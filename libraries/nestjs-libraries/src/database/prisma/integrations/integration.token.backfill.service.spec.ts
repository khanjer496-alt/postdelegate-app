import { randomBytes } from 'crypto';
import { IntegrationTokenBackfillService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.token.backfill.service';
import { TokenEncryption } from '@gitroom/nestjs-libraries/database/prisma/integrations/token.encryption';

jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn() },
}));

const makeStore = (initial: { id: string; token: string; refreshToken: string | null }[]) => {
  const rows = initial.map((row) => ({ ...row }));
  const repo = {
    getStoredCredentialsPage: jest.fn(async (take: number, cursor?: string) => {
      const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0;
      return rows
        .slice(start)
        .filter((r) => r.token !== '' || (r.refreshToken ?? '') !== '')
        .slice(0, take)
        .map((r) => ({ ...r }));
    }),
    replaceStoredCredentials: jest.fn(async (id: string, from: any, to: any) => {
      const row = rows.find((r) => r.id === id)!;
      if (row.token !== from.token || row.refreshToken !== from.refreshToken) {
        return { count: 0 };
      }
      Object.assign(row, to);
      return { count: 1 };
    }),
  };
  return { rows, repo, service: new IntegrationTokenBackfillService(repo as any) };
};

describe('IntegrationTokenBackfillService', () => {
  const env = { ...process.env };
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

  const plaintextRows = () => [
    { id: '1', token: 'tok-1', refreshToken: 'ref-1' },
    { id: '2', token: 'tok-2', refreshToken: null },
    { id: '3', token: '', refreshToken: null },
    { id: '4', token: 'tok-4', refreshToken: '' },
  ];

  it('encrypts plaintext rows and reports counts', async () => {
    const { service, rows } = makeStore(plaintextRows());
    const report = await service.run({ batchSize: 2 });

    expect(report).toEqual({
      dryRun: false, scanned: 3, updated: 3, unchanged: 0, skippedChanged: 0, unreadable: 0,
    });
    expect(rows.map((r) => TokenEncryption.decrypt(r.token))).toEqual(['tok-1', 'tok-2', '', 'tok-4']);
    expect(TokenEncryption.decrypt(rows[0].refreshToken)).toBe('ref-1');
    expect(rows[1].refreshToken).toBeNull();
    // the empty refresh token and the erased row are left as they were
    expect(rows[3].refreshToken).toBe('');
    expect(rows[2]).toMatchObject({ token: '', refreshToken: null });
    expect(JSON.stringify(rows)).not.toMatch(/tok-1|ref-1|tok-2|tok-4/);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const { service, rows, repo } = makeStore(plaintextRows());
    await service.run();
    const after = JSON.stringify(rows);
    repo.replaceStoredCredentials.mockClear();

    const second = await service.run();
    expect(second).toMatchObject({ updated: 0, unchanged: 3, scanned: 3 });
    expect(repo.replaceStoredCredentials).not.toHaveBeenCalled();
    expect(JSON.stringify(rows)).toBe(after);
  });

  it('resumes after a partial run and only touches what is left', async () => {
    const { service, rows } = makeStore(plaintextRows());
    rows[0].token = TokenEncryption.encrypt('tok-1');
    rows[0].refreshToken = TokenEncryption.encrypt('ref-1');
    const before = { ...rows[0] };
    const report = await service.run();
    expect(report).toMatchObject({ updated: 2, unchanged: 1 });
    expect(rows[0]).toEqual(before);
  });

  it('a dry run writes nothing', async () => {
    const { service, rows, repo } = makeStore(plaintextRows());
    const report = await service.run({ dryRun: true });
    expect(report).toMatchObject({ dryRun: true, updated: 3 });
    expect(repo.replaceStoredCredentials).not.toHaveBeenCalled();
    expect(rows[0].token).toBe('tok-1');
  });

  it('leaves a row that changed while it ran alone', async () => {
    const { service, rows, repo } = makeStore(plaintextRows());
    repo.replaceStoredCredentials.mockImplementationOnce(async () => ({ count: 0 }));
    const report = await service.run();
    expect(report).toMatchObject({ updated: 2, skippedChanged: 1 });
    expect(rows[0].token).toBe('tok-1');
  });

  it('reports unreadable rows without modifying them or logging values', async () => {
    const { service, rows } = makeStore([
      { id: '1', token: 'enc:v1:AAAA:BBBB:CCCC', refreshToken: null },
      { id: '2', token: 'tok-2', refreshToken: null },
    ]);
    const report = await service.run();
    expect(report).toMatchObject({ unreadable: 1, updated: 1 });
    expect(rows[0].token).toBe('enc:v1:AAAA:BBBB:CCCC');
    expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toContain('tok-2');
  });

  it('refuses to run without a key', async () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    TokenEncryption.reset();
    const { service } = makeStore(plaintextRows());
    await expect(service.run()).rejects.toThrow(/TOKEN_ENCRYPTION_KEY is not set/);
  });

  it('re-encrypts values of a retired key only when asked to', async () => {
    const { service, rows } = makeStore([{ id: '1', token: 'tok-1', refreshToken: null }]);
    await service.run();
    const oldKey = process.env.TOKEN_ENCRYPTION_KEY!;
    const stored = rows[0].token;
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = oldKey;
    TokenEncryption.reset();

    expect(await service.run()).toMatchObject({ updated: 0, unchanged: 1 });
    expect(rows[0].token).toBe(stored);

    expect(await service.run({ reencrypt: true })).toMatchObject({ updated: 1 });
    expect(rows[0].token).not.toBe(stored);
    expect(TokenEncryption.needsReencryption(rows[0].token)).toBe(false);
    expect(TokenEncryption.decrypt(rows[0].token)).toBe('tok-1');
  });
});
