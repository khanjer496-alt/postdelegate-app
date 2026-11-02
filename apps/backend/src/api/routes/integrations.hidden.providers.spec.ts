// HIDDEN_PROVIDERS / PREVIEW_PROVIDER_ORGS across every path that starts or
// saves a connection, with the real IntegrationManager and the real
// IntegrationService.checkProviderAvailable behind each controller.

// heavy modules that are not under test
jest.mock('@gitroom/nestjs-libraries/integrations/social/nostr.provider', () => ({
  NostrProvider: class {
    identifier = 'nostr';
    name = 'Nostr';
  },
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/integrations/integration.authorization.lifecycle.service',
  () => ({ IntegrationAuthorizationLifecycleService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository',
  () => ({ IntegrationRepository: class {}, isOwnedIntegrationPicture: () => false })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository',
  () => ({ AutopostRepository: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock('@gitroom/backend/services/auth/permissions/permissions.service', () => ({
  PermissionsService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));
jest.mock('@gitroom/nestjs-libraries/upload/multer.stream.engine', () => ({
  streamUploadOptions: () => ({}),
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({
  MediaService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/clipping/clipping.service',
  () => ({ ClippingService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({
  UsersService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service',
  () => ({ AdminStatsService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/chat/validation.schemas.helper', () => ({
  getValidationSchemas: jest.fn(),
}));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher', () => ({
  getSsrfSafeDispatcher: jest.fn(),
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => {
  const data = new Map<string, string>();
  return {
    ioRedis: {
      data,
      get: jest.fn(async (key: string) => data.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => data.set(key, value)),
      del: jest.fn(async (key: string) => data.delete(key)),
    },
  };
});

import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationsController } from './integrations.controller';
import { NoAuthIntegrationsController } from './no.auth.integrations.controller';
import { EnterpriseController } from './enterprise.controller';
import { PublicIntegrationsController } from '@gitroom/backend/public-api/routes/v1/public.integrations.controller';

const redis = ioRedis as any;
const unavailable = { status: 400, message: "This network isn't available yet" };

// channels the orgs already have
const channels = [
  { organizationId: 'org-1', internalId: 'x-acc', providerIdentifier: 'x' },
  { organizationId: 'org-1', internalId: 'bsky-acc', providerIdentifier: 'bluesky' },
  { organizationId: 'org-1', internalId: 'tt-acc', providerIdentifier: 'tiktok' },
  { organizationId: 'org-1', internalId: 'wp-acc', providerIdentifier: 'wordpress' },
];

const setup = (providerExtras: object = {}) => {
  const manager = new IntegrationManager();
  const provider = {
    generateAuthUrl: jest.fn(async () => ({
      url: 'https://auth.example',
      codeVerifier: 'verifier',
      state: 'st',
    })),
    authenticate: jest.fn(async () => ({
      id: 'new-acc',
      name: 'Demo',
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 1,
      picture: '',
      username: 'demo',
    })),
    ...providerExtras,
  };
  jest.spyOn(manager, 'getSocialIntegration').mockReturnValue(provider as any);

  const repository = {
    getIntegrationByInternalId: jest.fn(
      async (org: string, internalId: string) =>
        channels.find(
          (c) => c.organizationId === org && c.internalId === internalId
        ) || null
    ),
  };
  const service = new IntegrationService(
    repository as any,
    {} as any,
    manager,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  // what runs after the check is covered by its own specs
  const saved = jest
    .spyOn(service, 'createOrUpdateIntegration')
    .mockResolvedValue({ id: 'int-1' } as any);
  jest.spyOn(service, 'checkCappedProviderSwitch').mockResolvedValue();
  const adopted = jest
    .spyOn(service, 'migrateIntegrationOnConnect')
    .mockResolvedValue(undefined);
  const migrated = jest
    .spyOn(service, 'migrateIntegration')
    .mockResolvedValue({} as any);

  const getOrg = async (id: string) => ({ id, apiKey: 'key', isTrailing: false });
  const urls = new IntegrationsController(
    manager,
    service,
    {} as any,
    {} as any
  );
  const callback = new NoAuthIntegrationsController(
    manager,
    service,
    { startRefreshWorkflow: jest.fn(async () => undefined) } as any,
    { getOrgById: jest.fn(getOrg) } as any,
    // the plan's channel limit is covered by its own specs
    { canAddChannel: jest.fn(async () => true) } as any
  );
  const enterprise = new EnterpriseController(
    manager,
    { getOrgByApiKey: jest.fn(async () => getOrg('org-1')) } as any,
    service,
    {} as any
  );

  const publicApi = new PublicIntegrationsController(
    service,
    {} as any,
    {} as any,
    {} as any,
    manager,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

  return {
    urls,
    callback,
    enterprise,
    publicApi,
    provider,
    repository,
    saved,
    migrated,
    adopted,
  };
};

const getUrl = (
  urls: IntegrationsController,
  integration: string,
  orgId: string,
  refresh = ''
) =>
  urls.getIntegrationUrl(integration, refresh, '', '', '', {
    id: orgId,
  } as any);

// the state a connect link left in redis, then the callback that saves it
const connect = (
  callback: NoAuthIntegrationsController,
  integration: string,
  orgId: string,
  refresh?: string
) => {
  redis.data.set('login:s1', 'verifier');
  redis.data.set('organization:s1', orgId);
  if (refresh) {
    redis.data.set('refresh:s1', refresh);
  }
  return callback.connectSocialMedia(integration, {
    state: 's1',
    code: Buffer.from('{}').toString('base64'),
    timezone: 0,
  } as any);
};

describe('hidden providers on the connect paths', () => {
  const env = { ...process.env };

  beforeEach(() => {
    redis.data.clear();
    process.env.HIDDEN_PROVIDERS = 'x,pinterest,tiktok-business';
    process.env.PREVIEW_PROVIDER_ORGS = 'org-qa';
  });

  afterEach(() => {
    process.env = { ...env };
  });

  describe('GET /integrations/social/:integration', () => {
    it('blocks a hidden provider for a normal workspace', async () => {
      const { urls, provider } = setup();
      await expect(getUrl(urls, 'x', 'org-1')).rejects.toMatchObject(unavailable);
      expect(provider.generateAuthUrl).not.toHaveBeenCalled();
      expect(redis.data.size).toBe(0);
    });

    it('lets an allowlisted workspace connect a hidden provider', async () => {
      const { urls } = setup();
      expect(await getUrl(urls, 'x', 'org-qa')).toEqual({
        url: 'https://auth.example',
      });
      expect(redis.data.get('organization:st')).toBe('org-qa');
    });

    it('keeps reconnects of a channel the workspace already has working', async () => {
      const { urls } = setup();
      expect(await getUrl(urls, 'x', 'org-1', 'x-acc')).toEqual({
        url: 'https://auth.example',
      });
      expect(redis.data.get('refresh:st')).toBe('x-acc');
    });

    it('does not take any refresh value as a pass', async () => {
      const { urls } = setup();
      // unknown account, a channel of another provider, another org's channel
      for (const [orgId, refresh] of [
        ['org-1', 'nope'],
        ['org-1', 'bsky-acc'],
        ['org-2', 'x-acc'],
      ]) {
        await expect(getUrl(urls, 'x', orgId, refresh)).rejects.toMatchObject(
          unavailable
        );
      }
    });

    it('leaves providers that are not hidden alone', async () => {
      const { urls, repository } = setup();
      expect(await getUrl(urls, 'bluesky', 'org-1')).toEqual({
        url: 'https://auth.example',
      });
      expect(repository.getIntegrationByInternalId).not.toHaveBeenCalled();
    });
  });

  describe('POST /integrations/social-connect/:integration', () => {
    it('blocks a hidden provider for a normal workspace before authenticating', async () => {
      const { callback, provider, saved } = setup();
      await expect(connect(callback, 'x', 'org-1')).rejects.toMatchObject(
        unavailable
      );
      expect(provider.authenticate).not.toHaveBeenCalled();
      expect(saved).not.toHaveBeenCalled();
    });

    it('blocks a custom-fields connect of a hidden provider', async () => {
      const { callback, provider, saved } = setup({
        customFields: async (): Promise<unknown[]> => [],
      });
      await expect(connect(callback, 'pinterest', 'org-1')).rejects.toMatchObject(
        unavailable
      );
      expect(provider.authenticate).not.toHaveBeenCalled();
      expect(saved).not.toHaveBeenCalled();
    });

    it('saves the channel for an allowlisted workspace', async () => {
      const { callback, saved } = setup();
      await connect(callback, 'x', 'org-qa');
      expect(saved).toHaveBeenCalledTimes(1);
    });

    it('saves a reconnect of a channel the workspace already has', async () => {
      const { callback, provider, saved } = setup();
      provider.authenticate.mockResolvedValueOnce({
        id: 'x-acc',
        name: 'Demo',
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 1,
        picture: '',
        username: 'demo',
      });
      await connect(callback, 'x', 'org-1', 'x-acc');
      expect(saved).toHaveBeenCalledTimes(1);
    });

    it('lets a reconnect land on a hidden MIGRATE_PROVIDERS target', async () => {
      process.env.MIGRATE_PROVIDERS = 'tiktok:tiktok-business';
      const { callback, saved, migrated } = setup();
      await connect(callback, 'tiktok-business', 'org-1', 'tt-acc');
      expect(migrated).toHaveBeenCalledTimes(1);
      expect(saved).toHaveBeenCalledTimes(1);
    });

    describe('custom-field reconnect that comes back with another id', () => {
      // WordPress and Listmonk build the id from the site URL the person typed
      const retyped = {
        customFields: async (): Promise<unknown[]> => [],
        authenticate: jest.fn(async () => ({
          id: 'wp-acc-retyped',
          name: 'Blog',
          accessToken: 'a',
          refreshToken: '',
          expiresIn: 1,
          picture: '',
          username: 'blog',
        })),
      };

      it('saves it as a fresh connect for a visible provider', async () => {
        const { callback, saved, migrated, adopted } = setup(retyped);
        await connect(callback, 'wordpress', 'org-1', 'wp-acc');
        expect(migrated).not.toHaveBeenCalled();
        expect(adopted).toHaveBeenCalledTimes(1);
        expect(saved).toHaveBeenCalledTimes(1);
        expect(redis.data.has('refresh:s1')).toBe(false);
      });

      it('still blocks it for a hidden provider, keeping the state for a retry', async () => {
        process.env.HIDDEN_PROVIDERS = 'wordpress';
        const { callback, saved, migrated } = setup(retyped);
        await expect(
          connect(callback, 'wordpress', 'org-1', 'wp-acc')
        ).rejects.toMatchObject(unavailable);
        expect(migrated).not.toHaveBeenCalled();
        expect(saved).not.toHaveBeenCalled();
        expect(redis.data.get('refresh:s1')).toBe('wp-acc');
      });
    });

    it('rejects a refresh state of another provider reused for a hidden one', async () => {
      const { callback, saved } = setup();
      await expect(
        connect(callback, 'x', 'org-1', 'bsky-acc')
      ).rejects.toMatchObject(unavailable);
      expect(saved).not.toHaveBeenCalled();
    });
  });

  describe('GET /public/v1/social/:integration', () => {
    it('blocks a hidden provider for a normal workspace', async () => {
      const { publicApi, provider } = setup();
      await expect(
        publicApi.getIntegrationUrl('x', '', { id: 'org-1' } as any)
      ).rejects.toMatchObject(unavailable);
      expect(provider.generateAuthUrl).not.toHaveBeenCalled();
    });

    it('allows an allowlisted workspace and reconnects of existing channels', async () => {
      const { publicApi } = setup();
      expect(
        await publicApi.getIntegrationUrl('x', '', { id: 'org-qa' } as any)
      ).toEqual({ url: 'https://auth.example' });
      expect(
        await publicApi.getIntegrationUrl('x', 'x-acc', { id: 'org-1' } as any)
      ).toEqual({ url: 'https://auth.example' });
    });
  });

  describe('POST /enterprise/url', () => {
    it('starts no connection for a hidden provider', async () => {
      process.env.JWT_SECRET = 'unit-test-secret';
      const { AuthService } = await import('@gitroom/helpers/auth/auth.service');
      const { enterprise, provider } = setup();
      const params = AuthService.signTypedJWT('enterprise-user', {
        redirectUrl: 'https://partner.example',
        apiKey: 'key',
        provider: 'x',
        webhookUrl: 'https://partner.example/hook',
      });
      expect(await enterprise.redirectParams(params)).toBeUndefined();
      expect(provider.generateAuthUrl).not.toHaveBeenCalled();

      const visible = AuthService.signTypedJWT('enterprise-user', {
        redirectUrl: 'https://partner.example',
        apiKey: 'key',
        provider: 'bluesky',
        webhookUrl: 'https://partner.example/hook',
      });
      expect(await enterprise.redirectParams(visible)).toBe(
        'https://auth.example'
      );
    });
  });

  describe('GET /integrations/available', () => {
    it('lists hidden providers only for an allowlisted workspace', async () => {
      const { urls } = setup();
      const listed = async (id: string) =>
        (await urls.getAvailableIntegrations({ id } as any)).social.map(
          (p) => p.identifier
        );

      expect(await listed('org-1')).not.toContain('x');
      expect(await listed('org-qa')).toContain('x');
    });
  });
});
