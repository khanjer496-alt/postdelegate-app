const mockStripe = {
  subscriptions: { list: jest.fn() },
};

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn(() => mockStripe),
}));
// stripe.service is loaded for its helpers only, like in its own spec
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/users/users.service',
  () => ({ UsersService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({
  TrackService: class {},
}));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: {} }));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);

import { SubscriptionStatusSyncService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.status.sync.service';

describe('SubscriptionStatusSyncService', () => {
  const env = { ...process.env };
  const updatedAt = new Date('2026-11-01T00:00:00Z');
  const periodEnd = 1900000000;

  const plan = (over: Record<string, any> = {}) => ({
    id: 'sub_row_1',
    organizationId: 'org_1',
    identifier: 'u1',
    status: null,
    trialEndsAt: null,
    currentPeriodEnd: null,
    updatedAt,
    organization: { paymentId: 'cus_1', isTrailing: true },
    ...over,
  });

  const stripeSubscription = (status: string, over: Record<string, any> = {}) => ({
    id: `sub_${status}`,
    status,
    trial_end: null,
    metadata: { uniqueId: 'u1' },
    items: { data: [{ id: 'si_1', current_period_end: periodEnd }] },
    ...over,
  });

  const make = (rows: any[]) => {
    const repository = {
      getProviderSubscriptionsPage: jest
        .fn()
        .mockResolvedValueOnce(rows)
        .mockResolvedValue([]),
      setProviderStateIfUnchanged: jest.fn().mockResolvedValue(true),
      countEndedTrialFlags: jest.fn().mockResolvedValue(3),
      clearEndedTrialFlags: jest.fn().mockResolvedValue({ count: 3 }),
    };
    return {
      repository,
      service: new SubscriptionStatusSyncService(repository as any),
    };
  };

  const live = (...subscriptions: any[]) =>
    mockStripe.subscriptions.list.mockResolvedValueOnce({ data: subscriptions });

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterAll(() => {
    process.env = { ...env };
  });

  it.each([
    ['trialing', true],
    ['active', false],
    // a renewal being retried keeps its plan and is no trial
    ['past_due', false],
  ])(
    'stores a %s subscription and sets the trial flag from it',
    async (status, isTrailing) => {
      const { service, repository } = make([plan()]);
      live(stripeSubscription(status));

      const report = await service.run({ delayMs: 0 });

      expect(mockStripe.subscriptions.list).toHaveBeenCalledWith({
        customer: 'cus_1',
        status: 'all',
        limit: 100,
      });
      expect(repository.setProviderStateIfUnchanged).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sub_row_1', updatedAt }),
        { from: true, to: isTrailing },
        {
          status,
          trialEndsAt: null,
          currentPeriodEnd: new Date(periodEnd * 1000),
        }
      );
      expect(report).toMatchObject({ scanned: 1, updated: 1, unchanged: 0 });
    }
  );

  it('keeps the trial of a first charge after it that Stripe is retrying', async () => {
    const { service, repository } = make([plan()]);
    live(
      stripeSubscription('past_due', {
        trial_end: 1800000000,
        items: {
          data: [
            {
              id: 'si_1',
              current_period_start: 1800000000,
              current_period_end: periodEnd,
            },
          ],
        },
      })
    );

    await service.run({ delayMs: 0 });

    expect(repository.setProviderStateIfUnchanged).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sub_row_1' }),
      { from: true, to: true },
      expect.objectContaining({ status: 'past_due' })
    );
  });

  it('counts a plan that cannot be stored as failed and goes on', async () => {
    const { service, repository } = make([
      plan({ id: 'a', organizationId: 'org_db' }),
      plan({ id: 'b', organizationId: 'org_ok' }),
    ]);
    mockStripe.subscriptions.list.mockResolvedValue({
      data: [stripeSubscription('active')],
    });
    repository.setProviderStateIfUnchanged
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(true);

    const report = await service.run({ delayMs: 0 });

    expect(report.failed).toEqual(['org_db']);
    expect(report.updated).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'organization org_db: could not be stored'
    );
  });

  it.each(['unpaid', 'paused', 'incomplete', 'canceled'])(
    'reports a %s subscription as needing attention and never acts on it',
    async (status) => {
      const { service, repository } = make([plan()]);
      live(stripeSubscription(status));

      const report = await service.run({ delayMs: 0 });

      expect(report.needsAttention).toEqual([
        { organizationId: 'org_1', status },
      ]);
      expect(repository.setProviderStateIfUnchanged).not.toHaveBeenCalled();
    }
  );

  it('reports a customer with no subscription at all', async () => {
    const { service } = make([plan()]);
    live();
    expect((await service.run({ delayMs: 0 })).needsAttention).toEqual([
      { organizationId: 'org_1', status: 'none' },
    ]);
  });

  it('follows the subscription the stored plan came from', async () => {
    const { service, repository } = make([plan()]);
    live(
      stripeSubscription('active', { metadata: { uniqueId: 'other' } }),
      stripeSubscription('trialing', { metadata: { uniqueId: 'u1' } })
    );

    await service.run({ delayMs: 0 });

    expect(repository.setProviderStateIfUnchanged.mock.calls[0][2].status).toBe(
      'trialing'
    );
  });

  it('leaves a plan that already holds what Stripe has', async () => {
    const { service, repository } = make([
      plan({
        status: 'active',
        currentPeriodEnd: new Date(periodEnd * 1000),
        organization: { paymentId: 'cus_1', isTrailing: false },
      }),
    ]);
    live(stripeSubscription('active'));

    const report = await service.run({ delayMs: 0 });

    expect(report).toMatchObject({ unchanged: 1, updated: 0 });
    expect(repository.setProviderStateIfUnchanged).not.toHaveBeenCalled();
  });

  it('writes nothing on a dry run, and only counts the ended trials', async () => {
    const { service, repository } = make([plan()]);
    live(stripeSubscription('past_due'));

    const report = await service.run({ delayMs: 0, dryRun: true });

    expect(report).toMatchObject({ dryRun: true, updated: 1, endedTrials: 3 });
    expect(repository.setProviderStateIfUnchanged).not.toHaveBeenCalled();
    expect(repository.clearEndedTrialFlags).not.toHaveBeenCalled();
  });

  it('clears the flags of workspaces whose subscription ended', async () => {
    const { service, repository } = make([]);
    expect((await service.run({ delayMs: 0 })).endedTrials).toBe(3);
    expect(repository.clearEndedTrialFlags).toHaveBeenCalled();
  });

  it('counts a plan a webhook stored since as skipped, not updated', async () => {
    const { service, repository } = make([plan()]);
    repository.setProviderStateIfUnchanged.mockResolvedValue(false);
    live(stripeSubscription('active'));

    expect(await service.run({ delayMs: 0 })).toMatchObject({
      updated: 0,
      skippedChanged: 1,
    });
  });

  it('skips admin plans, and goes on past a customer Stripe cannot read', async () => {
    const { service, repository } = make([
      plan({ id: 'a', organizationId: 'org_admin', identifier: 'admin_x1' }),
      plan({ id: 'b', organizationId: 'org_down' }),
      plan({ id: 'c', organizationId: 'org_ok' }),
    ]);
    mockStripe.subscriptions.list
      .mockRejectedValueOnce(
        Object.assign(new Error('No such customer: cus_1'), {
          code: 'resource_missing',
        })
      )
      .mockResolvedValueOnce({ data: [stripeSubscription('active')] });

    const report = await service.run({ delayMs: 0 });

    expect(report).toMatchObject({ scanned: 3, skipped: 1, updated: 1 });
    expect(report.failed).toEqual(['org_down']);
    expect(mockStripe.subscriptions.list).toHaveBeenCalledTimes(2);
    // the workspace and the error code, never what Stripe said
    expect(console.error).toHaveBeenCalledWith(
      'organization org_down: Stripe could not be read (resource_missing)'
    );
    expect(repository.setProviderStateIfUnchanged.mock.calls[0][0].id).toBe(
      'c'
    );
  });

  it('reads the plans a page at a time, resuming after the last id', async () => {
    const { service, repository } = make([]);
    repository.getProviderSubscriptionsPage
      .mockReset()
      .mockResolvedValueOnce([plan({ id: 'a' }), plan({ id: 'b' })])
      .mockResolvedValueOnce([]);
    mockStripe.subscriptions.list.mockResolvedValue({
      data: [stripeSubscription('active')],
    });

    await service.run({ delayMs: 0, batchSize: 2 });

    expect(repository.getProviderSubscriptionsPage.mock.calls).toEqual([
      ['stripe', 2, undefined],
      ['stripe', 2, 'b'],
    ]);
  });

  it('refuses to run without Stripe', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { service, repository } = make([]);
    await expect(service.run()).rejects.toThrow('STRIPE_SECRET_KEY');
    expect(repository.getProviderSubscriptionsPage).not.toHaveBeenCalled();
  });
});
