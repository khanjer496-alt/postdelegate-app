import { Injectable } from '@nestjs/common';
import { auditErrorBody } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.audit.body';
import { ErrorBodyScrubRepository } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.body.scrub.repository';

export interface ErrorBodyScrubReport {
  dryRun: boolean;
  scanned: number;
  // rows written, or that a dry run would write
  updated: number;
  // already allowlisted
  unchanged: number;
  // changed or erased while the scrub ran
  skippedChanged: number;
}

// Rows per pattern. Only counted: these two columns are not rewritten.
export interface TokenLikeReport {
  'Errors.message': Record<string, number>;
  'Post.error': Record<string, number>;
}

// What a credential tends to look like inside a serialized failure: an
// Authorization header, an OAuth query string or JSON body, a Meta (EAA...)
// or Google (ya29.) access token. 'EAA' also matches ordinary text, so a hit
// is a reason to look, not proof of a leak.
export const TOKEN_LIKE_PATTERNS = [
  'Bearer ',
  'access_token=',
  'refresh_token',
  'EAA',
  'ya29.',
  '"token":"',
];

// Rewrites every Errors.body through auditErrorBody, so the rows written
// before the allowlist stop holding decrypted channel credentials. Idempotent
// and resumable: an allowlisted body comes back unchanged and is not written.
// It never logs a value, only counts.
@Injectable()
export class ErrorBodyScrubService {
  constructor(private _repository: ErrorBodyScrubRepository) {}

  async run(
    options: {
      batchSize?: number;
      dryRun?: boolean;
      onProgress?: (report: ErrorBodyScrubReport) => void;
    } = {}
  ): Promise<{
    bodies: ErrorBodyScrubReport;
    // null when the counts could not be taken; the rewrite still completed
    tokenLike: TokenLikeReport | null;
  }> {
    const batchSize = Math.max(1, options.batchSize ?? 200);
    const report: ErrorBodyScrubReport = {
      dryRun: !!options.dryRun,
      scanned: 0,
      updated: 0,
      unchanged: 0,
      skippedChanged: 0,
    };

    let cursor: string | undefined;
    for (;;) {
      const rows = await this._repository.page(batchSize, cursor);
      for (const row of rows) {
        report.scanned++;
        const body = auditErrorBody(row.body);
        if (body === row.body) {
          report.unchanged++;
          continue;
        }
        if (report.dryRun) {
          report.updated++;
          continue;
        }
        const changed = await this._repository.replace(row.id, row.body, body);
        if (changed.count) {
          report.updated++;
        } else {
          report.skippedChanged++;
        }
      }
      options.onProgress?.({ ...report });
      if (rows.length < batchSize) {
        break;
      }
      cursor = rows[rows.length - 1].id;
    }

    // The counts are unindexed LIKE scans over two large columns, so they can
    // hit a statement timeout. That must not turn a completed rewrite into a
    // failure: report them as unavailable and keep the rewrite's result. The
    // error itself is not logged, since a database error can echo the query.
    let tokenLike: TokenLikeReport | null = null;
    try {
      tokenLike = await this.countTokenLike();
    } catch {
      console.error('token-like counts unavailable');
    }

    return { bodies: report, tokenLike };
  }

  private async countTokenLike(): Promise<TokenLikeReport> {
    const tokenLike: TokenLikeReport = {
      'Errors.message': {},
      'Post.error': {},
    };
    for (const pattern of TOKEN_LIKE_PATTERNS) {
      tokenLike['Errors.message'][pattern] =
        await this._repository.countErrorMessagesContaining(pattern);
      tokenLike['Post.error'][pattern] =
        await this._repository.countPostErrorsContaining(pattern);
    }
    return tokenLike;
  }
}
