jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);

import { RevenueCatProvider } from '@gitroom/nestjs-libraries/services/payment/providers/revenuecat.provider';

describe('RevenueCatProvider trial status', () => {
  const env = { ...process.env };
  const fetchMock = jest.fn();
  const subscriptionService = {
    createOrUpdateSubscriptionByOrg: jest.fn(),
    deleteSubscriptionByOrgId: jest.fn(),
    getSubscriptionByOrganizationId: jest.fn(),
  };
  const organizationService = { getOrgById: jest.fn() };
  const provider = new RevenueCatProvider(
    subscriptionService as any,
    organizationService as any
  );

  const subscriber = (subscriptions: Record<string, object>) =>
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ subscriber: { subscriptions } }),
    });
  const store = (over: Record<string, unknown> = {}) => ({
    expires_date: '2999-01-01T00:00:00Z',
    purchase_date: '2026-11-01T00:00:00Z',
    original_purchase_date: '2026-11-01T00:00:00Z',
    unsubscribe_detected_at: null,
    billing_issues_detected_at: null,
    is_sandbox: false,
    store: 'app_store',
    period_type: 'normal',
    ...over,
  });

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.REVENUECAT_SECRET_KEY = 'rc_secret';
    global.fetch = fetchMock as any;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    organizationService.getOrgById.mockResolvedValue({ id: 'org_1' });
  });
  afterAll(() => {
    process.env = { ...env };
  });

  it.each([
    ['an intro trial', { period_type: 'trial' }, true, 'trialing'],
    ['a paid period', {}, false, 'active'],
    [
      'a renewal the store is retrying',
      { billing_issues_detected_at: '2026-11-02T00:00:00Z' },
      false,
      'past_due',
    ],
  ])('stores %s with its status', async (_, over, trial, status) => {
    subscriber({ 'com.app.pro.monthly': store(over) });

    expect(await provider.syncSubscription('org_1')).toEqual({ active: true });

    const call =
      subscriptionService.createOrUpdateSubscriptionByOrg.mock.calls[0];
    expect(call[0]).toBe(trial);
    expect(call[8]).toEqual({
      status,
      trialEndsAt: trial ? new Date('2999-01-01T00:00:00Z') : null,
      currentPeriodEnd: new Date('2999-01-01T00:00:00Z'),
    });
  });

  it('asks for the event again when the plan cannot be removed, never throwing', async () => {
    subscriber({});
    subscriptionService.deleteSubscriptionByOrgId.mockRejectedValue(
      new Error('db down')
    );
    expect(await provider.syncSubscription('org_1')).toEqual({
      active: false,
      retry: true,
    });
  });

  describe('isTrialing', () => {
    const stored = (over: Record<string, unknown>) =>
      subscriptionService.getSubscriptionByOrganizationId.mockResolvedValue({
        provider: 'revenuecat',
        status: 'trialing',
        trialEndsAt: new Date(Date.now() + 86400000),
        ...over,
      });

    it('is a trial while the stored status is trialing and not past its end', async () => {
      stored({});
      expect(await provider.isTrialing('org_1')).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ['active', { status: 'active' }],
      ['past_due', { status: 'past_due' }],
      ['a trial past its end', { trialEndsAt: new Date(Date.now() - 1000) }],
      ['another provider', { provider: 'stripe' }],
    ])('is not a trial for %s', async (_, over) => {
      stored(over);
      expect(await provider.isTrialing('org_1')).toBe(false);
    });

    it('falls back to the workspace flag on a row stored before the status', async () => {
      stored({ status: null, trialEndsAt: null });
      organizationService.getOrgById.mockResolvedValue({ isTrailing: true });
      expect(await provider.isTrialing('org_1')).toBe(true);
    });

    it('is not a trial without a subscription', async () => {
      subscriptionService.getSubscriptionByOrganizationId.mockResolvedValue(
        null
      );
      expect(await provider.isTrialing('org_1')).toBe(false);
    });
  });
});
