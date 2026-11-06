import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  PrismaRepository,
  PrismaService,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationTokenBackfillService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.token.backfill.service';

// Encrypts the social tokens that are still stored in plaintext. Built with the
// backend, run inside the container (see deploy/postdelegate/README.md):
//
//   node apps/backend/dist/apps/backend/src/commands/backfill.integration.tokens.js [--dry-run] [--reencrypt] [--batch-size=200]
@Module({
  providers: [
    PrismaService,
    PrismaRepository,
    PrismaTransaction,
    NotificationsRepository,
    IntegrationRepository,
    IntegrationTokenBackfillService,
  ],
})
class BackfillIntegrationTokensModule {}

async function bootstrap() {
  const args = process.argv.slice(2);
  const batchSize = Number(
    args.find((arg) => arg.startsWith('--batch-size='))?.split('=')[1] || 200
  );
  const app = await NestFactory.createApplicationContext(
    BackfillIntegrationTokensModule,
    { logger: ['error'] }
  );
  try {
    const report = await app
      .get(IntegrationTokenBackfillService)
      .run({
        batchSize: Number.isFinite(batchSize) ? batchSize : 200,
        dryRun: args.includes('--dry-run'),
        reencrypt: args.includes('--reencrypt'),
        onProgress: (progress) =>
          console.log(`progress ${JSON.stringify(progress)}`),
      });
    console.log(`done ${JSON.stringify(report)}`);
    await app.close();
    // a non-zero exit when something could not be processed, so it is noticed
    process.exit(report.unreadable || report.skippedChanged ? 2 : 0);
  } catch (error) {
    console.error((error as Error).message);
    await app.close();
    process.exit(1);
  }
}

bootstrap();
