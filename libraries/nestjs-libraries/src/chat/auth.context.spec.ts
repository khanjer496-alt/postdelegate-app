import {
  PLAN_NEEDED_MESSAGE,
  SUBSCRIPTION_ENDED_MESSAGE,
  subscriptionProblem,
} from '@gitroom/nestjs-libraries/chat/auth.context';

describe('subscriptionProblem (MCP auth)', () => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  afterEach(() => {
    if (stripeKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = stripeKey;
    }
  });

  it('says the subscription ended for a workspace that had one', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    expect(subscriptionProblem({ subscription: null, paymentId: 'cus_1' })).toBe(
      SUBSCRIPTION_ENDED_MESSAGE
    );
    expect(SUBSCRIPTION_ENDED_MESSAGE).toContain(
      'Your PostDelegate subscription has ended'
    );
  });

  it('says an active plan is needed for a workspace that never subscribed', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    expect(subscriptionProblem({ subscription: null, paymentId: null })).toBe(
      PLAN_NEEDED_MESSAGE
    );
    expect(PLAN_NEEDED_MESSAGE).toContain('needs an active plan');
  });

  it('lets a subscribed organization through', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    expect(
      subscriptionProblem({ subscription: { subscriptionTier: 'PRO' } })
    ).toBeNull();
  });

  it('never blocks when billing is off (self-hosted)', () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(subscriptionProblem({ subscription: null })).toBeNull();
  });

  it('leaves a missing organization to the invalid token answer', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    expect(subscriptionProblem(undefined)).toBeNull();
  });
});
