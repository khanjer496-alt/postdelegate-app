// the real services pull in every social provider, the spec only needs the shape
jest.mock('@gitroom/nestjs-libraries/database/prisma/errors/errors.service', () => ({ ErrorsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service', () => ({ AdminStatsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/affiliates/affiliate.service', () => ({ AffiliateService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/reviews/review.service', () => ({ ReviewService: class {} }));

import { ReviewStatus } from '@prisma/client';
import { AdminController } from './admin.controller';
import { ReviewsController } from './reviews.controller';
import { PublicReviewsController } from './public.reviews.controller';

const reviewService = {
  isEligible: jest.fn().mockResolvedValue(true),
  markShown: jest.fn().mockResolvedValue({ ok: true }),
  dismiss: jest.fn().mockResolvedValue({ ok: true }),
  getMine: jest.fn().mockResolvedValue(null),
  submit: jest.fn().mockResolvedValue({ ok: true, lowRating: false }),
  listForAdmin: jest.fn().mockResolvedValue([{ id: 'r1' }]),
  exportApproved: jest.fn().mockResolvedValue([{ displayName: 'Sam' }]),
  setStatus: jest.fn().mockResolvedValue({ id: 'r1', status: 'APPROVED' }),
  getPublicFeed: jest.fn().mockResolvedValue([]),
};

describe('ReviewsController', () => {
  const controller = new ReviewsController(reviewService as any);
  const user: any = { id: 'u1', createdAt: new Date() };
  const org: any = { id: 'o1' };

  beforeEach(() => jest.clearAllMocks());

  it('only ever acts on the signed in user and their organization', async () => {
    expect(await controller.getPrompt(user, org)).toEqual({ eligible: true });
    expect(reviewService.isEligible).toHaveBeenCalledWith(user, 'o1');

    await controller.markShown(user);
    await controller.dismiss(user);
    await controller.getMine(user);
    await controller.submit(user, org, { rating: 5, text: 'Great' });

    expect(reviewService.markShown).toHaveBeenCalledWith('u1');
    expect(reviewService.dismiss).toHaveBeenCalledWith('u1');
    expect(reviewService.getMine).toHaveBeenCalledWith('u1');
    expect(reviewService.submit).toHaveBeenCalledWith('u1', 'o1', {
      rating: 5,
      text: 'Great',
    });
  });
});

describe('AdminController reviews authorization', () => {
  const controller = new AdminController(
    {} as any,
    {} as any,
    {} as any,
    reviewService as any
  );
  const admin: any = { id: 'a1', isSuperAdmin: true };
  const regular: any = { id: 'u1', isSuperAdmin: false };

  beforeEach(() => jest.clearAllMocks());

  it('lists, exports and moves the status for a super admin', async () => {
    expect(await controller.listReviews(admin, 'NEW')).toEqual([{ id: 'r1' }]);
    expect(reviewService.listForAdmin).toHaveBeenCalledWith('NEW');

    expect(await controller.exportReviews(admin)).toEqual([
      { displayName: 'Sam' },
    ]);

    await controller.setReviewStatus(admin, 'r1', {
      status: ReviewStatus.APPROVED,
    });
    expect(reviewService.setStatus).toHaveBeenCalledWith('r1', 'APPROVED');
  });

  it('refuses a regular user before touching any data', async () => {
    await expect(controller.listReviews(regular)).rejects.toThrow('Unauthorized');
    await expect(controller.exportReviews(regular)).rejects.toThrow(
      'Unauthorized'
    );
    await expect(
      controller.setReviewStatus(regular, 'r1', { status: ReviewStatus.APPROVED })
    ).rejects.toThrow('Unauthorized');

    expect(reviewService.listForAdmin).not.toHaveBeenCalled();
    expect(reviewService.exportApproved).not.toHaveBeenCalled();
    expect(reviewService.setStatus).not.toHaveBeenCalled();
  });

  it('refuses a missing user', async () => {
    await expect(controller.listReviews(undefined as any)).rejects.toThrow(
      'Unauthorized'
    );
  });
});

describe('PublicReviewsController', () => {
  it('serves the feed without a user and is cached and rate limited', async () => {
    const controller = new PublicReviewsController(reviewService as any);
    await controller.getFeed();
    expect(reviewService.getPublicFeed).toHaveBeenCalled();

    const handler = PublicReviewsController.prototype.getFeed;
    expect(Reflect.getMetadata('__headers__', handler)).toEqual([
      { name: 'Cache-Control', value: 'public, max-age=60' },
    ]);
    expect(Reflect.getMetadata('__guards__', handler)).toHaveLength(1);
  });
});
