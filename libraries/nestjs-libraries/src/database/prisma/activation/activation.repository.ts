import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

// Every query is scoped to one organization. The checklist facts only ask
// "is there at least one", so they read a single id instead of counting.
@Injectable()
export class ActivationRepository {
  constructor(
    private _integration: PrismaRepository<'integration'>,
    private _post: PrismaRepository<'post'>,
    private _userOrganization: PrismaRepository<'userOrganization'>
  ) {}

  async hasChannel(organizationId: string) {
    return !!(await this._integration.model.integration.findFirst({
      where: { organizationId, deletedAt: null },
      select: { id: true },
    }));
  }

  // Any post, drafts included
  async hasPost(organizationId: string) {
    return !!(await this._post.model.post.findFirst({
      where: { organizationId, deletedAt: null },
      select: { id: true },
    }));
  }

  // A post that left the drafts: queued, published, or queued and then failed
  async hasScheduledPost(organizationId: string) {
    return !!(await this._post.model.post.findFirst({
      where: {
        organizationId,
        deletedAt: null,
        state: { in: ['QUEUE', 'PUBLISHED', 'ERROR'] },
      },
      select: { id: true },
    }));
  }

  // More than one active member means someone was invited
  async hasTeammate(organizationId: string) {
    const members = await this._userOrganization.model.userOrganization.findMany(
      {
        where: { organizationId, disabled: false },
        select: { id: true },
        take: 2,
      }
    );
    return members.length > 1;
  }

  async getChecklistDismissedAt(userId: string, organizationId: string) {
    return (
      await this._userOrganization.model.userOrganization.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
        select: { onboardingDismissedAt: true },
      })
    )?.onboardingDismissedAt;
  }

  dismissChecklist(userId: string, organizationId: string, at: Date) {
    return this._userOrganization.model.userOrganization.updateMany({
      where: { userId, organizationId },
      data: { onboardingDismissedAt: at },
    });
  }

  private failedPostsWhere(
    organizationId: string,
    since: Date
  ): Prisma.PostWhereInput {
    return {
      organizationId,
      state: 'ERROR',
      deletedAt: null,
      parentPostId: null,
      publishDate: { gte: since },
      integration: { deletedAt: null },
    };
  }

  getFailedPosts(organizationId: string, since: Date, take: number) {
    return this._post.model.post.findMany({
      where: this.failedPostsWhere(organizationId, since),
      orderBy: { publishDate: 'desc' },
      take,
      select: {
        id: true,
        group: true,
        publishDate: true,
        content: true,
        error: true,
        integration: {
          select: {
            id: true,
            name: true,
            customName: true,
            picture: true,
            providerIdentifier: true,
          },
        },
      },
    });
  }

  countFailedPosts(organizationId: string, since: Date) {
    return this._post.model.post.count({
      where: this.failedPostsWhere(organizationId, since),
    });
  }

  // Disconnected, half-connected, or holding a token that expires before
  // `expiresBefore` with no refresh token to renew it. Disabled channels are
  // left out, they don't post. No credential is read.
  getChannelsNeedingAttention(organizationId: string, expiresBefore: Date) {
    return this._integration.model.integration.findMany({
      where: {
        organizationId,
        deletedAt: null,
        disabled: false,
        OR: [
          { refreshNeeded: true },
          { inBetweenSteps: true },
          {
            tokenExpiration: { lte: expiresBefore },
            OR: [{ refreshToken: null }, { refreshToken: '' }],
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        customName: true,
        picture: true,
        providerIdentifier: true,
        refreshNeeded: true,
        inBetweenSteps: true,
        tokenExpiration: true,
      },
    });
  }
}
