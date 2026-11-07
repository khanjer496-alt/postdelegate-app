import { AuthService } from '@gitroom/helpers/auth/auth.service';
import {
  THIRD_PARTY_KEY_LABEL,
  ThirdPartyRepository,
} from '@gitroom/nestjs-libraries/database/prisma/third-party/third-party.repository';
import { ThirdPartyService } from '@gitroom/nestjs-libraries/database/prisma/third-party/third-party.service';
import { SecretCrypto } from '@gitroom/nestjs-libraries/database/prisma/secrets/secret.crypto';

const KEY = Buffer.alloc(32, 13).toString('base64');
const API_KEY = 'tp_live_key_value';

const repositoryFake = () => {
  const rows: any[] = [];
  const model = {
    thirdParty: {
      findFirst: jest.fn(async () => rows[0] ?? null),
      upsert: jest.fn(async ({ create, update }: any) => {
        if (rows.length) {
          Object.assign(rows[0], update);
          return rows[0];
        }
        rows.push({ id: 'tp-1', ...create });
        return rows[0];
      }),
      create: jest.fn(async ({ data }: any) => {
        rows.push({ id: 'tp-1', ...data });
        return rows[0];
      }),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(rows[0], data);
        return rows[0];
      }),
    },
  };
  return { rows, repository: new ThirdPartyRepository({ model } as any) };
};

describe('Third-party integration keys at rest', () => {
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

  it('stores the key with authenticated encryption', async () => {
    const { repository, rows } = repositoryFake();

    await repository.saveIntegration('org-1', 'ident', API_KEY, {
      name: 'n',
      username: 'u',
      id: 'external-1',
    });

    expect(rows[0].apiKey).not.toContain(API_KEY);
    expect(rows[0].apiKey.startsWith('enc:v1:')).toBe(true);
    expect(SecretCrypto.decrypt(rows[0].apiKey, THIRD_PARTY_KEY_LABEL)).toBe(
      API_KEY
    );
  });

  it('reads back a key it stored', () => {
    const { repository } = repositoryFake();
    const service = new ThirdPartyService(repository);
    const stored = SecretCrypto.encrypt(API_KEY, THIRD_PARTY_KEY_LABEL);

    expect(service.readApiKey({ apiKey: stored } as any)).toBe(API_KEY);
  });

  it('reads a key stored by the previous release', () => {
    const { repository } = repositoryFake();
    const service = new ThirdPartyService(repository);

    expect(
      service.readApiKey({ apiKey: AuthService.fixedEncryption(API_KEY) } as any)
    ).toBe(API_KEY);
  });

  it('reads a missing key as an empty string rather than throwing', () => {
    const { repository } = repositoryFake();
    const service = new ThirdPartyService(repository);

    expect(service.readApiKey({ apiKey: null } as any)).toBe('');
    expect(service.readApiKey(null as any)).toBe('');
  });
});
