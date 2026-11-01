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
