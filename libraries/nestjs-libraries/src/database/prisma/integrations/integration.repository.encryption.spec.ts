import { randomBytes } from 'crypto';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { TokenEncryption } from '@gitroom/nestjs-libraries/database/prisma/integrations/token.encryption';

jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn() },
}));

// A small in-memory stand-in for the Prisma integration delegate, enough to
// exercise how the repository reads, writes and compares tokens.
const matches = (row: any, where: any = {}): boolean =>
  Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((w: any) => matches(row, w));
    if (key === 'organizationId_internalId') {
      return (
        row.organizationId === value.organizationId &&
        row.internalId === value.internalId
      );
    }
    const actual = row[key] ?? null;
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('not' in value) return actual !== value.not;
      if ('notIn' in value) return actual !== null && !value.notIn.includes(actual);
      if ('in' in value) return value.in.includes(actual);
      if ('lte' in value) return actual !== null && actual <= value.lte;
      return true;
    }
    return actual === value;
  });

const makeStore = (initial: any[]) => {
  const rows = initial.map((row) => ({ ...row }));
  let counter = 0;
  const integration = {
    findFirst: jest.fn(async ({ where }: any) => {
      const row = rows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
    findUnique: jest.fn(async ({ where }: any) => {
      const row = rows.find((r) => matches(r, where));
      return row ? { ...row } : null;
    }),
    findMany: jest.fn(async ({ where, take }: any = {}) =>
      rows
        .filter((r) => matches(r, where))
        .slice(0, take)
        .map((r) => ({ ...r }))
    ),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where))!;
      Object.assign(row, data);
      return { ...row };
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const found = rows.filter((r) => matches(r, where));
      found.forEach((row) => Object.assign(row, data));
      return { count: found.length };
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = { id: `new-${++counter}`, ...data };
      rows.push(row);
      return { ...row };
    }),
    upsert: jest.fn(async ({ where, create, update }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (row) {
        Object.assign(row, update);
        return { ...row };
      }
      const created = { id: `new-${++counter}`, ...create };
      rows.push(created);
      return { ...created };
    }),
  };
  const post = { updateMany: jest.fn() };
  const tx = {
    integration,
    post,
    errors: { deleteMany: jest.fn() },
    exisingPlugData: { deleteMany: jest.fn() },
    plugs: { updateMany: jest.fn() },
  };
  const repo = new IntegrationRepository(
    { model: { integration } } as any,
    { model: { post } } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { model: { $transaction: async (fn: any) => fn(tx) } } as any,
    {} as any
  );
  return { repo, rows, integration, post };
};

const row = (over: Record<string, unknown> = {}) => ({
  id: 'int-1',
  organizationId: 'org-1',
  internalId: 'ext-1',
  rootInternalId: 'ext-1',
  providerIdentifier: 'x',
  name: 'Channel',
  type: 'social',
  disabled: false,
  deletedAt: null,
  inBetweenSteps: false,
  refreshNeeded: false,
  tokenExpiration: new Date(Date.now() + 3600 * 1000),
  ...over,
});

describe('IntegrationRepository token encryption', () => {
  const env = { ...process.env };
  const enc = (value: string) => TokenEncryption.encrypt(value);

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
    TokenEncryption.reset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => {
    process.env = env;
    TokenEncryption.reset();
  });

  const tampered = (value: string) => {
    const parts = value.split(':');
    const data = Buffer.from(parts[4], 'base64url');
    data[0] ^= 1;
    parts[4] = data.toString('base64url');
    return parts.join(':');
  };

  describe('read paths return plaintext', () => {
    const rows = () => [
      row({ id: 'enc', internalId: 'a', token: enc('tok-enc'), refreshToken: enc('ref-enc') }),
      row({ id: 'legacy', internalId: 'b', token: 'tok-legacy', refreshToken: 'ref-legacy' }),
    ];

    it('getIntegrationById', async () => {
      const { repo } = makeStore(rows());
      expect(await repo.getIntegrationById('org-1', 'enc')).toMatchObject({
        token: 'tok-enc',
        refreshToken: 'ref-enc',
      });
      expect(await repo.getIntegrationById('org-1', 'legacy')).toMatchObject({
        token: 'tok-legacy',
        refreshToken: 'ref-legacy',
      });
      expect(await repo.getIntegrationById('org-1', 'missing')).toBeNull();
    });

    it('getIntegrationByInternalId', async () => {
      const { repo } = makeStore(rows());
      expect((await repo.getIntegrationByInternalId('org-1', 'a'))!.token).toBe('tok-enc');
      expect((await repo.getIntegrationByInternalId('org-1', 'b'))!.token).toBe('tok-legacy');
    });

    it('getIntegrationsList', async () => {
      const { repo } = makeStore(rows());
      const list = await repo.getIntegrationsList('org-1');
      expect(list.map((r) => r.token)).toEqual(['tok-enc', 'tok-legacy']);
      expect(list.map((r) => r.refreshToken)).toEqual(['ref-enc', 'ref-legacy']);
    });

    it('needsToBeRefreshed', async () => {
      const { repo } = makeStore(rows());
      const list = await repo.needsToBeRefreshed();
      expect(list.map((r) => r.token)).toEqual(['tok-enc', 'tok-legacy']);
    });

    it('getIntegrationForCleanup and findAuthorizationGrantCandidates', async () => {
      const { repo } = makeStore(rows());
      expect((await repo.getIntegrationForCleanup('org-1', 'enc'))!.refreshToken).toBe('ref-enc');
      const candidates = await repo.findAuthorizationGrantCandidates('ext-1');
      expect(candidates.map((r) => r.token)).toEqual(['tok-enc', 'tok-legacy']);
    });

    it('getAuthorizationIntegrationsPage', async () => {
      const { repo } = makeStore(rows());
      const page = await repo.getAuthorizationIntegrationsPage();
      expect(page.map((r) => r.token)).toEqual(['tok-enc', 'tok-legacy']);
      expect(page.every((r) => !r.credentialsUnreadable)).toBe(true);
    });

    it('reads an erased row as empty credentials', async () => {
      const { repo } = makeStore([row({ id: 'gone', token: '', refreshToken: null })]);
      expect(await repo.getIntegrationForCleanup('org-1', 'gone')).toMatchObject({
        token: '',
        refreshToken: null,
      });
    });

    it('createOrUpdateIntegration, updateIntegration and migrateIntegration return plaintext', async () => {
      const { repo } = makeStore(rows());
      const created = await repo.createOrUpdateIntegration(
        undefined, false, 'org-1', 'N', undefined, 'social', 'brand-new', 'x',
        'tok-new', 'ref-new'
      );
      expect(created).toMatchObject({ token: 'tok-new', refreshToken: 'ref-new' });
      const updated = await repo.updateIntegration('enc', { token: 'tok-upd' });
      expect(updated.token).toBe('tok-upd');
      const migrated = await repo.migrateIntegration('org-1', 'legacy', 'c', 'y', 'c');
      expect(migrated).toMatchObject({ token: 'tok-legacy', refreshToken: 'ref-legacy' });
    });
  });

  describe('unreadable stored values', () => {
    const bad = () => [
      row({ id: 'bad', internalId: 'bad', token: tampered(enc('x')), refreshToken: null }),
      row({ id: 'good', internalId: 'good', token: enc('tok-good'), refreshToken: null }),
    ];

    it('a single read fails loudly', async () => {
      const { repo } = makeStore(bad());
      await expect(repo.getIntegrationById('org-1', 'bad')).rejects.toThrow(
        /could not be decrypted/
      );
    });

    it('a missing key fails loudly on single reads', async () => {
      const { repo } = makeStore([row({ token: enc('x') })]);
      delete process.env.TOKEN_ENCRYPTION_KEY;
      TokenEncryption.reset();
      await expect(repo.getIntegrationById('org-1', 'int-1')).rejects.toThrow(
        /TOKEN_ENCRYPTION_KEY is not set/
      );
    });

    it('the list keeps the other channels and blanks the unreadable one', async () => {
      const { repo } = makeStore(bad());
      const list = await repo.getIntegrationsList('org-1');
      expect(list.map((r) => [r.id, r.token])).toEqual([
        ['bad', ''],
        ['good', 'tok-good'],
      ]);
    });

    it('the refresh scan skips the unreadable row, never refreshing with blank credentials', async () => {
      const { repo } = makeStore(bad());
      expect((await repo.needsToBeRefreshed()).map((r) => r.id)).toEqual(['good']);
    });

    it('the lifecycle page keeps its length and flags the unreadable row', async () => {
      const { repo } = makeStore(bad());
      const page = await repo.getAuthorizationIntegrationsPage();
      expect(page.map((r) => [r.id, r.credentialsUnreadable])).toEqual([
        ['bad', true],
        ['good', false],
      ]);
      expect(page[0].token).toBe('');
    });

    it('never logs a token value', async () => {
      const { repo } = makeStore(bad());
      await repo.getIntegrationsList('org-1');
      const logged = JSON.stringify((console.error as jest.Mock).mock.calls);
      expect(logged).not.toContain('enc:v1');
    });
  });

  describe('writes are encrypted', () => {
    it('createOrUpdateIntegration stores ciphertext on create', async () => {
      const { repo, rows } = makeStore([]);
      await repo.createOrUpdateIntegration(
        undefined, false, 'org-1', 'N', undefined, 'social', 'ext', 'x',
        'tok-plain', 'ref-plain'
      );
      expect(TokenEncryption.isEncrypted(rows[0].token)).toBe(true);
      expect(TokenEncryption.isEncrypted(rows[0].refreshToken)).toBe(true);
      expect(JSON.stringify(rows)).not.toContain('tok-plain');
      expect(JSON.stringify(rows)).not.toContain('ref-plain');
      expect(TokenEncryption.decrypt(rows[0].token)).toBe('tok-plain');
    });

    it('createOrUpdateIntegration stores ciphertext on update and keeps the refresh token when empty', async () => {
      const { repo, rows } = makeStore([
        row({ internalId: 'ext', token: 'old', refreshToken: enc('keep-me') }),
      ]);
      await repo.createOrUpdateIntegration(
        undefined, false, 'org-1', 'N', undefined, 'social', 'ext', 'x', 'tok-2', ''
      );
      expect(TokenEncryption.decrypt(rows[0].token)).toBe('tok-2');
      expect(TokenEncryption.isEncrypted(rows[0].token)).toBe(true);
      expect(TokenEncryption.decrypt(rows[0].refreshToken)).toBe('keep-me');
    });

    it('createOrUpdateIntegration stores ciphertext in the new deleted generation transaction', async () => {
      const { repo, rows } = makeStore([]);
      await repo.createOrUpdateIntegration(
        undefined, false, 'org-1', 'N', undefined, 'social', 'ext', 'x',
        'tok-plain', 'ref-plain', 999, undefined, false, undefined, undefined,
        undefined, true
      );
      expect(TokenEncryption.isEncrypted(rows[0].token)).toBe(true);
      expect(JSON.stringify(rows)).not.toContain('tok-plain');
    });

    it('one-time tokens are shared with the sibling channels encrypted', async () => {
      const { repo, rows } = makeStore([
        row({ id: 'sib', internalId: 'sib', rootInternalId: 'ext', token: 'old', refreshToken: 'old' }),
      ]);
      await repo.createOrUpdateIntegration(
        undefined, true, 'org-1', 'N', undefined, 'social', 'ext', 'x',
        'tok-shared', 'ref-shared'
      );
      const sibling = rows.find((r) => r.id === 'sib')!;
      expect(TokenEncryption.decrypt(sibling.token)).toBe('tok-shared');
      expect(TokenEncryption.isEncrypted(sibling.refreshToken)).toBe(true);
      expect(JSON.stringify(rows)).not.toContain('tok-shared');
    });

    it('updateIntegration encrypts a new token and keeps the stored refresh token as it is', async () => {
      const stored = enc('ref-keep');
      const { repo, rows } = makeStore([
        row({ id: 'page', internalId: 'p', token: 'x', refreshToken: stored }),
      ]);
      await repo.updateIntegration('page', { token: 'page-token', organizationId: 'org-1', internalId: 'p' });
      expect(TokenEncryption.decrypt(rows[0].token)).toBe('page-token');
      expect(TokenEncryption.isEncrypted(rows[0].token)).toBe(true);
      expect(rows[0].refreshToken).toBe(stored);
    });

    it('updateIntegration encrypts in a new deleted generation too', async () => {
      const { repo, rows } = makeStore([
        row({ id: 'page', internalId: 'p', token: 'x', refreshToken: enc('r') }),
      ]);
      await repo.updateIntegration(
        'page',
        { token: 'page-token', organizationId: 'org-1', internalId: 'p' },
        true
      );
      expect(TokenEncryption.isEncrypted(rows[0].token)).toBe(true);
      expect(TokenEncryption.decrypt(rows[0].token)).toBe('page-token');
      expect(TokenEncryption.decrypt(rows[0].refreshToken)).toBe('r');
    });

    it('updateAuthorizationIfActive stores the refreshed credentials encrypted', async () => {
      const { repo, rows } = makeStore([row({ token: enc('old'), refreshToken: enc('old-r') })]);
      const result = await repo.updateAuthorizationIfActive(
        'org-1', 'int-1',
        { accessToken: 'new-a', refreshToken: 'new-r', expiresIn: 3600 } as any,
        undefined, 'old'
      );
      expect(result.count).toBe(1);
      expect(TokenEncryption.decrypt(rows[0].token)).toBe('new-a');
      expect(TokenEncryption.decrypt(rows[0].refreshToken)).toBe('new-r');
      expect(JSON.stringify(rows)).not.toContain('new-a');
    });

    it('without a key everything is stored and read as plaintext', async () => {
      delete process.env.TOKEN_ENCRYPTION_KEY;
      TokenEncryption.reset();
      const { repo, rows } = makeStore([]);
      await repo.createOrUpdateIntegration(
        undefined, false, 'org-1', 'N', undefined, 'social', 'ext', 'x', 'tok', 'ref'
      );
      expect(rows[0]).toMatchObject({ token: 'tok', refreshToken: 'ref' });
      expect((await repo.getIntegrationById('org-1', rows[0].id))!.token).toBe('tok');
    });
  });

  describe('expected token comparisons (random IV means no SQL equality)', () => {
    it.each([
      ['encrypted', () => enc('current')],
      ['legacy plaintext', () => 'current'],
    ])('disconnectChannel matches a %s token', async (_name, stored) => {
      const { repo, rows } = makeStore([row({ token: stored() })]);
      expect((await repo.disconnectChannel('org-1', 'int-1', 'current')).count).toBe(1);
      expect(rows[0].refreshNeeded).toBe(true);
    });

    it('does nothing when the token changed', async () => {
      const { repo, rows, integration } = makeStore([row({ token: enc('rotated') })]);
      expect((await repo.disconnectChannel('org-1', 'int-1', 'stale')).count).toBe(0);
      expect(rows[0].refreshNeeded).toBe(false);
      expect(integration.updateMany).not.toHaveBeenCalled();
    });

    it('does nothing for a stored value that cannot be decrypted', async () => {
      const { repo, rows } = makeStore([row({ token: tampered(enc('x')) })]);
      expect((await repo.disconnectChannel('org-1', 'int-1', 'x')).count).toBe(0);
      expect(rows[0].refreshNeeded).toBe(false);
    });

    it('without an expected token only the row conditions apply', async () => {
      const { repo } = makeStore([row({ token: enc('t') })]);
      expect((await repo.disconnectChannel('org-1', 'int-1')).count).toBe(1);
    });

    it('pins the write to the stored value, so a concurrent change wins', async () => {
      const { repo, rows, integration } = makeStore([row({ token: enc('current') })]);
      const original = integration.updateMany.getMockImplementation()!;
      integration.updateMany.mockImplementationOnce(async (args: any) => {
        // a refresh lands between the comparison and the write
        rows[0].token = enc('refreshed');
        return original(args);
      });
      const result = await repo.disconnectChannel('org-1', 'int-1', 'current');
      expect(result.count).toBe(0);
      expect(rows[0].refreshNeeded).toBe(false);
    });

    it('retries when the stored value was only re-encrypted in between (backfill)', async () => {
      const { repo, rows, integration } = makeStore([row({ token: 'current' })]);
      const original = integration.updateMany.getMockImplementation()!;
      integration.updateMany.mockImplementationOnce(async (args: any) => {
        rows[0].token = enc('current');
        return original(args);
      });
      const result = await repo.disconnectChannel('org-1', 'int-1', 'current');
      expect(result.count).toBe(1);
      expect(rows[0].refreshNeeded).toBe(true);
    });

    it('setBetweenRefreshSteps and refreshNeeded compare the decrypted token', async () => {
      const { repo, rows } = makeStore([row({ token: enc('current') })]);
      expect((await repo.setBetweenRefreshSteps('int-1', 'wrong')).count).toBe(0);
      expect((await repo.setBetweenRefreshSteps('int-1', 'current')).count).toBe(1);
      expect(rows[0].inBetweenSteps).toBe(true);
      expect((await repo.refreshNeeded('org-1', 'int-1', 'wrong')).count).toBe(0);
      expect((await repo.refreshNeeded('org-1', 'int-1', 'current')).count).toBe(1);
      expect(rows[0].refreshNeeded).toBe(true);
    });

    it('markAuthorizationDeletionRequested matches the decrypted token', async () => {
      const { repo, rows } = makeStore([row({ token: enc('current') })]);
      expect(await repo.markAuthorizationDeletionRequested('org-1', 'int-1', 'wrong')).toEqual({ matched: false });
      expect(rows[0].disabled).toBe(false);
      expect(await repo.markAuthorizationDeletionRequested('org-1', 'int-1', 'current')).toEqual({ matched: true });
      expect(rows[0]).toMatchObject({ disabled: true, refreshNeeded: true });
      expect(rows[0].deletedAt).toBeInstanceOf(Date);
    });

    it('updateAuthorizationIfActive refuses a changed token and keeps the stored one', async () => {
      const stored = enc('rotated');
      const { repo, rows } = makeStore([row({ token: stored })]);
      const result = await repo.updateAuthorizationIfActive(
        'org-1', 'int-1', { accessToken: 'n', expiresIn: 1 } as any, undefined, 'stale'
      );
      expect(result.count).toBe(0);
      expect(rows[0].token).toBe(stored);
    });

    it('a one-time token rotation reaches only the siblings holding the same token', async () => {
      const { repo, rows } = makeStore([
        row({ id: 'a', internalId: 'a', rootInternalId: 'root', token: enc('shared') }),
        row({ id: 'b', internalId: 'b', rootInternalId: 'root', token: enc('shared') }),
        row({ id: 'c', internalId: 'c', rootInternalId: 'root', token: enc('other') }),
        row({ id: 'd', internalId: 'd', rootInternalId: 'root', token: 'shared' }),
      ]);
      const result = await repo.updateAuthorizationIfActive(
        'org-1', 'a', { accessToken: 'rotated', refreshToken: 'rotated-r', expiresIn: 60 } as any,
        undefined, 'shared', true
      );
      expect(result.count).toBe(1);
      const decrypted = Object.fromEntries(
        rows.map((r) => [r.id, TokenEncryption.decrypt(r.token)])
      );
      expect(decrypted).toEqual({ a: 'rotated', b: 'rotated', c: 'other', d: 'rotated' });
      expect(rows.every((r) => TokenEncryption.isEncrypted(r.token))).toBe(true);
    });
  });

  describe('erased sentinel', () => {
    it('scrubbing still writes empty credentials, never ciphertext', async () => {
      const { repo, rows } = makeStore([
        row({ deletedAt: new Date(), disabled: true, refreshNeeded: true, token: enc('t'), refreshToken: enc('r') }),
      ]);
      await repo.scrubAuthorizationData('org-1', 'int-1');
      expect(rows[0]).toMatchObject({ token: '', refreshToken: null, internalId: 'erased_int-1' });
    });

    it('the history wait touch still matches the erased row', async () => {
      const { repo, rows } = makeStore([
        row({ deletedAt: new Date(), internalId: 'erased_int-1', token: '', refreshToken: null }),
      ]);
      expect((await repo.touchAuthorizationHistoryWait('org-1', 'int-1')).count).toBe(1);
      expect(rows[0].token).toBe('');
    });

    it('the backfill scan leaves erased rows out', async () => {
      const { repo } = makeStore([
        row({ id: 'erased', token: '', refreshToken: null }),
        row({ id: 'empty-refresh', token: '', refreshToken: '' }),
        row({ id: 'live', token: 'plain', refreshToken: null }),
        row({ id: 'refresh-only', token: '', refreshToken: 'r' }),
      ]);
      const ids = (await repo.getStoredCredentialsPage(10)).map((r) => r.id);
      expect(ids).toEqual(['live', 'refresh-only']);
    });
  });
});

describe('IntegrationRepository channel lifecycle on (re)connect', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
    TokenEncryption.reset();
  });
  afterAll(() => {
    process.env = env;
    TokenEncryption.reset();
  });

  it('updating a row with the internalId it already holds never deletes its posts', async () => {
    const { repo, rows, post } = makeStore([
      row({ id: 'page', internalId: 'p', token: 'x' }),
    ]);
    await repo.updateIntegration('page', {
      token: 'page-token',
      organizationId: 'org-1',
      internalId: 'p',
    });
    expect(post.updateMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ internalId: 'p', deletedAt: null });
  });

  it('a reconnected deleted channel comes back on, also from a revoked tombstone', async () => {
    const { repo, rows } = makeStore([
      row({
        deletedAt: new Date(),
        disabled: true,
        disabledReason: 'PLAN_LIMIT',
        refreshNeeded: true,
      }),
    ]);
    await repo.createOrUpdateIntegration(
      undefined, false, 'org-1', 'N', undefined, 'social', 'ext-1', 'x', 'tok'
    );
    // back on, so no longer a reason to be off
    expect(rows[0]).toMatchObject({
      deletedAt: null,
      disabled: false,
      disabledReason: null,
      refreshNeeded: false,
    });
  });

  it('a reconnected live channel that was turned off stays off, for the same reason', async () => {
    for (const disabledReason of ['USER', 'PLAN_LIMIT', null]) {
      const { repo, rows } = makeStore([
        row({ disabled: true, disabledReason }),
      ]);
      await repo.createOrUpdateIntegration(
        undefined, false, 'org-1', 'N', undefined, 'social', 'ext-1', 'x', 'tok'
      );
      expect(rows[0]).toMatchObject({ disabled: true, disabledReason });
    }
  });

  it('a page pick turns the channel on and clears why it was off, in both write paths', async () => {
    for (const newDeletedGeneration of [false, true]) {
      const { repo, rows } = makeStore([
        row({
          id: 'page',
          internalId: 'p',
          token: 'x',
          disabled: true,
          disabledReason: 'PLAN_LIMIT',
        }),
      ]);
      await repo.updateIntegration(
        'page',
        { token: 'page-token', organizationId: 'org-1', internalId: 'p' },
        newDeletedGeneration
      );
      expect(rows[0]).toMatchObject({ disabled: false, disabledReason: null });
    }
  });

  it('an upgrade turns back on only the channels the plan locked, never one the customer turned off', async () => {
    const { repo, rows } = makeStore([
      row({ id: 'plan-1', internalId: 'a', disabled: true, disabledReason: 'PLAN_LIMIT' }),
      row({ id: 'user', internalId: 'b', disabled: true, disabledReason: 'USER' }),
      row({ id: 'legacy', internalId: 'c', disabled: true, disabledReason: null }),
      row({ id: 'plan-2', internalId: 'd', disabled: true, disabledReason: 'PLAN_LIMIT' }),
      row({ id: 'removed', internalId: 'e', disabled: true, disabledReason: 'PLAN_LIMIT', deletedAt: new Date() }),
      row({ id: 'other-org', organizationId: 'org-2', internalId: 'f', disabled: true, disabledReason: 'PLAN_LIMIT' }),
    ]);

    // room for one: a partial unlock
    expect((await repo.enablePlanLockedIntegrations('org-1', 1)).count).toBe(1);
    const on = () => rows.filter((r) => !r.disabled).map((r) => r.id);
    expect(on()).toEqual(['plan-1']);

    expect((await repo.enablePlanLockedIntegrations('org-1', 10)).count).toBe(1);
    expect(on()).toEqual(['plan-1', 'plan-2']);
    expect(rows.find((r) => r.id === 'plan-2')!.disabledReason).toBeNull();
    expect(rows.find((r) => r.id === 'user')!.disabledReason).toBe('USER');
    expect(rows.find((r) => r.id === 'legacy')!.disabled).toBe(true);
  });

  it('a verified reconnect finishes a channel a failed refresh left between steps', async () => {
    const { repo, rows } = makeStore([row({ inBetweenSteps: true })]);
    await repo.createOrUpdateIntegration(
      undefined, false, 'org-1', 'N', undefined, 'social', 'ext-1', 'x', 'tok',
      '', undefined, undefined, false, 'ext-1'
    );
    expect(rows[0].inBetweenSteps).toBe(false);
  });
});
