import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  PrismaRepository,
  PrismaService,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import {
  SubscriptionStatusSyncReport,
  SubscriptionStatusSyncService,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.status.sync.service';

// Stores Stripe's live status on every Stripe-billed plan and sets the trial
// flag from it (a trialing subscription, or one whose first charge after the
// trial is being retried, is a trial). Idempotent, so it
// can be re-run. It never changes a tier or a channel and never deletes:
// workspaces whose live subscription grants no plan are listed and the exit
// code is 2. Built with the backend, run inside the container (see
// deploy/postdelegate/subscription-status-rollout.md):
//
//   sync-subscription-status [--dry-run] [--batch-size=100]
//
// The release image wraps it under that name, as it does backfill-secrets.
@Module({
  providers: [
    PrismaService,
    PrismaRepository,
    PrismaTransaction,
    SubscriptionRepository,
    SubscriptionStatusSyncService,
  ],
})
class SyncSubscriptionStatusModule {}

// counts only, the lists are printed once at the end
const counts = (report: SubscriptionStatusSyncReport) => ({
  ...report,
  needsAttention: report.needsAttention.length,
  failed: report.failed.length,
});

async function bootstrap() {
  const args = process.argv.slice(2);
  const batchSize = Number(
    args.find((arg) => arg.startsWith('--batch-size='))?.split('=')[1] || 100
  );

  const app = await NestFactory.createApplicationContext(
    SyncSubscriptionStatusModule,
    { logger: ['error'] }
  );
  try {
    const report = await app.get(SubscriptionStatusSyncService).run({
      batchSize: Number.isFinite(batchSize) ? batchSize : 100,
      dryRun: args.includes('--dry-run'),
      onProgress: (progress) =>
        console.log(`progress ${JSON.stringify(counts(progress))}`),
    });
    for (const { organizationId, status } of report.needsAttention) {
      console.log(
        `needs attention: organization ${organizationId} (${status})`
      );
    }
    for (const organizationId of report.failed) {
      console.log(`not read: organization ${organizationId}`);
    }
    console.log(`done ${JSON.stringify(counts(report))}`);
    await app.close();
    // a non-zero exit when something was not synced, so it is noticed
    process.exit(
      report.needsAttention.length ||
        report.failed.length ||
        report.skippedChanged
        ? 2
        : 0
    );
  } catch (error) {
    console.error((error as Error).message);
    await app.close();
    process.exit(1);
  }
}

bootstrap();
