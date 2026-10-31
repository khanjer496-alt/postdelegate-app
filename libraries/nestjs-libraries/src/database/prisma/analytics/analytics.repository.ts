import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { AnalyticsReportFrequency, Prisma } from '@prisma/client';
import { AccountStats, PostStats } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

// the most rows one history read returns, newest first: a 90-day comparison
// window of 100 channels is under 20,000 snapshot rows
const HISTORY_READ_LIMIT = 50000;
// deleted channels per batch when their history is purged
const PURGE_BATCH = 500;

export interface AnalyticsPostMetricsInput extends PostStats {
  externalId: string;
  postId?: string;
  publishedAt: Date;
  title?: string;
  url?: string;
}

const postMetricsSelect = {
  id: true,
  integrationId: true,
  externalId: true,
  postId: true,
  publishedAt: true,
  title: true,
  url: true,
  views: true,
  likes: true,
  comments: true,
  shares: true,
  clicks: true,
} satisfies Prisma.AnalyticsPostSelect;

@Injectable()
export class AnalyticsRepository {
  constructor(
    private _post: PrismaRepository<'post'>,
    private _integration: PrismaRepository<'integration'>,
    private _accountSnapshot: PrismaRepository<'analyticsAccountSnapshot'>,
    private _analyticsPost: PrismaRepository<'analyticsPost'>,
    private _postSnapshot: PrismaRepository<'analyticsPostSnapshot'>,
    private _reportSettings: PrismaRepository<'analyticsReportSettings'>,
    private _organization: PrismaRepository<'organization'>,
    private _userOrganization: PrismaRepository<'userOrganization'>
  ) {}

  // Top-level posts of the organization (thread children share a parentPostId)
  // on channels that still exist: published and failed in [from, now], queued
  // in (now, until]. Only the three columns the overview needs are read.
  getOverviewPosts(orgId: string, from: Date, now: Date, until: Date) {
    const where: Prisma.PostWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      parentPostId: null,
      integration: {
        organizationId: orgId,
        deletedAt: null,
      },
      OR: [
        {
          state: { in: ['PUBLISHED', 'ERROR'] },
          publishDate: { gte: from, lte: now },
        },
        {
          state: 'QUEUE',
          publishDate: { gt: now, lte: until },
        },
      ],
    };

    return this._post.model.post.findMany({
      where,
      select: {
        integrationId: true,
        state: true,
        publishDate: true,
      },
    });
  }

  getOverviewChannels(orgId: string) {
    return this._integration.model.integration.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        customName: true,
        picture: true,
        providerIdentifier: true,
        type: true,
        disabled: true,
        refreshNeeded: true,
        inBetweenSteps: true,
        tokenExpiration: true,
      },
    });
  }

  countPublished(
    orgId: string,
    from: Date,
    to: Date,
    integrationId?: string
  ) {
    return this._post.model.post.count({
      where: {
        organizationId: orgId,
        ...(integrationId ? { integrationId } : {}),
        deletedAt: null,
        parentPostId: null,
        state: 'PUBLISHED',
        publishDate: { gte: from, lt: to },
        integration: { organizationId: orgId, deletedAt: null },
      },
    });
  }

  // Live social channels of live workspaces whose provider has a history
  // source, in id order so the daily job can walk them page by page. Tokens
  // are never read here: the job loads one channel at a time through the
  // integration service, which decrypts them.
  // With `paidOnly`, only workspaces with a live subscription are read, so
  // lapsed workspaces cost no provider calls.
  getSnapshotChannelsPage(
    providers: string[],
    take: number,
    cursor?: string,
    paidOnly = false
  ) {
    return this._integration.model.integration.findMany({
      where: {
        type: 'social',
        deletedAt: null,
        disabled: false,
        refreshNeeded: false,
        inBetweenSteps: false,
        providerIdentifier: { in: providers },
        organization: {
          deletedAt: null,
          ...(paidOnly ? { subscription: { is: { deletedAt: null } } } : {}),
        },
        // a plain id comparison keeps paging even if the cursor row is erased
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take,
      select: {
        id: true,
        organizationId: true,
        providerIdentifier: true,
        tokenExpiration: true,
      },
    });
  }

  async hasAccountSnapshot(integrationId: string, date: Date) {
    return !!(await this._accountSnapshot.model.analyticsAccountSnapshot.findUnique(
      {
        where: { integrationId_date: { integrationId, date } },
        select: { id: true },
      }
    ));
  }

  // Top-level posts the channel published through PostDelegate since `since`,
  // newest first, that have a platform id to read metrics with
  getPublishedPostsForSnapshot(
    orgId: string,
    integrationId: string,
    since: Date,
    take: number
  ) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        integrationId,
        deletedAt: null,
        parentPostId: null,
        state: 'PUBLISHED',
        publishDate: { gte: since },
        releaseId: { not: null, notIn: ['missing'] },
      },
      orderBy: { publishDate: 'desc' },
      take,
      select: {
        id: true,
        content: true,
        publishDate: true,
        releaseId: true,
        releaseURL: true,
        settings: true,
      },
    });
  }

  upsertAccountSnapshot(
    orgId: string,
    integrationId: string,
    date: Date,
    stats: AccountStats
  ) {
    const data = {
      followers: stats.followers ?? null,
      following: stats.following ?? null,
      posts: stats.posts ?? null,
    };
    return this._accountSnapshot.model.analyticsAccountSnapshot.upsert({
      where: { integrationId_date: { integrationId, date } },
      create: { organizationId: orgId, integrationId, date, ...data },
      update: data,
    });
  }

  // The latest metrics of the post plus its row for the day; both upserts are
  // keyed so a re-run on the same day overwrites instead of duplicating
  async upsertPostMetrics(
    orgId: string,
    integrationId: string,
    date: Date,
    now: Date,
    post: AnalyticsPostMetricsInput
  ) {
    const metrics = {
      views: post.views ?? null,
      likes: post.likes ?? null,
      comments: post.comments ?? null,
      shares: post.shares ?? null,
      clicks: post.clicks ?? null,
    };
    await this._analyticsPost.model.analyticsPost.upsert({
      where: {
        integrationId_externalId: { integrationId, externalId: post.externalId },
      },
      create: {
        organizationId: orgId,
        integrationId,
        externalId: post.externalId,
        postId: post.postId ?? null,
        publishedAt: post.publishedAt,
        title: post.title ?? null,
        url: post.url ?? null,
        lastSnapshotAt: now,
        ...metrics,
      },
      update: {
        // a post read back from the platform never unlinks a PostDelegate post
        ...(post.postId ? { postId: post.postId } : {}),
        ...(post.title ? { title: post.title } : {}),
        ...(post.url ? { url: post.url } : {}),
        lastSnapshotAt: now,
        ...metrics,
      },
    });
    await this._postSnapshot.model.analyticsPostSnapshot.upsert({
      where: {
        integrationId_externalId_date: {
          integrationId,
          externalId: post.externalId,
          date,
        },
      },
      create: {
        organizationId: orgId,
        integrationId,
        externalId: post.externalId,
        date,
        ...metrics,
      },
      update: metrics,
    });
  }

  // Account rows and latest post metrics are kept until `cutoff`, the daily
  // post rows (the bulk of the history) until `postSnapshotCutoff`
  async purgeHistoryBefore(cutoff: Date, postSnapshotCutoff: Date) {
    const [accounts, posts, snapshots] = await Promise.all([
      this._accountSnapshot.model.analyticsAccountSnapshot.deleteMany({
        where: { date: { lt: cutoff } },
      }),
      this._analyticsPost.model.analyticsPost.deleteMany({
        where: { publishedAt: { lt: cutoff } },
      }),
      this._postSnapshot.model.analyticsPostSnapshot.deleteMany({
        where: { date: { lt: postSnapshotCutoff } },
      }),
    ]);
    return accounts.count + posts.count + snapshots.count;
  }

  // The history of channels deleted since `since` goes with the channel
  async purgeDeletedChannelsHistory(since: Date) {
    let deleted = 0;
    let cursor: string | undefined;
    while (true) {
      const channels = await this._integration.model.integration.findMany({
        where: {
          deletedAt: { gte: since },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: PURGE_BATCH,
        select: { id: true },
      });
      if (!channels.length) {
        return deleted;
      }
      const ids = channels.map((channel) => channel.id);
      const counts = await Promise.all([
        this._accountSnapshot.model.analyticsAccountSnapshot.deleteMany({
          where: { integrationId: { in: ids } },
        }),
        this._analyticsPost.model.analyticsPost.deleteMany({
          where: { integrationId: { in: ids } },
        }),
        this._postSnapshot.model.analyticsPostSnapshot.deleteMany({
          where: { integrationId: { in: ids } },
        }),
      ]);
      deleted += counts.reduce((sum, result) => sum + result.count, 0);
      cursor = ids[ids.length - 1];
    }
  }

  getAccountSnapshots(
    orgId: string,
    from: Date,
    to: Date,
    integrationId?: string
  ) {
    return this._accountSnapshot.model.analyticsAccountSnapshot.findMany({
      where: {
        organizationId: orgId,
        ...(integrationId ? { integrationId } : {}),
        date: { gte: from, lte: to },
      },
      // past the limit the oldest days go, never the current ones
      orderBy: { date: 'desc' },
      take: HISTORY_READ_LIMIT,
      select: {
        integrationId: true,
        date: true,
        followers: true,
        following: true,
        posts: true,
      },
    });
  }

  getAnalyticsPosts(
    orgId: string,
    from: Date,
    to: Date,
    integrationId?: string
  ) {
    return this._analyticsPost.model.analyticsPost.findMany({
      where: {
        organizationId: orgId,
        ...(integrationId ? { integrationId } : {}),
        publishedAt: { gte: from, lt: to },
      },
      orderBy: { publishedAt: 'desc' },
      take: HISTORY_READ_LIMIT,
      select: postMetricsSelect,
    });
  }

  // Content, media and tags of the organization's posts behind the metrics
  getPostsContent(orgId: string, postIds: string[]) {
    if (!postIds.length) {
      return Promise.resolve([]);
    }
    return this._post.model.post.findMany({
      where: { organizationId: orgId, id: { in: postIds } },
      select: {
        id: true,
        content: true,
        image: true,
        tags: {
          select: {
            tag: {
              select: { id: true, name: true, color: true, deletedAt: true },
            },
          },
        },
      },
    });
  }

  getDailyPostTotals(orgId: string, from: Date, to: Date) {
    return this._postSnapshot.model.analyticsPostSnapshot.groupBy({
      by: ['integrationId', 'date'],
      where: { organizationId: orgId, date: { gte: from, lte: to } },
      orderBy: [{ date: 'asc' }, { integrationId: 'asc' }],
      _count: { _all: true },
      _sum: {
        views: true,
        likes: true,
        comments: true,
        shares: true,
        clicks: true,
      },
    });
  }

  getOrganizationName(orgId: string) {
    return this._organization.model.organization.findFirst({
      where: { id: orgId, deletedAt: null },
      select: { id: true, name: true },
    });
  }

  getReportSettings(orgId: string) {
    return this._reportSettings.model.analyticsReportSettings.findUnique({
      where: { organizationId: orgId },
    });
  }

  upsertReportSettings(
    orgId: string,
    data: {
      frequency: AnalyticsReportFrequency;
      recipients: string[];
      brandName: string | null;
      logoUrl: string | null;
      lastSentAt?: Date;
    }
  ) {
    return this._reportSettings.model.analyticsReportSettings.upsert({
      where: { organizationId: orgId },
      create: { organizationId: orgId, ...data },
      update: data,
    });
  }

  // Active members of the organization who can receive the report
  getReportMembers(orgId: string, userIds?: string[]) {
    return this._userOrganization.model.userOrganization.findMany({
      where: {
        organizationId: orgId,
        disabled: false,
        ...(userIds ? { userId: { in: userIds } } : {}),
        user: { deletedAt: null, activated: true },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        user: {
          select: { id: true, email: true, name: true, lastName: true },
        },
      },
    });
  }

  getScheduledReportsPage(take: number, cursor?: string) {
    return this._reportSettings.model.analyticsReportSettings.findMany({
      where: {
        frequency: { not: 'OFF' },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take,
    });
  }

  getOrganizationsForReports(orgIds: string[]) {
    return this._organization.model.organization.findMany({
      where: { id: { in: orgIds }, deletedAt: null },
      select: {
        id: true,
        name: true,
        subscription: {
          select: { subscriptionTier: true, deletedAt: true },
        },
      },
    });
  }

  // Marks the report as sent only if nobody sent it since `previous` was
  // read, so a retried or parallel run never emails the same period twice
  async claimReportSend(id: string, previous: Date | null, now: Date) {
    const { count } =
      await this._reportSettings.model.analyticsReportSettings.updateMany({
        where: { id, lastSentAt: previous },
        data: { lastSentAt: now },
      });
    return count === 1;
  }
}
