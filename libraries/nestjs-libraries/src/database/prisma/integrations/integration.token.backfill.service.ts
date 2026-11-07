import { Injectable } from '@nestjs/common';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import {
  TokenEncryption,
  TokenEncryptionError,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/token.encryption';

export interface TokenBackfillReport {
  dryRun: boolean;
  scanned: number;
  // rows that were written (or would be written in a dry run)
  updated: number;
  // already encrypted with the current key, nothing to do
  unchanged: number;
  // changed by a reconnect or refresh while the backfill ran, left alone
  skippedChanged: number;
  // could not be decrypted, never modified
  unreadable: number;
}

// Encrypts the plaintext access/refresh tokens that were stored before
// TOKEN_ENCRYPTION_KEY was set. Idempotent: encrypted values are never
// touched again, so it can be re-run (or resumed) safely. With reencrypt it
// also moves values encrypted with a retired key (TOKEN_ENCRYPTION_KEY_PREVIOUS)
// to the current key. It never logs token values.
@Injectable()
export class IntegrationTokenBackfillService {
  constructor(private _integrationRepository: IntegrationRepository) {}

  private convert(value: string | null, reencrypt: boolean) {
    if (!value) return value;
    if (TokenEncryption.needsEncryption(value)) {
      const encrypted = TokenEncryption.encrypt(value);
      // never write a value that does not read back as the original
      if (TokenEncryption.decrypt(encrypted) !== value) {
        throw new TokenEncryptionError('Encrypted value does not round-trip');
      }
      return encrypted;
    }
    if (reencrypt && TokenEncryption.needsReencryption(value)) {
      return TokenEncryption.encrypt(TokenEncryption.decrypt(value));
    }
    if (TokenEncryption.isEncrypted(value)) {
      // verifies it is readable, throws otherwise
      TokenEncryption.decrypt(value);
    }
    return value;
  }

  async run(
    options: {
      batchSize?: number;
      dryRun?: boolean;
      reencrypt?: boolean;
      onProgress?: (report: TokenBackfillReport) => void;
    } = {}
  ): Promise<TokenBackfillReport> {
    if (!TokenEncryption.isEnabled()) {
      throw new TokenEncryptionError(
        'TOKEN_ENCRYPTION_KEY is not set, nothing to encrypt with'
      );
    }
    const batchSize = Math.max(1, options.batchSize ?? 200);
    const dryRun = !!options.dryRun;
    const report: TokenBackfillReport = {
      dryRun,
      scanned: 0,
      updated: 0,
      unchanged: 0,
      skippedChanged: 0,
      unreadable: 0,
    };

    let cursor: string | undefined;
    for (;;) {
      const rows = await this._integrationRepository.getStoredCredentialsPage(
        batchSize,
        cursor
      );
      for (const row of rows) {
        report.scanned++;
        let next: { token: string; refreshToken: string | null };
        try {
          next = {
            token: this.convert(row.token, !!options.reencrypt) as string,
            refreshToken: this.convert(row.refreshToken, !!options.reencrypt),
          };
        } catch (err) {
          report.unreadable++;
          console.error(`Integration ${row.id}: ${(err as Error).message}`);
          continue;
        }
        if (next.token === row.token && next.refreshToken === row.refreshToken) {
          report.unchanged++;
          continue;
        }
        if (dryRun) {
          report.updated++;
          continue;
        }
        const changed = await this._integrationRepository.replaceStoredCredentials(
          row.id,
          row,
          next
        );
        if (changed.count) report.updated++;
        else report.skippedChanged++;
      }
      options.onProgress?.({ ...report });
      if (rows.length < batchSize) break;
      cursor = rows[rows.length - 1].id;
    }
    return report;
  }
}
