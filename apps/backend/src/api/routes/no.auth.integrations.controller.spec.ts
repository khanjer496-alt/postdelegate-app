jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({ RefreshIntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.missing.scopes', () => ({ NotEnoughScopesFilter: class { catch() {} } }));
jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({ NotEnoughScopes: class extends Error {} }));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher', () => ({ getSsrfSafeDispatcher: jest.fn() }));
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
import { NoAuthIntegrationsController } from './no.auth.integrations.controller';

const redis = ioRedis as any;

const make = (provider: object) => {
  const org = { id: 'org-1', apiKey: 'api', isTrailing: false };
  const integrationService = {
    createOrUpdateIntegration: jest.fn(async () => ({ id: 'int-1', name: 'x' })),
    migrateIntegrationOnConnect: jest.fn(),
    saveProviderPage: jest.fn(async () => ({ saved: true })),
  };
  const controller = new NoAuthIntegrationsController(
    {
      getAllowedSocialsIntegrations: () => ['demo'],
      getSocialIntegration: () => provider,
    } as any,
    integrationService as any,
    { startRefreshWorkflow: jest.fn(async () => undefined) } as any,
    { getOrgById: jest.fn(async () => org) } as any
  );
  return { controller, integrationService };
};

const authenticated = {
  authenticate: jest.fn(async () => ({
    id: '1',
    name: 'Demo',
    accessToken: 'a',
    refreshToken: 'r',
    expiresIn: 1,
    picture: '',
    username: 'demo',
  })),
};

describe('NoAuthIntegrationsController state keys', () => {
  beforeEach(() => {
    redis.data.clear();
    redis.data.set('login:s1', 'verifier');
    redis.data.set('organization:s1', 'org-1');
  });

  it('spends the organization state when a channel is connected', async () => {
    const { controller } = make({ ...authenticated });
    await controller.connectSocialMedia('demo', { state: 's1', code: 'c', timezone: 0 } as any);
    expect(redis.data.has('organization:s1')).toBe(false);
    expect(redis.data.has('login:s1')).toBe(false);

    // a replay of the same state has nothing left to act on
    await expect(
      controller.connectSocialMedia('demo', { state: 's1', code: 'c', timezone: 0 } as any)
    ).rejects.toBeDefined();
  });

  it('keeps it for the page picking step of a two step provider, then spends it', async () => {
    const { controller, integrationService } = make({
      ...authenticated,
      isBetweenSteps: true,
    });
    await controller.connectSocialMedia('demo', { state: 's1', code: 'c', timezone: 0 } as any);
    expect(redis.data.get('organization:s1')).toBe('org-1');

    await controller.saveProviderPage('int-1', { state: 's1', page: 'p' });
    expect(integrationService.saveProviderPage).toHaveBeenCalledTimes(1);
    expect(redis.data.has('organization:s1')).toBe(false);

    await expect(
      controller.saveProviderPage('int-1', { state: 's1', page: 'p' })
    ).rejects.toThrow('Organization not found');
    expect(integrationService.saveProviderPage).toHaveBeenCalledTimes(1);
  });

  it('keeps the state when saving the page fails, so the person can retry', async () => {
    const { controller, integrationService } = make({ ...authenticated, isBetweenSteps: true });
    integrationService.saveProviderPage.mockRejectedValueOnce(new Error('bad page'));
    await expect(
      controller.saveProviderPage('int-1', { state: 's1', page: 'p' })
    ).rejects.toThrow('bad page');
    expect(redis.data.get('organization:s1')).toBe('org-1');
  });
});
