import { Injectable } from '@nestjs/common';
import { Organization, State } from '@prisma/client';
import dayjs from 'dayjs';
import pLimit from 'p-limit';
import { AnalyticsRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';

// provider analytics are slow third-party calls: a few at a time, and a channel
// that takes too long is reported as unavailable instead of holding the page
const ENGAGEMENT_CONCURRENCY = 4;
const ENGAGEMENT_TIMEOUT_MS = 20000;

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
      (channel) =>
        channel.type === 'social' &&
        !channel.disabled &&
        !channel.refreshNeeded &&
        !channel.inBetweenSteps
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
