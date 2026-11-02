// the service pulls in heavy modules that are not under test
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
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
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(), set: jest.fn() },
}));

import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

const redis = ioRedis as unknown as { get: jest.Mock; set: jest.Mock };

const views = [{ label: 'Views', data: [{ total: '12', date: '2026-10-01' }] }];

const channel = (overrides: Record<string, unknown> = {}) => ({
  id: 'int-1',
  organizationId: 'org-A',
  internalId: 'open-id',
  token: 'token',
  type: 'social',
  providerIdentifier: 'tiktok',
  deletedAt: null as Date | null,
  disabled: false,
  inBetweenSteps: false,
  tokenExpiration: new Date(Date.now() + 60 * 60 * 1000),
  ...overrides,
});

const makeService = (
  provider: Record<string, unknown> | undefined,
  integration: ReturnType<typeof channel> | null = channel()
) => {
  const integrationRepository = {
    getIntegrationById: jest.fn().mockResolvedValue(integration),
    disconnectChannel: jest.fn(),
  };
  const integrationManager = {
    getSocialIntegration: jest.fn().mockReturnValue(provider),
  };
  const refreshIntegrationService = { refresh: jest.fn() };
  const service = new IntegrationService(
    integrationRepository as any,
    {} as any,
    integrationManager as any,
    {} as any,
    refreshIntegrationService as any,
    {} as any,
    {} as any
  );
  return {
    service,
    integrationRepository,
    integrationManager,
    refreshIntegrationService,
  };
};

const org = { id: 'org-A' } as any;

const expired = () => channel({ tokenExpiration: new Date(Date.now() - 1000) });

describe('IntegrationService.checkAnalytics soft refresh (Analytics > Views)', () => {
  beforeEach(() => {
    redis.get.mockReset().mockResolvedValue(undefined);
    redis.set.mockReset().mockResolvedValue('OK');
  });

  it('tries the refresh softly and stays empty when it fails, without disconnecting', async () => {
    const analytics = jest.fn();
    const { service, refreshIntegrationService } = makeService(
      { analytics },
      expired()
    );
    const disconnect = jest.spyOn(service, 'disconnectChannel');
    refreshIntegrationService.refresh.mockResolvedValue(false);

    expect(await service.checkAnalytics(org, 'int-1', '7', false, 'soft')).toEqual([]);
    expect(refreshIntegrationService.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'int-1' }),
      '',
      true
    );
    expect(disconnect).not.toHaveBeenCalled();
    expect(analytics).not.toHaveBeenCalled();
  });

  it('does not disconnect when a soft refresh returns no token', async () => {
    const { service, refreshIntegrationService } = makeService(
      { analytics: jest.fn() },
      expired()
    );
    const disconnect = jest.spyOn(service, 'disconnectChannel');
    refreshIntegrationService.refresh.mockResolvedValue({ accessToken: '' });

    expect(await service.checkAnalytics(org, 'int-1', '7', false, 'soft')).toEqual([]);
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('uses a refreshed token', async () => {
    const analytics = jest.fn().mockResolvedValue(views);
    const { service, refreshIntegrationService } = makeService(
      { analytics },
      expired()
    );
    refreshIntegrationService.refresh.mockResolvedValue({ accessToken: 'fresh' });

    expect(await service.checkAnalytics(org, 'int-1', '7', false, 'soft')).toEqual(views);
    expect(analytics).toHaveBeenCalledWith('open-id', 'fresh', 7);
  });

  it('retries a token error once with a soft refresh, never in a loop', async () => {
    const analytics = jest
      .fn()
      .mockRejectedValue(new RefreshToken('network', '{}', '{}'));
    const { service, refreshIntegrationService } = makeService({ analytics });
    refreshIntegrationService.refresh.mockResolvedValue({ accessToken: 'fresh' });

    expect(await service.checkAnalytics(org, 'int-1', '7', false, 'soft')).toEqual([]);
    expect(analytics).toHaveBeenCalledTimes(2);
    expect(refreshIntegrationService.refresh).toHaveBeenCalledTimes(1);
    expect(refreshIntegrationService.refresh.mock.calls[0][2]).toBe(true);
  });

  it('never keeps the data of a provider that bypasses the analytics cache', async () => {
    const analytics = jest.fn().mockResolvedValue(views);
    const { service } = makeService({
      analytics,
      authorizationPolicy: { bypassAnalyticsCache: true },
    });

    expect(await service.checkAnalytics(org, 'int-1', '7', false, 'soft')).toEqual(views);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe('IntegrationService.topViewedPosts', () => {
  beforeEach(() => {
    redis.get.mockReset().mockResolvedValue(undefined);
    redis.set.mockReset().mockResolvedValue('OK');
  });

  it('is read-only: an expired token is unavailable, never refreshed', async () => {
    const topViewedPosts = jest.fn();
    const { service, refreshIntegrationService } = makeService(
      { topViewedPosts },
      expired()
    );

    expect(await service.topViewedPosts(org, 'int-1', 7, 10)).toEqual({
      supported: true,
      unavailable: true,
      posts: [],
    });
    expect(topViewedPosts).not.toHaveBeenCalled();
    expect(refreshIntegrationService.refresh).not.toHaveBeenCalled();
  });

  it('reads a bypassing provider on demand, never from or into the cache', async () => {
    const posts = [{ id: 'v1', views: 5 }];
    const { service } = makeService({
      topViewedPosts: jest.fn().mockResolvedValue(posts),
      authorizationPolicy: { bypassAnalyticsCache: true },
    });

    expect(await service.topViewedPosts(org, 'int-1', 30, 50)).toEqual({
      supported: true,
      posts,
    });
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe('IntegrationService.checkAnalytics on a channel without analytics', () => {
  beforeEach(() => {
    redis.get.mockReset().mockResolvedValue(undefined);
  });

  // the analytics page used to call .map on the error it got back
  it.each([
    ['disabled', channel({ disabled: true })],
    ['half-connected', channel({ inBetweenSteps: true })],
    ['deleted', channel({ deletedAt: new Date() })],
  ])('answers [] for a %s channel, as the API documents', async (_, row) => {
    const analytics = jest.fn();
    const { service } = makeService({ analytics }, row as any);
    await expect(service.checkAnalytics(org, 'int-1', '7')).resolves.toEqual(
      []
    );
    expect(analytics).not.toHaveBeenCalled();
  });
});

describe('IntegrationService.checkAnalytics on an unknown channel', () => {
  // getIntegrationById is scoped to the workspace: another workspace's id
  // comes back empty too
  it('answers 404 for an id that is not a channel of the workspace', async () => {
    const { service } = makeService({ analytics: jest.fn() }, null);
    await expect(service.checkAnalytics(org, 'other-org-id', '7')).rejects.toMatchObject({
      status: 404,
    });
  });
});
