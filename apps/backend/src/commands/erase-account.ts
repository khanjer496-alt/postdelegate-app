// Operator command: permanently erase a person's data on a verified request.
// Built with the backend and run with node inside the production container:
//   erase-account --email user@example.com --dry-run
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { getTemporalModule } from '@gitroom/nestjs-libraries/temporal/temporal.module';
import { ErasureRepository } from '@gitroom/nestjs-libraries/database/prisma/erasure/erasure.repository';
import {
  ErasureRefusal,
  ErasureReport,
  ErasureService,
} from '@gitroom/nestjs-libraries/database/prisma/erasure/erasure.service';
import {
  ERASE_ACCOUNT_USAGE,
  parseEraseAccountArgs,
} from '@gitroom/backend/commands/erase-account.args';

// The erasure providers live here and not in DatabaseModule, so the API and the
// publishing worker are unchanged by this operator tool
@Module({
  imports: [DatabaseModule, getTemporalModule(false)],
  providers: [ErasureRepository, ErasureService],
})
export class EraseAccountModule {}

const formatCounts = (counts: Record<string, number | null>) =>
  Object.entries(counts)
    .filter(([, count]) => count !== 0)
    .map(
      ([table, count]) =>
        `    ${table.padEnd(34)} ${count === null ? 'table missing' : count}`
    )
    .join('\n') || '    (nothing)';

export const formatReport = (report: ErasureReport) => {
  const real = report.mode === 'erase';
  const lines = [
    real ? 'ERASURE' : 'DRY RUN (nothing is changed)',
    `email hash: ${report.emailHash}`,
    `accounts (${report.users.length}):`,
    ...report.users.map(
      (user) =>
        `  ${user.id}  ${user.providerName}${
          user.removedFromApp ? '  (already removed from the app)' : ''
        }`
    ),
  ];

  for (const org of report.organizations) {
    lines.push(
      '',
      `organization ${org.id}: ${
        org.action === 'ERASE'
          ? 'ERASE entirely (the person is the only member)'
          : 'LEAVE (shared workspace, content kept)'
      }  [${org.status}]`,
      formatCounts(org.tables)
    );
    if (org.aiMemory) {
      lines.push('  AI memory:', formatCounts(org.aiMemory));
    }
    if (org.objects) {
      const o = org.objects;
      lines.push(
        `  uploaded objects: ${o.candidates} found` +
          (o.deleted !== undefined
            ? `, ${o.deleted} deleted, ${o.alreadyMissing} already missing, ${
                o.sharedKept
              } kept (still referenced), ${o.failed?.length || 0} failed`
            : '')
      );
      for (const key of o.failed || []) lines.push(`    FAILED ${key}`);
    }
    if (org.workflows) {
      lines.push(
        `  temporal workflows: ${org.workflows.candidates} candidates` +
          (org.workflows.terminated !== undefined
            ? `, ${org.workflows.terminated} terminated`
            : '')
      );
    }
    if (org.hasSubscription) {
      lines.push('  billing: subscription is cancelled before erasing');
    }
    for (const blocker of org.blockers) lines.push(`  BLOCKED: ${blocker}`);
  }

  for (const user of report.users) {
    if (!Object.keys(user.tables).length) continue;
    lines.push(
      '',
      `account ${user.id}: ${real ? 'erased' : 'will be erased'}${
        user.tombstone
          ? ` (kept as an anonymised tombstone, ${user.commissions} commission(s) in the ledger)`
          : ''
      }  [${user.status}]`,
      formatCounts(user.tables)
    );
    if (user.objects) {
      lines.push(
        `  uploaded objects: ${user.objects.candidates} found, ${
          user.objects.deleted
        } deleted, ${user.objects.failed?.length || 0} failed`
      );
    }
  }

  if (report.notes.length) {
    lines.push('', ...report.notes.map((note) => `note: ${note}`));
  }
  if (report.followUp.length) {
    lines.push(
      '',
      `${report.followUp.length} manual follow-up(s) are listed in the receipt.`
    );
  }
  if (report.receiptPath) lines.push(`receipt: ${report.receiptPath}`);
  if (!real) {
    lines.push(
      '',
      'To erase for real, repeat the target: erase-account --email <email> --confirm <email>'
    );
  }

  return lines.join('\n');
};

async function main() {
  process.env.TZ = 'UTC';

  let options: ReturnType<typeof parseEraseAccountArgs>;
  try {
    options = parseEraseAccountArgs(process.argv.slice(2));
  } catch (err: any) {
    console.error(`${err.message}\n\n${ERASE_ACCOUNT_USAGE}`);
    process.exit(2);
  }
  if (options.help) {
    console.log(ERASE_ACCOUNT_USAGE);
    process.exit(0);
  }

  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
  try {
    app = await NestFactory.createApplicationContext(EraseAccountModule, {
      logger: ['error'],
    });
  } catch (err: any) {
    // typically the database or Temporal is unreachable, nothing was touched
    console.error(
      'Could not start:',
      String(err?.message || err).split('\n')[0]
    );
    process.exit(1);
  }

  let code = 0;
  try {
    const report = await app.get(ErasureService).run(options);
    console.log(formatReport(report));
  } catch (err: any) {
    if (err instanceof ErasureRefusal) {
      console.error(`REFUSED (${err.code}): ${err.message}`);
      code = err.code === 'BLOCKED' ? 3 : 2;
    } else {
      console.error('ERASURE FAILED:', err?.message || err);
      code = 1;
    }
  }

  await app.close().catch(() => undefined);
  // redis and temporal connections keep the event loop alive
  process.exit(code);
}

if (require.main === module) {
  main();
}
