'use client';

import React, { FC, KeyboardEvent, useCallback, useMemo, useRef } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import useCookie from 'react-use-cookie';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';
import { getTimezone } from '@gitroom/frontend/components/layout/set.timezone';
import {
  Card,
  formatNumber,
  hourName,
  Range,
  RangePicker,
  RANGES,
  Skeleton,
  swrOptions,
  weekdayName,
} from '@gitroom/frontend/components/platform-analytics/analytics.ui';
import {
  PeriodComparisonRow,
  TrendsSection,
} from '@gitroom/frontend/components/platform-analytics/analytics.trends';
import { TopPostsSection } from '@gitroom/frontend/components/platform-analytics/analytics.top.posts';
import { InsightsSection } from '@gitroom/frontend/components/platform-analytics/analytics.insights';
import { ReportsSection } from '@gitroom/frontend/components/platform-analytics/analytics.reports';

interface OverviewChannel {
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

interface OverviewData {
  days: number;
  timezone: string;
  totals: { published: number; scheduled: number; failed: number };
  channels: OverviewChannel[];
  heatmap: number[][];
  byWeekday: number[];
  byHour: number[];
}

interface EngagementData {
  days: number;
  metrics: Array<{ label: string; total: number; channels: number }>;
  channels: Array<{
    id: string;
    name: string;
    status: 'ok' | 'empty' | 'unavailable';
  }>;
  unsupported: number;
}

const useAnalyticsOverview = (days: Range) => {
  const fetch = useFetch();
  const timezone = getTimezone();
  const load = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()) as OverviewData;
  }, []);
  return useSWR(
    `/analytics/overview?days=${days}&timezone=${encodeURIComponent(timezone)}`,
    load,
    swrOptions
  );
};

const useAnalyticsEngagement = (days: Range) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()) as EngagementData;
  }, []);
  return useSWR(
    `/analytics/overview/engagement?days=${days}`,
    load,
    swrOptions
  );
};

const topIndexes = (values: number[], count: number) =>
  values
    .map((value, index) => ({ value, index }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .slice(0, count);

const StatTile: FC<{
  label: string;
  hint: string;
  value?: number;
  tone?: 'default' | 'danger';
  loading: boolean;
}> = ({ label, hint, value, tone = 'default', loading }) => (
  <div className="flex flex-col gap-[6px] bg-newTableHeader border border-newTableBorder rounded-[12px] px-[16px] py-[14px] min-w-0">
    <div className="text-[13px] font-[500] text-newTableText">{label}</div>
    {loading ? (
      <Skeleton className="h-[36px] w-[72px]" />
    ) : (
      <div
        className={clsx(
          'text-[32px] leading-[36px] font-[600] tracking-tight flex items-center gap-[8px]',
          tone === 'danger' && !!value ? 'text-red-500' : 'text-newTextColor'
        )}
      >
        {tone === 'danger' && !!value && (
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5v5.5M12 16.5h.01" />
          </svg>
        )}
        {formatNumber(value || 0)}
      </div>
    )}
    <div className="text-[12px] text-newTableText">{hint}</div>
  </div>
);

const ChannelBreakdown: FC<{ channels: OverviewChannel[] }> = ({
  channels,
}) => {
  const t = useT();
  const max = Math.max(1, ...channels.map((c) => c.published + c.failed));

  if (!channels.length) {
    return (
      <p className="text-[13px] text-newTableText">
        {t(
          'analytics_overview_no_channels',
          'Connect a channel to see how each one is doing.'
        )}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-[12px] max-h-[320px] overflow-y-auto pe-[4px] scrollbar scrollbar-thumb-newTableBorder scrollbar-track-transparent">
      {channels.map((channel) => {
        const summary = t(
          'analytics_overview_channel_summary',
          '{{published}} published, {{failed}} failed, {{scheduled}} scheduled',
          {
            published: channel.published,
            failed: channel.failed,
            scheduled: channel.scheduled,
          }
        );
        return (
          <li
            key={channel.id}
            className={clsx(
              'flex items-center gap-[12px] min-w-0',
              channel.disabled && 'opacity-50'
            )}
          >
            <div className="relative shrink-0">
              <ImageWithFallback
                fallbackSrc={`/icons/platforms/${channel.identifier}.png`}
                src={
                  channel.picture ||
                  `/icons/platforms/${channel.identifier}.png`
                }
                className="rounded-[8px]"
                alt=""
                width={32}
                height={32}
              />
              <img
                src={`/icons/platforms/${channel.identifier}.png`}
                className="rounded-[4px] absolute -bottom-[3px] -end-[3px] w-[14px] h-[14px] border border-newTableHeader"
                alt=""
              />
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-[6px]">
              <div className="flex items-center gap-[8px] min-w-0">
                <span className="flex-1 truncate text-[14px] text-newTextColor">
                  {channel.name}
                </span>
                <span className="text-[13px] tabular-nums text-newTableText whitespace-nowrap">
                  <span className="text-newTextColor font-[600]">
                    {formatNumber(channel.published)}
                  </span>
                  {!!channel.failed && (
                    <span className="text-red-500">
                      {' · '}
                      {formatNumber(channel.failed)}{' '}
                      {t('analytics_overview_failed_short', 'failed')}
                    </span>
                  )}
                  {!!channel.scheduled && (
                    <span>
                      {' · '}
                      {formatNumber(channel.scheduled)}{' '}
                      {t('analytics_overview_scheduled_short', 'scheduled')}
                    </span>
                  )}
                </span>
              </div>
              <div
                role="img"
                aria-label={`${channel.name}: ${summary}`}
                data-tooltip-id="tooltip"
                data-tooltip-content={summary}
                className="flex h-[6px] w-full gap-[2px] rounded-full bg-newTableBorder overflow-hidden"
              >
                {!!channel.published && (
                  <div
                    className="h-full rounded-full bg-btnPrimary"
                    style={{ width: `${(channel.published / max) * 100}%` }}
                  />
                )}
                {!!channel.failed && (
                  <div
                    className="h-full rounded-full bg-red-500"
                    style={{ width: `${(channel.failed / max) * 100}%` }}
                  />
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

interface BestTimesData {
  timezone: string;
  basis: 'engagement' | 'publish_count';
  posts: number;
  required: number;
  bestDays: Array<{ weekday: number; score: number; posts: number }>;
  bestHours: Array<{ hour: number; score: number; posts: number }>;
  heatmap: number[][];
  counts: number[][];
}

const useAnalyticsBestTimes = (days: Range) => {
  const fetch = useFetch();
  const timezone = getTimezone();
  const load = useCallback(async (path: string) => {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error('best times');
    }
    return (await response.json()) as BestTimesData;
  }, []);
  return useSWR(
    `/analytics/best-times?days=${days}&timezone=${encodeURIComponent(
      timezone
    )}`,
    load,
    swrOptions
  );
};

// weeks start on Monday in the grid
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const Heatmap: FC<{
  values: number[][];
  caption: string;
  label: (weekday: number, hour: number) => string;
}> = ({ values, caption, label }) => {
  const t = useT();
  const max = Math.max(0, ...values.flat());
  return (
    <div className="overflow-x-auto -mx-[4px] px-[4px]">
      <table className="w-full min-w-[420px] border-separate border-spacing-[2px] table-fixed">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="w-[36px]">
              <span className="sr-only">
                {t('analytics_overview_day', 'Day')}
              </span>
            </th>
            {values[0].map((_, hour) => (
              <th
                key={hour}
                scope="col"
                className="text-[10px] font-[400] text-newTableText text-center"
              >
                {hour % 6 === 0 ? (
                  hour
                ) : (
                  <span className="sr-only">{hour}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WEEK_ORDER.map((weekday) => (
            <tr key={weekday}>
              <th
                scope="row"
                className="text-[11px] font-[400] text-newTableText text-start pe-[4px]"
              >
                {weekdayName(weekday)}
              </th>
              {values[weekday].map((value, hour) => {
                const text = label(weekday, hour);
                return (
                  <td
                    key={hour}
                    data-tooltip-id="tooltip"
                    data-tooltip-content={text}
                    className="h-[16px] p-0 rounded-[3px] bg-newTableBorder relative"
                  >
                    {!!value && max > 0 && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 rounded-[3px] bg-btnPrimary"
                        style={{ opacity: 0.2 + 0.8 * (value / max) }}
                      />
                    )}
                    <span className="sr-only">{text}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const BestTimes: FC<{ data: OverviewData; days: Range }> = ({ data, days }) => {
  const t = useT();
  const { data: best } = useAnalyticsBestTimes(days);
  const fromEngagement = best?.basis === 'engagement';

  if (fromEngagement && best) {
    const times = (score: number) =>
      t('analytics_best_times_score', '{{score}}× typical', {
        score: score.toFixed(1),
      });
    return (
      <div className="flex flex-col gap-[16px]">
        <dl className="grid grid-cols-2 gap-[12px]">
          <div className="flex flex-col gap-[4px]">
            <dt className="text-[12px] text-newTableText">
              {t('analytics_overview_best_days', 'Best days')}
            </dt>
            <dd className="text-[14px] text-newTextColor font-[500]">
              {best.bestDays.length
                ? best.bestDays
                    .map((d) => `${weekdayName(d.weekday)} (${times(d.score)})`)
                    .join(', ')
                : t('analytics_best_times_none', 'Not enough posts per day yet')}
            </dd>
          </div>
          <div className="flex flex-col gap-[4px]">
            <dt className="text-[12px] text-newTableText">
              {t('analytics_overview_best_hours', 'Best hours')}
            </dt>
            <dd className="text-[14px] text-newTextColor font-[500]">
              {best.bestHours.length
                ? best.bestHours
                    .map((h) => `${hourName(h.hour)} (${times(h.score)})`)
                    .join(', ')
                : t('analytics_best_times_none', 'Not enough posts per day yet')}
            </dd>
          </div>
        </dl>
        <Heatmap
          values={best.heatmap}
          caption={t(
            'analytics_best_times_heatmap_caption',
            'Average engagement by weekday and hour ({{timezone}})',
            { timezone: best.timezone }
          )}
          label={(weekday, hour) =>
            t(
              'analytics_best_times_cell',
              '{{day}} {{hour}}: {{posts}} posts, {{score}}× typical engagement',
              {
                day: weekdayName(weekday, 'dddd'),
                hour: hourName(hour),
                posts: best.counts[weekday][hour],
                score: best.heatmap[weekday][hour].toFixed(1),
              }
            )
          }
        />
        <p className="text-[12px] text-newTableText">
          {t(
            'analytics_best_times_engagement_note',
            'Based on {{count}} posts with engagement data. 1× is a typical post on its channel. Times are in {{timezone}}.',
            { count: best.posts, timezone: best.timezone }
          )}
        </p>
      </div>
    );
  }

  const bestDays = topIndexes(data.byWeekday, 3);
  const bestHours = topIndexes(data.byHour, 3);

  if (!data.totals.published) {
    return (
      <p className="text-[13px] text-newTableText">
        {t(
          'analytics_overview_no_published',
          'Nothing was published in this range yet. Your best days and hours will show here.'
        )}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <dl className="grid grid-cols-2 gap-[12px]">
        <div className="flex flex-col gap-[4px]">
          <dt className="text-[12px] text-newTableText">
            {t('analytics_overview_best_days', 'Best days')}
          </dt>
          <dd className="text-[14px] text-newTextColor font-[500]">
            {bestDays
              .map((d) => `${weekdayName(d.index)} (${formatNumber(d.value)})`)
              .join(', ')}
          </dd>
        </div>
        <div className="flex flex-col gap-[4px]">
          <dt className="text-[12px] text-newTableText">
            {t('analytics_overview_best_hours', 'Best hours')}
          </dt>
          <dd className="text-[14px] text-newTextColor font-[500]">
            {bestHours
              .map((h) => `${hourName(h.index)} (${formatNumber(h.value)})`)
              .join(', ')}
          </dd>
        </div>
      </dl>
      <Heatmap
        values={data.heatmap}
        caption={t(
          'analytics_overview_heatmap_caption',
          'Published posts by weekday and hour ({{timezone}})',
          { timezone: data.timezone }
        )}
        label={(weekday, hour) =>
          `${weekdayName(weekday, 'dddd')} ${hourName(hour)}: ${
            data.heatmap[weekday][hour]
          }`
        }
      />
      <p className="text-[12px] text-newTableText">
        {t(
          'analytics_best_times_publish_note',
          'Based on when your {{published}} posts went out. Recommendations switch to engagement once {{required}} posts have metrics ({{count}} so far); metrics are collected daily. Times are in {{timezone}}.',
          {
            published: data.totals.published,
            required: best?.required || 10,
            count: best?.posts || 0,
            timezone: data.timezone,
          }
        )}
      </p>
    </div>
  );
};

const Engagement: FC<{ days: Range }> = ({ days }) => {
  const t = useT();
  const { data, isLoading, error } = useAnalyticsEngagement(days);

  const withData = useMemo(
    () => data?.channels.filter((c) => c.status === 'ok').length || 0,
    [data]
  );

  if (isLoading && !data) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[12px]">
        {[0, 1, 2, 3].map((p) => (
          <Skeleton key={p} className="h-[64px]" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-[13px] text-newTableText">
        {t(
          'analytics_overview_engagement_error',
          'Engagement totals could not be loaded right now.'
        )}
      </p>
    );
  }

  if (!data.channels.length) {
    return (
      <p className="text-[13px] text-newTableText">
        {t(
          'analytics_overview_engagement_unsupported',
          'None of your active channels share engagement data. Post counts above still cover every channel.'
        )}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-[12px]" aria-busy={isLoading}>
      {data.metrics.length ? (
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-[12px]">
          {data.metrics.slice(0, 8).map((metric) => (
            <div
              key={metric.label}
              className="flex flex-col gap-[4px] rounded-[10px] bg-newBgColorInner border border-newTableBorder px-[12px] py-[10px] min-w-0"
            >
              <dt className="text-[12px] text-newTableText truncate">
                {metric.label}
              </dt>
              <dd className="text-[20px] font-[600] text-newTextColor tabular-nums">
                {formatNumber(Math.round(metric.total))}
              </dd>
              <dd className="text-[11px] text-newTableText">
                {t('analytics_overview_metric_channels', '{{count}} channels', {
                  count: metric.channels,
                })}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[13px] text-newTableText">
          {t(
            'analytics_overview_engagement_empty',
            'Your channels have no engagement data for this range yet.'
          )}
        </p>
      )}
      <p className="text-[12px] text-newTableText">
        {t(
          'analytics_overview_engagement_coverage',
          'From {{withData}} of {{total}} channels that share analytics.',
          { withData, total: data.channels.length }
        )}
        {data.channels.some((c) => c.status === 'unavailable') &&
          ' ' +
            t(
              'analytics_overview_engagement_partial',
              'Some channels did not respond and are left out.'
            )}
      </p>
    </div>
  );
};

const SECTIONS = ['overview', 'trends', 'top', 'insights', 'reports'] as const;
type Section = (typeof SECTIONS)[number];

const SectionTabs: FC<{
  value: Section;
  onChange: (value: Section) => void;
}> = ({ value, onChange }) => {
  const t = useT();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const labels: Record<Section, string> = {
    overview: t('analytics_section_overview', 'Overview'),
    trends: t('analytics_section_trends', 'Trends'),
    top: t('analytics_section_top_posts', 'Top posts'),
    insights: t('analytics_section_insights', 'Insights'),
    reports: t('analytics_section_reports', 'Reports'),
  };

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const forward = document.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      const backward = document.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      const index = SECTIONS.indexOf(value);
      const next =
        e.key === forward
          ? (index + 1) % SECTIONS.length
          : e.key === backward
          ? (index - 1 + SECTIONS.length) % SECTIONS.length
          : e.key === 'Home'
          ? 0
          : e.key === 'End'
          ? SECTIONS.length - 1
          : -1;
      if (next === -1) {
        return;
      }
      e.preventDefault();
      onChange(SECTIONS[next]);
      refs.current[next]?.focus();
    },
    [value, onChange]
  );

  return (
    <div
      role="tablist"
      aria-label={t('analytics_sections', 'Analytics sections')}
      onKeyDown={onKeyDown}
      className="flex gap-[4px] border-b border-newTableBorder overflow-x-auto scrollbar-none -mx-[4px] px-[4px]"
    >
      {SECTIONS.map((section, index) => (
        <button
          key={section}
          ref={(el) => {
            refs.current[index] = el;
          }}
          id={`analytics-tab-${section}`}
          type="button"
          role="tab"
          aria-selected={value === section}
          aria-controls={`analytics-panel-${section}`}
          tabIndex={value === section ? 0 : -1}
          onClick={() => onChange(section)}
          className={clsx(
            'relative h-[40px] px-[12px] text-[14px] font-[500] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary rounded-t-[8px]',
            value === section
              ? 'text-newTextColor'
              : 'text-textItemBlur hover:text-newTextColor'
          )}
        >
          {labels[section]}
          {value === section && (
            <span
              aria-hidden="true"
              className="absolute inset-x-[8px] -bottom-[1px] h-[2px] rounded-full bg-btnPrimary"
            />
          )}
        </button>
      ))}
    </div>
  );
};

export const AnalyticsOverview: FC = () => {
  const t = useT();
  const [savedRange, setSavedRange] = useCookie('analyticsOverviewRange', '7');
  const days = (RANGES as readonly number[]).includes(+savedRange)
    ? (+savedRange as Range)
    : 7;
  const { data, isLoading, error } = useAnalyticsOverview(days);
  const loading = isLoading && !data;

  const setDays = useCallback((value: Range) => {
    setSavedRange(String(value), { days: 365 });
  }, []);

  const [savedSection, setSavedSection] = useCookie(
    'analyticsSection',
    'overview'
  );
  const section = (SECTIONS as readonly string[]).includes(savedSection)
    ? (savedSection as Section)
    : 'overview';
  const setSection = useCallback((value: Section) => {
    setSavedSection(value, { days: 365 });
  }, []);

  return (
    <div className="bg-newBgColorInner p-[20px] mobile:p-[12px] flex flex-col gap-[16px]">
      <div className="flex items-center gap-[12px] flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <h2 className="text-[20px] font-[500]">
            {t('analytics_workspace_title', 'Workspace analytics')}
          </h2>
          <p className="text-[13px] text-newTableText">
            {t(
              'analytics_overview_subtitle',
              'Every channel in this workspace, last {{days}} days',
              { days }
            )}
          </p>
        </div>
        <RangePicker value={days} onChange={setDays} />
      </div>

      <SectionTabs value={section} onChange={setSection} />

      {section === 'trends' && (
        <div role="tabpanel" id="analytics-panel-trends" aria-labelledby="analytics-tab-trends">
          <TrendsSection days={days} />
        </div>
      )}
      {section === 'top' && (
        <div role="tabpanel" id="analytics-panel-top" aria-labelledby="analytics-tab-top">
          <TopPostsSection days={days} />
        </div>
      )}
      {section === 'insights' && (
        <div role="tabpanel" id="analytics-panel-insights" aria-labelledby="analytics-tab-insights">
          <InsightsSection days={days} />
        </div>
      )}
      {section === 'reports' && (
        <div role="tabpanel" id="analytics-panel-reports" aria-labelledby="analytics-tab-reports">
          <ReportsSection days={days} />
        </div>
      )}

      {section !== 'overview' ? null : error && !data ? (
        <p role="alert" className="text-[13px] text-red-500">
          {t(
            'analytics_overview_error',
            'The overview could not be loaded. Please try again.'
          )}
        </p>
      ) : (
        <div
          role="tabpanel"
          id="analytics-panel-overview"
          aria-labelledby="analytics-tab-overview"
          className="flex flex-col gap-[16px]"
        >
          <div
            className="grid grid-cols-3 mobile:grid-cols-1 gap-[12px]"
            aria-live="polite"
            aria-busy={loading}
          >
            <StatTile
              label={t('analytics_overview_published', 'Published')}
              hint={t('analytics_overview_last_days', 'Last {{days}} days', {
                days,
              })}
              value={data?.totals.published}
              loading={loading}
            />
            <StatTile
              label={t('analytics_overview_scheduled', 'Scheduled')}
              hint={t('analytics_overview_next_days', 'Next {{days}} days', {
                days,
              })}
              value={data?.totals.scheduled}
              loading={loading}
            />
            <StatTile
              label={t('analytics_overview_failed', 'Failed')}
              hint={t('analytics_overview_last_days', 'Last {{days}} days', {
                days,
              })}
              value={data?.totals.failed}
              tone="danger"
              loading={loading}
            />
          </div>

          <Card
            title={t('analytics_compare_title', 'Compared with the previous {{days}} days', {
              days,
            })}
          >
            <PeriodComparisonRow days={days} />
          </Card>

          <div className="grid grid-cols-2 tablet:grid-cols-1 gap-[12px]">
            <Card
              title={t('analytics_overview_by_channel', 'By channel')}
              subtitle={t(
                'analytics_overview_by_channel_hint',
                'Published and failed in the last {{days}} days',
                { days }
              )}
            >
              {loading || !data ? (
                <div className="flex flex-col gap-[12px]">
                  {[0, 1, 2].map((p) => (
                    <Skeleton key={p} className="h-[32px]" />
                  ))}
                </div>
              ) : (
                <ChannelBreakdown channels={data.channels} />
              )}
            </Card>
            <Card
              title={t('analytics_overview_best_times', 'Best days and hours')}
              subtitle={t(
                'analytics_best_times_hint',
                'When your posts do best, from their engagement'
              )}
            >
              {loading || !data ? (
                <Skeleton className="h-[180px]" />
              ) : (
                <BestTimes data={data} days={days} />
              )}
            </Card>
          </div>

          <Card
            title={t('analytics_overview_engagement', 'Engagement')}
            subtitle={t(
              'analytics_overview_engagement_hint',
              'Totals across channels whose platform shares analytics'
            )}
          >
            <Engagement days={days} />
          </Card>
        </div>
      )}
    </div>
  );
};
