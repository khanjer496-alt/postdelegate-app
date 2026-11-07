import { AuthService } from '@gitroom/helpers/auth/auth.service';
import {
  OAUTH_SECRET_LABELS,
  OAuthService,
} from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { SecretCrypto } from '@gitroom/nestjs-libraries/database/prisma/secrets/secret.crypto';

const KEY = Buffer.alloc(32, 3).toString('base64');

// A fake standing in for the Prisma repository: it holds rows and matches them
// the way the database does, on exact equality against the stored column. That
// is the behaviour under test — whether the service asks for the right stored
// forms — so the rows are real and only the driver is fake.
const fakeRepository = () => {
  const authorizations: any[] = [];
  const apps: any[] = [];
  return {
    authorizations,
    apps,
    getAppByOrgId: jest.fn(async () => null),
    getAppByClientId: jest.fn(
      async (clientId: string) =>
        apps.find((app) => app.clientId === clientId) ?? null
    ),
    createApp: jest.fn(async (orgId: string, data: any) => {
      const app = { id: 'app-1', organizationId: orgId, ...data };
      apps.push(app);
      return app;
    }),
    createAuthorization: jest.fn(async (data: any) => {
      authorizations.push({ id: `auth-${authorizations.length}`, ...data });
    }),
    findByCode: jest.fn(
      async (values: string[]) =>
        authorizations.find(
          (row) =>
            row.authorizationCode && values.includes(row.authorizationCode)
        ) ?? null
    ),
    findByAccessToken: jest.fn(
      async (values: string[]) =>
        authorizations.find(
          (row) => row.accessToken && values.includes(row.accessToken)
        ) ?? null
    ),
    // like the database's conditional update: only while the row still holds
    // the code it was looked up with
    exchangeCodeForToken: jest.fn(
      async (id: string, storedCode: string, storedToken: string) => {
        const row = authorizations.find(
          (candidate) =>
            candidate.id === id && candidate.authorizationCode === storedCode
        );
        if (!row) {
          return null;
        }
        row.accessToken = storedToken;
        row.authorizationCode = null;
        return {
          organizationId: 'org-1',
          organization: { paymentId: 'cus_1' },
        };
      }
    ),
    updateClientSecret: jest.fn(async (orgId: string, stored: string) => {
      apps.find((app) => app.organizationId === orgId).clientSecret = stored;
    }),
  };
};

const setup = () => {
  const repository = fakeRepository();
  return { repository, service: new OAuthService(repository as any) };
};

describe('OAuth secrets at rest', () => {
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

  describe('access token lookup', () => {
    it('finds an authorization stored under the hash of the presented token', async () => {
      const { service, repository } = setup();
      const token = 'pos_live-token';
      repository.authorizations.push({
        id: 'auth-x',
        accessToken: SecretCrypto.hash(token, OAUTH_SECRET_LABELS.accessToken),
      });

      await expect(service.getOrgByOAuthToken(token)).resolves.toMatchObject({
        id: 'auth-x',
      });
    });

    it('still finds one written by the previous release', async () => {
      const { service, repository } = setup();
      const token = 'pos_legacy-token';
      repository.authorizations.push({
        id: 'auth-legacy',
        accessToken: AuthService.fixedEncryption(token),
      });

      await expect(service.getOrgByOAuthToken(token)).resolves.toMatchObject({
        id: 'auth-legacy',
      });
    });

    it('does not find an authorization for a different token', async () => {
      const { service, repository } = setup();
      repository.authorizations.push({
        id: 'auth-x',
        accessToken: SecretCrypto.hash(
          'pos_one',
          OAUTH_SECRET_LABELS.accessToken
        ),
      });

      await expect(service.getOrgByOAuthToken('pos_two')).resolves.toBeNull();
    });

    // Review Focus 2
    it('never queries, and never matches, for an empty or whitespace token', async () => {
      const { service, repository } = setup();
      repository.authorizations.push({ id: 'auth-x', accessToken: '' });

      await expect(service.getOrgByOAuthToken('')).resolves.toBeNull();
      await expect(service.getOrgByOAuthToken('   ')).resolves.toBeNull();
      expect(repository.findByAccessToken).not.toHaveBeenCalled();
    });

    // Review Focus 1
    it('falls back to the legacy lookup when no key is configured', async () => {
      delete process.env.TOKEN_ENCRYPTION_KEY;
      SecretCrypto.reset();
      const { service, repository } = setup();
      const token = 'pos_legacy-token';
      repository.authorizations.push({
        id: 'auth-legacy',
        accessToken: AuthService.fixedEncryption(token),
      });

      await expect(service.getOrgByOAuthToken(token)).resolves.toMatchObject({
        id: 'auth-legacy',
      });
    });

    // Review Focus 3
    it('finds a row hashed under a retired key', async () => {
      const token = 'pos_rotated';
      const underOldKey = SecretCrypto.hash(
        token,
        OAUTH_SECRET_LABELS.accessToken
      );
      process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString('base64');
      process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = KEY;
      SecretCrypto.reset();

      const { service, repository } = setup();
      repository.authorizations.push({
        id: 'auth-rotated',
        accessToken: underOldKey,
      });

      await expect(service.getOrgByOAuthToken(token)).resolves.toMatchObject({
        id: 'auth-rotated',
      });
    });
  });

  describe('authorization codes', () => {
    it('returns the code and stores it hashed, not reversibly', async () => {
      const { service, repository } = setup();

      const code = await service.createAuthorizationCode(
        'app-1',
        'user-1',
        'org-1'
      );

      const stored = repository.authorizations[0].authorizationCode;
      expect(stored.startsWith('h1:')).toBe(true);
      expect(stored).not.toContain(code);
      expect(() => AuthService.fixedDecryption(stored)).toThrow();
    });

    it('finds the authorization it just stored by the returned code', async () => {
      const { service, repository } = setup();
      const code = await service.createAuthorizationCode(
        'app-1',
        'user-1',
        'org-1'
      );

      await expect(
        repository.findByCode(
          SecretCrypto.hashCandidates(code, OAUTH_SECRET_LABELS.code)
        )
      ).resolves.toMatchObject({ oauthAppId: 'app-1' });
    });
  });

  describe('client secrets', () => {
    const appWith = (secret: string) => ({
      id: 'app-1',
      organizationId: 'org-1',
      clientId: 'pca_app',
      clientSecret: secret,
      dynamic: false,
      tokenEndpointAuthMethod: 'client_secret_post',
      redirectUrl: 'https://example.com/cb',
      redirectUris: null,
    });

    const codeRow = (storedCode: string) => ({
      id: 'auth-1',
      oauthAppId: 'app-1',
      authorizationCode: storedCode,
      codeExpiresAt: new Date(Date.now() + 60_000),
      codeChallenge: null,
      codeChallengeMethod: null,
      redirectUri: null,
    });

    it('stores a created app secret hashed and returns the plaintext once', async () => {
      const { service, repository } = setup();

      const created = await service.createApp('org-1', {
        name: 'App',
        redirectUrl: 'https://example.com/cb',
      } as any);

      expect(created.clientSecret.startsWith('pcs_')).toBe(true);
      const stored = repository.apps[0].clientSecret;
      expect(stored.startsWith('h1:')).toBe(true);
      expect(stored).not.toContain(created.clientSecret);
    });

    it('accepts the right client secret', async () => {
      const { service, repository } = setup();
      const secret = 'pcs_right';
      const code = 'the-code';
      repository.apps.push(appWith(SecretCrypto.hash(secret, OAUTH_SECRET_LABELS.clientSecret)));
      repository.authorizations.push(
        codeRow(SecretCrypto.hash(code, OAUTH_SECRET_LABELS.code))
      );

      await expect(
        service.exchangeCodeForToken(code, 'pca_app', secret)
      ).resolves.toMatchObject({ token_type: 'bearer' });
    });

    it('rejects a wrong client secret', async () => {
      const { service, repository } = setup();
      const code = 'the-code';
      repository.apps.push(
        appWith(SecretCrypto.hash('pcs_right', OAUTH_SECRET_LABELS.clientSecret))
      );
      repository.authorizations.push(
        codeRow(SecretCrypto.hash(code, OAUTH_SECRET_LABELS.code))
      );

      await expect(
        service.exchangeCodeForToken(code, 'pca_app', 'pcs_wrong')
      ).rejects.toMatchObject({ response: { error: 'invalid_client' } });
    });

    it('accepts a secret stored by the previous release', async () => {
      const { service, repository } = setup();
      const secret = 'pcs_legacy';
      const code = 'the-code';
      repository.apps.push(appWith(AuthService.fixedEncryption(secret)));
      repository.authorizations.push(
        codeRow(AuthService.fixedEncryption(code))
      );

      await expect(
        service.exchangeCodeForToken(code, 'pca_app', secret)
      ).resolves.toMatchObject({ token_type: 'bearer' });
    });

    it('rotates to a hashed secret and returns the new plaintext', async () => {
      const { service, repository } = setup();
      repository.apps.push(appWith('h1:whatever'));
      repository.getAppByOrgId = jest.fn(async () => repository.apps[0]) as any;

      const { clientSecret } = await service.rotateSecret('org-1');

      expect(clientSecret.startsWith('pcs_')).toBe(true);
      expect(repository.apps[0].clientSecret.startsWith('h1:')).toBe(true);
      expect(repository.apps[0].clientSecret).not.toContain(clientSecret);
    });

    it('lets only one exchange of a code win', async () => {
      const { service, repository } = setup();
      const secret = 'pcs_right';
      const code = 'the-code';
      repository.apps.push(appWith(SecretCrypto.hash(secret, OAUTH_SECRET_LABELS.clientSecret)));
      const stored = SecretCrypto.hash(code, OAUTH_SECRET_LABELS.code);
      repository.authorizations.push(codeRow(stored));
      // both requests looked the code up before either spent it
      repository.findByCode.mockResolvedValue({ ...codeRow(stored) });

      await expect(
        service.exchangeCodeForToken(code, 'pca_app', secret)
      ).resolves.toMatchObject({ token_type: 'bearer' });
      await expect(
        service.exchangeCodeForToken(code, 'pca_app', secret)
      ).rejects.toMatchObject({ response: { error: 'invalid_grant' } });
    });

    it('refuses a second app for the organization', async () => {
      const { service, repository } = setup();
      repository.createApp.mockResolvedValueOnce(null as any);
      await expect(
        service.createApp('org-1', {
          name: 'App',
          redirectUrl: 'https://example.com/cb',
        } as any)
      ).rejects.toMatchObject({ status: 400 });
    });

    it('stores the access token hashed when a code is exchanged', async () => {
      const { service, repository } = setup();
      const secret = 'pcs_right';
      const code = 'the-code';
      repository.apps.push(appWith(SecretCrypto.hash(secret, OAUTH_SECRET_LABELS.clientSecret)));
      repository.authorizations.push(
        codeRow(SecretCrypto.hash(code, OAUTH_SECRET_LABELS.code))
      );

      const result: any = await service.exchangeCodeForToken(
        code,
        'pca_app',
        secret
      );

      const stored = repository.authorizations[0].accessToken;
      expect(stored.startsWith('h1:')).toBe(true);
      expect(stored).not.toContain(result.access_token);
      expect(
        SecretCrypto.hashCandidates(
          result.access_token,
          OAUTH_SECRET_LABELS.accessToken
        )
      ).toContain(stored);
    });
  });
});
