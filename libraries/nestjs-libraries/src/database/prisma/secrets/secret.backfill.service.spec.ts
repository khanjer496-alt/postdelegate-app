import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { ORG_API_KEY_LABEL } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { AI_CREDENTIAL_LABEL } from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.repository';
import { OAUTH_SECRET_LABELS } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import {
  NOT_ROTATABLE,
  SecretBackfillService,
} from '@gitroom/nestjs-libraries/database/prisma/secrets/secret.backfill.service';
import {
  SecretCrypto,
  SecretCryptoError,
} from '@gitroom/nestjs-libraries/database/prisma/secrets/secret.crypto';

const KEY = Buffer.alloc(32, 23).toString('base64');

// Stands in for SecretBackfillRepository: holds rows per table and applies the
// same compare-and-swap the real updateMany does, so "the row changed under us"
// is real behaviour here rather than a mocked branch.
const repositoryFake = (tables: Record<string, any[]> = {}) => {
  const rows = tables;
  const repository = {
    page: jest.fn(
      async (table: string, _columns: string[], take: number, cursor?: string) =>
        (rows[table] ?? [])
          .filter((row) => !cursor || row.id > cursor)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, take)
          .map((row) => ({ ...row }))
    ),
    replace: jest.fn(
      async (
        table: string,
        id: string,
        previous: Record<string, unknown>,
        next: Record<string, unknown>
      ) => {
        const row = (rows[table] ?? []).find((candidate) => candidate.id === id);
        if (!row) return { count: 0 };
        const stillThere = Object.entries(previous).every(
          ([column, value]) => row[column] === value
        );
        if (!stillThere) return { count: 0 };
        Object.assign(row, next);
        return { count: 1 };
      }
    ),
  };
  return { rows, repository };
};

describe('SecretBackfillService', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
    process.env.JWT_SECRET = 'unit-test-secret';
    SecretCrypto.reset();
  });

  afterAll(() => {
    process.env = { ...env };
    SecretCrypto.reset();
  });

  it('refuses to run with no key configured', async () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    SecretCrypto.reset();
    const { repository } = repositoryFake();

    await expect(
      new SecretBackfillService(repository as any).run()
    ).rejects.toThrow(SecretCryptoError);
  });

  describe('organizations', () => {
    // The pre-migration row holds the key itself. The backfill must hash and
    // encrypt THAT value, not the id hiding inside it.
    const legacyKey = AuthService.fixedEncryption('discarded-random-id');

    it('hashes and encrypts the key the customer holds', async () => {
      const { repository, rows } = repositoryFake({
        organization: [
          { id: 'org-1', apiKey: legacyKey, apiKeyHash: null },
        ],
      });

      const report = await new SecretBackfillService(repository as any).run({
        only: 'org',
      });

      const row = rows.organization[0];
      expect(row.apiKeyHash).toBe(
        SecretCrypto.hash(legacyKey, ORG_API_KEY_LABEL)
      );
      expect(SecretCrypto.decrypt(row.apiKey, ORG_API_KEY_LABEL)).toBe(
        legacyKey
      );
      expect(report.organization.updated).toBe(1);
    });

    it('is idempotent: a second run changes nothing', async () => {
      const { repository, rows } = repositoryFake({
        organization: [{ id: 'org-1', apiKey: legacyKey, apiKeyHash: null }],
      });
      const service = new SecretBackfillService(repository as any);

      await service.run({ only: 'org' });
      const afterFirst = { ...rows.organization[0] };
      const second = await service.run({ only: 'org' });

      expect(rows.organization[0]).toEqual(afterFirst);
      expect(second.organization.updated).toBe(0);
      expect(second.organization.unchanged).toBe(1);
    });

    it('writes nothing in a dry run but reports what it would write', async () => {
      const { repository, rows } = repositoryFake({
        organization: [{ id: 'org-1', apiKey: legacyKey, apiKeyHash: null }],
      });

      const report = await new SecretBackfillService(repository as any).run({
        only: 'org',
        dryRun: true,
      });

      expect(rows.organization[0].apiKeyHash).toBe(null);
      expect(rows.organization[0].apiKey).toBe(legacyKey);
      expect(report.organization.updated).toBe(1);
      expect(report.organization.dryRun).toBe(true);
      expect(repository.replace).not.toHaveBeenCalled();
    });

    it('skips a row that changed while the batch was in flight', async () => {
      const { repository, rows } = repositoryFake({
        organization: [{ id: 'org-1', apiKey: legacyKey, apiKeyHash: null }],
      });
      repository.page = jest.fn(async () => {
        // the row the backfill reads is already stale
        rows.organization[0].apiKey = AuthService.fixedEncryption('rotated');
        return [{ id: 'org-1', apiKey: legacyKey, apiKeyHash: null }];
      }) as any;

      const report = await new SecretBackfillService(repository as any).run({
        only: 'org',
      });

      expect(report.organization.skippedChanged).toBe(1);
      expect(report.organization.updated).toBe(0);
    });

    it('pages through more rows than one batch', async () => {
      const organization = Array.from({ length: 5 }, (_, i) => ({
        id: `org-${i}`,
        apiKey: AuthService.fixedEncryption(`id-${i}`),
        apiKeyHash: null,
      }));
      const { repository, rows } = repositoryFake({ organization });

      const report = await new SecretBackfillService(repository as any).run({
        only: 'org',
        batchSize: 2,
      });

      expect(report.organization.scanned).toBe(5);
      expect(report.organization.updated).toBe(5);
      expect(rows.organization.every((row) => !!row.apiKeyHash)).toBe(true);
    });
  });

  describe('verification and failures', () => {
    it('leaves a row it cannot read alone and counts it unreadable', async () => {
      const { repository, rows } = repositoryFake({
        aiCredential: [{ id: 'ai-1', apiKey: 'not-hex-and-not-encrypted!!' }],
      });

      const report = await new SecretBackfillService(repository as any).run({
        only: 'credentials',
      });

      expect(rows.aiCredential[0].apiKey).toBe('not-hex-and-not-encrypted!!');
      expect(report.aiCredential.unreadable).toBe(1);
      expect(report.aiCredential.updated).toBe(0);
    });

    it('converts an AI key and reads it back as the original', async () => {
      const { repository, rows } = repositoryFake({
        aiCredential: [
          { id: 'ai-1', apiKey: AuthService.fixedEncryption('sk-proj-key') },
        ],
      });

      await new SecretBackfillService(repository as any).run({
        only: 'credentials',
      });

      expect(rows.aiCredential[0].apiKey.startsWith('enc:v1:')).toBe(true);
      expect(
        SecretCrypto.decrypt(rows.aiCredential[0].apiKey, AI_CREDENTIAL_LABEL)
      ).toBe('sk-proj-key');
    });
  });

  describe('oauth', () => {
    it('replaces a legacy access token with its hash', async () => {
      const token = 'pos_live';
      const { repository, rows } = repositoryFake({
        oAuthAuthorization: [
          { id: 'auth-1', accessToken: AuthService.fixedEncryption(token) },
        ],
      });

      await new SecretBackfillService(repository as any).run({
        only: 'oauth',
      });

      expect(rows.oAuthAuthorization[0].accessToken).toBe(
        SecretCrypto.hash(token, OAUTH_SECRET_LABELS.accessToken)
      );
    });

    it('leaves a row whose token is already hashed', async () => {
      const hashed = SecretCrypto.hash('pos_live', OAUTH_SECRET_LABELS.accessToken);
      const { repository, rows } = repositoryFake({
        oAuthAuthorization: [{ id: 'auth-1', accessToken: hashed }],
      });

      const report = await new SecretBackfillService(repository as any).run({
        only: 'oauth',
      });

      expect(rows.oAuthAuthorization[0].accessToken).toBe(hashed);
      expect(report.oAuthAuthorization.unchanged).toBe(1);
    });
  });

  // Completing a rotation: TOKEN_ENCRYPTION_KEY_PREVIOUS cannot be retired
  // until everything still readable only with it has been moved.
  describe('rotation (--rotate)', () => {
    const rotateTo = (newKey: string) => {
      process.env.TOKEN_ENCRYPTION_KEY = newKey;
      process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = KEY;
      SecretCrypto.reset();
    };
    const K2 = Buffer.alloc(32, 24).toString('base64');

    it('re-encrypts a credential left on the retired key', async () => {
      const underK1 = SecretCrypto.encrypt('sk-proj-key', AI_CREDENTIAL_LABEL);
      const { repository, rows } = repositoryFake({
        aiCredential: [{ id: 'ai-1', apiKey: underK1 }],
      });
      rotateTo(K2);

      const report = await new SecretBackfillService(repository as any).run({
        rotate: true,
        only: 'credentials',
      });

      expect(rows.aiCredential[0].apiKey).not.toBe(underK1);
      expect(SecretCrypto.needsReencryption(rows.aiCredential[0].apiKey, AI_CREDENTIAL_LABEL)).toBe(false);
      expect(SecretCrypto.decrypt(rows.aiCredential[0].apiKey, AI_CREDENTIAL_LABEL)).toBe('sk-proj-key');
      expect(report.aiCredential.updated).toBe(1);
    });

    it('leaves a credential already on the current key', async () => {
      rotateTo(K2);
      const underK2 = SecretCrypto.encrypt('sk-proj-key', AI_CREDENTIAL_LABEL);
      const { repository, rows } = repositoryFake({
        aiCredential: [{ id: 'ai-1', apiKey: underK2 }],
      });

      const report = await new SecretBackfillService(repository as any).run({
        rotate: true,
        only: 'credentials',
      });

      expect(rows.aiCredential[0].apiKey).toBe(underK2);
      expect(report.aiCredential.unchanged).toBe(1);
    });

    // The org key is the one hashed column that CAN be rotated: its plaintext
    // is recoverable from the encrypted copy in the same row.
    it('re-encrypts the org key and re-hashes it under the new key', async () => {
      const key = 'original-api-key-value';
      const underK1 = SecretCrypto.encrypt(key, ORG_API_KEY_LABEL);
      const hashK1 = SecretCrypto.hash(key, ORG_API_KEY_LABEL);
      const { repository, rows } = repositoryFake({
        organization: [{ id: 'org-1', apiKey: underK1, apiKeyHash: hashK1 }],
      });
      rotateTo(K2);

      await new SecretBackfillService(repository as any).run({
        rotate: true,
        only: 'org',
      });

      expect(rows.organization[0].apiKeyHash).toBe(
        SecretCrypto.hash(key, ORG_API_KEY_LABEL)
      );
      expect(rows.organization[0].apiKeyHash).not.toBe(hashK1);
      expect(
        SecretCrypto.decrypt(rows.organization[0].apiKey, ORG_API_KEY_LABEL)
      ).toBe(key);
      expect(
        SecretCrypto.needsReencryption(rows.organization[0].apiKey, ORG_API_KEY_LABEL)
      ).toBe(false);
    });

    // An HMAC cannot be recomputed without the plaintext, and for these the
    // plaintext is held only by the customer. The retired key has to stay, or
    // the credentials have to be re-issued. Silently reporting them as done
    // would be the dangerous outcome.
    it('does not touch, and names, the columns it cannot rotate', async () => {
      const underK1 = SecretCrypto.hash('pos_live', OAUTH_SECRET_LABELS.accessToken);
      const { repository, rows } = repositoryFake({
        oAuthAuthorization: [{ id: 'auth-1', accessToken: underK1 }],
      });
      rotateTo(K2);

      const report = await new SecretBackfillService(repository as any).run({
        rotate: true,
      });

      expect(rows.oAuthAuthorization[0].accessToken).toBe(underK1);
      expect(report.oAuthAuthorization).toBeUndefined();
      expect(NOT_ROTATABLE.length).toBeGreaterThan(0);
      expect(NOT_ROTATABLE.join(' ')).toContain('OAuthAuthorization.accessToken');
    });

    it('a normal run does not re-encrypt a retired-key value', async () => {
      const underK1 = SecretCrypto.encrypt('sk-proj-key', AI_CREDENTIAL_LABEL);
      const { repository, rows } = repositoryFake({
        aiCredential: [{ id: 'ai-1', apiKey: underK1 }],
      });
      rotateTo(K2);

      const report = await new SecretBackfillService(repository as any).run({
        only: 'credentials',
      });

      expect(rows.aiCredential[0].apiKey).toBe(underK1);
      expect(report.aiCredential.unchanged).toBe(1);
    });
  });

  it('reports every table it touched when no filter is given', async () => {
    const { repository } = repositoryFake();
    const report = await new SecretBackfillService(repository as any).run();

    expect(Object.keys(report).sort()).toEqual(
      [
        'aiCredential',
        'integration',
        'oAuthApp',
        'oAuthAuthorization',
        'oAuthSelfHostedAuthorization',
        'organization',
        'thirdParty',
      ].sort()
    );
  });
});
