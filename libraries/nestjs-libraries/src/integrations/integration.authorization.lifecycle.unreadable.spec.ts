jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn() },
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository', () => ({
  IntegrationRepository: class {},
  isOwnedIntegrationPicture: () => false,
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));

import { IntegrationAuthorizationLifecycleService } from '@gitroom/nestjs-libraries/integrations/integration.authorization.lifecycle.service';

describe('IntegrationAuthorizationLifecycleService.checkAuthorizationsPage', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.INTEGRATION_AUTHORIZATION_LIFECYCLE_ENABLED = 'true';
  });
  afterAll(() => {
    process.env = env;
  });

  it('never checks, revokes or updates a channel whose stored credentials are unreadable', async () => {
    const row = (id: string, credentialsUnreadable: boolean) => ({
      id, organizationId: 'org', providerIdentifier: 'x', token: credentialsUnreadable ? '' : 'tok',
      refreshToken: null, internalId: id, rootInternalId: id, picture: null, disabled: false,
      refreshNeeded: false, deletedAt: null, credentialsUnreadable,
    });
    const repository = {
      getAuthorizationIntegrationsPage: jest.fn(async () => [row('bad', true), row('good', false)]),
      updateAuthorizationIfActive: jest.fn(),
      markAuthorizationDeletionRequested: jest.fn(),
      getIntegrationForCleanup: jest.fn(),
    };
    const checkAuthorization = jest.fn(async () => ({ status: 'valid' }));
    const manager = {
      getSocialIntegration: () => ({ authorizationPolicy: {}, checkAuthorization }),
    };
    const service = new IntegrationAuthorizationLifecycleService(
      repository as any, manager as any, {} as any
    );

    const result = await service.checkAuthorizationsPage();

    expect(result).toMatchObject({ checked: 1, pending: 1 });
    expect(checkAuthorization).toHaveBeenCalledTimes(1);
    expect(checkAuthorization.mock.calls[0]).toEqual([expect.objectContaining({ accessToken: 'tok' })]);
    expect(repository.updateAuthorizationIfActive).toHaveBeenCalledTimes(1);
    expect(repository.updateAuthorizationIfActive.mock.calls[0][1]).toBe('good');
    expect(repository.getIntegrationForCleanup).not.toHaveBeenCalled();
  });
});
