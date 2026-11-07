import { Injectable } from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { AI_CREDENTIAL_LABEL } from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.repository';
import { CUSTOM_INSTANCE_DETAILS_LABEL } from '@gitroom/nestjs-libraries/database/prisma/integrations/custom.instance.details';
import {
  MCP_RELAY_KEY_LABEL,
  OAUTH_SECRET_LABELS,
} from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { ORG_API_KEY_LABEL } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { THIRD_PARTY_KEY_LABEL } from '@gitroom/nestjs-libraries/database/prisma/third-party/third-party.repository';
import {
  SecretBackfillRepository,
  SecretTable,
} from '@gitroom/nestjs-libraries/database/prisma/secrets/secret.backfill.repository';
import {
  SecretCrypto,
  SecretCryptoError,
} from '@gitroom/nestjs-libraries/database/prisma/secrets/secret.crypto';

export interface SecretBackfillReport {
  table: SecretTable;
  dryRun: boolean;
  scanned: number;
  // rows written, or that a dry run would write
  updated: number;
  // already on the current scheme
  unchanged: number;
  // changed by a reconnect, refresh or rotation while the backfill ran
  skippedChanged: number;
  // could not be read, never modified
  unreadable: number;
}

export type SecretBackfillGroup =
  | 'org'
  | 'oauth'
  | 'credentials'
  | 'integrations';

type Plan = {
  table: SecretTable;
  group: SecretBackfillGroup;
  columns: string[];
  // the values to write, or null when the row is already current. Throws when
  // the stored value cannot be read, which the caller counts as unreadable.
  convert(row: Record<string, any>): Record<string, string | null> | null;
  // moves a row that is still readable only with a retired key onto the
  // current one. Absent when the column cannot be rotated at all.
  rotate?(row: Record<string, any>): Record<string, string | null> | null;
};

// Why some columns cannot be rotated: an HMAC cannot be recomputed without the
// plaintext, and for these the plaintext is held only by the customer. So
// retiring a TOKEN_ENCRYPTION_KEY that any of these were hashed with means
// either keeping it in TOKEN_ENCRYPTION_KEY_PREVIOUS until the credentials are
// re-issued, or deliberately invalidating them - which forces every connected
// app to authorise again. The rotation command prints this list.
//
// Organization.apiKeyHash is NOT here: its plaintext is recoverable from the
// encrypted copy in the same row, so it can be re-hashed.
export const NOT_ROTATABLE = [
  'OAuthAuthorization.accessToken',
  'OAuthApp.clientSecret',
  'OAuthSelfHostedAuthorization.accessToken',
];

// The legacy plaintext behind a value written by an earlier release. Throws
// when it is not a legacy value at all, so a row nobody can read is reported
// rather than overwritten.
const legacyPlaintext = (value: string) => {
  const plaintext = AuthService.fixedDecryption(value);
  if (!plaintext) {
    throw new SecretCryptoError('A stored secret read back empty');
  }
  return plaintext;
};

// A secret that is only ever matched: store its HMAC.
const toHash = (value: string | null, label: string) => {
  if (!value || SecretCrypto.isHashed(value)) {
    return null;
  }
  return SecretCrypto.hash(legacyPlaintext(value), label);
};

// Moves a ciphertext from a retired key onto the current one. null when it is
// already current, or is not this module's ciphertext at all.
const reCipher = (value: string | null, label: string) => {
  if (!value || !SecretCrypto.needsReencryption(value, label)) {
    return null;
  }
  const plaintext = SecretCrypto.decrypt(value, label);
  const encrypted = SecretCrypto.encrypt(plaintext, label);
  if (SecretCrypto.decrypt(encrypted, label) !== plaintext) {
    throw new SecretCryptoError('Re-encrypted value does not round-trip');
  }
  return encrypted;
};

// A secret that has to be read back: store authenticated ciphertext, and never
// write one that does not read back as the original.
const toCipher = (value: string | null, label: string) => {
  if (!value || SecretCrypto.isEncrypted(value)) {
    return null;
  }
  const plaintext = legacyPlaintext(value);
  const encrypted = SecretCrypto.encrypt(plaintext, label);
  if (SecretCrypto.decrypt(encrypted, label) !== plaintext) {
    throw new SecretCryptoError('Encrypted value does not round-trip');
  }
  return encrypted;
};

// One column, read back and re-stored under `label`.
const cipherPlan = (
  table: SecretTable,
  group: SecretBackfillGroup,
  column: string,
  label: string
): Plan => ({
  table,
  group,
  columns: [column],
  convert: (row) => {
    const next = toCipher(row[column], label);
    return next ? { [column]: next } : null;
  },
  rotate: (row) => {
    const next = reCipher(row[column], label);
    return next ? { [column]: next } : null;
  },
});

// One column, matched only, so hashed.
const hashPlan = (
  table: SecretTable,
  group: SecretBackfillGroup,
  column: string,
  label: string
): Plan => ({
  table,
  group,
  columns: [column],
  convert: (row) => {
    const next = toHash(row[column], label);
    return next ? { [column]: next } : null;
  },
});

// Converts every credential an earlier release stored with
// AuthService.fixedEncryption onto the scheme its field now uses. Idempotent
// and resumable: a converted row is never touched again, so it can be re-run.
// It never logs a secret value.
//
// Authorization codes are deliberately not converted: they expire ten minutes
// after they are issued, so by the time a backfill runs there is nothing left
// to convert, and both forms are accepted while they live.
@Injectable()
export class SecretBackfillService {
  constructor(private _repository: SecretBackfillRepository) {}

  private plans(): Plan[] {
    return [
      {
        table: 'organization',
        group: 'org',
        columns: ['apiKey', 'apiKeyHash'],
        convert: (row) => {
          if (!row.apiKey) {
            return null;
          }
          // A pre-migration row holds the key itself: the random id behind it
          // was discarded at creation. So the key to hash and encrypt is the
          // stored value, never what is inside it.
          const key = SecretCrypto.isEncrypted(row.apiKey)
            ? SecretCrypto.decrypt(row.apiKey, ORG_API_KEY_LABEL)
            : row.apiKey;
          const apiKey = SecretCrypto.isEncrypted(row.apiKey)
            ? row.apiKey
            : SecretCrypto.encrypt(key, ORG_API_KEY_LABEL);
          const apiKeyHash = SecretCrypto.hash(key, ORG_API_KEY_LABEL);
          if (apiKey === row.apiKey && apiKeyHash === row.apiKeyHash) {
            return null;
          }
          if (SecretCrypto.decrypt(apiKey, ORG_API_KEY_LABEL) !== key) {
            throw new SecretCryptoError('Encrypted value does not round-trip');
          }
          return { apiKey, apiKeyHash };
        },
        // The one hashed column that can be rotated: the key is recoverable
        // from the encrypted copy beside it, so the hash can be recomputed.
        rotate: (row) => {
          if (!row.apiKey || !SecretCrypto.isEncrypted(row.apiKey)) {
            return null;
          }
          const key = SecretCrypto.decrypt(row.apiKey, ORG_API_KEY_LABEL);
          const apiKey = reCipher(row.apiKey, ORG_API_KEY_LABEL) ?? row.apiKey;
          const apiKeyHash = SecretCrypto.hash(key, ORG_API_KEY_LABEL);
          if (apiKey === row.apiKey && apiKeyHash === row.apiKeyHash) {
            return null;
          }
          if (SecretCrypto.decrypt(apiKey, ORG_API_KEY_LABEL) !== key) {
            throw new SecretCryptoError('Re-encrypted value does not round-trip');
          }
          return { apiKey, apiKeyHash };
        },
      },
      hashPlan(
        'oAuthAuthorization',
        'oauth',
        'accessToken',
        OAUTH_SECRET_LABELS.accessToken
      ),
      hashPlan(
        'oAuthApp',
        'oauth',
        'clientSecret',
        OAUTH_SECRET_LABELS.clientSecret
      ),
      {
        table: 'oAuthSelfHostedAuthorization',
        group: 'oauth',
        columns: ['accessToken', 'apiKey'],
        convert: (row) => {
          const accessToken = toHash(
            row.accessToken,
            OAUTH_SECRET_LABELS.accessToken
          );
          const apiKey = toCipher(row.apiKey, MCP_RELAY_KEY_LABEL);
          if (!accessToken && !apiKey) {
            return null;
          }
          return {
            ...(accessToken ? { accessToken } : {}),
            ...(apiKey ? { apiKey } : {}),
          };
        },
        // accessToken is an HMAC and cannot be re-hashed; only the relay key
        // moves. See NOT_ROTATABLE.
        rotate: (row) => {
          const apiKey = reCipher(row.apiKey, MCP_RELAY_KEY_LABEL);
          return apiKey ? { apiKey } : null;
        },
      },
      cipherPlan('aiCredential', 'credentials', 'apiKey', AI_CREDENTIAL_LABEL),
      cipherPlan('thirdParty', 'credentials', 'apiKey', THIRD_PARTY_KEY_LABEL),
      cipherPlan(
        'integration',
        'integrations',
        'customInstanceDetails',
        CUSTOM_INSTANCE_DETAILS_LABEL
      ),
    ];
  }

  async run(
    options: {
      batchSize?: number;
      dryRun?: boolean;
      only?: SecretBackfillGroup;
      // move rows off a retired TOKEN_ENCRYPTION_KEY_PREVIOUS instead of
      // converting legacy values. Only the columns that can be rotated run.
      rotate?: boolean;
      onProgress?: (report: SecretBackfillReport) => void;
    } = {}
  ): Promise<Record<string, SecretBackfillReport>> {
    if (!SecretCrypto.isEnabled()) {
      throw new SecretCryptoError(
        'TOKEN_ENCRYPTION_KEY is not set, nothing to convert with'
      );
    }

    const batchSize = Math.max(1, options.batchSize ?? 200);
    const dryRun = !!options.dryRun;
    const plans = this.plans()
      .filter((plan) => !options.only || plan.group === options.only)
      .filter((plan) => !options.rotate || !!plan.rotate);
    const reports: Record<string, SecretBackfillReport> = {};

    for (const plan of plans) {
      const report: SecretBackfillReport = {
        table: plan.table,
        dryRun,
        scanned: 0,
        updated: 0,
        unchanged: 0,
        skippedChanged: 0,
        unreadable: 0,
      };
      reports[plan.table] = report;

      let cursor: string | undefined;
      for (;;) {
        const rows = await this._repository.page(
          plan.table,
          plan.columns,
          batchSize,
          cursor
        );
        for (const row of rows) {
          report.scanned++;
          let next: Record<string, string | null> | null;
          try {
            next = options.rotate
              ? plan.rotate!(row)
              : plan.convert(row);
          } catch (err) {
            report.unreadable++;
            // the row id, never the value
            console.error(
              `${plan.table} ${row.id}: ${(err as Error).message}`
            );
            continue;
          }
          if (!next) {
            report.unchanged++;
            continue;
          }
          if (dryRun) {
            report.updated++;
            continue;
          }
          const previous = plan.columns.reduce(
            (where, column) => ({ ...where, [column]: row[column] }),
            {} as Record<string, unknown>
          );
          const changed = await this._repository.replace(
            plan.table,
            row.id,
            previous,
            next
          );
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
    }

    return reports;
  }
}
