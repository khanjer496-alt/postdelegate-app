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

  const makeEnableService = (
    enabled: number,
    disabledReason: string | null = null
  ) => {
    const repository = {
      getIntegrationsList: jest
        .fn()
        .mockResolvedValue([
          ...Array.from({ length: enabled }, (_, i) => ({ id: `i${i}`, disabled: false })),
          // the channel being enabled, and a half-connected row that is not
          // a channel yet and never counts
          { id: 'i9', disabled: true, disabledReason },
          { id: 'temp', disabled: false, inBetweenSteps: true },
        ]),
      enableChannel: jest.fn().mockResolvedValue({}),
      disableChannel: jest.fn().mockResolvedValue({ id: 'i0' }),
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

  it('refuses a channel that is not in the workspace or still picking its page', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
    const { service, repository } = makeEnableService(0);
    await expect(service.enableChannel('org', 3, 'gone')).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.enableChannel('org', 3, 'temp')).rejects.toMatchObject({
      status: 400,
    });
    expect(repository.enableChannel).not.toHaveBeenCalled();
  });

  it('checks the limit whatever turned the channel off', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
    for (const reason of ['USER', 'PLAN_LIMIT', null]) {
      const full = makeEnableService(3, reason);
      await expect(full.service.enableChannel('org', 3, 'i9')).rejects.toMatchObject({
        status: 400,
      });
      expect(full.repository.enableChannel).not.toHaveBeenCalled();

      const room = makeEnableService(2, reason);
      await room.service.enableChannel('org', 3, 'i9');
      expect(room.repository.enableChannel).toHaveBeenCalledWith('org', 'i9');
    }
  });

  it('turns a channel off through the repository, which records the customer did it', async () => {
    const { service, repository } = makeEnableService(1);
    expect(await service.disableChannel('org', 'i0')).toEqual({ id: 'i0' });
    expect(repository.disableChannel).toHaveBeenCalledWith('org', 'i0');
  });

  it('leaves a channel that is already on alone, even at the limit', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
    const { service, repository } = makeEnableService(3);
    await service.enableChannel('org', 3, 'i0');
    expect(repository.enableChannel).not.toHaveBeenCalled();
  });
});

describe('IntegrationService.saveProviderPage channel limit', () => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  afterEach(() => {
    if (key === undefined) {
      delete process.env.STRIPE_PUBLISHABLE_KEY;
    } else {
      process.env.STRIPE_PUBLISHABLE_KEY = key;
    }
  });

  const makePageService = (channels: object[]) => {
    const repository = {
      getIntegrationById: jest.fn().mockResolvedValue({
        id: 'temp',
        inBetweenSteps: true,
        providerIdentifier: 'facebook',
        token: 't',
      }),
      getIntegrationsList: jest.fn().mockResolvedValue([
        { id: 'temp', internalId: 'user-1', inBetweenSteps: true },
        ...channels,
      ]),
      checkForDeletedOnceAndUpdate: jest.fn(),
      updateIntegration: jest.fn().mockResolvedValue({}),
    };
    const manager = {
      getSocialIntegration: () => ({
        fetchPageInformation: jest.fn().mockResolvedValue({
          id: 'page-1',
          name: 'Page',
          picture: '',
          access_token: 'pt',
          username: 'page',
        }),
      }),
    };
    const service = new IntegrationService(
      repository as any,
      {} as any,
      manager as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    return { service, repository };
  };

  it('refuses one more channel at the plan limit', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
    const { service, repository } = makePageService([
      { id: 'a', internalId: 'x' },
      { id: 'b', internalId: 'page-1', disabled: true },
    ]);
    // the picked page is a channel that was turned off: picking it turns it on
    await expect(
      service.saveProviderPage('org', 'temp', { page: 'page-1' }, 1)
    ).rejects.toMatchObject({ status: 400 });
    expect(repository.updateIntegration).not.toHaveBeenCalled();
  });

  it('lets a page that is already a connected channel through at the limit', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
    const { service, repository } = makePageService([
      { id: 'a', internalId: 'page-1' },
    ]);
    await service.saveProviderPage('org', 'temp', { page: 'page-1' }, 1);
    expect(repository.updateIntegration).toHaveBeenCalled();
  });

  it('adds a page under the limit, and never checks with billing off', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
    const under = makePageService([{ id: 'a', internalId: 'x' }]);
    await under.service.saveProviderPage('org', 'temp', { page: 'page-1' }, 2);
    expect(under.repository.updateIntegration).toHaveBeenCalled();

    delete process.env.STRIPE_PUBLISHABLE_KEY;
    const off = makePageService([{ id: 'a', internalId: 'x' }]);
    await off.service.saveProviderPage('org', 'temp', { page: 'page-1' }, 0);
    expect(off.repository.updateIntegration).toHaveBeenCalled();
  });
});

describe('IntegrationService.changeActiveCron', () => {
  it('marks every running feed inactive as it stops it, so the list matches', async () => {
    const autoposts = {
      getAutoposts: jest.fn().mockResolvedValue([
        { id: 'a1', active: true },
        { id: 'a2', active: false },
      ]),
      changeActive: jest.fn().mockResolvedValue({}),
    };
    const temporal = { terminateWorkflow: jest.fn().mockResolvedValue({}) };
    const service = new IntegrationService(
      {} as any,
      autoposts as any,
      {} as any,
      {} as any,
      {} as any,
      temporal as any,
      {} as any
    );

    expect(await service.changeActiveCron('org')).toBe(true);
    expect(autoposts.changeActive).toHaveBeenCalledTimes(1);
    expect(autoposts.changeActive).toHaveBeenCalledWith('org', 'a1', false);
    expect(temporal.terminateWorkflow).toHaveBeenCalledWith('autopost-a1');
  });

  it('never throws from a billing webhook', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = new IntegrationService(
      {} as any,
      { getAutoposts: jest.fn().mockRejectedValue(new Error('db')) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    expect(await service.changeActiveCron('org')).toBe(false);
  });
});
