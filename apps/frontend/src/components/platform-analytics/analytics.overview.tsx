'use client';

import React, { FC, KeyboardEvent, useCallback, useMemo, useRef } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import dayjs from 'dayjs';
import useCookie from 'react-use-cookie';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';
import { getTimezone } from '@gitroom/frontend/components/layout/set.timezone';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

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

const swrOptions = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  refreshWhenHidden: false,
  refreshWhenOffline: false,
  keepPreviousData: true,
};

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

const formatNumber = (value: number) =>
  new Intl.NumberFormat(undefined, {
    notation: value >= 100000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);

// 0 = Sunday, like the backend buckets
const weekdayName = (weekday: number, format: 'ddd' | 'dddd' = 'ddd') =>
  dayjs().day(weekday).format(format);

const hourName = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

const topIndexes = (values: number[], count: number) =>
  values
    .map((value, index) => ({ value, index }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .slice(0, count);

const Skeleton: FC<{ className?: string }> = ({ className }) => (
  <div
    aria-hidden="true"
    className={clsx('animate-pulse rounded-[8px] bg-newTableBorder', className)}
  />
);

const Card: FC<{
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, className, children }) => (
  <section
    className={clsx(
      'flex flex-col gap-[14px] bg-newTableHeader border border-newTableBorder rounded-[12px] p-[16px] min-w-0',
      className
    )}
  >
    <div className="flex flex-col gap-[2px]">
      <h3 className="text-[15px] font-[600] text-newTextColor">{title}</h3>
      {!!subtitle && (
        <p className="text-[13px] text-newTableText">{subtitle}</p>
      )}
    </div>
    {children}
  </section>
);

const RangePicker: FC<{ value: Range; onChange: (value: Range) => void }> = ({
  value,
  onChange,
}) => {
  const t = useT();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const labels: Record<Range, string> = {
    7: t('7_days', '7 Days'),
    30: t('30_days', '30 Days'),
    90: t('90_days', '90 Days'),
  };

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      // left and right follow the reading direction
      const forward = document.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      const backward = document.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      const step =
        e.key === forward || e.key === 'ArrowDown'
          ? 1
          : e.key === backward || e.key === 'ArrowUp'
          ? -1
          : 0;
      if (!step) {
        return;
      }
      e.preventDefault();
      const next =
        (RANGES.indexOf(value) + step + RANGES.length) % RANGES.length;
      onChange(RANGES[next]);
      refs.current[next]?.focus();
    },
    [value, onChange]
  );

  return (
    <div
      role="radiogroup"
      aria-label={t('analytics_overview_range', 'Date range')}
      onKeyDown={onKeyDown}
      className="flex p-[3px] gap-[2px] rounded-[10px] bg-btnSimple"
    >
      {RANGES.map((range, index) => (
        <button
          key={range}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === range}
          tabIndex={value === range ? 0 : -1}
          onClick={() => onChange(range)}
          className={clsx(
            'h-[32px] px-[12px] rounded-[8px] text-[13px] font-[500] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary',
            value === range
              ? 'bg-newBgColorInner text-newTextColor shadow-menu'
              : 'text-textItemBlur hover:text-newTextColor'
          )}
        >
          {labels[range]}
        </button>
      ))}
    </div>
  );
};

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

const BestTimes: FC<{ data: OverviewData }> = ({ data }) => {
  const t = useT();
  const max = Math.max(1, ...data.heatmap.flat());
  const bestDays = topIndexes(data.byWeekday, 3);
  const bestHours = topIndexes(data.byHour, 3);
  // weeks start on Monday in the grid
  const order = [1, 2, 3, 4, 5, 6, 0];

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
      <div className="overflow-x-auto -mx-[4px] px-[4px]">
        <table className="w-full min-w-[420px] border-separate border-spacing-[2px] table-fixed">
          <caption className="sr-only">
            {t(
              'analytics_overview_heatmap_caption',
              'Published posts by weekday and hour ({{timezone}})',
              { timezone: data.timezone }
            )}
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-[36px]">
                <span className="sr-only">
                  {t('analytics_overview_day', 'Day')}
                </span>
              </th>
              {data.byHour.map((_, hour) => (
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
            {order.map((weekday) => (
              <tr key={weekday}>
                <th
                  scope="row"
                  className="text-[11px] font-[400] text-newTableText text-start pe-[4px]"
                >
                  {weekdayName(weekday)}
                </th>
                {data.heatmap[weekday].map((count, hour) => {
                  const label = `${weekdayName(weekday, 'dddd')} ${hourName(
                    hour
                  )}: ${count}`;
                  return (
                    <td
                      key={hour}
                      data-tooltip-id="tooltip"
                      data-tooltip-content={label}
                      className="h-[16px] p-0 rounded-[3px] bg-newTableBorder relative"
                    >
                      {!!count && (
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 rounded-[3px] bg-btnPrimary"
                          style={{ opacity: 0.2 + 0.8 * (count / max) }}
                        />
                      )}
                      <span className="sr-only">{label}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-newTableText">
        {t('analytics_overview_timezone_note', 'Times are in {{timezone}}.', {
          timezone: data.timezone,
        })}
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

  return (
    <div className="bg-newBgColorInner p-[20px] mobile:p-[12px] flex flex-col gap-[16px]">
      <div className="flex items-center gap-[12px] flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <h2 className="text-[20px] font-[500]">
            {t('analytics_overview_title', 'Overview')}
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

      {error && !data ? (
        <p role="alert" className="text-[13px] text-red-500">
          {t(
            'analytics_overview_error',
            'The overview could not be loaded. Please try again.'
          )}
        </p>
      ) : (
        <>
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
                'analytics_overview_best_times_hint',
                'When your published posts went out'
              )}
            >
              {loading || !data ? (
                <Skeleton className="h-[180px]" />
              ) : (
                <BestTimes data={data} />
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
        </>
      )}
    </div>
  );
};
