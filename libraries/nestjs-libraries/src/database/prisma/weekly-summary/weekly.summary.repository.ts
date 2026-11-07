import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { State } from '@prisma/client';
import { channelNeedsAttentionWhere } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.state';

const postSelect = {
  id: true,
  content: true,
  publishDate: true,
  releaseURL: true,
  error: true,
  integration: {
    select: {
      name: true,
      providerIdentifier: true,
    },
  },
} as const;

@Injectable()
export class WeeklySummaryRepository {
  constructor(
    private _userOrg: PrismaRepository<'userOrganization'>,
    private _post: PrismaRepository<'post'>,
    private _integration: PrismaRepository<'integration'>
  ) {}

  getPreference(orgId: string, userId: string) {
    return this._userOrg.model.userOrganization.findFirst({
      where: {
        organizationId: orgId,
        userId,
      },
      select: {
        weeklySummaryEmails: true,
      },
    });
  }

  setPreference(orgId: string, userId: string, enabled: boolean) {
    return this._userOrg.model.userOrganization.updateMany({
      where: {
        organizationId: orgId,
        userId,
      },
      data: {
        weeklySummaryEmails: enabled,
      },
    });
  }

  // the members who want the summary, a page at a time
  getSubscribers(cursor: string | undefined, take: number) {
    return this._userOrg.model.userOrganization.findMany({
      where: {
        weeklySummaryEmails: true,
        disabled: false,
        user: {
          deletedAt: null,
          activated: true,
        },
        organization: {
          deletedAt: null,
        },
      },
      select: {
        id: true,
        organizationId: true,
        weeklySummarySentAt: true,
        user: {
          select: {
            email: true,
            timezoneName: true,
          },
        },
        organization: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        id: 'asc',
      },
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  // marks the summary of this week as sent, only once: a retried or a
  // concurrent run finds it already marked and sends nothing
  async claimSend(id: string, weekStart: Date) {
    const { count } = await this._userOrg.model.userOrganization.updateMany({
      where: {
        id,
        OR: [
          { weeklySummarySentAt: null },
          { weeklySummarySentAt: { lt: weekStart } },
        ],
      },
      data: {
        weeklySummarySentAt: new Date(),
      },
    });
    return count === 1;
  }

  private postsWhere(orgId: string, state: State, from: Date, to: Date) {
    return {
      organizationId: orgId,
      state,
      parentPostId: null as string | null,
      deletedAt: null as Date | null,
      publishDate: {
        gte: from,
        lt: to,
      },
      integration: {
        deletedAt: null as Date | null,
      },
    };
  }

  countPosts(orgId: string, state: State, from: Date, to: Date) {
    return this._post.model.post.count({
      where: this.postsWhere(orgId, state, from, to),
    });
  }

  getPosts(
    orgId: string,
    state: State,
    from: Date,
    to: Date,
    take: number,
    order: 'asc' | 'desc'
  ) {
    return this._post.model.post.findMany({
      where: this.postsWhere(orgId, state, from, to),
      select: postSelect,
      orderBy: {
        publishDate: order,
      },
      take,
    });
  }

  channelsNeedingReconnect(orgId: string) {
    return this._integration.model.integration.findMany({
      where: {
        organizationId: orgId,
        ...channelNeedsAttentionWhere(),
      },
      select: {
        id: true,
        name: true,
        providerIdentifier: true,
      },
      take: 10,
    });
  }
}
