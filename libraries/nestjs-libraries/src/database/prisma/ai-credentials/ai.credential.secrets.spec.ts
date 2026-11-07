import { AuthService } from '@gitroom/helpers/auth/auth.service';
import {
  AI_CREDENTIAL_LABEL,
  AiCredentialRepository,
} from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.repository';
import { AiCredentialService } from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service';
import { SecretCrypto } from '@gitroom/nestjs-libraries/database/prisma/secrets/secret.crypto';

const KEY = Buffer.alloc(32, 11).toString('base64');
const OPENAI_KEY = 'sk-proj-abcdefghijklmnop';

const repositoryFake = () => {
  const rows: any[] = [];
  const model = {
    aiCredential: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          rows.find((row) => row.organizationId === where.organizationId) ??
          null
      ),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = rows.find(
          (row) => row.organizationId === where.organizationId
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        rows.push({ ...create });
        return rows[rows.length - 1];
      }),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  };
  return { rows, repository: new AiCredentialRepository({ model } as any) };
};

describe('AI credentials at rest', () => {
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

  it('stores the key with authenticated encryption, not reversibly from JWT_SECRET', async () => {
    const { repository, rows } = repositoryFake();

    await repository.upsert('org-1', 'openai', OPENAI_KEY);

    expect(rows[0].apiKey).not.toBe(OPENAI_KEY);
    expect(rows[0].apiKey).not.toContain(OPENAI_KEY);
    expect(rows[0].apiKey.startsWith('enc:v1:')).toBe(true);
    expect(rows[0].apiKey).not.toBe(AuthService.fixedEncryption(OPENAI_KEY));
    expect(SecretCrypto.decrypt(rows[0].apiKey, AI_CREDENTIAL_LABEL)).toBe(
      OPENAI_KEY
    );
  });

  it('writes a fresh ciphertext each time, so equal keys do not look equal', async () => {
    const a = repositoryFake();
    const b = repositoryFake();
    await a.repository.upsert('org-1', 'openai', OPENAI_KEY);
    await b.repository.upsert('org-1', 'openai', OPENAI_KEY);
    expect(a.rows[0].apiKey).not.toBe(b.rows[0].apiKey);
  });

  it('reads back a key it stored', async () => {
    const { repository, rows } = repositoryFake();
    await repository.upsert('org-1', 'openai', OPENAI_KEY);
    const service = new AiCredentialService(repository);

    await expect(service.getOpenAiKey('org-1')).resolves.toBe(OPENAI_KEY);
    expect(rows[0].apiKey.startsWith('enc:v1:')).toBe(true);
  });

  it('reads a key stored by the previous release', async () => {
    const { repository, rows } = repositoryFake();
    rows.push({
      organizationId: 'org-1',
      provider: 'openai',
      apiKey: AuthService.fixedEncryption(OPENAI_KEY),
    });
    const service = new AiCredentialService(repository);

    await expect(service.getOpenAiKey('org-1')).resolves.toBe(OPENAI_KEY);
  });

  it('masks from the decrypted key, whichever scheme stored it', async () => {
    const legacy = repositoryFake();
    legacy.rows.push({
      organizationId: 'org-1',
      provider: 'openai',
      apiKey: AuthService.fixedEncryption(OPENAI_KEY),
    });
    const current = repositoryFake();
    await current.repository.upsert('org-1', 'openai', OPENAI_KEY);

    const expected = `${OPENAI_KEY.slice(0, 3)}…${OPENAI_KEY.slice(-4)}`;
    await expect(
      new AiCredentialService(legacy.repository).getCredential('org-1')
    ).resolves.toEqual({ provider: 'openai', maskedKey: expected });
    await expect(
      new AiCredentialService(current.repository).getCredential('org-1')
    ).resolves.toEqual({ provider: 'openai', maskedKey: expected });
  });

  // Review Focus 3
  it('reads a key encrypted under a retired key', async () => {
    const { repository, rows } = repositoryFake();
    await repository.upsert('org-1', 'openai', OPENAI_KEY);
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString('base64');
    process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = KEY;
    SecretCrypto.reset();

    await expect(
      new AiCredentialService(repository).getOpenAiKey('org-1')
    ).resolves.toBe(OPENAI_KEY);
  });

  it('does not put the key in the error when there is no credential', async () => {
    const { repository } = repositoryFake();
    const service = new AiCredentialService(repository);

    await expect(service.getOpenAiKey('org-1')).rejects.toThrow(
      /Add your OpenAI key/
    );
  });
});
