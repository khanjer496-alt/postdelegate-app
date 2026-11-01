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
