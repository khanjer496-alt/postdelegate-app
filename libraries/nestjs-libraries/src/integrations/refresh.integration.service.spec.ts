// the refresh service pulls in heavy modules that are not under test
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));

import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';

const integration = {
  id: 'int-1',
  organizationId: 'org-A',
  providerIdentifier: 'network',
  token: 'old',
  refreshToken: 'refresh',
  internalId: 'internal',
  rootInternalId: 'internal',
} as any;

const make = (refreshToken: jest.Mock) => {
  const integrationService = {
    getActiveIntegrationById: jest.fn().mockResolvedValue({ token: 'old' }),
    persistRefreshedAuthorization: jest.fn().mockResolvedValue({ count: 1 }),
    refreshNeeded: jest.fn().mockResolvedValue({ count: 1 }),
    informAboutRefreshError: jest.fn(),
  };
  const manager = {
    getSocialIntegration: jest.fn(() => ({ refreshToken })),
  };
  return {
    service: new RefreshIntegrationService(
      manager as any,
      integrationService as any,
      {} as any
    ),
    integrationService,
  };
};

describe('RefreshIntegrationService soft refresh', () => {
  it.each([
    ['throws', jest.fn().mockRejectedValue(new Error('429'))],
    ['returns no token', jest.fn().mockResolvedValue({ accessToken: '' })],
  ])('when the provider %s: false, nothing flagged, notified or saved', async (_, refreshToken) => {
    const { service, integrationService } = make(refreshToken);

    expect(await service.refresh(integration, '', true)).toBe(false);
    expect(integrationService.refreshNeeded).not.toHaveBeenCalled();
    expect(integrationService.informAboutRefreshError).not.toHaveBeenCalled();
    expect(integrationService.persistRefreshedAuthorization).not.toHaveBeenCalled();
  });

  it('saves a successful soft refresh like any other', async () => {
    const { service, integrationService } = make(
      jest.fn().mockResolvedValue({ accessToken: 'new' })
    );

    expect(await service.refresh(integration, '', true)).toEqual({ accessToken: 'new' });
    expect(integrationService.persistRefreshedAuthorization).toHaveBeenCalled();
  });

  it('still flags the channel when a normal refresh fails', async () => {
    const { service, integrationService } = make(
      jest.fn().mockRejectedValue(new Error('revoked'))
    );

    expect(await service.refresh(integration)).toBe(false);
    expect(integrationService.refreshNeeded).toHaveBeenCalledWith('org-A', 'int-1', 'old');
    expect(integrationService.informAboutRefreshError).toHaveBeenCalled();
  });

  it('does not notify again when the channel was already flagged', async () => {
    const { service, integrationService } = make(
      jest.fn().mockResolvedValue({ accessToken: '' })
    );
    integrationService.refreshNeeded.mockResolvedValue({ count: 0 });

    expect(await service.refresh(integration)).toBe(false);
    expect(integrationService.refreshNeeded).toHaveBeenCalled();
    expect(integrationService.informAboutRefreshError).not.toHaveBeenCalled();
  });
});
