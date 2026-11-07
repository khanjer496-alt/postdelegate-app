import { AuthService } from '@gitroom/helpers/auth/auth.service';
import {
  ORG_API_KEY_LABEL,
  OrganizationRepository,
} from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { SecretCrypto } from '@gitroom/nestjs-libraries/database/prisma/secrets/secret.crypto';

const KEY = Buffer.alloc(32, 5).toString('base64');

// Matches rows the way Postgres does: exact equality on the column, or
// membership of the candidate list.
const matches = (row: any, where: any) => {
  if (where.OR) {
    return where.OR.some((clause: any) => matches(row, clause));
  }
  if (where.apiKeyHash?.in) {
    return !!row.apiKeyHash && where.apiKeyHash.in.includes(row.apiKeyHash);
  }
  if (where.apiKey !== undefined) {
    return !!row.apiKey && row.apiKey === where.apiKey;
  }
  return false;
};

const setup = () => {
  const rows: any[] = [];
  const findFirst = jest.fn(async ({ where }: any) => {
    if (where.deletedAt !== null) {
      throw new Error('every API key lookup must exclude deleted orgs');
    }
    return rows.find((row) => matches(row, where)) ?? null;
  });
  const update = jest.fn(async ({ where, data }: any) => {
    const row = rows.find((candidate) => candidate.id === where.id);
    Object.assign(row, data);
    return row;
  });
  const organization = {
    model: { organization: { findFirst, update, create: jest.fn() } },
  };
  return {
    rows,
    findFirst,
    repository: new OrganizationRepository(
      organization as any,
      {} as any,
      {} as any,
      {} as any
    ),
  };
};

describe('Organization API keys', () => {
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

  describe('issueApiKey', () => {
    it('returns the key, an encrypted copy to display and a hash to look up', () => {
      const { repository } = setup();

      const { key, stored, hash } = repository.issueApiKey();

      expect(key).toMatch(/^[A-Za-z0-9]{10,}$/);
      expect(stored).not.toBe(key);
      expect(stored.startsWith('enc:v1:')).toBe(true);
      expect(hash.startsWith('h1:')).toBe(true);
      expect(SecretCrypto.decrypt(stored, ORG_API_KEY_LABEL)).toBe(key);
      expect(
        SecretCrypto.hashCandidates(key, ORG_API_KEY_LABEL)
      ).toContain(hash);
    });

    it('never returns the same key twice', () => {
      const { repository } = setup();
      expect(repository.issueApiKey().key).not.toBe(
        repository.issueApiKey().key
      );
    });
  });

  describe('getOrgByApiKey', () => {
    it('finds an organization by the hash of a newly issued key', async () => {
      const { repository, rows } = setup();
      const { key, stored, hash } = repository.issueApiKey();
      rows.push({ id: 'org-new', apiKey: stored, apiKeyHash: hash });

      await expect(repository.getOrgByApiKey(key)).resolves.toMatchObject({
        id: 'org-new',
      });
    });

    // The pre-migration row holds the key itself: the random id was discarded
    // and the ciphertext is what the customer was handed.
    it('finds an organization whose key was issued before this change', async () => {
      const { repository, rows } = setup();
      const legacyKey = AuthService.fixedEncryption('discarded-random-id');
      rows.push({ id: 'org-legacy', apiKey: legacyKey, apiKeyHash: null });

      await expect(
        repository.getOrgByApiKey(legacyKey)
      ).resolves.toMatchObject({ id: 'org-legacy' });
    });

    it('does not find an organization for an unknown key', async () => {
      const { repository, rows } = setup();
      const { stored, hash } = repository.issueApiKey();
      rows.push({ id: 'org-new', apiKey: stored, apiKeyHash: hash });

      await expect(repository.getOrgByApiKey('nope')).resolves.toBeNull();
    });

    // Review Focus 2
    it('never queries, and never matches a null column, for an empty key', async () => {
      const { repository, rows, findFirst } = setup();
      rows.push({ id: 'org-empty', apiKey: null, apiKeyHash: null });

      await expect(repository.getOrgByApiKey('')).resolves.toBeNull();
      await expect(repository.getOrgByApiKey('   ')).resolves.toBeNull();
      await expect(
        repository.getOrgByApiKey(undefined as any)
      ).resolves.toBeNull();
      expect(findFirst).not.toHaveBeenCalled();
    });

    // Review Focus 3
    it('finds an organization hashed under a retired key', async () => {
      const { repository, rows } = setup();
      const { key, stored, hash } = repository.issueApiKey();
      rows.push({ id: 'org-rotated', apiKey: stored, apiKeyHash: hash });

      process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 6).toString('base64');
      process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = KEY;
      SecretCrypto.reset();

      await expect(repository.getOrgByApiKey(key)).resolves.toMatchObject({
        id: 'org-rotated',
      });
    });
  });

  describe('readApiKey', () => {
    it('decrypts a stored copy back to the key the customer holds', () => {
      const { repository } = setup();
      const { key, stored } = repository.issueApiKey();

      expect(repository.readApiKey({ apiKey: stored } as any)).toBe(key);
    });

    // The trap: for a legacy row the stored value IS the key. Decrypting it
    // would hand back the discarded random id, and every existing customer's
    // displayed key - and the one sent to enterprise webhooks - would be wrong.
    it('returns a legacy stored value unchanged, never the id behind it', () => {
      const { repository } = setup();
      const legacyKey = AuthService.fixedEncryption('discarded-random-id');

      expect(repository.readApiKey({ apiKey: legacyKey } as any)).toBe(
        legacyKey
      );
      expect(repository.readApiKey({ apiKey: legacyKey } as any)).not.toBe(
        'discarded-random-id'
      );
    });

    // A lost or emptied TOKEN_ENCRYPTION_KEY must not take down the app shell.
    // This value feeds GET /user/self, the frontend's bootstrap call, which has
    // no try/catch - a throw here 500s it for every user. The UI already
    // handles an empty publicApi, so key loss degrades to "key not shown".
    it('reads as empty, not an exception, when the key is gone', () => {
      const { repository } = setup();
      const { stored } = repository.issueApiKey();

      delete process.env.TOKEN_ENCRYPTION_KEY;
      SecretCrypto.reset();

      expect(repository.readApiKey({ apiKey: stored } as any)).toBe('');
    });

    it('reads as empty, not an exception, when the stored copy is unreadable', () => {
      const { repository } = setup();
      const { stored } = repository.issueApiKey();
      const tampered = stored.slice(0, -2) + (stored.endsWith('xy') ? 'ab' : 'xy');

      expect(repository.readApiKey({ apiKey: tampered } as any)).toBe('');
    });

    it('reads null and the empty string as an empty key', () => {
      const { repository } = setup();
      expect(repository.readApiKey({ apiKey: null } as any)).toBe('');
      expect(repository.readApiKey({ apiKey: '' } as any)).toBe('');
      expect(repository.readApiKey(null as any)).toBe('');
    });
  });

  describe('updateApiKey', () => {
    it('writes both the encrypted copy and the hash, and returns the key', async () => {
      const { repository, rows } = setup();
      rows.push({ id: 'org-1', apiKey: 'legacy', apiKeyHash: null });

      const key = await repository.updateApiKey('org-1');

      expect(rows[0].apiKey.startsWith('enc:v1:')).toBe(true);
      expect(rows[0].apiKeyHash.startsWith('h1:')).toBe(true);
      expect(SecretCrypto.decrypt(rows[0].apiKey, ORG_API_KEY_LABEL)).toBe(key);
      await expect(repository.getOrgByApiKey(key)).resolves.toMatchObject({
        id: 'org-1',
      });
    });
  });
});
