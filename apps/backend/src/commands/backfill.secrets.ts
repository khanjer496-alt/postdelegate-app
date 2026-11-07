import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  PrismaRepository,
  PrismaService,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { SecretBackfillRepository } from '@gitroom/nestjs-libraries/database/prisma/secrets/secret.backfill.repository';
import {
  NOT_ROTATABLE,
  SecretBackfillGroup,
  SecretBackfillService,
} from '@gitroom/nestjs-libraries/database/prisma/secrets/secret.backfill.service';

// Converts the credentials earlier releases stored with
// AuthService.fixedEncryption onto the scheme each field now uses. Idempotent,
// so it can be re-run or resumed. Built with the backend, run inside the
// container (see deploy/postdelegate/secrets-at-rest-rollout.md):
//
//   backfill-secrets [--dry-run] [--only=org|oauth|credentials|integrations] [--batch-size=200]
//
// With --rotate it instead moves rows off a retired TOKEN_ENCRYPTION_KEY_PREVIOUS
// onto the current key. Only the columns that can be rotated run; it prints the
// ones that cannot.
//
// The release image wraps it under that name, as it does erase-account.
@Module({
  providers: [
    PrismaService,
    PrismaRepository,
    PrismaTransaction,
    SecretBackfillRepository,
    SecretBackfillService,
  ],
})
class BackfillSecretsModule {}

const GROUPS: SecretBackfillGroup[] = [
  'org',
  'oauth',
  'credentials',
  'integrations',
];

async function bootstrap() {
  const args = process.argv.slice(2);
  const batchSize = Number(
    args.find((arg) => arg.startsWith('--batch-size='))?.split('=')[1] || 200
  );
  const only = args
    .find((arg) => arg.startsWith('--only='))
    ?.split('=')[1] as SecretBackfillGroup | undefined;

  if (only && !GROUPS.includes(only)) {
    console.error(`--only must be one of: ${GROUPS.join(', ')}`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(
    BackfillSecretsModule,
    { logger: ['error'] }
  );
  try {
    const rotate = args.includes('--rotate');
    if (rotate) {
      console.log(
        `rotate: these columns cannot be re-keyed, because an HMAC cannot be recomputed without the plaintext and the customer holds it: ${NOT_ROTATABLE.join(
          ', '
        )}. Keep TOKEN_ENCRYPTION_KEY_PREVIOUS until those credentials are re-issued.`
      );
    }
    const reports = await app.get(SecretBackfillService).run({
      batchSize: Number.isFinite(batchSize) ? batchSize : 200,
      dryRun: args.includes('--dry-run'),
      only,
      rotate,
      onProgress: (progress) =>
        console.log(`progress ${JSON.stringify(progress)}`),
    });
    console.log(`done ${JSON.stringify(reports)}`);
    const needsAttention = Object.values(reports).some(
      (report) => report.unreadable || report.skippedChanged
    );
    await app.close();
    // a non-zero exit when something could not be processed, so it is noticed
    process.exit(needsAttention ? 2 : 0);
  } catch (error) {
    console.error((error as Error).message);
    await app.close();
    process.exit(1);
  }
}

bootstrap();
