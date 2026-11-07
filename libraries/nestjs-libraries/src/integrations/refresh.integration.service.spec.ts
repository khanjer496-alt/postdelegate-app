jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: jest.fn(async () => undefined),
}));

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
    // the concurrency wait loop reads the stored row back: the default is the
    // same unchanged row, so no other flow looks to have refreshed and the
    // loop falls through to flagging, which is what these tests are about
    getIntegrationById: jest.fn().mockResolvedValue({
      token: 'old',
      refreshToken: 'refresh',
      internalId: 'internal',
      providerIdentifier: 'network',
      refreshNeeded: false,
      inBetweenSteps: false,
      deletedAt: null,
      tokenExpiration: null,
    }),
    // the real one pins the write to the token we started from, so it writes
    // nothing once another flow has rotated it. A mock that always reports
    // count 1 would hide the bug this suite exists to catch
    persistRefreshedAuthorization: jest.fn(async (int: any) =>
      int.token === 'old' ? { count: 1 } : { count: 0 }
    ),
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

  // the cause is read out in the notification and its email
  it.each([
    ['a workflow cause', 'Please re-authenticate your YouTube account', 'Please re-authenticate your YouTube account'],
    // the placeholder handleErrors leaves when it could not map the response
    ['the unmapped placeholder', 'Unknown Error', ''],
    ['no cause at all', '', ''],
  ])('notifies with %s', async (_, cause, expected) => {
    const { service, integrationService } = make(
      jest.fn().mockRejectedValue(new Error('revoked'))
    );

    expect(await service.refresh(integration, cause)).toBe(false);
    expect(integrationService.informAboutRefreshError).toHaveBeenCalledWith(
      'org-A',
      expect.anything(),
      expected
    );
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

describe('RefreshIntegrationService concurrent refresh', () => {
  // Two flows can refresh the same channel at once. A provider that rotates
  // the refresh token rejects the second call while the first is still
  // storing its tokens, and flagging the channel on that is wrong: the
  // channel is fine, someone else just got there first.
  it('reuses the tokens the other flow stored instead of flagging', async () => {
    const { service, integrationService } = make(
      jest.fn(async () => false as const)
    );
    const inOneHour = new Date(Date.now() + 3600_000);
    integrationService.getIntegrationById.mockResolvedValue({
      token: 'new',
      refreshToken: 'rotated',
      internalId: 'internal',
      providerIdentifier: 'network',
      name: 'Channel',
      profile: 'handle',
      picture: 'pic',
      refreshNeeded: false,
      inBetweenSteps: false,
      deletedAt: null,
      tokenExpiration: inOneHour,
    });

    const result = await service.refresh(integration);

    expect(result).toMatchObject({
      accessToken: 'new',
      refreshToken: 'rotated',
      id: 'internal',
    });
    // the other flow already stored them: writing again would be pinned to the
    // token we started from, write nothing, and turn a success into a failure
    expect(
      integrationService.persistRefreshedAuthorization
    ).not.toHaveBeenCalled();
    expect(integrationService.refreshNeeded).not.toHaveBeenCalled();
    expect(integrationService.informAboutRefreshError).not.toHaveBeenCalled();
  });

  it('still flags when the stored row is the one we already tried', async () => {
    const { service, integrationService } = make(
      jest.fn(async () => false as const)
    );

    expect(await service.refresh(integration)).toBe(false);
    expect(integrationService.refreshNeeded).toHaveBeenCalled();
  });
});
