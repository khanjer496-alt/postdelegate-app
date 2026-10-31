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

const post = {
  id: '7301',
  title: 'Launch day',
  publishedAt: '2026-10-31T09:00:00.000Z',
  views: 10,
};

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

describe('IntegrationService.recentPosts', () => {
  beforeEach(() => {
    redis.get.mockReset().mockResolvedValue(undefined);
    redis.set.mockReset().mockResolvedValue('OK');
  });

  it('looks the channel up in the caller organization only', async () => {
    const { service, integrationRepository } = makeService(
      { recentPosts: jest.fn().mockResolvedValue([]) },
      null
    );

    await expect(service.recentPosts(org, 'int-of-org-B')).rejects.toThrow(
      'Invalid integration'
    );
    expect(integrationRepository.getIntegrationById).toHaveBeenCalledWith(
      'org-A',
      'int-of-org-B'
    );
  });

  it('rejects deleted, disabled and half-connected channels', async () => {
    for (const overrides of [
      { deletedAt: new Date() },
      { disabled: true },
      { inBetweenSteps: true },
    ]) {
      const { service } = makeService(
        { recentPosts: jest.fn() },
        channel(overrides)
      );
      await expect(service.recentPosts(org, 'int-1')).rejects.toThrow(
        'Invalid integration'
      );
    }
  });

  it('reports providers without recentPosts as unsupported, without calling anything', async () => {
    const { service } = makeService({ analytics: jest.fn() });

    expect(await service.recentPosts(org, 'int-1')).toEqual({
      supported: false,
      posts: [],
    });
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('reports non social channels as unsupported', async () => {
    const recentPosts = jest.fn();
    const { service } = makeService(
      { recentPosts },
      channel({ type: 'article' })
    );

    expect((await service.recentPosts(org, 'int-1')).supported).toBe(false);
    expect(recentPosts).not.toHaveBeenCalled();
  });

  it('loads the posts and caches them for an hour under the org scoped key', async () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const recentPosts = jest.fn().mockResolvedValue([post]);
    const { service } = makeService({ recentPosts });

    try {
      expect(await service.recentPosts(org, 'int-1')).toEqual({
        supported: true,
        posts: [post],
      });
    } finally {
      process.env.NODE_ENV = env;
    }

    expect(recentPosts).toHaveBeenCalledWith('open-id', 'token', 20);
    expect(redis.get).toHaveBeenCalledWith(
      'integration:org-A:int-1:recent-posts'
    );
    expect(redis.set).toHaveBeenCalledWith(
      'integration:org-A:int-1:recent-posts',
      JSON.stringify([post]),
      'EX',
      3600
    );
  });

  it('serves a cached list without calling the platform', async () => {
    redis.get.mockResolvedValue(JSON.stringify([post]));
    const recentPosts = jest.fn();
    const { service } = makeService({ recentPosts });

    expect(await service.recentPosts(org, 'int-1')).toEqual({
      supported: true,
      posts: [post],
    });
    expect(recentPosts).not.toHaveBeenCalled();
  });

  it('skips the cache for providers that bypass the analytics cache', async () => {
    const recentPosts = jest.fn().mockResolvedValue([post]);
    const { service, integrationRepository } = makeService({
      recentPosts,
      authorizationPolicy: { bypassAnalyticsCache: true },
    });

    expect((await service.recentPosts(org, 'int-1')).posts).toEqual([post]);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    // the token is checked again so a list read with a revoked token is dropped
    expect(integrationRepository.getIntegrationById).toHaveBeenCalledTimes(2);
  });

  it('drops a list read with a token that changed meanwhile when the cache is bypassed', async () => {
    const recentPosts = jest.fn().mockResolvedValue([post]);
    const { service, integrationRepository } = makeService({
      recentPosts,
      authorizationPolicy: { bypassAnalyticsCache: true },
    });
    integrationRepository.getIntegrationById
      .mockResolvedValueOnce(channel())
      .mockResolvedValueOnce(channel({ token: 'rotated' }));

    expect(await service.recentPosts(org, 'int-1')).toEqual({
      supported: true,
      unavailable: true,
      posts: [],
    });
  });

  it('reports a platform error as unavailable and never caches it', async () => {
    const recentPosts = jest.fn().mockRejectedValue(new Error('boom'));
    const { service } = makeService({ recentPosts });

    expect(await service.recentPosts(org, 'int-1')).toEqual({
      supported: true,
      unavailable: true,
      posts: [],
    });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('never refreshes or disconnects on a read-only call', async () => {
    const recentPosts = jest
      .fn()
      .mockRejectedValue(new RefreshToken('tiktok', '{}', '{}'));
    const { service, refreshIntegrationService, integrationRepository } =
      makeService({ recentPosts });

    expect((await service.recentPosts(org, 'int-1', false)).unavailable).toBe(
      true
    );
    expect(refreshIntegrationService.refresh).not.toHaveBeenCalled();
    expect(integrationRepository.disconnectChannel).not.toHaveBeenCalled();
  });

  it('does not touch an expired token on a read-only call', async () => {
    const recentPosts = jest.fn();
    const { service, refreshIntegrationService } = makeService(
      { recentPosts },
      channel({ tokenExpiration: new Date(Date.now() - 1000) })
    );

    expect((await service.recentPosts(org, 'int-1', false)).unavailable).toBe(
      true
    );
    expect(recentPosts).not.toHaveBeenCalled();
    expect(refreshIntegrationService.refresh).not.toHaveBeenCalled();
  });

  it('refreshes an expired token before loading when refreshing is allowed', async () => {
    const recentPosts = jest.fn().mockResolvedValue([post]);
    const { service, refreshIntegrationService } = makeService(
      { recentPosts },
      channel({ tokenExpiration: new Date(Date.now() - 1000) })
    );
    refreshIntegrationService.refresh.mockResolvedValue({
      accessToken: 'fresh',
    });

    expect((await service.recentPosts(org, 'int-1')).posts).toEqual([post]);
    expect(recentPosts).toHaveBeenCalledWith('open-id', 'fresh', 20);
  });

  it('reports unavailable without disconnecting when the refresh is refused', async () => {
    const recentPosts = jest.fn();
    const { service, refreshIntegrationService, integrationRepository } =
      makeService(
        { recentPosts },
        channel({ tokenExpiration: new Date(Date.now() - 1000) })
      );
    refreshIntegrationService.refresh.mockResolvedValue(false);

    expect((await service.recentPosts(org, 'int-1')).unavailable).toBe(true);
    expect(recentPosts).not.toHaveBeenCalled();
    expect(integrationRepository.disconnectChannel).not.toHaveBeenCalled();
  });

  it('disconnects like checkAnalytics when a refresh returns no access token', async () => {
    const recentPosts = jest.fn();
    const { service, refreshIntegrationService, integrationRepository } =
      makeService(
        { recentPosts },
        channel({ tokenExpiration: new Date(Date.now() - 1000) })
      );
    refreshIntegrationService.refresh.mockResolvedValue({ accessToken: '' });
    integrationRepository.disconnectChannel.mockResolvedValue({ count: 0 });

    expect((await service.recentPosts(org, 'int-1')).unavailable).toBe(true);
    expect(integrationRepository.disconnectChannel).toHaveBeenCalledWith(
      'org-A',
      'int-1',
      'token'
    );
    expect(recentPosts).not.toHaveBeenCalled();
  });

  it('refreshes once and retries when refreshing is allowed', async () => {
    const recentPosts = jest
      .fn()
      .mockRejectedValueOnce(new RefreshToken('tiktok', '{}', '{}'))
      .mockRejectedValueOnce(new RefreshToken('tiktok', '{}', '{}'));
    const { service, refreshIntegrationService } = makeService({
      recentPosts,
    });
    refreshIntegrationService.refresh.mockResolvedValue({
      accessToken: 'fresh',
    });

    expect((await service.recentPosts(org, 'int-1')).unavailable).toBe(true);
    expect(refreshIntegrationService.refresh).toHaveBeenCalledTimes(1);
    expect(recentPosts).toHaveBeenCalledTimes(2);
    expect(recentPosts).toHaveBeenLastCalledWith('open-id', 'fresh', 20);
  });
});
