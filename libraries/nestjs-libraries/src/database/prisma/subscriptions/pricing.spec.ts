import {
  isAiAvailable,
  pricing,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

describe('pricing', () => {
  const paid = ['STANDARD', 'TEAM', 'PRO', 'ULTIMATE'];

  it('has the launch prices', () => {
    expect(paid.map((p) => pricing[p].month_price)).toEqual([19, 29, 39, 79]);
    expect(paid.map((p) => pricing[p].year_price)).toEqual([
      180, 276, 372, 756,
    ]);
  });

  it('prices yearly at least 20% under twelve months', () => {
    for (const p of paid) {
      expect(pricing[p].year_price).toBeLessThanOrEqual(
        Math.round(pricing[p].month_price * 12 * 0.8)
      );
    }
  });

  it('maps every paid tier to a customer label and a Stripe lookup slug', () => {
    expect(paid.map((p) => pricing[p].label)).toEqual([
      'Starter',
      'Team',
      'Pro',
      'Ultimate',
    ]);
    expect(paid.map((p) => pricing[p].slug)).toEqual([
      'starter',
      'team',
      'pro',
      'ultimate',
    ]);
  });

  it('keeps every AI allowance off in every tier', () => {
    for (const tier of Object.values(pricing)) {
      expect(tier.ai).toBe(false);
      expect(tier.image_generator).toBe(false);
      expect(tier.image_generation_count).toBe(0);
      expect(tier.generate_videos).toBe(0);
      expect(tier.clipping_minutes).toBe(0);
    }
  });
});

describe('isAiAvailable', () => {
  const original = process.env.OPENAI_API_KEY;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = original;
    }
  });

  it('needs both the tier flag and a provider key', () => {
    const withAi = { ...pricing.ULTIMATE, ai: true };

    delete process.env.OPENAI_API_KEY;
    expect(isAiAvailable(withAi)).toBe(false);

    process.env.OPENAI_API_KEY = 'sk-test';
    expect(isAiAvailable(withAi)).toBe(true);
    expect(isAiAvailable(pricing.ULTIMATE)).toBe(false);
    expect(isAiAvailable(undefined)).toBe(false);
  });
});
