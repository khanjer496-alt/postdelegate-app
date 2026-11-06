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

const makeService = (
  existing: { providerIdentifier: string; deletedAt?: Date } | null
) => {
  const repository = {
    getIntegrationByInternalIdWithDeleted: jest
      .fn()
      .mockResolvedValue(
        existing && { id: 'int-old', name: 'Brand', deletedAt: null, ...existing }
      ),
    retireDeletedIntegration: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const service = new IntegrationService(
    repository as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  return Object.assign(service, { repository });
};

describe('IntegrationService.checkCappedProviderSwitch', () => {
  it('stops an account moving onto a capped network over its own key channel', async () => {
    await expect(
      makeService({ providerIdentifier: 'x-own-key' }).checkCappedProviderSwitch(
        'org-1',
        '42',
        'x'
      )
    ).rejects.toMatchObject({
      status: 400,
      message:
        'This account is already connected as the channel "Brand". Delete that channel first, then connect the account again.',
    });
  });

  it('stops a capped channel moving to another provider', async () => {
    await expect(
      makeService({ providerIdentifier: 'x' }).checkCappedProviderSwitch(
        'org-1',
        '42',
        'x-own-key'
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  it('retires a deleted channel instead of reviving it under the other provider', async () => {
    for (const [before, after] of [
      ['x', 'x-own-key'],
      ['x-own-key', 'x'],
    ]) {
      const service = makeService({
        providerIdentifier: before,
        deletedAt: new Date(),
      });
      await service.checkCappedProviderSwitch('org-1', '42', after);
      expect(service.repository.retireDeletedIntegration).toHaveBeenCalledWith(
        'org-1',
        'int-old'
      );
    }
  });

  it('leaves a deleted channel of the same provider to be revived', async () => {
    const service = makeService({ providerIdentifier: 'x', deletedAt: new Date() });
    await service.checkCappedProviderSwitch('org-1', '42', 'x');
    expect(service.repository.retireDeletedIntegration).not.toHaveBeenCalled();
  });

  it('lets a reconnect on the same provider and uncapped providers through', async () => {
    await makeService({ providerIdentifier: 'x' }).checkCappedProviderSwitch(
      'org-1',
      '42',
      'x'
    );
    await makeService({
      providerIdentifier: 'instagram',
    }).checkCappedProviderSwitch('org-1', '42', 'instagram-standalone');
    await makeService(null).checkCappedProviderSwitch('org-1', '42', 'x');
  });
});

describe('IntegrationService.enableChannel', () => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  afterEach(() => {
    if (key === undefined) {
      delete process.env.STRIPE_PUBLISHABLE_KEY;
    } else {
      process.env.STRIPE_PUBLISHABLE_KEY = key;
    }
  });

  const makeEnableService = (enabled: number) => {
    const repository = {
      getIntegrationsList: jest
        .fn()
        .mockResolvedValue(
          Array.from({ length: enabled }, (_, i) => ({ id: `i${i}`, disabled: false }))
        ),
      enableChannel: jest.fn().mockResolvedValue({}),
    };
    const service = new IntegrationService(
      repository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    return { service, repository };
  };

  it('answers 400 with a readable message at the plan limit', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
    const { service, repository } = makeEnableService(3);

    await expect(service.enableChannel('org', 3, 'i9')).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('maximum number of channels'),
    });
    expect(repository.enableChannel).not.toHaveBeenCalled();
  });

  it('enables under the limit', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
    const { service, repository } = makeEnableService(2);
    await service.enableChannel('org', 3, 'i9');
    expect(repository.enableChannel).toHaveBeenCalledWith('org', 'i9');
  });
});
