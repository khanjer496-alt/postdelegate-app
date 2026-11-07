import { HttpException } from '@nestjs/common';
import { ReviewStatus } from '@prisma/client';
import { ReviewService, isReviewEligible } from './review.service';
import { ReviewRepository } from './review.repository';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-30T12:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

const facts = (over: Partial<Parameters<typeof isReviewEligible>[0]> = {}) => ({
  now: NOW,
  userCreatedAt: ago(8),
  reviewed: false,
  dismissedAt: null,
  publishedPosts: jest.fn().mockResolvedValue(3),
  ...over,
});

describe('isReviewEligible', () => {
  it('asks an account older than 7 days with 3 published posts', async () => {
    expect(await isReviewEligible(facts())).toBe(true);
  });

  it('does not ask an account younger than 7 days, nor count its posts', async () => {
    const f = facts({ userCreatedAt: ago(6.9) });
    expect(await isReviewEligible(f)).toBe(false);
    expect(f.publishedPosts).not.toHaveBeenCalled();
  });

  it('asks an account exactly 7 days old', async () => {
    expect(await isReviewEligible(facts({ userCreatedAt: ago(7) }))).toBe(true);
  });

  it('does not ask with fewer than 3 published posts', async () => {
    expect(
      await isReviewEligible(
        facts({ publishedPosts: jest.fn().mockResolvedValue(2) })
      )
    ).toBe(false);
  });

  it('does not ask someone who already reviewed', async () => {
    expect(await isReviewEligible(facts({ reviewed: true }))).toBe(false);
  });

  it('does not ask within 30 days of a dismissal', async () => {
    expect(await isReviewEligible(facts({ dismissedAt: ago(29) }))).toBe(false);
  });

  it('asks again once the dismissal is 30 days old', async () => {
    expect(await isReviewEligible(facts({ dismissedAt: ago(30) }))).toBe(true);
    expect(await isReviewEligible(facts({ dismissedAt: ago(90) }))).toBe(true);
  });
});

const makeRepository = () => ({
  getReviewByUserId: jest.fn().mockResolvedValue(null),
  getPrompt: jest.fn().mockResolvedValue(null),
  countPublishedPosts: jest.fn().mockResolvedValue(5),
  upsertReview: jest.fn().mockResolvedValue({}),
  markPromptShown: jest.fn().mockResolvedValue({}),
  markPromptDismissed: jest.fn().mockResolvedValue({}),
  markPromptReviewed: jest.fn().mockResolvedValue({}),
  listForAdmin: jest.fn().mockResolvedValue([]),
  updateStatus: jest.fn().mockResolvedValue({ count: 1 }),
  listPublic: jest.fn().mockResolvedValue([]),
});

const setup = () => {
  const repository = makeRepository();
  const service = new ReviewService(repository as any);
  return { service, repository };
};

describe('ReviewService eligibility', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  const user = { id: 'u1', createdAt: ago(10) };

  it('is eligible and counts the published posts of the organization', async () => {
    const { service, repository } = setup();
    expect(await service.isEligible(user, 'o1')).toBe(true);
    expect(repository.countPublishedPosts).toHaveBeenCalledWith('o1', 3);
  });

  it('is not eligible once a review exists', async () => {
    const { service, repository } = setup();
    repository.getReviewByUserId.mockResolvedValue({ id: 'r1' });
    expect(await service.isEligible(user, 'o1')).toBe(false);
  });

  it('is not eligible once the prompt was answered', async () => {
    const { service, repository } = setup();
    repository.getPrompt.mockResolvedValue({ reviewedAt: ago(1) });
    expect(await service.isEligible(user, 'o1')).toBe(false);
  });

  it('is not eligible after a recent dismissal', async () => {
    const { service, repository } = setup();
    repository.getPrompt.mockResolvedValue({ dismissedAt: ago(5) });
    expect(await service.isEligible(user, 'o1')).toBe(false);
  });

  it('is not eligible with too few posts', async () => {
    const { service, repository } = setup();
    repository.countPublishedPosts.mockResolvedValue(1);
    expect(await service.isEligible(user, 'o1')).toBe(false);
  });
});

describe('ReviewService.submit', () => {
  it('saves a 5 star review with consent and marks the prompt answered', async () => {
    const { service, repository } = setup();
    const result = await service.submit('u1', 'o1', {
      rating: 5,
      text: '  Great tool  ',
      displayName: ' Sam ',
      roleCompany: ' Founder, Acme ',
      consentToPublish: true,
    });

    expect(result).toEqual({ ok: true, lowRating: false });
    expect(repository.upsertReview).toHaveBeenCalledWith(
      {
        userId: 'u1',
        organizationId: 'o1',
        rating: 5,
        text: 'Great tool',
        displayName: 'Sam',
        roleCompany: 'Founder, Acme',
        consentToPublish: true,
      },
      ReviewStatus.NEW
    );
    expect(repository.markPromptReviewed).toHaveBeenCalledWith(
      'u1',
      expect.any(Date)
    );
  });

  it('never publishes by default', async () => {
    const { service, repository } = setup();
    await service.submit('u1', 'o1', { rating: 5, text: 'Nice' });
    expect(repository.upsertReview.mock.calls[0][0].consentToPublish).toBe(
      false
    );
  });

  it.each([1, 2, 3])(
    'saves a %s star review as private, even if consent is sent',
    async (rating) => {
      const { service, repository } = setup();
      const result = await service.submit('u1', 'o1', {
        rating,
        text: 'Needs work',
        displayName: 'Sam',
        consentToPublish: true,
      });

      expect(result).toEqual({ ok: true, lowRating: true });
      expect(repository.upsertReview.mock.calls[0][0].consentToPublish).toBe(
        false
      );
      expect(repository.markPromptReviewed).toHaveBeenCalled();
    }
  );

  it('treats 4 stars as publishable', async () => {
    const { service, repository } = setup();
    const result = await service.submit('u1', 'o1', {
      rating: 4,
      text: 'Good',
      displayName: 'Sam',
      consentToPublish: true,
    });
    expect(result.lowRating).toBe(false);
    expect(repository.upsertReview.mock.calls[0][0].consentToPublish).toBe(true);
  });

  it('asks for a name when the author consents to publish', async () => {
    const { service, repository } = setup();
    await expect(
      service.submit('u1', 'o1', {
        rating: 5,
        text: 'Great',
        displayName: '   ',
        consentToPublish: true,
      })
    ).rejects.toThrow(HttpException);
    expect(repository.upsertReview).not.toHaveBeenCalled();
  });

  it('rejects an empty text', async () => {
    const { service } = setup();
    await expect(
      service.submit('u1', 'o1', { rating: 5, text: '   ' })
    ).rejects.toThrow(HttpException);
  });

  it('sends an edited review back to NEW for a new approval', async () => {
    const { service, repository } = setup();
    repository.getReviewByUserId.mockResolvedValue({
      status: ReviewStatus.APPROVED,
    });
    await service.submit('u1', 'o1', { rating: 5, text: 'Edited' });
    expect(repository.upsertReview.mock.calls[0][1]).toBe(ReviewStatus.NEW);
  });

  it('keeps a hidden review hidden when it is edited', async () => {
    const { service, repository } = setup();
    repository.getReviewByUserId.mockResolvedValue({
      status: ReviewStatus.HIDDEN,
    });
    await service.submit('u1', 'o1', { rating: 5, text: 'Edited' });
    expect(repository.upsertReview.mock.calls[0][1]).toBe(ReviewStatus.HIDDEN);
  });
});

describe('ReviewService prompt state', () => {
  it('records that the card was shown and dismissed', async () => {
    const { service, repository } = setup();
    await service.markShown('u1');
    await service.dismiss('u1');
    expect(repository.markPromptShown).toHaveBeenCalledWith(
      'u1',
      expect.any(Date)
    );
    expect(repository.markPromptDismissed).toHaveBeenCalledWith(
      'u1',
      expect.any(Date)
    );
  });
});

describe('ReviewService public feed', () => {
  const row = (over: Record<string, any> = {}) => ({
    displayName: 'Sam',
    roleCompany: 'Founder',
    rating: 5,
    text: 'Great',
    createdAt: new Date('2026-10-20T23:00:00Z'),
    ...over,
  });

  it('returns only the displayed fields, no ids or emails', async () => {
    const { service, repository } = setup();
    repository.listPublic.mockResolvedValue([
      { ...row(), id: 'r1', userId: 'u1', email: 'a@b.c' },
    ]);
    expect(await service.getPublicFeed()).toEqual([
      {
        displayName: 'Sam',
        roleCompany: 'Founder',
        rating: 5,
        text: 'Great',
        date: expect.stringMatching(/^2026-10-2\d$/),
      },
    ]);
  });

  it('drops a row without a name or text even if the query returned it', async () => {
    const { service, repository } = setup();
    repository.listPublic.mockResolvedValue([
      row({ displayName: null }),
      row({ text: '' }),
      row({ displayName: 'Ana' }),
    ]);
    const feed = await service.getPublicFeed();
    expect(feed.map((r) => r.displayName)).toEqual(['Ana']);
  });

  it('caches the feed and refreshes it after a status change', async () => {
    const { service, repository } = setup();
    repository.listPublic.mockResolvedValue([row()]);
    await service.getPublicFeed();
    await service.getPublicFeed();
    expect(repository.listPublic).toHaveBeenCalledTimes(1);

    await service.setStatus('r1', ReviewStatus.HIDDEN);
    await service.getPublicFeed();
    expect(repository.listPublic).toHaveBeenCalledTimes(2);
  });

  it('reads the export fresh', async () => {
    const { service, repository } = setup();
    repository.listPublic.mockResolvedValue([row()]);
    await service.getPublicFeed();
    await service.exportApproved();
    expect(repository.listPublic).toHaveBeenCalledTimes(2);
  });
});

describe('ReviewService admin', () => {
  it('lists with a valid status filter and flattens the author', async () => {
    const { service, repository } = setup();
    repository.listForAdmin.mockResolvedValue([
      {
        id: 'r1',
        status: 'NEW',
        rating: 4,
        text: 'ok',
        displayName: null,
        roleCompany: null,
        consentToPublish: false,
        createdAt: NOW,
        user: { email: 'a@b.c' },
        organization: { name: 'Acme' },
      },
    ]);
    const list = await service.listForAdmin('NEW');
    expect(repository.listForAdmin).toHaveBeenCalledWith('NEW', 200);
    expect(list[0]).toMatchObject({ id: 'r1', email: 'a@b.c', organization: 'Acme' });
  });

  it('rejects an unknown status filter', async () => {
    const { service } = setup();
    await expect(service.listForAdmin('DELETED')).rejects.toThrow('Unknown status');
  });

  it('404s when the review does not exist', async () => {
    const { service, repository } = setup();
    repository.updateStatus.mockResolvedValue({ count: 0 });
    await expect(service.setStatus('x', ReviewStatus.APPROVED)).rejects.toThrow(
      'Review not found'
    );
  });
});

describe('ReviewRepository public query', () => {
  it('asks the database for approved AND consented reviews with a name, selecting no ids or emails', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new ReviewRepository(
      { model: { review: { findMany } } } as any,
      {} as any,
      {} as any
    );
    await repository.listPublic(50);

    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      status: ReviewStatus.APPROVED,
      consentToPublish: true,
      displayName: { not: null },
    });
    expect(Object.keys(args.select).sort()).toEqual([
      'createdAt',
      'displayName',
      'rating',
      'roleCompany',
      'text',
    ]);
    expect(args.take).toBe(50);
  });

  it('counts only top level published posts that are not deleted', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const repository = new ReviewRepository(
      {} as any,
      {} as any,
      { model: { post: { findMany } } } as any
    );
    expect(await repository.countPublishedPosts('o1', 3)).toBe(2);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: {
        organizationId: 'o1',
        state: 'PUBLISHED',
        deletedAt: null,
        parentPostId: null,
      },
      take: 3,
    });
  });
});
