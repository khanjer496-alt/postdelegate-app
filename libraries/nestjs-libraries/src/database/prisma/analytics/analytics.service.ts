import { Injectable } from '@nestjs/common';
import { Organization, State } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import pLimit from 'p-limit';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { createHash } from 'crypto';
import {
  AnalyticsRepository,
  HISTORY_READ_LIMIT,
} from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { SocialProvider } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  isChannelConnected,
  isChannelReady,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.state';

// provider analytics are slow third-party calls: a few at a time, and a channel
// that takes too long is reported as unavailable instead of holding the page
const ENGAGEMENT_CONCURRENCY = 4;
const ENGAGEMENT_TIMEOUT_MS = 20000;

dayjs.extend(utc);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type OverviewChannelRow = Awaited<
  ReturnType<AnalyticsRepository['getOverviewChannels']>
>[number];

interface OverviewPostRow {
  integrationId: string;
  state: State;
  publishDate: Date;
}

interface ProviderMetric {
  label: string;
  data?: Array<{ total: number | string; date?: string }>;
  average?: boolean;
}

export interface AnalyticsOverviewChannel {
  id: string;
  name: string;
  picture: string | null;
  identifier: string;
  disabled: boolean;
  refreshNeeded: boolean;
  published: number;
  scheduled: number;
  failed: number;
}

export interface AnalyticsOverviewResponse {
  days: number;
  timezone: string;
  totals: { published: number; scheduled: number; failed: number };
  channels: AnalyticsOverviewChannel[];
  // published posts per weekday (0 = Sunday) and hour (0-23), in `timezone`
  heatmap: number[][];
  byWeekday: number[];
  byHour: number[];
}

export interface AnalyticsEngagementChannel {
  id: string;
  name: string;
  picture: string | null;
  identifier: string;
  status: 'ok' | 'empty' | 'unavailable';
}

export interface AnalyticsEngagementResponse {
  days: number;
  metrics: Array<{ label: string; total: number; channels: number }>;
  channels: AnalyticsEngagementChannel[];
  // active channels whose provider has no analytics
  unsupported: number;
}

const channelName = (channel: OverviewChannelRow) =>
  channel.customName || channel.name;

// ---- history (daily snapshots) ----

type AccountSnapshotRow = Awaited<
  ReturnType<AnalyticsRepository['getAccountSnapshots']>
>[number];

type AnalyticsPostRow = Awaited<
  ReturnType<AnalyticsRepository['getAnalyticsPosts']>
>[number];

type PostContentRow = Awaited<
  ReturnType<AnalyticsRepository['getPostsContent']>
>[number];

// A provider can feed the daily history when it has a source of stats and its
// authorization policy allows keeping its analytics (YouTube does not)
export const isHistoryProvider = (provider?: SocialProvider) =>
  !!provider &&
  !provider.authorizationPolicy?.bypassAnalyticsCache &&
  !!(
    provider.accountStats ||
    provider.postsStats ||
    provider.postAnalytics ||
    provider.recentPosts
  );
// engagement-based best times need this many posts with metrics, and a day or
// hour needs this many posts before it can be recommended
export const BEST_TIMES_MIN_POSTS = 10;
const BEST_TIMES_MIN_BUCKET_POSTS = 2;
const TOP_HASHTAGS = 10;
const CSV_ROW_LIMIT = 5000;

export type TopPostsSort =
  | 'engagement'
  | 'views'
  | 'likes'
  | 'comments'
  | 'shares'
  | 'date';

export interface HistoryChannel {
  id: string;
  name: string;
  picture: string | null;
  identifier: string;
}

export interface PeriodComparison {
  key: 'followers' | 'published' | 'engagement' | 'views';
  current: number | null;
  previous: number | null;
  // percent, null when there is nothing to compare with
  change: number | null;
}

export interface AnalyticsTrendsResponse {
  // false when the history is switched off, or the channel's platform does
  // not allow keeping its analytics
  collecting: boolean;
  from: string;
  to: string;
  // the first day with a snapshot in the compared window, null before any
  firstSnapshot: string | null;
  comparison: PeriodComparison[];
  followers: {
    dates: string[];
    total: Array<number | null>;
    channels: Array<
      HistoryChannel & {
        points: Array<number | null>;
        current: number | null;
        gained: number | null;
      }
    >;
  };
}

export interface TopPostRow {
  id: string;
  postId: string | null;
  externalId: string;
  channel: HistoryChannel;
  title: string | null;
  url: string | null;
  publishedAt: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
  engagement: number | null;
  // engagement per view in percent, null without views
  engagementRate: number | null;
}

export interface BestTimesResponse {
  timezone: string;
  basis: 'engagement' | 'publish_count';
  // posts with engagement metrics in the range
  posts: number;
  required: number;
  bestDays: Array<{ weekday: number; score: number; posts: number }>;
  bestHours: Array<{ hour: number; score: number; posts: number }>;
  // average relative engagement per weekday (0 = Sunday) and hour, 0 when empty
  heatmap: number[][];
  counts: number[][];
}

export interface InsightGroup {
  key: string;
  label: string;
  color?: string;
  posts: number;
  avgEngagement: number | null;
  avgViews: number | null;
  // average engagement relative to each channel's typical post, 1 = typical
  score: number | null;
}

// ---- view gains (Analytics > Views) ----

export interface ViewGainDay {
  date: string;
  views: number;
}

export interface ViewGainsChannel extends HistoryChannel {
  // ok: views per day below. collecting: the daily history has no two days to
  // compare yet. unavailable: the network did not answer, or the channel needs
  // a reconnect. unsupported: the network does not share view counts
  status: 'ok' | 'collecting' | 'unavailable' | 'unsupported';
  // live: read from the network when asked. history: computed from the daily
  // view counts of the posts PostDelegate tracks
  source: 'live' | 'history' | null;
  // views gained per day of `dates`, null when the day has no data
  points: Array<number | null>;
  total: number | null;
  bestDay: ViewGainDay | null;
}

export interface ViewGainsResponse {
  days: number;
  from: string;
  to: string;
  dates: string[];
  // across the channels with data
  total: Array<number | null>;
  totalViews: number | null;
  bestDay: ViewGainDay | null;
  channels: ViewGainsChannel[];
  // the daily history hit its read limit, so its oldest days are left out
  partial: boolean;
}

export interface ViewGainPost {
  id: string;
  externalId: string;
  postId: string | null;
  channel: HistoryChannel;
  title: string | null;
  url: string | null;
  publishedAt: string | null;
  // views gained in the range
  gained: number;
  // lifetime views at the last daily reading, null when the network only
  // reports the gains
  views: number | null;
}

export interface ViewGainPostsResponse {
  days: number;
  // the top posts of each channel by views gained, most first
  posts: ViewGainPost[];
  // channels asked for their posts that did not answer
  unavailable: number;
  // see ViewGainsResponse.partial
  partial: boolean;
}

// the daily history part of the view gains, kept briefly so the two Views
// calls of a page compute it once
interface HistoryViewGains {
  // views gained per channel id and day
  channels: Record<string, Record<string, number>>;
  posts: Array<Omit<ViewGainPost, 'channel'> & { integrationId: string }>;
  partial: boolean;
}

type PostViewReadingRow = Awaited<
  ReturnType<AnalyticsRepository['getPostViewSnapshots']>
>[number];

type ViewsSource = 'live' | 'history' | null;

// readings this many days before the range give its first days a base
const VIEW_GAINS_LOOKBACK_DAYS = 7;
// a post first read within this many days of going out had no views before
const NEW_POST_DAYS = 2;
const VIEW_GAIN_POSTS_LIMIT = 10;
// a count read this many times in a row below the highest one is a lasting
// recount, not a glitch
const RECOUNT_READINGS = 2;
// how long the history part of the Views section is kept. Live network data
// is never kept here: a provider that bypasses the analytics cache is read
// on demand
const VIEWS_HISTORY_CACHE_SECONDS = 600;
// the most posts one Views posts call returns across its channels
const VIEW_GAIN_POSTS_TOTAL = 1000;

export interface AnalyticsInsightsResponse {
  // PostDelegate posts with metrics in the range
  posts: number;
  contentTypes: InsightGroup[];
  lengths: InsightGroup[];
  hashtags: InsightGroup[];
  tags: InsightGroup[];
}

const engagementOf = (post: {
  likes: number | null;
  comments: number | null;
  shares: number | null;
}) =>
  post.likes === null && post.comments === null && post.shares === null
    ? null
    : (post.likes || 0) + (post.comments || 0) + (post.shares || 0);

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const periodChange = (
  current: number | null,
  previous: number | null
): number | null =>
  current === null || previous === null || previous === 0
    ? null
    : round(((current - previous) / Math.abs(previous)) * 100);

const isoDay = (date: Date) => dayjs(date).utc().format('YYYY-MM-DD');

// Daily gains of a running count (a post's lifetime views) from its daily
// readings: each reading minus the highest count read before it, never below
// 0. A count that drops is no gain, so a reading that dips once and comes back
// (a glitch) is never counted twice. A drop that holds for RECOUNT_READINGS
// readings is a lasting recount: the count then gains from its new level. Days
// missed between two readings share the gain evenly. The first reading is the
// base, unless the post went out at most NEW_POST_DAYS before it: then it had
// no views before and its count is spread from the day it was published.
// Known limit: a dip that lasts RECOUNT_READINGS readings and then comes back
// (1000, 0, 0, 1000) can't be told from a recount followed by real growth, so
// the recovery counts as gains again.
export const dailyGains = (
  readings: Array<{ date: string; value: number }>,
  publishedDay?: string
): Map<string, number> => {
  const gains = new Map<string, number>();
  // spreads `delta` over the days after `after`, up to `until` included
  const spread = (after: string, until: string, delta: number) => {
    const start = dayjs.utc(after);
    const days = Math.max(1, dayjs.utc(until).diff(start, 'day'));
    const each = Math.floor(delta / days);
    for (let day = 1; day <= days; day++) {
      gains.set(
        start.add(day, 'day').format('YYYY-MM-DD'),
        day === days ? delta - each * (days - 1) : each
      );
    }
  };

  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  let previous: { date: string; value: number } | undefined;
  let highest = 0;
  let lower = 0;
  for (const reading of sorted) {
    if (previous && previous.date === reading.date) {
      continue;
    }
    if (previous) {
      lower = reading.value < highest ? lower + 1 : 0;
      if (lower >= RECOUNT_READINGS) {
        // the recount held: gains count from the reading before this one
        highest = previous.value;
      }
      spread(previous.date, reading.date, Math.max(0, reading.value - highest));
    } else if (publishedDay) {
      const age = dayjs.utc(reading.date).diff(dayjs.utc(publishedDay), 'day');
      if (age <= NEW_POST_DAYS) {
        const firstDay = age < 0 ? dayjs.utc(reading.date) : dayjs.utc(publishedDay);
        spread(
          firstDay.subtract(1, 'day').format('YYYY-MM-DD'),
          reading.date,
          reading.value
        );
      }
    }
    previous = reading;
    highest = lower >= RECOUNT_READINGS ? reading.value : Math.max(highest, reading.value);
    if (lower >= RECOUNT_READINGS) {
      lower = 0;
    }
  }
  return gains;
};

// the total and the best day of a series of daily gains
const sumAndBestDay = (dates: string[], points: Array<number | null>) => {
  let total: number | null = null;
  let bestDay: ViewGainDay | null = null;
  points.forEach((value, index) => {
    if (value === null) {
      return;
    }
    total = (total || 0) + value;
    if (value > 0 && (!bestDay || value > bestDay.views)) {
      bestDay = { date: dates[index], views: value };
    }
  });
  return { total, bestDay } as {
    total: number | null;
    bestDay: ViewGainDay | null;
  };
};

const median = (values: number[]) => {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

// A spreadsheet cell: quoted when needed, and text that a spreadsheet would
// run as a formula is prefixed so an exported post can never execute
export const csvCell = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  let text = value;
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (
  header: string[],
  rows: Array<Array<string | number | null | undefined>>
) =>
  '﻿' +
  [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') +
  '\r\n';

@Injectable()
export class AnalyticsService {
  constructor(
    private _analyticsRepository: AnalyticsRepository,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager
  ) {}

  async getOverview(
    orgId: string,
    days: number,
    timezone = 'UTC'
  ): Promise<AnalyticsOverviewResponse> {
    const now = dayjs();
    const [posts, channels] = await Promise.all([
      this._analyticsRepository.getOverviewPosts(
        orgId,
        now.subtract(days, 'day').toDate(),
        now.toDate(),
        now.add(days, 'day').toDate()
      ),
      this._analyticsRepository.getOverviewChannels(orgId),
    ]);

    return this.aggregateOverview(days, timezone, posts, channels);
  }

  aggregateOverview(
    days: number,
    timezone: string,
    posts: OverviewPostRow[],
    channels: OverviewChannelRow[]
  ): AnalyticsOverviewResponse {
    const bucket = this.weekdayHourIn(timezone);
    const totals = { published: 0, scheduled: 0, failed: 0 };
    const heatmap = WEEKDAYS.map(() => Array<number>(24).fill(0));
    const perChannel = new Map<string, typeof totals>();

    for (const post of posts) {
      const key =
        post.state === 'PUBLISHED'
          ? 'published'
          : post.state === 'ERROR'
          ? 'failed'
          : post.state === 'QUEUE'
          ? 'scheduled'
          : null;
      if (!key) {
        continue;
      }

      totals[key]++;
      const channel = perChannel.get(post.integrationId) || {
        published: 0,
        scheduled: 0,
        failed: 0,
      };
      channel[key]++;
      perChannel.set(post.integrationId, channel);

      if (key === 'published') {
        const { weekday, hour } = bucket.of(post.publishDate);
        heatmap[weekday][hour]++;
      }
    }

    return {
      days,
      timezone: bucket.timezone,
      totals,
      channels: channels
        .map((channel) => ({
          id: channel.id,
          name: channelName(channel),
          picture: channel.picture,
          identifier: channel.providerIdentifier,
          disabled: channel.disabled,
          refreshNeeded: channel.refreshNeeded,
          ...(perChannel.get(channel.id) || {
            published: 0,
            scheduled: 0,
            failed: 0,
          }),
        }))
        .sort(
          (a, b) =>
            b.published - a.published ||
            b.scheduled - a.scheduled ||
            a.name.localeCompare(b.name)
        ),
      heatmap,
      byWeekday: heatmap.map((hours) => hours.reduce((a, b) => a + b, 0)),
      byHour: Array.from({ length: 24 }, (_, hour) =>
        heatmap.reduce((sum, hours) => sum + hours[hour], 0)
      ),
    };
  }

  async getEngagement(
    org: Organization,
    days: number
  ): Promise<AnalyticsEngagementResponse> {
    const channels = (
      await this._analyticsRepository.getOverviewChannels(org.id)
    ).filter(
      // getOverviewChannels already excludes removed ones
      (channel) => channel.type === 'social' && isChannelReady(channel)
    );

    const supported = channels.filter(
      (channel) =>
        !!this._integrationManager.getSocialIntegration(
          channel.providerIdentifier
        )?.analytics
    );

    // the same cached path the per-channel analytics view uses, but read-only:
    // a channel whose token expired is reported as unavailable instead of
    // being refreshed (or disconnected) by a page view
    const now = dayjs();
    const limit = pLimit(ENGAGEMENT_CONCURRENCY);
    const results = await Promise.all(
      supported.map((channel) =>
        channel.tokenExpiration && dayjs(channel.tokenExpiration).isBefore(now)
          ? Promise.resolve(null)
          : limit(() =>
              this.withTimeout(
                this._integrationService.checkAnalytics(
                  org,
                  channel.id,
                  String(days),
                  false,
                  false
                ),
                ENGAGEMENT_TIMEOUT_MS
              )
                .then((data) => data as ProviderMetric[])
                .catch((): null => null)
            )
      )
    );

    return this.aggregateEngagement(
      days,
      supported,
      results,
      channels.length - supported.length
    );
  }

  aggregateEngagement(
    days: number,
    channels: OverviewChannelRow[],
    results: Array<ProviderMetric[] | null>,
    unsupported: number
  ): AnalyticsEngagementResponse {
    const metrics = new Map<
      string,
      { label: string; total: number; channels: number }
    >();

    const channelStatus = channels.map((channel, index) => {
      const result = results[index];
      const status: AnalyticsEngagementChannel['status'] = !Array.isArray(
        result
      )
        ? 'unavailable'
        : result.length
        ? 'ok'
        : 'empty';

      for (const metric of Array.isArray(result) ? result : []) {
        // averages and rates can't be summed across channels
        if (metric?.average || !metric?.label) {
          continue;
        }
        const total = (metric.data || []).reduce((sum, point) => {
          const value = Number(point?.total);
          return Number.isFinite(value) ? sum + value : sum;
        }, 0);
        const key = metric.label.trim().toLowerCase();
        const current = metrics.get(key) || {
          label: metric.label.trim(),
          total: 0,
          channels: 0,
        };
        current.total += total;
        current.channels++;
        metrics.set(key, current);
      }

      return {
        id: channel.id,
        name: channelName(channel),
        picture: channel.picture,
        identifier: channel.providerIdentifier,
        status,
      };
    });

    return {
      days,
      metrics: [...metrics.values()].sort(
        (a, b) =>
          b.channels - a.channels ||
          b.total - a.total ||
          a.label.localeCompare(b.label)
      ),
      channels: channelStatus,
      unsupported,
    };
  }

  // ---- history: trends, top posts, best times, insights, exports ----

  // the last `days` UTC days, today included
  historyRange(days: number, now = new Date()) {
    return {
      from: dayjs(now)
        .utc()
        .startOf('day')
        .subtract(days - 1, 'day')
        .toDate(),
      to: now,
    };
  }

  async getTrends(
    orgId: string,
    days: number,
    integrationId?: string,
    now = new Date()
  ) {
    const { from, to } = this.historyRange(days, now);
    return this.trendsFor(orgId, from, to, integrationId);
  }

  async trendsFor(
    orgId: string,
    from: Date,
    to: Date,
    integrationId?: string
  ): Promise<AnalyticsTrendsResponse> {
    const dates = this.daysBetween(from, to);
    const previousFrom = dayjs(from)
      .utc()
      .subtract(dates.length, 'day')
      .toDate();
    const [channels, snapshots, posts, published, previousPublished] =
      await Promise.all([
        this._analyticsRepository.getOverviewChannels(orgId),
        // a week before the compared window gives the baselines to carry forward
        this._analyticsRepository.getAccountSnapshots(
          orgId,
          dayjs(previousFrom).utc().startOf('day').subtract(7, 'day').toDate(),
          to,
          integrationId
        ),
        this._analyticsRepository.getAnalyticsPosts(
          orgId,
          previousFrom,
          to,
          integrationId
        ),
        this._analyticsRepository.countPublished(orgId, from, to, integrationId),
        this._analyticsRepository.countPublished(
          orgId,
          previousFrom,
          from,
          integrationId
        ),
      ]);

    const selected = channels.filter(
      (channel) => !integrationId || channel.id === integrationId
    );
    const collecting =
      process.env.ANALYTICS_HISTORY_DISABLED !== 'true' &&
      (!integrationId ||
        selected.some((channel) =>
          isHistoryProvider(
            this._integrationManager.getSocialIntegration(
              channel.providerIdentifier
            )
          )
        ));

    return {
      ...this.aggregateTrends({
        from,
        to,
        channels: selected,
        snapshots,
        posts,
        published,
        previousPublished,
      }),
      collecting,
    };
  }

  aggregateTrends({
    from,
    to,
    channels,
    snapshots,
    posts,
    published,
    previousPublished,
  }: {
    from: Date;
    to: Date;
    channels: OverviewChannelRow[];
    snapshots: AccountSnapshotRow[];
    posts: AnalyticsPostRow[];
    published: number;
    previousPublished: number;
  }): Omit<AnalyticsTrendsResponse, 'collecting'> {
    const dates = this.daysBetween(from, to);
    const periodStart = dates[0];
    const previousStart = dayjs
      .utc(periodStart)
      .subtract(dates.length, 'day')
      .format('YYYY-MM-DD');
    const previousEnd = dayjs.utc(periodStart).subtract(1, 'day').format('YYYY-MM-DD');
    const periodEnd = dates[dates.length - 1];
    const live = new Set(channels.map((channel) => channel.id));

    // followers per channel in date order, from the snapshots that have them
    const series = new Map<string, Array<{ date: string; value: number }>>();
    let firstSnapshot: string | null = null;
    for (const row of snapshots) {
      if (!live.has(row.integrationId)) {
        continue;
      }
      const date = isoDay(row.date);
      if (!firstSnapshot || date < firstSnapshot) {
        firstSnapshot = date;
      }
      if (row.followers === null || row.followers === undefined) {
        continue;
      }
      const list = series.get(row.integrationId) || [];
      list.push({ date, value: row.followers });
      series.set(row.integrationId, list);
    }
    for (const list of series.values()) {
      list.sort((a, b) => a.date.localeCompare(b.date));
    }

    const valueAt = (id: string, date: string) => {
      let value: number | null = null;
      for (const point of series.get(id) || []) {
        if (point.date > date) {
          break;
        }
        value = point.value;
      }
      return value;
    };

    // growth between the value before the period (or its first value, for a
    // channel tracked since) and the last value in it; null without two points
    const gainedIn = (id: string, start: string, end: string) => {
      const points = (series.get(id) || []).filter((p) => p.date <= end);
      if (!points.length) {
        return null;
      }
      const last = points[points.length - 1];
      const before = points.filter((p) => p.date < start);
      const base = before.length
        ? before[before.length - 1]
        : points.find((p) => p.date >= start)!;
      return base === last ? null : last.value - base.value;
    };

    const sumOrNull = (values: Array<number | null>) => {
      const present = values.filter((v): v is number => v !== null);
      return present.length ? present.reduce((a, b) => a + b, 0) : null;
    };

    const tracked = channels.filter((channel) => series.has(channel.id));
    const channelRows = tracked
      .map((channel) => ({
        ...this.historyChannel(channel),
        points: dates.map((date) => valueAt(channel.id, date)),
        current: valueAt(channel.id, periodEnd),
        gained: gainedIn(channel.id, periodStart, periodEnd),
      }))
      .sort(
        (a, b) =>
          (b.current || 0) - (a.current || 0) || a.name.localeCompare(b.name)
      );

    const followersNow = sumOrNull(
      tracked.map((channel) => gainedIn(channel.id, periodStart, periodEnd))
    );
    const followersBefore = sumOrNull(
      tracked.map((channel) => gainedIn(channel.id, previousStart, previousEnd))
    );

    const fromTime = from.getTime();
    const previousFromTime = dayjs.utc(previousStart).valueOf();
    let engagement: number | null = null;
    let previousEngagement: number | null = null;
    let views: number | null = null;
    let previousViews: number | null = null;
    for (const post of posts) {
      if (!live.has(post.integrationId)) {
        continue;
      }
      const time = post.publishedAt.getTime();
      const current = time >= fromTime;
      if (!current && time < previousFromTime) {
        continue;
      }
      const value = engagementOf(post);
      if (value !== null) {
        if (current) {
          engagement = (engagement || 0) + value;
        } else {
          previousEngagement = (previousEngagement || 0) + value;
        }
      }
      if (post.views !== null) {
        if (current) {
          views = (views || 0) + post.views;
        } else {
          previousViews = (previousViews || 0) + post.views;
        }
      }
    }

    const compare = (
      key: PeriodComparison['key'],
      current: number | null,
      previous: number | null
    ): PeriodComparison => ({
      key,
      current,
      previous,
      change: periodChange(current, previous),
    });

    return {
      from: periodStart,
      to: periodEnd,
      firstSnapshot,
      comparison: [
        compare('followers', followersNow, followersBefore),
        compare('published', published, previousPublished),
        compare('engagement', engagement, previousEngagement),
        compare('views', views, previousViews),
      ],
      followers: {
        dates,
        total: dates.map((_, index) =>
          sumOrNull(channelRows.map((channel) => channel.points[index]))
        ),
        channels: channelRows,
      },
    };
  }

  async getTopPosts(
    orgId: string,
    days: number,
    options: {
      sort?: TopPostsSort;
      order?: 'asc' | 'desc';
      integrations?: string[];
      limit?: number;
      offset?: number;
    },
    now = new Date()
  ) {
    const { from, to } = this.historyRange(days, now);
    return this.topPostsFor(orgId, from, to, options);
  }

  async topPostsFor(
    orgId: string,
    from: Date,
    to: Date,
    options: {
      sort?: TopPostsSort;
      order?: 'asc' | 'desc';
      integrations?: string[];
      limit?: number;
      offset?: number;
    }
  ) {
    const [channels, posts] = await Promise.all([
      this._analyticsRepository.getOverviewChannels(orgId),
      this._analyticsRepository.getAnalyticsPosts(orgId, from, to),
    ]);
    const rows = this.buildTopPosts(channels, posts, options);
    const offset = Math.max(0, options.offset || 0);
    const limit = Math.max(1, options.limit || 50);
    // the channels that have tracked posts in the range, for the filter
    const withPosts = new Set(posts.map((post) => post.integrationId));
    return {
      total: rows.length,
      channels: channels
        .filter((channel) => withPosts.has(channel.id))
        .map((channel) => this.historyChannel(channel))
        .sort((a, b) => a.name.localeCompare(b.name)),
      posts: rows.slice(offset, offset + limit),
    };
  }

  buildTopPosts(
    channels: OverviewChannelRow[],
    posts: AnalyticsPostRow[],
    {
      sort = 'engagement',
      order = 'desc',
      integrations,
    }: {
      sort?: TopPostsSort;
      order?: 'asc' | 'desc';
      integrations?: string[];
    }
  ): TopPostRow[] {
    const byId = new Map(channels.map((channel) => [channel.id, channel]));
    const only = integrations?.length ? new Set(integrations) : null;
    const rows: TopPostRow[] = [];
    for (const post of posts) {
      const channel = byId.get(post.integrationId);
      if (!channel || (only && !only.has(post.integrationId))) {
        continue;
      }
      const engagement = engagementOf(post);
      rows.push({
        id: post.id,
        postId: post.postId,
        externalId: post.externalId,
        channel: this.historyChannel(channel),
        title: post.title,
        url: post.url,
        publishedAt: post.publishedAt.toISOString(),
        views: post.views,
        likes: post.likes,
        comments: post.comments,
        shares: post.shares,
        clicks: post.clicks,
        engagement,
        engagementRate:
          engagement !== null && post.views
            ? round((engagement / post.views) * 100, 2)
            : null,
      });
    }

    const valueOf = (row: TopPostRow) =>
      sort === 'date' ? Date.parse(row.publishedAt) : row[sort];
    const direction = order === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      const left = valueOf(a);
      const right = valueOf(b);
      // posts without the metric always go last
      if (left === null || right === null) {
        return left === right ? 0 : left === null ? 1 : -1;
      }
      return (
        (left - right) * direction ||
        Date.parse(b.publishedAt) - Date.parse(a.publishedAt) ||
        a.id.localeCompare(b.id)
      );
    });
  }

  // ---- view gains (Analytics > Views) ----

  // Where a channel's daily view gains come from: the network's own daily
  // series (live), or the daily view counts of its tracked posts (history).
  // null when its provider does not say which metric counts views.
  viewsSourceOf(providerIdentifier: string, kind: 'channel' | 'posts'): ViewsSource {
    const provider = this._integrationManager.getSocialIntegration(
      providerIdentifier
    );
    const metric = provider?.viewsMetric;
    if (!metric) {
      return null;
    }
    if (kind === 'channel' && metric.channel && provider.analytics) {
      return 'live';
    }
    if (kind === 'posts' && provider.topViewedPosts) {
      return 'live';
    }
    return this.keepsViewHistory(providerIdentifier) ? 'history' : null;
  }

  // the provider's post views are kept in the daily history
  private keepsViewHistory(providerIdentifier: string) {
    const provider = this._integrationManager.getSocialIntegration(
      providerIdentifier
    );
    return (
      !!provider?.viewsMetric?.post?.length &&
      process.env.ANALYTICS_HISTORY_DISABLED !== 'true' &&
      isHistoryProvider(provider)
    );
  }

  // the live social channels of the organization
  private async viewGainChannels(orgId: string) {
    return (await this._analyticsRepository.getOverviewChannels(orgId)).filter(
      (channel) => channel.type === 'social' && isChannelConnected(channel)
    );
  }

  async getViewGains(
    org: Organization,
    days: number,
    now = new Date()
  ): Promise<ViewGainsResponse> {
    const { from, to } = this.historyRange(days, now);
    const channels = await this.viewGainChannels(org.id);
    const sources = channels.map((channel) =>
      this.viewsSourceOf(channel.providerIdentifier, 'channel')
    );
    const history = await this.historyViewGains(org.id, channels, days, from, to);

    // a few channels at a time, a slow one is left out. An expired token is
    // refreshed softly: a failed refresh leaves the channel unavailable here,
    // it is never flagged for reconnect by this page
    const limit = pLimit(ENGAGEMENT_CONCURRENCY);
    const live = await Promise.all(
      channels.map((channel, index) =>
        sources[index] !== 'live' || channel.refreshNeeded
          ? Promise.resolve(null)
          : limit(() =>
              this.withTimeout(
                this._integrationService.checkAnalytics(
                  org,
                  channel.id,
                  String(days),
                  false,
                  'soft'
                ),
                ENGAGEMENT_TIMEOUT_MS
              )
                .then((data) => data as ProviderMetric[])
                .catch((): null => null)
            )
      )
    );

    return {
      ...this.aggregateViewGains({
        days,
        from,
        to,
        channels,
        sources,
        live,
        history: history.channels,
      }),
      partial: history.partial,
    };
  }

  aggregateViewGains({
    days,
    from,
    to,
    channels,
    sources,
    live,
    history,
  }: {
    days: number;
    from: Date;
    to: Date;
    channels: OverviewChannelRow[];
    sources: ViewsSource[];
    live: Array<ProviderMetric[] | null>;
    history: Record<string, Record<string, number>>;
  }): Omit<ViewGainsResponse, 'partial'> {
    const dates = this.daysBetween(from, to);

    const rows = channels.map((channel, index): ViewGainsChannel => {
      const source = sources[index];
      const base = { ...this.historyChannel(channel), source };
      const empty = { points: dates.map((): null => null), total: null, bestDay: null };

      if (!source) {
        return { ...base, status: 'unsupported', ...empty };
      }

      let byDay: Record<string, number> | undefined;
      if (source === 'history') {
        byDay = history[channel.id];
      } else {
        const metric = this._integrationManager.getSocialIntegration(
          channel.providerIdentifier
        )?.viewsMetric;
        const label = metric?.channel?.trim().toLowerCase();
        const offset = metric?.channelDateOffset || 0;
        const series = (live[index] || []).find(
          (item) => item?.label?.trim().toLowerCase() === label
        );
        if (series) {
          byDay = {};
          for (const point of series.data || []) {
            const value = Number(point?.total);
            const date = point?.date ? dayjs.utc(point.date) : null;
            if (!Number.isFinite(value) || !date?.isValid()) {
              continue;
            }
            const key = date.add(offset, 'day').format('YYYY-MM-DD');
            byDay[key] = (byDay[key] || 0) + Math.max(0, Math.round(value));
          }
        }
      }

      if (!byDay) {
        return {
          ...base,
          status: source === 'history' ? 'collecting' : 'unavailable',
          ...empty,
        };
      }

      const points = dates.map((date) => byDay![date] ?? null);
      if (source === 'history' && points.every((point) => point === null)) {
        return { ...base, status: 'collecting', ...empty };
      }
      return { ...base, status: 'ok', points, ...sumAndBestDay(dates, points) };
    });

    const withData = rows.filter((row) => row.status === 'ok');
    const total = dates.map((_, index) => {
      const values = withData
        .map((row) => row.points[index])
        .filter((value): value is number => value !== null);
      return values.length ? values.reduce((a, b) => a + b, 0) : null;
    });
    const overall = sumAndBestDay(dates, total);
    const statusOrder = ['ok', 'collecting', 'unavailable', 'unsupported'];

    return {
      days,
      from: dates[0],
      to: dates[dates.length - 1],
      dates,
      total,
      totalViews: overall.total,
      bestDay: overall.bestDay,
      channels: rows.sort(
        (a, b) =>
          statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status) ||
          (b.total || 0) - (a.total || 0) ||
          a.name.localeCompare(b.name)
      ),
    };
  }

  async getViewGainPosts(
    org: Organization,
    days: number,
    options: { integrations?: string[]; limit?: number },
    now = new Date()
  ): Promise<ViewGainPostsResponse> {
    const { from, to } = this.historyRange(days, now);
    const limit = Math.min(50, Math.max(1, options.limit || VIEW_GAIN_POSTS_LIMIT));
    const all = await this.viewGainChannels(org.id);
    // the same history as the channel gains (and its cache), narrowed after
    const history = await this.historyViewGains(org.id, all, days, from, to);

    const only = options.integrations?.length ? new Set(options.integrations) : null;
    const channels = all.filter((channel) => !only || only.has(channel.id));
    const sources = channels.map((channel) =>
      this.viewsSourceOf(channel.providerIdentifier, 'posts')
    );
    const byId = new Map(
      channels
        .filter((_, index) => sources[index] === 'history')
        .map((channel) => [channel.id, channel])
    );

    const posts: ViewGainPost[] = history.posts
      .filter((post) => byId.has(post.integrationId))
      .map(({ integrationId, ...post }) => ({
        ...post,
        channel: this.historyChannel(byId.get(integrationId)!),
      }));

    // read-only, see IntegrationService.topViewedPosts
    let unavailable = 0;
    const live = channels.filter((_, index) => sources[index] === 'live');
    const queue = pLimit(ENGAGEMENT_CONCURRENCY);
    const results = await Promise.all(
      live.map((channel) =>
        queue(() =>
          this.withTimeout(
            this._integrationService.topViewedPosts(org, channel.id, days, limit),
            ENGAGEMENT_TIMEOUT_MS
          ).catch((): null => null)
        )
      )
    );
    results.forEach((result, index) => {
      if (!result || ('unavailable' in result && result.unavailable)) {
        unavailable++;
        return;
      }
      const channel = live[index];
      for (const post of result.posts) {
        posts.push({
          id: `${channel.id}:${post.id}`,
          externalId: post.id,
          postId: null,
          channel: this.historyChannel(channel),
          title: post.title ? post.title.slice(0, 200) : null,
          url: post.url && /^https?:\/\//i.test(post.url) ? post.url : null,
          publishedAt: post.publishedAt || null,
          gained: Math.max(0, Math.round(Number(post.views) || 0)),
          views: null,
        });
      }
    });

    // the top `limit` of each channel, so narrowing to a smaller channel
    // still has its posts
    const perChannel = new Map<string, number>();
    return {
      days,
      posts: posts
        .filter((post) => post.gained > 0)
        .sort((a, b) => b.gained - a.gained || a.id.localeCompare(b.id))
        .filter((post) => {
          const count = (perChannel.get(post.channel.id) || 0) + 1;
          perChannel.set(post.channel.id, count);
          return count <= limit;
        })
        .slice(0, VIEW_GAIN_POSTS_TOTAL),
      unavailable,
      partial: history.partial && byId.size > 0,
    };
  }

  // The daily view gains of the tracked posts of every channel whose post
  // views are kept, per channel and day and per post over the range. Kept
  // for a few minutes, so the two Views calls of a page read the history once
  private async historyViewGains(
    orgId: string,
    channels: OverviewChannelRow[],
    days: number,
    from: Date,
    to: Date
  ): Promise<HistoryViewGains> {
    const integrationIds = channels
      .filter((channel) => this.keepsViewHistory(channel.providerIdentifier))
      .map((channel) => channel.id)
      .sort();
    if (!integrationIds.length) {
      return { channels: {}, posts: [], partial: false };
    }

    // under the integration:{org}:* pattern the organization erasure clears
    const cacheKey = `integration:${orgId}:views-history:${days}:${isoDay(
      to
    )}:${createHash('sha1').update(integrationIds.join(',')).digest('hex')}`;
    const cached = await ioRedis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    let readings = await this._analyticsRepository.getPostViewSnapshots(
      orgId,
      integrationIds,
      dayjs(from)
        .utc()
        .startOf('day')
        .subtract(VIEW_GAINS_LOOKBACK_DAYS, 'day')
        .toDate(),
      to
    );
    // past the read limit the oldest day read may be cut off: leave it out
    const partial = readings.length >= HISTORY_READ_LIMIT;
    if (partial) {
      const oldest = readings.reduce(
        (min, reading) => (isoDay(reading.date) < min ? isoDay(reading.date) : min),
        isoDay(readings[0].date)
      );
      readings = readings.filter((reading) => isoDay(reading.date) !== oldest);
    }

    const posts = await this._analyticsRepository.getAnalyticsPostsOf(
      orgId,
      integrationIds,
      [...new Set(readings.map((reading) => reading.externalId))]
    );
    const result = {
      ...this.aggregateHistoryViewGains(from, to, readings, posts),
      partial,
    };
    await ioRedis.set(
      cacheKey,
      JSON.stringify(result),
      'EX',
      VIEWS_HISTORY_CACHE_SECONDS
    );
    return result;
  }

  aggregateHistoryViewGains(
    from: Date,
    to: Date,
    readings: PostViewReadingRow[],
    posts: AnalyticsPostRow[]
  ): Omit<HistoryViewGains, 'partial'> {
    const first = isoDay(from);
    const last = isoDay(to);
    const key = (integrationId: string, externalId: string) =>
      `${integrationId}\u0000${externalId}`;
    const meta = new Map(
      posts.map((post) => [key(post.integrationId, post.externalId), post])
    );

    const byPost = new Map<
      string,
      {
        integrationId: string;
        externalId: string;
        readings: Array<{ date: string; value: number }>;
      }
    >();
    for (const reading of readings) {
      if (reading.views === null || reading.views === undefined) {
        continue;
      }
      const id = key(reading.integrationId, reading.externalId);
      const entry = byPost.get(id) || {
        integrationId: reading.integrationId,
        externalId: reading.externalId,
        readings: [],
      };
      entry.readings.push({ date: isoDay(reading.date), value: reading.views });
      byPost.set(id, entry);
    }

    const channels: Record<string, Record<string, number>> = {};
    const rows: HistoryViewGains['posts'] = [];
    for (const [id, entry] of byPost) {
      const post = meta.get(id);
      const gains = dailyGains(
        entry.readings,
        post ? isoDay(post.publishedAt) : undefined
      );
      let gained = 0;
      for (const [date, value] of gains) {
        if (date < first || date > last) {
          continue;
        }
        // a channel with readings but no day to compare yet has no entry
        const channel = (channels[entry.integrationId] =
          channels[entry.integrationId] || {});
        channel[date] = (channel[date] || 0) + value;
        gained += value;
      }

      const latest = entry.readings.reduce((a, b) => (b.date > a.date ? b : a));
      rows.push({
        id: post?.id || `${entry.integrationId}:${entry.externalId}`,
        integrationId: entry.integrationId,
        externalId: entry.externalId,
        postId: post?.postId ?? null,
        title: post?.title ?? null,
        url: post?.url ?? null,
        publishedAt: post ? post.publishedAt.toISOString() : null,
        gained,
        views: latest.value,
      });
    }

    return { channels, posts: rows };
  }

  async getBestTimes(
    orgId: string,
    days: number,
    timezone = 'UTC',
    now = new Date()
  ) {
    const { from, to } = this.historyRange(days, now);
    return this.bestTimesFor(orgId, from, to, timezone);
  }

  async bestTimesFor(orgId: string, from: Date, to: Date, timezone = 'UTC') {
    const [channels, posts] = await Promise.all([
      this._analyticsRepository.getOverviewChannels(orgId),
      this._analyticsRepository.getAnalyticsPosts(orgId, from, to),
    ]);
    const live = new Set(channels.map((channel) => channel.id));
    return this.aggregateBestTimes(
      timezone,
      posts.filter((post) => live.has(post.integrationId))
    );
  }

  aggregateBestTimes(
    timezone: string,
    posts: Array<
      Pick<
        AnalyticsPostRow,
        'id' | 'integrationId' | 'publishedAt' | 'likes' | 'comments' | 'shares'
      >
    >
  ): BestTimesResponse {
    const bucket = this.weekdayHourIn(timezone);
    const scores = this.relativeScores(posts);
    const sums = WEEKDAYS.map(() => Array<number>(24).fill(0));
    const counts = WEEKDAYS.map(() => Array<number>(24).fill(0));

    for (const post of posts) {
      const score = scores.get(post.id);
      if (score === undefined) {
        continue;
      }
      const { weekday, hour } = bucket.of(post.publishedAt);
      sums[weekday][hour] += score;
      counts[weekday][hour]++;
    }

    const best = (sum: number[], count: number[]) =>
      sum
        .map((total, index) => ({
          index,
          posts: count[index],
          score: count[index] ? total / count[index] : 0,
        }))
        .filter((item) => item.posts >= BEST_TIMES_MIN_BUCKET_POSTS)
        .sort((a, b) => b.score - a.score || b.posts - a.posts || a.index - b.index)
        .slice(0, 3);

    const daySums = sums.map((hours) => hours.reduce((a, b) => a + b, 0));
    const dayCounts = counts.map((hours) => hours.reduce((a, b) => a + b, 0));
    const hourSums = Array.from({ length: 24 }, (_, hour) =>
      sums.reduce((total, hours) => total + hours[hour], 0)
    );
    const hourCounts = Array.from({ length: 24 }, (_, hour) =>
      counts.reduce((total, hours) => total + hours[hour], 0)
    );

    return {
      timezone: bucket.timezone,
      basis: scores.size >= BEST_TIMES_MIN_POSTS ? 'engagement' : 'publish_count',
      posts: scores.size,
      required: BEST_TIMES_MIN_POSTS,
      bestDays: best(daySums, dayCounts).map((item) => ({
        weekday: item.index,
        score: round(item.score, 2),
        posts: item.posts,
      })),
      bestHours: best(hourSums, hourCounts).map((item) => ({
        hour: item.index,
        score: round(item.score, 2),
        posts: item.posts,
      })),
      heatmap: sums.map((hours, weekday) =>
        hours.map((total, hour) =>
          counts[weekday][hour] ? round(total / counts[weekday][hour], 2) : 0
        )
      ),
      counts,
    };
  }

  // Engagement of each post relative to its channel's median post, so a large
  // channel does not drown out the others (1 = a typical post on its channel)
  relativeScores(
    posts: Array<
      Pick<AnalyticsPostRow, 'id' | 'integrationId' | 'likes' | 'comments' | 'shares'>
    >
  ) {
    const perChannel = new Map<string, number[]>();
    for (const post of posts) {
      const value = engagementOf(post);
      if (value === null) {
        continue;
      }
      const list = perChannel.get(post.integrationId) || [];
      list.push(value);
      perChannel.set(post.integrationId, list);
    }
    const medians = new Map(
      [...perChannel.entries()].map(([id, values]) => [id, median(values)])
    );
    const scores = new Map<string, number>();
    for (const post of posts) {
      const value = engagementOf(post);
      if (value === null) {
        continue;
      }
      scores.set(
        post.id,
        value / Math.max(1, medians.get(post.integrationId) || 0)
      );
    }
    return scores;
  }

  async getInsights(orgId: string, days: number, now = new Date()) {
    const { from, to } = this.historyRange(days, now);
    return this.insightsFor(orgId, from, to);
  }

  async insightsFor(
    orgId: string,
    from: Date,
    to: Date
  ): Promise<AnalyticsInsightsResponse> {
    const [channels, posts] = await Promise.all([
      this._analyticsRepository.getOverviewChannels(orgId),
      this._analyticsRepository.getAnalyticsPosts(orgId, from, to),
    ]);
    const live = new Set(channels.map((channel) => channel.id));
    const tracked = posts.filter(
      (post) => live.has(post.integrationId) && engagementOf(post) !== null
    );
    const contents = await this._analyticsRepository.getPostsContent(
      orgId,
      [...new Set(tracked.map((post) => post.postId).filter((id): id is string => !!id))]
    );
    return this.aggregateInsights(tracked, contents);
  }

  aggregateInsights(
    posts: AnalyticsPostRow[],
    contents: PostContentRow[]
  ): AnalyticsInsightsResponse {
    const scores = this.relativeScores(posts);
    const byPostId = new Map(contents.map((content) => [content.id, content]));
    type Row = { engagement: number; views: number | null; score: number };
    const groups = {
      contentTypes: new Map<string, Row[]>(),
      lengths: new Map<string, Row[]>(),
      hashtags: new Map<string, Row[]>(),
      tags: new Map<string, Row[]>(),
    };
    const tagInfo = new Map<string, { name: string; color: string }>();
    const add = (map: Map<string, Row[]>, key: string, row: Row) => {
      const list = map.get(key) || [];
      list.push(row);
      map.set(key, list);
    };

    let analysed = 0;
    for (const post of posts) {
      const content = post.postId ? byPostId.get(post.postId) : undefined;
      const engagement = engagementOf(post);
      if (!content || engagement === null) {
        continue;
      }
      analysed++;
      const row: Row = {
        engagement,
        views: post.views,
        score: scores.get(post.id) ?? 0,
      };
      const text = this.plainText(content.content);
      add(groups.contentTypes, this.contentTypeOf(content.image), row);
      add(groups.lengths, this.lengthBucketOf(text.length), row);
      for (const hashtag of this.hashtagsOf(text)) {
        add(groups.hashtags, hashtag, row);
      }
      for (const { tag } of content.tags || []) {
        if (!tag || tag.deletedAt) {
          continue;
        }
        tagInfo.set(tag.id, { name: tag.name, color: tag.color });
        add(groups.tags, tag.id, row);
      }
    }

    const summarise = (key: string, label: string, rows: Row[], color?: string): InsightGroup => {
      const withViews = rows.filter((row) => row.views !== null);
      return {
        key,
        label,
        ...(color ? { color } : {}),
        posts: rows.length,
        avgEngagement: rows.length
          ? round(rows.reduce((sum, row) => sum + row.engagement, 0) / rows.length)
          : null,
        avgViews: withViews.length
          ? round(withViews.reduce((sum, row) => sum + row.views!, 0) / withViews.length)
          : null,
        score: rows.length
          ? round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length, 2)
          : null,
      };
    };

    const ordered = (map: Map<string, Row[]>, keys: Record<string, string>) =>
      Object.entries(keys)
        .filter(([key]) => map.has(key))
        .map(([key, label]) => summarise(key, label, map.get(key)!));

    return {
      posts: analysed,
      contentTypes: ordered(groups.contentTypes, {
        video: 'Video',
        carousel: 'Carousel',
        image: 'Image',
        text: 'Text only',
      }),
      lengths: ordered(groups.lengths, {
        short: 'Up to 80 characters',
        medium: '81 to 280 characters',
        long: '281 to 1,000 characters',
        very_long: 'Over 1,000 characters',
      }),
      hashtags: [...groups.hashtags.entries()]
        .map(([key, rows]) => summarise(key, `#${key}`, rows))
        .sort(
          (a, b) =>
            b.posts - a.posts || (b.score || 0) - (a.score || 0) || a.key.localeCompare(b.key)
        )
        .slice(0, TOP_HASHTAGS),
      tags: [...groups.tags.entries()]
        .map(([key, rows]) =>
          summarise(key, tagInfo.get(key)!.name, rows, tagInfo.get(key)!.color)
        )
        .sort((a, b) => b.posts - a.posts || a.label.localeCompare(b.label)),
    };
  }

  contentTypeOf(image: string | null): 'video' | 'carousel' | 'image' | 'text' {
    let media: Array<{ path?: string }> = [];
    try {
      const parsed = JSON.parse(image || '[]');
      media = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      media = [];
    }
    const paths = media.map((item) => item?.path || '').filter(Boolean);
    if (
      paths.some((path) =>
        ['mp4', 'mov', 'webm', 'm4v'].some((ext) => hasExtension(path, ext))
      )
    ) {
      return 'video';
    }
    return paths.length > 1 ? 'carousel' : paths.length === 1 ? 'image' : 'text';
  }

  lengthBucketOf(length: number) {
    return length <= 80
      ? 'short'
      : length <= 280
      ? 'medium'
      : length <= 1000
      ? 'long'
      : 'very_long';
  }

  hashtagsOf(text: string) {
    return [
      ...new Set(
        [...text.matchAll(/(?:^|[^\p{L}\p{N}_&/])#([\p{L}\p{N}_]{2,50})/gu)]
          .map((match) => match[1].toLowerCase())
          .filter((tag) => !/^\d+$/.test(tag))
      ),
    ];
  }

  private plainText(content: string | null) {
    if (!content) {
      return '';
    }
    try {
      return stripHtmlValidation('none', content).replace(/\s+/g, ' ').trim();
    } catch (err) {
      return content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  async exportTopPostsCsv(
    orgId: string,
    days: number,
    options: {
      sort?: TopPostsSort;
      order?: 'asc' | 'desc';
      integrations?: string[];
    }
  ) {
    const { posts } = await this.getTopPosts(orgId, days, {
      ...options,
      limit: CSV_ROW_LIMIT,
    });
    return this.topPostsCsv(posts);
  }

  topPostsCsv(rows: TopPostRow[]) {
    return toCsv(
      [
        'Published (UTC)',
        'Channel',
        'Platform',
        'Post',
        'URL',
        'Views',
        'Likes',
        'Comments',
        'Shares',
        'Clicks',
        'Engagement',
        'Engagement rate (%)',
      ],
      rows.map((row) => [
        row.publishedAt,
        row.channel.name,
        row.channel.identifier,
        row.title,
        row.url,
        row.views,
        row.likes,
        row.comments,
        row.shares,
        row.clicks,
        row.engagement,
        row.engagementRate,
      ])
    );
  }

  async exportDailyCsv(
    orgId: string,
    days: number,
    integrations?: string[],
    now = new Date()
  ) {
    const { from, to } = this.historyRange(days, now);
    const [channels, snapshots, totals] = await Promise.all([
      this._analyticsRepository.getOverviewChannels(orgId),
      this._analyticsRepository.getAccountSnapshots(orgId, from, to),
      this._analyticsRepository.getDailyPostTotals(orgId, from, to),
    ]);
    return this.dailyCsv(channels, snapshots, totals, integrations);
  }

  dailyCsv(
    channels: OverviewChannelRow[],
    snapshots: AccountSnapshotRow[],
    totals: Array<{
      integrationId: string;
      date: Date;
      _count?: { _all?: number } | null;
      _sum?: {
        views?: number | null;
        likes?: number | null;
        comments?: number | null;
        shares?: number | null;
        clicks?: number | null;
      } | null;
    }>,
    integrations?: string[]
  ) {
    const byId = new Map(channels.map((channel) => [channel.id, channel]));
    const only = integrations?.length ? new Set(integrations) : null;
    const rows = new Map<
      string,
      {
        date: string;
        channel: OverviewChannelRow;
        account?: AccountSnapshotRow;
        totals?: (typeof totals)[number];
      }
    >();
    const rowOf = (integrationId: string, date: Date) => {
      const channel = byId.get(integrationId);
      if (!channel || (only && !only.has(integrationId))) {
        return undefined;
      }
      const day = isoDay(date);
      const key = `${day}|${integrationId}`;
      const row = rows.get(key) || { date: day, channel };
      rows.set(key, row);
      return row;
    };
    for (const snapshot of snapshots) {
      const row = rowOf(snapshot.integrationId, snapshot.date);
      if (row) {
        row.account = snapshot;
      }
    }
    for (const total of totals) {
      const row = rowOf(total.integrationId, total.date);
      if (row) {
        row.totals = total;
      }
    }

    return toCsv(
      [
        'Date',
        'Channel',
        'Platform',
        'Followers',
        'Following',
        'Total posts',
        'Posts tracked',
        'Views',
        'Likes',
        'Comments',
        'Shares',
        'Clicks',
      ],
      [...rows.values()]
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            channelName(a.channel).localeCompare(channelName(b.channel))
        )
        .slice(0, CSV_ROW_LIMIT)
        .map((row) => [
          row.date,
          channelName(row.channel),
          row.channel.providerIdentifier,
          row.account?.followers ?? null,
          row.account?.following ?? null,
          row.account?.posts ?? null,
          row.totals?._count?._all ?? null,
          row.totals?._sum?.views ?? null,
          row.totals?._sum?.likes ?? null,
          row.totals?._sum?.comments ?? null,
          row.totals?._sum?.shares ?? null,
          row.totals?._sum?.clicks ?? null,
        ])
    );
  }

  private historyChannel(channel: OverviewChannelRow): HistoryChannel {
    return {
      id: channel.id,
      name: channelName(channel),
      picture: channel.picture,
      identifier: channel.providerIdentifier,
    };
  }

  // every UTC day from `from` to `to`, both included
  daysBetween(from: Date, to: Date) {
    const days: string[] = [];
    const last = dayjs(to).utc().startOf('day');
    for (
      let day = dayjs(from).utc().startOf('day');
      !day.isAfter(last) && days.length < 400;
      day = day.add(1, 'day')
    ) {
      days.push(day.format('YYYY-MM-DD'));
    }
    return days.length ? days : [last.format('YYYY-MM-DD')];
  }

  private withTimeout<T>(promise: Promise<T>, ms: number) {
    let handle: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        handle = setTimeout(() => reject(new Error('Analytics timeout')), ms);
      }),
    ]).finally(() => clearTimeout(handle));
  }

  private weekdayHourIn(timezone: string) {
    let format: Intl.DateTimeFormat;
    let resolved = timezone || 'UTC';
    try {
      format = new Intl.DateTimeFormat('en-US', {
        timeZone: resolved,
        weekday: 'short',
        hour: 'numeric',
        hourCycle: 'h23',
      });
    } catch (e) {
      resolved = 'UTC';
      format = new Intl.DateTimeFormat('en-US', {
        timeZone: resolved,
        weekday: 'short',
        hour: 'numeric',
        hourCycle: 'h23',
      });
    }

    return {
      timezone: resolved,
      of: (date: Date) => {
        let weekday = 0;
        let hour = 0;
        for (const part of format.formatToParts(date)) {
          if (part.type === 'weekday') {
            weekday = Math.max(0, WEEKDAYS.indexOf(part.value));
          } else if (part.type === 'hour') {
            hour = +part.value % 24;
          }
        }
        return { weekday, hour };
      },
    };
  }
}
