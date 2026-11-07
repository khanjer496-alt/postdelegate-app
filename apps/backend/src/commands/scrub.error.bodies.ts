import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  PrismaRepository,
  PrismaService,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ErrorBodyScrubRepository } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.body.scrub.repository';
import { ErrorBodyScrubService } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.body.scrub.service';

// Rewrites every Errors.body through the allowlist, so the rows written before
// it stop holding decrypted channel credentials. Idempotent, so it can be
// re-run or resumed. It also counts, read-only, the Errors.message and
// Post.error rows that look like they hold a token. Built with the backend,
// run inside the container (see deploy/postdelegate/error-body-scrub.md):
//
//   scrub-error-bodies [--dry-run] [--batch-size=200]
//
// The release image wraps it under that name, as it does backfill-secrets.
@Module({
  providers: [
    PrismaService,
    PrismaRepository,
    PrismaTransaction,
    ErrorBodyScrubRepository,
    ErrorBodyScrubService,
  ],
})
class ScrubErrorBodiesModule {}

async function bootstrap() {
  const args = process.argv.slice(2);
  const batchSize = Number(
    args.find((arg) => arg.startsWith('--batch-size='))?.split('=')[1] || 200
  );
  const app = await NestFactory.createApplicationContext(
    ScrubErrorBodiesModule,
    { logger: ['error'] }
  );
  try {
    const report = await app.get(ErrorBodyScrubService).run({
      batchSize: Number.isFinite(batchSize) ? batchSize : 200,
      dryRun: args.includes('--dry-run'),
      onProgress: (progress) =>
        console.log(`progress ${JSON.stringify(progress)}`),
    });
    console.log(`done ${JSON.stringify(report)}`);
    await app.close();
    // a non-zero exit when something could not be processed, so it is noticed.
    // The tokenLike counts (null when unavailable) are for reading, not for
    // the exit code: nothing here rewrites those columns, so a re-run could
    // never clear them.
    process.exit(report.bodies.skippedChanged ? 2 : 0);
  } catch (error) {
    console.error((error as Error).message);
    await app.close();
    process.exit(1);
  }
}

bootstrap();
