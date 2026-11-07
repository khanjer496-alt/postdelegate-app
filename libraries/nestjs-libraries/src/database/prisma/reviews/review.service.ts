import { HttpException, Injectable } from '@nestjs/common';
import { ReviewStatus } from '@prisma/client';
import dayjs from 'dayjs';
import { ReviewRepository } from '@gitroom/nestjs-libraries/database/prisma/reviews/review.repository';
import {
  REVIEW_ADMIN_LIMIT,
  REVIEW_DISMISS_DAYS,
  REVIEW_FEED_CACHE_MS,
  REVIEW_FEED_LIMIT,
  REVIEW_LOW_RATING_MAX,
  REVIEW_MIN_ACCOUNT_AGE_DAYS,
  REVIEW_MIN_PUBLISHED_POSTS,
} from '@gitroom/nestjs-libraries/database/prisma/reviews/review.config';
import { CreateReviewDto } from '@gitroom/nestjs-libraries/dtos/reviews/create.review.dto';

export interface PublicReview {
  displayName: string;
  roleCompany: string | null;
  rating: number;
  text: string;
  date: string;
}

export interface ReviewEligibilityFacts {
  now: Date;
  userCreatedAt: Date;
  reviewed: boolean;
  dismissedAt: Date | null;
  publishedPosts: () => Promise<number>;
}

// The rules for showing the review card, the cheap checks run first and the
// posts are counted only when everything else already passes
export const isReviewEligible = async (facts: ReviewEligibilityFacts) => {
  const now = dayjs(facts.now);
  if (now.diff(facts.userCreatedAt, 'day', true) < REVIEW_MIN_ACCOUNT_AGE_DAYS) {
    return false;
  }
  if (facts.reviewed) {
    return false;
  }
  if (
    facts.dismissedAt &&
    now.diff(facts.dismissedAt, 'day', true) < REVIEW_DISMISS_DAYS
  ) {
    return false;
  }
  return (await facts.publishedPosts()) >= REVIEW_MIN_PUBLISHED_POSTS;
};

const clean = (value?: string | null) => {
  const trimmed = (value || '').trim();
  return trimmed || null;
};

@Injectable()
export class ReviewService {
  private _feed: { at: number; data: PublicReview[] } | undefined;

  constructor(private _reviewRepository: ReviewRepository) {}

  async isEligible(
    user: { id: string; createdAt: Date },
    organizationId: string
  ) {
    const [review, prompt] = await Promise.all([
      this._reviewRepository.getReviewByUserId(user.id),
      this._reviewRepository.getPrompt(user.id),
    ]);

    return isReviewEligible({
      now: new Date(),
      userCreatedAt: user.createdAt,
      reviewed: !!review || !!prompt?.reviewedAt,
      dismissedAt: prompt?.dismissedAt || null,
      publishedPosts: () =>
        this._reviewRepository.countPublishedPosts(
          organizationId,
          REVIEW_MIN_PUBLISHED_POSTS
        ),
    });
  }

  async getMine(userId: string) {
    const review = await this._reviewRepository.getReviewByUserId(userId);
    if (!review) {
      return null;
    }
    return {
      rating: review.rating,
      text: review.text,
      displayName: review.displayName,
      roleCompany: review.roleCompany,
      consentToPublish: review.consentToPublish,
    };
  }

  async markShown(userId: string) {
    await this._reviewRepository.markPromptShown(userId, new Date());
    return { ok: true };
  }

  async dismiss(userId: string) {
    await this._reviewRepository.markPromptDismissed(userId, new Date());
    return { ok: true };
  }

  async submit(userId: string, organizationId: string, body: CreateReviewDto) {
    const text = (body.text || '').trim();
    if (!text) {
      throw new HttpException('Write a few words about your experience', 400);
    }

    // a low rating is a note to the team, never offered for publishing
    const lowRating = body.rating <= REVIEW_LOW_RATING_MAX;
    const consentToPublish = !lowRating && body.consentToPublish === true;
    const displayName = clean(body.displayName);
    if (consentToPublish && !displayName) {
      throw new HttpException(
        'Add the name you want shown with your review',
        400
      );
    }

    const existing = await this._reviewRepository.getReviewByUserId(userId);
    await this._reviewRepository.upsertReview(
      {
        userId,
        organizationId,
        rating: body.rating,
        text,
        displayName,
        roleCompany: clean(body.roleCompany),
        consentToPublish,
      },
      // an edit has to be approved again, a hidden review stays hidden
      existing?.status === ReviewStatus.HIDDEN
        ? ReviewStatus.HIDDEN
        : ReviewStatus.NEW
    );
    await this._reviewRepository.markPromptReviewed(userId, new Date());
    this._feed = undefined;

    return { ok: true, lowRating };
  }

  async listForAdmin(status?: string) {
    const parsed = Object.values(ReviewStatus).find((s) => s === status);
    if (status && !parsed) {
      throw new HttpException('Unknown status', 400);
    }
    const reviews = await this._reviewRepository.listForAdmin(
      parsed,
      REVIEW_ADMIN_LIMIT
    );
    return reviews.map((r) => ({
      id: r.id,
      status: r.status,
      rating: r.rating,
      text: r.text,
      displayName: r.displayName,
      roleCompany: r.roleCompany,
      consentToPublish: r.consentToPublish,
      createdAt: r.createdAt,
      email: r.user.email,
      organization: r.organization.name,
    }));
  }

  async setStatus(id: string, status: ReviewStatus) {
    const { count } = await this._reviewRepository.updateStatus(id, status);
    if (!count) {
      throw new HttpException('Review not found', 404);
    }
    this._feed = undefined;
    return { id, status };
  }

  private async loadPublic(): Promise<PublicReview[]> {
    const reviews = await this._reviewRepository.listPublic(REVIEW_FEED_LIMIT);
    return reviews
      .filter((r) => !!r.displayName && !!r.text)
      .map((r) => ({
        displayName: r.displayName as string,
        roleCompany: r.roleCompany,
        rating: r.rating,
        text: r.text,
        date: dayjs(r.createdAt).format('YYYY-MM-DD'),
      }));
  }

  // No auth: approved and consented reviews only, cached for a minute
  async getPublicFeed() {
    if (this._feed && Date.now() - this._feed.at < REVIEW_FEED_CACHE_MS) {
      return this._feed.data;
    }
    const data = await this.loadPublic();
    this._feed = { at: Date.now(), data };
    return data;
  }

  // The admin export is the same set as the public feed, read fresh
  exportApproved() {
    return this.loadPublic();
  }
}
