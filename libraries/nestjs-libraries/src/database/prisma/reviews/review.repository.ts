import { Injectable } from '@nestjs/common';
import { ReviewStatus } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export interface UpsertReviewParams {
  userId: string;
  organizationId: string;
  rating: number;
  text: string;
  displayName: string | null;
  roleCompany: string | null;
  consentToPublish: boolean;
}

@Injectable()
export class ReviewRepository {
  constructor(
    private _review: PrismaRepository<'review'>,
    private _prompt: PrismaRepository<'reviewPrompt'>,
    private _post: PrismaRepository<'post'>
  ) {}

  getReviewByUserId(userId: string) {
    return this._review.model.review.findUnique({ where: { userId } });
  }

  getPrompt(userId: string) {
    return this._prompt.model.reviewPrompt.findUnique({ where: { userId } });
  }

  // Stops counting at the limit, the answer is only "enough or not"
  async countPublishedPosts(organizationId: string, limit: number) {
    const posts = await this._post.model.post.findMany({
      where: {
        organizationId,
        state: 'PUBLISHED',
        deletedAt: null,
        parentPostId: null,
      },
      select: { id: true },
      take: limit,
    });
    return posts.length;
  }

  // `statusOnEdit` is the status an existing review gets back, see the service
  upsertReview(params: UpsertReviewParams, statusOnEdit: ReviewStatus) {
    const { userId, ...content } = params;
    return this._review.model.review.upsert({
      where: { userId },
      create: { userId, ...content },
      update: { ...content, status: statusOnEdit },
    });
  }

  markPromptShown(userId: string, at: Date) {
    return this._prompt.model.reviewPrompt.upsert({
      where: { userId },
      create: { userId, lastPromptAt: at },
      update: { lastPromptAt: at },
    });
  }

  markPromptDismissed(userId: string, at: Date) {
    return this._prompt.model.reviewPrompt.upsert({
      where: { userId },
      create: { userId, dismissedAt: at },
      update: { dismissedAt: at },
    });
  }

  markPromptReviewed(userId: string, at: Date) {
    return this._prompt.model.reviewPrompt.upsert({
      where: { userId },
      create: { userId, reviewedAt: at },
      update: { reviewedAt: at },
    });
  }

  listForAdmin(status: ReviewStatus | undefined, take: number) {
    return this._review.model.review.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take,
      include: {
        user: { select: { email: true } },
        organization: { select: { name: true } },
      },
    });
  }

  updateStatus(id: string, status: ReviewStatus) {
    return this._review.model.review.updateMany({
      where: { id },
      data: { status },
    });
  }

  // The only reviews that may leave the system: approved by a super admin AND
  // consented to by the author. Only the fields shown on the site are read,
  // never an id or an email.
  listPublic(take: number) {
    return this._review.model.review.findMany({
      where: {
        status: ReviewStatus.APPROVED,
        consentToPublish: true,
        displayName: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        displayName: true,
        roleCompany: true,
        rating: true,
        text: true,
        createdAt: true,
      },
    });
  }
}
