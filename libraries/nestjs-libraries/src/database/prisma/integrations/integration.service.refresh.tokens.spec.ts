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
  () => ({
    IntegrationRepository: class {},
    isOwnedIntegrationPicture: () => false,
  })
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

const makeService = (refresh: jest.Mock) => {
  const integrationRepository = {
    needsToBeRefreshed: jest.fn().mockResolvedValue([
      { id: 'int-1', organizationId: 'org-A', providerIdentifier: 'x' },
      { id: 'int-2', organizationId: 'org-A', providerIdentifier: 'x' },
      { id: 'int-3', organizationId: 'org-B', providerIdentifier: 'x' },
    ]),
  };
  const service = new IntegrationService(
    integrationRepository as any,
    {} as any,
    {} as any,
    {} as any,
    { refresh } as any,
    {} as any,
    {} as any
  );
  return { service };
};

describe('IntegrationService.refreshTokens', () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('keeps refreshing the remaining channels when one refresh returns false', async () => {
    const refresh = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue({ accessToken: 'new' });
    const { service } = makeService(refresh);

    await service.refreshTokens();

    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('keeps refreshing the remaining channels when one refresh throws', async () => {
    const refresh = jest
      .fn()
      .mockResolvedValueOnce({ accessToken: 'new' })
      .mockRejectedValueOnce(new Error('reConnect failed'))
      .mockResolvedValue({ accessToken: 'new' });
    const { service } = makeService(refresh);

    await expect(service.refreshTokens()).resolves.toBeUndefined();

    expect(refresh).toHaveBeenCalledTimes(3);
    expect(refresh.mock.calls.map(([i]) => i.id)).toEqual([
      'int-1',
      'int-2',
      'int-3',
    ]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
