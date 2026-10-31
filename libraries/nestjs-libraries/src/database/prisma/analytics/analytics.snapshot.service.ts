import { Injectable, Logger } from '@nestjs/common';
import { Integration } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import pLimit from 'p-limit';
import {
  AnalyticsPostMetricsInput,
  AnalyticsRepository,
} from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { isHistoryProvider } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.service';
import {
  AccountStats,
  AnalyticsData,
  PostStats,
  RecentPostStat,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { timer } from '@gitroom/helpers/utils/timer';
import { setHeartbeatDetails } from '@gitroom/nestjs-libraries/temporal/temporal.heartbeat';

dayjs.extend(utc);

// channels per activity page, and how many of them talk to providers at once
export const SNAPSHOT_PAGE_SIZE = 10;
const CHANNEL_CONCURRENCY = 2;
// posts published through PostDelegate in this window get their metrics read
export const SNAPSHOT_POST_DAYS = 30;
// account rows and the latest post metrics older than this are deleted by the
// daily retention pass, the daily post rows (the bulk) after 90 days
export const SNAPSHOT_RETENTION_DAYS = 400;
export const POST_SNAPSHOT_RETENTION_DAYS = 90;
// per provider call, a channel that hangs is skipped instead of holding the page
const PROVIDER_TIMEOUT_MS = 20000;
// gap between two per-post calls of the same channel
const POST_CALL_GAP_MS = 500;
// a channel stops reading more posts after this long, so a page always ends
// well inside the activity timeout
const CHANNEL_BUDGET_MS = 3 * 60 * 1000;
// per-post reads stop after this many failures in a row (a dead token on a
// provider that does not report it as one)
const MAX_FAILURES_IN_A_ROW = 3;
const DEFAULT_POST_LIMIT = 25;
const RECENT_POSTS_LIMIT = 20;
const TITLE_LENGTH = 200;
const MAX_INT = 2147483647;

export type ChannelSnapshotStatus = 'saved' | 'skipped' | 'failed';

// Platform metric labels mapped to the normalised counters, in order of
// preference: the first label a provider reports wins (Views over Reach).
const POST_METRIC_LABELS: Record<keyof PostStats, string[]> = {
  views: ['views', 'impressions', 'video views', 'plays', 'reach'],
  likes: ['likes', 'reactions', 'favorites'],
  comments: ['comments', 'replies'],
  shares: ['shares', 'reposts', 'retweets'],
  clicks: ['clicks', 'pin clicks', 'link clicks', 'outbound clicks'],
};

// only web links are stored, a provider response never becomes a javascript: href
const safeUrl = (url?: string | null) =>
  url && /^https?:\/\//i.test(url) ? url.slice(0, 2048) : undefined;

const toCount = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return undefined;
  }
  return Math.min(MAX_INT, Math.max(0, Math.round(number)));
};

// Provider errors can echo request URLs, keep credentials out of the logs
const safeError = (err: unknown) =>
  String((err as Error)?.message || err || 'unknown error')
    .replace(/(access_token|token|key)=[^&\s"]+/gi, '$1=[redacted]')
    .replace(/Bearer\s+[^\s"]+/gi, 'Bearer [redacted]')
    .slice(0, 200);

@Injectable()
export class AnalyticsSnapshotService {
  private readonly _logger = new Logger(AnalyticsSnapshotService.name);

  constructor(
    private _analyticsRepository: AnalyticsRepository,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager,
    private _postsService: PostsService
  ) {}

  enabled() {
    return process.env.ANALYTICS_HISTORY_DISABLED !== 'true';
  }

  // Providers that can feed the history. A provider whose authorization policy
  // forbids caching its analytics (YouTube) is never stored.
  historyProviders(): string[] {
    return this._integrationManager
      .getAllowedSocialsIntegrations()
      .filter((identifier) =>
        isHistoryProvider(this._integrationManager.getSocialIntegration(identifier))
      );
  }

  async snapshotPage(cursor?: string, now = new Date()) {
    if (!this.enabled()) {
      return { enabled: false, saved: 0, skipped: 0, failed: 0 };
    }

    const rows = await this._analyticsRepository.getSnapshotChannelsPage(
      this.historyProviders(),
      SNAPSHOT_PAGE_SIZE,
      cursor,
      // with billing on, lapsed workspaces are not read
      !!process.env.STRIPE_PUBLISHABLE_KEY
    );
    const today = this.utcDay(now);
    const limit = pLimit(CHANNEL_CONCURRENCY);
    const statuses = await Promise.all(
      rows.map((row) =>
        limit(async (): Promise<ChannelSnapshotStatus> => {
          try {
            // idempotent: a channel already saved today is not read again
            if (
              await this._analyticsRepository.hasAccountSnapshot(row.id, today)
            ) {
              return 'skipped';
            }
            return await this.snapshotChannel(row.organizationId, row.id, now);
          } catch (err) {
            this._logger.warn(
              `Analytics snapshot of integration ${row.id} failed: ${safeError(
                err
              )}`
            );
            return 'failed';
          }
        })
      )
    );

    return {
      enabled: true,
      ...(rows.length === SNAPSHOT_PAGE_SIZE
        ? { cursor: rows[rows.length - 1].id }
        : {}),
      saved: statuses.filter((s) => s === 'saved').length,
      skipped: statuses.filter((s) => s === 'skipped').length,
      failed: statuses.filter((s) => s === 'failed').length,
    };
  }

  // Reads one channel and stores today's rows. Read-only towards the channel:
  // an expired token is skipped, never refreshed, and a token error stops the
  // channel for today without marking it for refresh or disconnecting it.
  async snapshotChannel(
    orgId: string,
    integrationId: string,
    now = new Date()
  ): Promise<ChannelSnapshotStatus> {
    const integration = await this._integrationService.getIntegrationById(
      orgId,
      integrationId
    );
    if (
      !integration ||
      integration.organizationId !== orgId ||
      integration.deletedAt ||
      integration.disabled ||
      integration.refreshNeeded ||
      integration.inBetweenSteps ||
      integration.type !== 'social' ||
      (integration.tokenExpiration &&
        dayjs(integration.tokenExpiration).isBefore(dayjs(now)))
    ) {
      return 'skipped';
    }

    const provider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!isHistoryProvider(provider)) {
      return 'skipped';
    }

    setHeartbeatDetails(`analytics snapshot ${integrationId}`);
    const deadline = Date.now() + CHANNEL_BUDGET_MS;
    const today = this.utcDay(now);
    const internalId = integration.internalId;
    const token = integration.token;

    let account: AccountStats = {};
    if (provider.accountStats) {
      try {
        account = await this.withTimeout(
          provider.accountStats(internalId, token)
        );
      } catch (err) {
        if (err instanceof RefreshToken) {
          return 'failed';
        }
        this._logger.warn(
          `Account stats of integration ${integrationId} failed: ${safeError(
            err
          )}`
        );
      }
    }

    const posts = await this.collectPosts(
      orgId,
      integration,
      provider,
      now,
      deadline
    );
    if (posts === null) {
      return 'failed';
    }

    for (const post of posts) {
      await this._analyticsRepository.upsertPostMetrics(
        orgId,
        integrationId,
        today,
        now,
        post
      );
    }

    // written last: its presence marks the channel as done for the day
    await this._analyticsRepository.upsertAccountSnapshot(
      orgId,
      integrationId,
      today,
      account
    );
    return 'saved';
  }

  // Metrics of the channel's recent posts: the platform's own list where the
  // provider has one, plus the posts published through PostDelegate in the
  // last SNAPSHOT_POST_DAYS days. null when a token error stopped the channel.
  private async collectPosts(
    orgId: string,
    integration: Integration,
    provider: SocialProvider,
    now: Date,
    deadline: number
  ): Promise<AnalyticsPostMetricsInput[] | null> {
    const byExternalId = new Map<string, AnalyticsPostMetricsInput>();

    if (provider.recentPosts) {
      try {
        const recent = await this.withTimeout(
          provider.recentPosts(
            integration.internalId,
            integration.token,
            RECENT_POSTS_LIMIT
          )
        );
        for (const post of recent || []) {
          const row = this.fromRecentPost(post);
          if (row) {
            byExternalId.set(row.externalId, row);
          }
        }
      } catch (err) {
        if (err instanceof RefreshToken) {
          return null;
        }
        this._logger.warn(
          `Recent posts of integration ${integration.id} failed: ${safeError(
            err
          )}`
        );
      }
    }

    const published = await this._analyticsRepository.getPublishedPostsForSnapshot(
      orgId,
      integration.id,
      dayjs(now).subtract(SNAPSHOT_POST_DAYS, 'day').toDate(),
      provider.analyticsHistoryPostLimit || DEFAULT_POST_LIMIT
    );

    const toRead: Array<{ externalId: string; base: AnalyticsPostMetricsInput }> =
      [];
    for (const post of published) {
      if (Date.now() > deadline) {
        break;
      }
      const releaseId = await this.releaseIdOf(orgId, integration, provider, post);
      if (!releaseId) {
        continue;
      }
      const base: AnalyticsPostMetricsInput = {
        externalId: releaseId,
        postId: post.id,
        publishedAt: post.publishDate,
        title: this.excerpt(post.content),
        url: safeUrl(post.releaseURL),
      };
      const fromRecent = byExternalId.get(releaseId);
      if (fromRecent) {
        // the platform list already carries its stats, only link the post
        byExternalId.set(releaseId, {
          ...fromRecent,
          postId: post.id,
          publishedAt: post.publishDate,
          title: base.title || fromRecent.title,
          url: base.url || fromRecent.url,
        });
        continue;
      }
      toRead.push({ externalId: releaseId, base });
    }

    if (toRead.length && provider.postsStats) {
      try {
        const stats = await this.withTimeout(
          provider.postsStats(
            integration.internalId,
            integration.token,
            toRead.map((p) => p.externalId)
          )
        );
        for (const { externalId, base } of toRead) {
          const metrics = this.cleanStats(stats?.[externalId]);
          if (metrics) {
            byExternalId.set(externalId, { ...base, ...metrics });
          }
        }
      } catch (err) {
        if (err instanceof RefreshToken) {
          return null;
        }
        this._logger.warn(
          `Post stats of integration ${integration.id} failed: ${safeError(err)}`
        );
      }
    } else if (toRead.length && provider.postAnalytics) {
      let failures = 0;
      for (const [index, { externalId, base }] of toRead.entries()) {
        if (Date.now() > deadline || failures >= MAX_FAILURES_IN_A_ROW) {
          break;
        }
        if (index) {
          await timer(POST_CALL_GAP_MS);
        }
        try {
          const data = await this.withTimeout(
            provider.postAnalytics(
              integration.internalId,
              integration.token,
              externalId,
              SNAPSHOT_POST_DAYS
            )
          );
          const metrics = this.normalisePostAnalytics(data);
          if (metrics) {
            byExternalId.set(externalId, { ...base, ...metrics });
          }
          failures = 0;
        } catch (err) {
          if (err instanceof RefreshToken) {
            // keep what was read so far, stop calling with a dead token
            break;
          }
          failures++;
          this._logger.warn(
            `Post analytics of integration ${integration.id} failed: ${safeError(
              err
            )}`
          );
        }
      }
    }

    return [...byExternalId.values()];
  }

  private async releaseIdOf(
    orgId: string,
    integration: Integration,
    provider: SocialProvider,
    post: {
      id: string;
      releaseId: string | null;
      releaseURL: string | null;
      settings: string | null;
    }
  ): Promise<string | undefined> {
    if (!post.releaseId) {
      return undefined;
    }
    if (!provider.resolveReleaseId) {
      return post.releaseId;
    }
    try {
      const resolved = await this.withTimeout(
        this._postsService.resolveRelease(orgId, {
          id: post.id,
          releaseId: post.releaseId,
          releaseURL: post.releaseURL || '',
          settings: post.settings || '{}',
          integration,
        })
      );
      return resolved.pending || resolved.unavailable
        ? undefined
        : resolved.releaseId;
    } catch (err) {
      return undefined;
    }
  }

  private fromRecentPost(
    post: RecentPostStat
  ): AnalyticsPostMetricsInput | undefined {
    const publishedAt = post?.publishedAt ? dayjs(post.publishedAt) : null;
    if (!post?.id || !publishedAt?.isValid()) {
      return undefined;
    }
    const metrics = this.cleanStats(post);
    if (!metrics) {
      return undefined;
    }
    return {
      externalId: String(post.id),
      publishedAt: publishedAt.toDate(),
      title: post.title ? post.title.slice(0, TITLE_LENGTH) : undefined,
      url: safeUrl(post.url),
      ...metrics,
    };
  }

  // Generic: maps whatever labels postAnalytics returns onto the normalised
  // counters, so every provider with post analytics feeds the history without
  // provider-specific code here. undefined when nothing could be mapped.
  normalisePostAnalytics(data: AnalyticsData[] | undefined): PostStats | undefined {
    const byLabel = new Map<string, number>();
    for (const metric of Array.isArray(data) ? data : []) {
      const label = metric?.label?.trim().toLowerCase();
      if (!label || byLabel.has(label)) {
        continue;
      }
      const values = (metric.data || [])
        .map((point) => toCount(point?.total))
        .filter((value): value is number => value !== undefined);
      if (values.length) {
        byLabel.set(
          label,
          values.reduce((sum, value) => sum + value, 0)
        );
      }
    }

    const stats: PostStats = {};
    for (const [key, labels] of Object.entries(POST_METRIC_LABELS) as Array<
      [keyof PostStats, string[]]
    >) {
      const label = labels.find((l) => byLabel.has(l));
      if (label) {
        stats[key] = Math.min(MAX_INT, byLabel.get(label)!);
      }
    }
    return Object.keys(stats).length ? stats : undefined;
  }

  private cleanStats(stats: PostStats | undefined): PostStats | undefined {
    if (!stats) {
      return undefined;
    }
    const clean: PostStats = {};
    for (const key of Object.keys(POST_METRIC_LABELS) as Array<keyof PostStats>) {
      const value = toCount(stats[key]);
      if (value !== undefined) {
        clean[key] = value;
      }
    }
    return Object.keys(clean).length ? clean : undefined;
  }

  // Retention: rows of days (and posts published) before the cutoffs go
  // away, and so does the history of channels deleted since the last pass
  async purgeExpired(now = new Date()) {
    if (!this.enabled()) {
      return 0;
    }
    const today = dayjs(this.utcDay(now)).utc();
    const cutoff = today.subtract(SNAPSHOT_RETENTION_DAYS, 'day').toDate();
    const expired = await this._analyticsRepository.purgeHistoryBefore(
      cutoff,
      today.subtract(POST_SNAPSHOT_RETENTION_DAYS, 'day').toDate()
    );
    // a week back, so a missed daily pass still catches up
    const deletedChannels =
      await this._analyticsRepository.purgeDeletedChannelsHistory(
        today.subtract(7, 'day').toDate()
      );
    return expired + deletedChannels;
  }

  utcDay(date: Date) {
    return dayjs(date).utc().startOf('day').toDate();
  }

  private excerpt(content: string | null) {
    if (!content) {
      return undefined;
    }
    try {
      const text = stripHtmlValidation('none', content)
        .replace(/\s+/g, ' ')
        .trim();
      return text ? text.slice(0, TITLE_LENGTH) : undefined;
    } catch (err) {
      return undefined;
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms = PROVIDER_TIMEOUT_MS) {
    let handle: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        handle = setTimeout(
          () => reject(new Error('Analytics provider timeout')),
          ms
        );
      }),
    ]).finally(() => clearTimeout(handle));
  }
}
