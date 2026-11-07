'use client';

import React, { FC, useCallback, useId, useMemo } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { TopPostsTable } from '@gitroom/frontend/components/platform-analytics/analytics.top.posts';
import {
  Card,
  ChannelAvatar,
  DeltaBadge,
  formatNumber,
  HistoryEmpty,
  Range,
  Skeleton,
  swrOptions,
} from '@gitroom/frontend/components/platform-analytics/analytics.ui';

interface PeriodComparison {
  key: 'followers' | 'published' | 'engagement' | 'views';
  current: number | null;
  previous: number | null;
  change: number | null;
}

interface TrendChannel {
  id: string;
  name: string;
  picture: string | null;
  identifier: string;
  points: Array<number | null>;
  current: number | null;
  gained: number | null;
}

export interface TrendsData {
  collecting: boolean;
  from: string;
  to: string;
  firstSnapshot: string | null;
  comparison: PeriodComparison[];
  followers: {
    dates: string[];
    total: Array<number | null>;
    channels: TrendChannel[];
  };
}

export const useAnalyticsTrends = (days: Range, integration?: string) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error('trends');
    }
    return (await response.json()) as TrendsData;
  }, []);
  return useSWR(
    `/analytics/trends?days=${days}${
      integration ? `&integration=${encodeURIComponent(integration)}` : ''
    }`,
    load,
    swrOptions
  );
};

const signed = (value: number) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatNumber(Math.abs(value))}`;

const dateLabel = (date: string) => dayjs(date).format('MMM D');

// The four period-over-period tiles of the overview
export const PeriodComparisonRow: FC<{ days: Range }> = ({ days }) => {
  const t = useT();
  const { data, isLoading, error } = useAnalyticsTrends(days);
  const labels: Record<PeriodComparison['key'], string> = {
    followers: t('analytics_compare_followers', 'Followers gained'),
    published: t('analytics_compare_published', 'Posts published'),
    engagement: t('analytics_compare_engagement', 'Engagement'),
    views: t('analytics_compare_views', 'Views'),
  };

  if (error && !data) {
    return (
      <p className="text-[13px] text-newTableText">
        {t(
          'analytics_compare_error',
          'The comparison could not be loaded right now.'
        )}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-[10px]">
      <dl
        className="grid grid-cols-4 tablet:grid-cols-2 mobile:grid-cols-1 gap-[12px]"
        aria-busy={isLoading && !data}
      >
        {(data?.comparison ||
          (['followers', 'published', 'engagement', 'views'] as const).map(
            (key) => ({ key, current: null, previous: null, change: null })
          )
        ).map((item) => (
          <div
            key={item.key}
            className="flex flex-col gap-[4px] rounded-[10px] bg-newBgColorInner border border-newTableBorder px-[12px] py-[10px] min-w-0"
          >
            <dt className="text-[12px] text-newTableText truncate">
              {labels[item.key]}
            </dt>
            {isLoading && !data ? (
              <dd>
                <Skeleton className="h-[28px] w-[64px]" />
              </dd>
            ) : (
              <>
                <dd className="text-[20px] font-[600] text-newTextColor tabular-nums">
                  {item.current === null
                    ? '–'
                    : item.key === 'followers'
                    ? signed(item.current)
                    : formatNumber(item.current)}
                </dd>
                <dd className="flex items-center gap-[6px] flex-wrap">
                  <DeltaBadge
                    change={item.change}
                    previous={item.previous}
                    current={item.current}
                  />
                  {item.previous !== null && (
                    <span className="text-[11px] text-newTableText">
                      {t('analytics_compare_previous', 'vs {{value}}', {
                        value:
                          item.key === 'followers'
                            ? signed(item.previous)
                            : formatNumber(item.previous),
                      })}
                    </span>
                  )}
                </dd>
              </>
            )}
          </div>
        ))}
      </dl>
      <p className="text-[12px] text-newTableText">
        {t(
          'analytics_compare_note',
          'Engagement and views add up the posts published in each period, as last measured, so newer posts have had less time to collect them. Followers and post metrics are saved daily from the day history started{{since}}.',
          {
            since: data?.firstSnapshot
              ? ` (${dayjs(data.firstSnapshot).format('MMM D, YYYY')})`
              : '',
          }
        )}
      </p>
    </div>
  );
};

// A native SVG line chart: gaps where a day has no value, a hidden table with
// every value for screen readers
export const LineChart: FC<{
  dates: string[];
  values: Array<number | null>;
  label: string;
  height?: number;
  compact?: boolean;
  // fixed light colors for the printed report
  print?: boolean;
}> = ({ dates, values, label, height = 180, compact = false, print = false }) => {
  const t = useT();
  const gradientId = `trend-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const width = 600;
  const pad = compact ? 2 : 8;
  const present = values.filter((v): v is number => v !== null);
  const min = present.length ? Math.min(...present) : 0;
  const max = present.length ? Math.max(...present) : 0;
  const span = max - min || Math.max(1, Math.abs(max) * 0.05);
  const low = min - (max === min ? span / 2 : span * 0.1);
  const high = max + (max === min ? span / 2 : span * 0.1);
  const x = (index: number) =>
    dates.length > 1
      ? pad + (index / (dates.length - 1)) * (width - pad * 2)
      : width / 2;
  const y = (value: number) =>
    height - pad - ((value - low) / (high - low)) * (height - pad * 2);

  const segments = useMemo(() => {
    const result: Array<Array<[number, number]>> = [];
    let current: Array<[number, number]> = [];
    values.forEach((value, index) => {
      if (value === null) {
        if (current.length) result.push(current);
        current = [];
        return;
      }
      current.push([x(index), y(value)]);
    });
    if (current.length) result.push(current);
    return result;
  }, [values, dates, height]);

  const first = values.findIndex((v) => v !== null);
  const last = values.length - 1 - [...values].reverse().findIndex((v) => v !== null);
  const summary =
    first === -1
      ? t('analytics_chart_no_data', 'No data yet')
      : t(
          'analytics_chart_summary',
          '{{label}}: {{start}} on {{startDate}}, {{end}} on {{endDate}}',
          {
            label,
            start: formatNumber(values[first]!),
            startDate: dateLabel(dates[first]),
            end: formatNumber(values[last]!),
            endDate: dateLabel(dates[last]),
          }
        );

  return (
    <figure className="flex flex-col gap-[6px] m-0 min-w-0">
      <div className="relative">
        <svg
          role="img"
          aria-label={summary}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className={clsx(
            'w-full block overflow-visible',
            print ? 'text-[#5b3fe6]' : 'text-btnPrimary'
          )}
          style={{ height }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {!compact &&
            [0.25, 0.5, 0.75].map((ratio) => (
              <line
                key={ratio}
                x1={0}
                x2={width}
                y1={height * ratio}
                y2={height * ratio}
                className={print ? 'stroke-[#e7e5ef]' : 'stroke-newTableBorder'}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          {segments.map((segment, index) => (
            <g key={index}>
              {segment.length > 1 && !compact && (
                <path
                  d={`M${segment[0][0]},${height} ${segment
                    .map(([px, py]) => `L${px},${py}`)
                    .join(' ')} L${segment[segment.length - 1][0]},${height} Z`}
                  fill={`url(#${gradientId})`}
                />
              )}
              {segment.length > 1 ? (
                <path
                  d={segment
                    .map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`)
                    .join(' ')}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={compact ? 1.5 : 2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : (
                <circle
                  cx={segment[0][0]}
                  cy={segment[0][1]}
                  r={3}
                  fill="currentColor"
                />
              )}
            </g>
          ))}
        </svg>
        {!compact && present.length > 0 && (
          <div
            aria-hidden="true"
            className={clsx(
              'absolute inset-y-0 start-0 flex flex-col justify-between text-[10px] pointer-events-none py-[2px]',
              print ? 'text-[#6b6b78]' : 'text-newTableText'
            )}
          >
            <span className={clsx('px-[2px] rounded', print ? 'bg-white' : 'bg-newTableHeader')}>
              {formatNumber(Math.round(max))}
            </span>
            <span className={clsx('px-[2px] rounded', print ? 'bg-white' : 'bg-newTableHeader')}>
              {formatNumber(Math.round(min))}
            </span>
          </div>
        )}
      </div>
      {!compact && (
        <figcaption
          aria-hidden="true"
          className={clsx(
            'flex justify-between text-[11px]',
            print ? 'text-[#6b6b78]' : 'text-newTableText'
          )}
        >
          <span>{dateLabel(dates[0])}</span>
          <span>{dateLabel(dates[dates.length - 1])}</span>
        </figcaption>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {dates.map((date, index) =>
            values[index] === null ? null : (
              <tr key={date}>
                <th scope="row">{date}</th>
                <td>{values[index]}</td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </figure>
  );
};

const FollowerChannels: FC<{ data: TrendsData }> = ({ data }) => {
  const t = useT();
  return (
    <ul className="flex flex-col divide-y divide-newTableBorder">
      {data.followers.channels.map((channel) => (
        <li
          key={channel.id}
          className="flex items-center gap-[12px] py-[10px] min-w-0"
        >
          <ChannelAvatar picture={channel.picture} identifier={channel.identifier} />
          <div className="flex-1 min-w-0">
            <div className="truncate text-[14px] text-newTextColor">
              {channel.name}
            </div>
            <div className="text-[12px] text-newTableText tabular-nums">
              {channel.current === null
                ? t('analytics_trends_no_followers', 'No follower count yet')
                : t('analytics_trends_followers_count', '{{followers}} followers', {
                    followers: formatNumber(channel.current),
                  })}
            </div>
          </div>
          <div className="w-[120px] mobile:hidden">
            <LineChart
              compact
              height={32}
              dates={data.followers.dates}
              values={channel.points}
              label={channel.name}
            />
          </div>
          <div
            className={clsx(
              'w-[72px] text-end text-[13px] font-[600] tabular-nums',
              channel.gained === null
                ? 'text-newTableText'
                : channel.gained > 0
                ? 'text-green-500'
                : channel.gained < 0
                ? 'text-red-500'
                : 'text-newTableText'
            )}
          >
            {channel.gained === null ? '–' : signed(channel.gained)}
          </div>
        </li>
      ))}
    </ul>
  );
};

export const TrendsSection: FC<{ days: Range }> = ({ days }) => {
  const t = useT();
  const { data, isLoading, error } = useAnalyticsTrends(days);

  if (error && !data) {
    return (
      <p role="alert" className="text-[13px] text-red-500">
        {t('analytics_trends_error', 'Trends could not be loaded. Please try again.')}
      </p>
    );
  }

  if (isLoading && !data) {
    return <Skeleton className="h-[260px]" />;
  }

  const hasFollowers = !!data?.followers.channels.length;
  const total = data?.followers.total || [];

  if (data && !data.collecting && !hasFollowers) {
    return (
      <HistoryEmpty>
        {t(
          'analytics_history_off',
          'Daily history is switched off on this server, so trends are not collected.'
        )}
      </HistoryEmpty>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] tablet:grid-cols-1 gap-[12px]">
      <Card
        title={t('analytics_trends_followers', 'Follower growth')}
        subtitle={t(
          'analytics_trends_followers_hint',
          'All channels with a follower count, last {{days}} days',
          { days }
        )}
      >
        {hasFollowers && data ? (
          <LineChart
            dates={data.followers.dates}
            values={total}
            label={t('analytics_trends_total_followers', 'Total followers')}
          />
        ) : (
          <HistoryEmpty />
        )}
      </Card>
      <Card
        title={t('analytics_trends_by_channel', 'By channel')}
        subtitle={t(
          'analytics_trends_by_channel_hint',
          'Followers now and gained in the last {{days}} days',
          { days }
        )}
      >
        {hasFollowers && data ? (
          <FollowerChannels data={data} />
        ) : (
          <p className="text-[13px] text-newTableText">
            {t(
              'analytics_trends_channels_empty',
              'Channels whose platform shares a follower count show up here after their first daily snapshot.'
            )}
          </p>
        )}
      </Card>
    </div>
  );
};

// The follower history of one channel, in the channel view
export const ChannelFollowerTrend: FC<{ days: Range; integration: string }> = ({
  days,
  integration,
}) => {
  const t = useT();
  const { data, isLoading } = useAnalyticsTrends(days, integration);
  const channel = data?.followers.channels[0];

  if (isLoading && !data) {
    return <Skeleton className="h-[180px]" />;
  }

  if (!channel || !data) {
    return (
      <HistoryEmpty>
        {t(
          'analytics_channel_history_empty',
          'This channel’s follower history starts with its first daily snapshot. Check back tomorrow.'
        )}
      </HistoryEmpty>
    );
  }

  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex items-baseline gap-[10px] flex-wrap">
        <span className="text-[24px] font-[600] tabular-nums text-newTextColor">
          {channel.current === null ? '–' : formatNumber(channel.current)}
        </span>
        {channel.gained !== null && (
          <span
            className={clsx(
              'text-[13px] font-[600] tabular-nums',
              channel.gained > 0
                ? 'text-green-500'
                : channel.gained < 0
                ? 'text-red-500'
                : 'text-newTableText'
            )}
          >
            {t('analytics_channel_gained', '{{value}} in {{days}} days', {
              value: signed(channel.gained),
              days,
            })}
          </span>
        )}
      </div>
      <LineChart
        dates={data.followers.dates}
        values={channel.points}
        label={t('analytics_channel_followers', '{{name}} followers', {
          name: channel.name,
        })}
      />
    </div>
  );
};

// The history cards of the channel view; a platform that does not allow
// keeping its analytics gets a note instead of empty cards
export const ChannelHistory: FC<{ days: Range; integration: string }> = ({
  days,
  integration,
}) => {
  const t = useT();
  const { data } = useAnalyticsTrends(days, integration);

  if (data && !data.collecting) {
    return (
      <p className="text-[13px] text-newTableText">
        {t(
          'analytics_channel_not_collected',
          'Daily history is not kept for this channel: its platform does not allow storing analytics, or history is switched off.'
        )}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 tablet:grid-cols-1 gap-[12px]">
      <Card
        title={t('analytics_channel_history', 'Follower history')}
        subtitle={t(
          'analytics_channel_history_hint',
          'Saved once a day, last {{days}} days',
          { days }
        )}
      >
        <ChannelFollowerTrend days={days} integration={integration} />
      </Card>
      <Card
        title={t('analytics_channel_top_posts', 'Top posts')}
        subtitle={t(
          'analytics_channel_top_posts_hint',
          'This channel’s best posts of the last {{days}} days, by engagement',
          { days }
        )}
      >
        <TopPostsTable compact days={days} integration={integration} />
      </Card>
    </div>
  );
};
