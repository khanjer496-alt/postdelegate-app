// the real services pull in every social provider, the spec only needs planMonth
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository', () => ({ SubscriptionRepository: class {} }));

import dayjs from 'dayjs';
import {
  planMonth,
  SubscriptionService,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';

describe('planMonth', () => {
  // a subscription that started on October 30, months clamp in February
  const anchor = new Date(2026, 9, 30, 12, 0, 0);
  const day = (y: number, m: number, d: number, h = 12) =>
    new Date(y, m - 1, d, h, 0, 0);

  it('starts every window where the previous one ends, October 30 to March 2027', () => {
    let current = planMonth(anchor, anchor);
    for (let at = dayjs(anchor); at.isBefore(day(2027, 4, 1)); at = at.add(1, 'hour')) {
      const window = planMonth(anchor, at.toDate());
      // each moment is inside its window
      expect(window.from.getTime()).toBeLessThanOrEqual(at.valueOf());
      expect(window.until.getTime()).toBeGreaterThan(at.valueOf());
      if (window.from.getTime() !== current.from.getTime()) {
        // no gap and no overlap with the window before
        expect(window.from).toEqual(current.until);
        current = window;
      }
    }
  });

  it('takes both ends from the anchor, so February does not shift March', () => {
    expect(planMonth(anchor, day(2027, 2, 27))).toEqual({
      from: day(2027, 1, 30),
      until: day(2027, 2, 28),
    });
    expect(planMonth(anchor, day(2027, 3, 15))).toEqual({
      from: day(2027, 2, 28),
      until: day(2027, 3, 30),
    });
    expect(planMonth(anchor, day(2027, 3, 31))).toEqual({
      from: day(2027, 3, 30),
      until: day(2027, 4, 30),
    });
  });

  it('puts a date before the anchor in the first window', () => {
    expect(planMonth(anchor, day(2026, 1, 1))).toEqual({
      from: anchor,
      until: day(2026, 11, 30),
    });
  });
});

describe('getProviderPostsLimits', () => {
  const repository = { getSubscriptionByOrganizationId: jest.fn() };
  const organizations = { getOrgById: jest.fn() };
  const service = new SubscriptionService(
    repository as any,
    {} as any,
    organizations as any
  );
  const anchor = new Date(2026, 9, 30);
  const env = process.env.STRIPE_PUBLISHABLE_KEY;

  beforeEach(() => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
  });
  afterAll(() => {
    process.env.STRIPE_PUBLISHABLE_KEY = env;
  });

  const limits = (tier: string | null, isTrailing: boolean) => {
    repository.getSubscriptionByOrganizationId.mockResolvedValue(
      tier ? { subscriptionTier: tier, createdAt: anchor } : null
    );
    organizations.getOrgById.mockResolvedValue({ id: 'org_1', isTrailing });
    return service.getProviderPostsLimits('org_1');
  };

  // isTrailing is also set for a paid renewal being retried, so the trial
  // caps come next to the plan's and the posts check confirms the trial
  it('adds the Starter X cap as the trial cap of a workspace marked trialing', async () => {
    expect(await limits('ULTIMATE', true)).toEqual({
      plan: 'Ultimate',
      limits: { x: 1000 },
      trialLimits: { x: 30 },
      anchor,
    });
  });

  it('gives the paid plan its own cap and no trial cap', async () => {
    expect(await limits('ULTIMATE', false)).toEqual({
      plan: 'Ultimate',
      limits: { x: 1000 },
      anchor,
    });
  });

  it('keeps a workspace without a plan at 0', async () => {
    expect((await limits(null, true))!.limits).toEqual({ x: 0 });
  });

  it('caps nothing without billing', async () => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    expect(await service.getProviderPostsLimits('org_1')).toBeNull();
  });
});

describe('SubscriptionService plan writes', () => {
  const make = (current: object | null, channels: object[] = []) => {
    const repository = {
      getSubscriptionByCustomerId: jest.fn().mockResolvedValue(current),
      getSubscriptionByOrgId: jest.fn().mockResolvedValue(current),
      getOrganizationByCustomerId: jest.fn().mockResolvedValue({ id: 'org_1' }),
      deleteSubscriptionByCustomerId: jest.fn().mockResolvedValue({ count: 1 }),
      createOrUpdateSubscription: jest.fn(),
      createOrUpdateLifetimeSubscription: jest.fn().mockResolvedValue(true),
      setCustomerId: jest.fn(),
    };
    const integrations = {
      getIntegrationsList: jest.fn().mockResolvedValue(channels),
      disableIntegrations: jest.fn(),
      enablePlanLockedIntegrations: jest.fn(),
      changeActiveCron: jest.fn(),
    };
    const organizations = { disableOrEnableNonSuperAdminUsers: jest.fn() };
    const service = new SubscriptionService(
      repository as any,
      integrations as any,
      organizations as any
    );
    return { service, repository, integrations };
  };

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('never removes a lifetime plan on a customer-keyed cancellation', async () => {
    const { service, repository, integrations } = make({
      provider: 'stripe',
      isLifetime: true,
      subscriptionTier: 'PRO',
    });
    expect(await service.deleteSubscription('cus_1', 'stripe')).toEqual({
      count: 0,
    });
    expect(repository.deleteSubscriptionByCustomerId).not.toHaveBeenCalled();
    expect(integrations.disableIntegrations).not.toHaveBeenCalled();
  });

  it('asks for a retry instead of throwing when a write fails', async () => {
    const failing = make({ provider: 'stripe', subscriptionTier: 'PRO' });
    failing.repository.deleteSubscriptionByCustomerId.mockRejectedValue(
      new Error('db down')
    );
    expect(await failing.service.deleteSubscription('cus_1', 'stripe')).toEqual(
      { count: 0, retry: true }
    );

    const update = make({ provider: 'stripe', subscriptionTier: 'PRO' });
    update.repository.createOrUpdateSubscription.mockRejectedValue(
      new Error('db down')
    );
    expect(
      await update.service.createOrUpdateSubscription(
        'stripe', false, 'u1', 'cus_1', 30, 'PRO', 'MONTHLY', null
      )
    ).toEqual({ retry: true });
  });

  it('acknowledges a plan change that fails on what the event carries', async () => {
    const { service, repository } = make({
      provider: 'stripe',
      subscriptionTier: 'PRO',
    });
    // an unknown plan in the metadata: a retry would fail the same way
    expect(
      await service.createOrUpdateSubscription(
        'stripe', false, 'u1', 'cus_1', 30, 'UNKNOWN' as any, 'MONTHLY', null
      )
    ).toEqual({});
    expect(repository.createOrUpdateSubscription).not.toHaveBeenCalled();
  });

  it('does not ask for a retry for a customer it does not know', async () => {
    const { service, repository } = make(null);
    repository.getOrganizationByCustomerId.mockResolvedValue(null);
    expect(
      await service.createOrUpdateSubscription(
        'stripe', false, 'u1', 'cus_x', 30, 'PRO', 'MONTHLY', null
      )
    ).toEqual({});
  });

  it('counts only connected channels when a plan shrinks', async () => {
    const { service, integrations } = make(
      { provider: 'stripe', subscriptionTier: 'PRO', totalChannels: 30 },
      [
        { id: 'a' },
        { id: 'b', refreshNeeded: true },
        { id: 'c' },
        { id: 'off', disabled: true },
        { id: 'temp', inBetweenSteps: true },
      ]
    );
    await service.modifySubscription('cus_1', 2, 'STANDARD');
    expect(integrations.disableIntegrations).toHaveBeenCalledWith('org_1', 1);
  });

  describe('channels a plan locked', () => {
    const channels = [
      { id: 'on-1' },
      { id: 'on-2' },
      { id: 'locked', disabled: true, disabledReason: 'PLAN_LIMIT' },
      { id: 'mine', disabled: true, disabledReason: 'USER' },
      { id: 'legacy', disabled: true },
    ];

    it('a downgrade locks the excess and turns nothing back on', async () => {
      const { service, integrations } = make(
        { provider: 'stripe', subscriptionTier: 'TEAM', totalChannels: 10 },
        channels
      );
      await service.modifySubscription('cus_1', 1, 'STANDARD');
      // the newest one, the order is the repository's (createdAt desc)
      expect(integrations.disableIntegrations).toHaveBeenCalledWith('org_1', 1);
      expect(integrations.enablePlanLockedIntegrations).not.toHaveBeenCalled();
    });

    it('an upgrade unlocks as many as the new limit has room for next to the channels on', async () => {
      const { service, integrations } = make(
        { provider: 'stripe', subscriptionTier: 'STANDARD', totalChannels: 2 },
        channels
      );
      await service.modifySubscription('cus_1', 3, 'TEAM');
      expect(integrations.disableIntegrations).not.toHaveBeenCalled();
      // which ones (PLAN_LIMIT only, oldest first) is the repository's
      expect(integrations.enablePlanLockedIntegrations).toHaveBeenCalledWith(
        'org_1',
        1
      );
    });

    it('a renewal, a same-limit update or a move to FREE never turns a channel on', async () => {
      const same = make(
        { provider: 'stripe', subscriptionTier: 'TEAM', totalChannels: 10 },
        channels
      );
      await same.service.modifySubscription('cus_1', 10, 'TEAM');
      expect(same.integrations.enablePlanLockedIntegrations).not.toHaveBeenCalled();

      const free = make(null, channels);
      await free.service.modifySubscriptionByOrg('org_1', 10, 'FREE');
      expect(free.integrations.enablePlanLockedIntegrations).not.toHaveBeenCalled();

      // the limit grew, but the channels on already fill it
      const full = make(
        { provider: 'stripe', subscriptionTier: 'STANDARD', totalChannels: 1 },
        channels
      );
      await full.service.modifySubscription('cus_1', 2, 'STANDARD');
      expect(full.integrations.enablePlanLockedIntegrations).not.toHaveBeenCalled();
    });

    it('stores the plan when turning channels back on fails, never throwing to the webhook', async () => {
      const { service, repository, integrations } = make(
        { provider: 'stripe', subscriptionTier: 'STANDARD', totalChannels: 2 },
        channels
      );
      integrations.enablePlanLockedIntegrations.mockRejectedValue(
        new Error('db down')
      );
      expect(
        await service.createOrUpdateSubscription(
          'stripe', false, 'u1', 'cus_1', 10, 'TEAM', 'MONTHLY', null
        )
      ).toBeUndefined();
      expect(repository.createOrUpdateSubscription).toHaveBeenCalled();
    });
  });

  it('tells the admin why a lifetime or another provider plan was left alone', async () => {
    const lifetime = make({ provider: 'stripe', isLifetime: true });
    expect(
      await lifetime.service.addSubscription('org_1', 'PRO', 'stripe')
    ).toEqual({ added: false, reason: expect.stringContaining('lifetime') });

    const store = make({ provider: 'revenuecat', isLifetime: false });
    expect(
      await store.service.addSubscription('org_1', 'PRO', 'stripe')
    ).toEqual({ added: false, reason: expect.stringContaining('revenuecat') });
    expect(store.repository.createOrUpdateSubscription).not.toHaveBeenCalled();
  });

  it('sets an admin plan on the workspace without touching its Stripe customer', async () => {
    const { service, repository } = make(null);
    expect(await service.addSubscription('org_1', 'PRO', 'stripe')).toEqual({
      added: true,
    });
    expect(repository.setCustomerId).not.toHaveBeenCalled();
    expect(repository.createOrUpdateSubscription).toHaveBeenCalledWith(
      'stripe',
      false,
      expect.stringMatching(/^admin_/),
      '',
      expect.any(Number),
      'PRO',
      'MONTHLY',
      null,
      undefined,
      { id: 'org_1' },
      // an admin plan has no provider status
      undefined
    );
  });

  it('stores the provider status with the plan, and the trial flag it was given', async () => {
    const { service, repository } = make({
      provider: 'stripe',
      subscriptionTier: 'PRO',
    });
    const state = {
      status: 'past_due',
      trialEndsAt: null,
      currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
    };
    expect(
      await service.createOrUpdateSubscription(
        'stripe', false, 'u1', 'cus_1', 30, 'PRO', 'MONTHLY', null,
        undefined, undefined, state
      )
    ).toBeUndefined();
    expect(repository.createOrUpdateSubscription).toHaveBeenCalledWith(
      'stripe', false, 'u1', 'cus_1', 30, 'PRO', 'MONTHLY', null,
      undefined, undefined, state
    );
  });

  it('stores the provider status of a store subscription keyed by the workspace', async () => {
    const { service, repository } = make({
      provider: 'revenuecat',
      subscriptionTier: 'PRO',
    });
    const state = {
      status: 'trialing',
      trialEndsAt: new Date('2026-11-15T00:00:00Z'),
      currentPeriodEnd: new Date('2026-11-15T00:00:00Z'),
    };
    await service.createOrUpdateSubscriptionByOrg(
      true, 'org_1', 'revenuecat', 'com.app.pro.monthly', 30, 'PRO', 'MONTHLY', null,
      state
    );
    expect(repository.createOrUpdateSubscription).toHaveBeenCalledWith(
      'revenuecat', true, 'com.app.pro.monthly', '', 30, 'PRO', 'MONTHLY', null,
      undefined, { id: 'org_1' }, state
    );
  });

  it('removes the plan, and asks for a retry instead of throwing', async () => {
    const { service, repository } = make({
      provider: 'stripe',
      subscriptionTier: 'PRO',
      totalChannels: 30,
    });
    expect(await service.deleteSubscription('cus_1', 'stripe')).toEqual({
      count: 1,
    });
    expect(repository.deleteSubscriptionByCustomerId).toHaveBeenCalledWith(
      'cus_1',
      'stripe'
    );

    repository.getSubscriptionByCustomerId.mockRejectedValue(new Error('db'));
    expect(await service.deleteSubscription('cus_1', 'stripe')).toEqual({
      count: 0,
      retry: true,
    });
  });

  describe('lifetime codes', () => {
    it('turns back on the channels a downgrade locked, like an upgrade', async () => {
      const { service, repository, integrations } = make(null, [
        { id: 'a' },
        { id: 'off', disabled: true, disabledReason: 'PLAN_LIMIT' },
      ]);
      expect(
        await service.createOrUpdateSubscription(
          'stripe', false, 'id', 'org_1', 5, 'STANDARD', 'MONTHLY', null,
          'code', 'org_1'
        )
      ).toBeUndefined();
      expect(
        repository.createOrUpdateLifetimeSubscription
      ).toHaveBeenCalledWith('stripe', 'id', 5, 'STANDARD', 'MONTHLY', 'code', 'org_1');
      // room for the 4 channels the 5-channel plan has next to the one on
      expect(integrations.enablePlanLockedIntegrations).toHaveBeenCalledWith(
        'org_1',
        4
      );
    });

    it('says when the code was spent by another redeem first', async () => {
      const { service, repository, integrations } = make(null);
      repository.createOrUpdateLifetimeSubscription.mockResolvedValue(false);
      expect(
        await service.createOrUpdateSubscription(
          'stripe', false, 'id', 'org_1', 5, 'STANDARD', 'MONTHLY', null,
          'code', 'org_1'
        )
      ).toEqual({ codeUsed: true });
      expect(integrations.enablePlanLockedIntegrations).not.toHaveBeenCalled();
    });
  });
});
