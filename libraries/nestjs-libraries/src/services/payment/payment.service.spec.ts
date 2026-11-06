jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);

import { PaymentService } from '@gitroom/nestjs-libraries/services/payment/payment.service';

describe('PaymentService.isTrialing', () => {
  const provider = { isTrialing: jest.fn() };
  const manager = { getProvider: jest.fn(() => provider) };
  const subscriptions = { getSubscriptionByOrganizationId: jest.fn() };
  const service = new PaymentService(manager as any, subscriptions as any);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    subscriptions.getSubscriptionByOrganizationId.mockResolvedValue({
      provider: 'stripe',
    });
  });

  it('asks the provider that owns the subscription', async () => {
    provider.isTrialing.mockResolvedValue(true);
    expect(await service.isTrialing('org_1')).toBe(true);
    expect(manager.getProvider).toHaveBeenCalledWith('stripe');
    expect(provider.isTrialing).toHaveBeenCalledWith('org_1');
  });

  // a limit built on the answer falls back to the plan's
  it('says no when the provider cannot be reached', async () => {
    provider.isTrialing.mockRejectedValue(new Error('ECONNRESET'));
    expect(await service.isTrialing('org_1')).toBe(false);
  });

  it('says no without a subscription', async () => {
    subscriptions.getSubscriptionByOrganizationId.mockResolvedValue(null);
    expect(await service.isTrialing('org_1')).toBe(false);
    expect(manager.getProvider).not.toHaveBeenCalled();
  });
});

describe('PaymentService.getGrowthStats', () => {
  const stats = (overrides: Record<string, any> = {}) => ({
    supported: true,
    currency: 'usd',
    trialsStarted: 1,
    trialsRunning: 1,
    trialsRunningWithCard: 0,
    trialsConverted: 1,
    trialsExpired: 0,
    paying: 1,
    payingByPlan: [
      { tier: 'STANDARD', period: 'MONTHLY', count: 1, mrr: 1900 },
    ],
    mrr: 1900,
    cancellations: 0,
    cancelling: 1,
    paymentFailing: 1,
    ...overrides,
  });
  const web = { getGrowthStats: jest.fn() };
  const mobile = { getGrowthStats: jest.fn() };
  const manager = {
    getProviders: jest.fn(() => [
      { name: 'stripe', provider: web },
      { name: 'revenuecat', provider: mobile },
    ]),
  };
  const service = new PaymentService(manager as any, {} as any);
  const from = new Date('2026-10-01');
  const to = new Date('2026-10-31');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('adds up the providers that support it', async () => {
    web.getGrowthStats.mockResolvedValue(stats());
    mobile.getGrowthStats.mockResolvedValue(
      stats({
        trialsStarted: 2,
        mrr: 2900,
        payingByPlan: [
          { tier: 'STANDARD', period: 'MONTHLY', count: 1, mrr: 1900 },
          { tier: 'PRO', period: 'MONTHLY', count: 1, mrr: 1000 },
        ],
      })
    );

    const total = await service.getGrowthStats(from, to);

    expect(web.getGrowthStats).toHaveBeenCalledWith(from, to);
    expect(total.supported).toBe(true);
    expect(total.trialsStarted).toBe(3);
    expect(total.mrr).toBe(4800);
    expect(total.cancelling).toBe(2);
    expect(total.paymentFailing).toBe(2);
    expect(total.payingByPlan).toEqual([
      { tier: 'STANDARD', period: 'MONTHLY', count: 2, mrr: 3800 },
      { tier: 'PRO', period: 'MONTHLY', count: 1, mrr: 1000 },
    ]);
  });

  it('leaves out a provider that does not support it or fails', async () => {
    web.getGrowthStats.mockRejectedValue(new Error('ECONNRESET'));
    mobile.getGrowthStats.mockResolvedValue(stats({ supported: false }));

    const total = await service.getGrowthStats(from, to);

    expect(total.supported).toBe(false);
    expect(total.paying).toBe(0);
    expect(console.error).toHaveBeenCalled();
  });
});
