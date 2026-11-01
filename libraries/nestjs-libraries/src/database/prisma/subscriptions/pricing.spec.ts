import {
  allowsExtraChannels,
  MAX_EXTRA_CHANNELS,
  pricing,
  totalChannelsOf,
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

  it('caps X posts a month on every plan, nothing on the free plan', () => {
    expect(pricing.FREE.provider_posts_per_month).toEqual({ x: 0 });
    expect(paid.map((p) => pricing[p].provider_posts_per_month?.x)).toEqual([
      30, 100, 300, 1000,
    ]);
  });

  it('sells extra channels on Ultimate only, $1 a month and 20% less yearly', () => {
    expect(Object.keys(pricing).filter(allowsExtraChannels)).toEqual([
      'ULTIMATE',
    ]);
    expect(pricing.ULTIMATE.extra_channel_month_price).toBe(1);
    expect(pricing.ULTIMATE.extra_channel_year_price).toBeCloseTo(
      pricing.ULTIMATE.extra_channel_month_price! * 12 * 0.8
    );
  });

  it('maps extra channels to the stored channel limit', () => {
    expect(totalChannelsOf('ULTIMATE')).toBe(100);
    expect(totalChannelsOf('ULTIMATE', 0)).toBe(100);
    expect(totalChannelsOf('ULTIMATE', 1)).toBe(101);
    expect(totalChannelsOf('ULTIMATE', 250)).toBe(350);
    expect(totalChannelsOf('ULTIMATE', -4)).toBe(100);
    expect(totalChannelsOf('ULTIMATE', 2.7)).toBe(102);
    expect(totalChannelsOf('ULTIMATE', 5000)).toBe(100 + MAX_EXTRA_CHANNELS);
  });

  it('ignores extra channels on a tier that does not sell them', () => {
    expect(totalChannelsOf('STANDARD', 10)).toBe(5);
    expect(totalChannelsOf('PRO', 10)).toBe(30);
    expect(totalChannelsOf('FREE', 10)).toBe(0);
    expect(allowsExtraChannels(undefined)).toBe(false);
    expect(allowsExtraChannels('UNKNOWN')).toBe(false);
  });
});
