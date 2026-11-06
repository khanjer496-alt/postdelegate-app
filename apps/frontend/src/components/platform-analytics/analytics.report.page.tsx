'use client';

import React, { FC, useCallback, useEffect } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { getTimezone } from '@gitroom/frontend/components/layout/set.timezone';
import {
  formatNumber,
  hourName,
  isWebUrl,
  weekdayName,
} from '@gitroom/frontend/components/platform-analytics/analytics.ui';
import {
  LineChart,
  TrendsData,
} from '@gitroom/frontend/components/platform-analytics/analytics.trends';
import {
  InsightGroup,
  InsightsData,
  useInsightLabels,
} from '@gitroom/frontend/components/platform-analytics/analytics.insights';

interface ReportPost {
  id: string;
  channel: { id: string; name: string; identifier: string };
  title: string | null;
  url: string | null;
  publishedAt: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  engagement: number | null;
}

interface ReportData {
  brand: { name: string; logoUrl: string | null };
  from: string;
  to: string;
  generatedAt: string;
  trends: TrendsData;
  topPosts: ReportPost[];
  insights: InsightsData;
  bestTimes: {
    timezone: string;
    basis: 'engagement' | 'publish_count';
    posts: number;
    required: number;
    bestDays: Array<{ weekday: number; score: number }>;
    bestHours: Array<{ hour: number; score: number }>;
  };
}

const useReportData = (from: string, to: string) => {
  const fetch = useFetch();
  const timezone = getTimezone();
  const load = useCallback(async (path: string) => {
    const response = await fetch(path);
    if (!response.ok) {
      throw Object.assign(new Error('report'), { status: response.status });
    }
    return (await response.json()) as ReportData;
  }, []);
  return useSWR(
    from && to
      ? `/analytics/reports/data?from=${encodeURIComponent(
          from
        )}&to=${encodeURIComponent(to)}&timezone=${encodeURIComponent(
          timezone
        )}`
      : null,
    load,
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );
};

const value = (number: number | null) =>
  number === null ? '–' : formatNumber(number);

// The printed report is a client document: it keeps a fixed light palette in
// both app themes instead of the theme tokens, and avoids page breaks inside
// sections.
const Section: FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section className="flex flex-col gap-[12px] break-inside-avoid">
    <h2 className="text-[16px] font-[700] text-[#111118] border-b border-[#e7e5ef] pb-[6px]">
      {title}
    </h2>
    {children}
  </section>
);

const InsightTable: FC<{
  title: string;
  groups: InsightGroup[];
  labels?: Record<string, string>;
}> = ({ title, groups, labels = {} }) => {
  const t = useT();
  if (!groups.length) {
    return null;
  }
  return (
    <table className="w-full text-[12px] break-inside-avoid">
      <caption className="text-start text-[13px] font-[600] text-[#111118] pb-[6px]">
        {title}
      </caption>
      <thead>
        <tr className="text-[#6b6b78] border-b border-[#e7e5ef]">
          <th scope="col" className="text-start font-[500] py-[4px]">
            {t('analytics_report_group', 'Group')}
          </th>
          <th scope="col" className="text-end font-[500] py-[4px]">
            {t('analytics_report_posts', 'Posts')}
          </th>
          <th scope="col" className="text-end font-[500] py-[4px]">
            {t('analytics_report_avg_engagement', 'Avg. engagement')}
          </th>
          <th scope="col" className="text-end font-[500] py-[4px]">
            {t('analytics_report_vs_typical', 'vs typical')}
          </th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <tr key={group.key} className="border-b border-[#f0eff5]">
            <td className="py-[4px] pe-[8px]">{labels[group.key] || group.label}</td>
            <td className="py-[4px] text-end tabular-nums">{group.posts}</td>
            <td className="py-[4px] text-end tabular-nums">
              {value(group.avgEngagement)}
            </td>
            <td className="py-[4px] text-end tabular-nums">
              {group.score === null ? '–' : `${group.score.toFixed(1)}×`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export const AnalyticsReportPage: FC<{ from: string; to: string }> = ({
  from,
  to,
}) => {
  const t = useT();
  const labels = useInsightLabels();
  const { data, error, isLoading } = useReportData(from, to);

  useEffect(() => {
    if (data?.brand.name) {
      document.title = `${data.brand.name} · ${dayjs(data.from).format(
        'MMM D'
      )} – ${dayjs(data.to).format('MMM D, YYYY')}`;
    }
  }, [data]);

  const compareLabels: Record<string, string> = {
    followers: t('analytics_compare_followers', 'Followers gained'),
    published: t('analytics_compare_published', 'Posts published'),
    engagement: t('analytics_compare_engagement', 'Engagement'),
    views: t('analytics_compare_views', 'Views'),
  };

  return (
    <div className="min-h-screen bg-[#ececf2] print:bg-white text-[#111118] py-[24px] print:py-0 px-[16px] print:px-0">
      <style>{`@page { size: A4; margin: 14mm; } @media print { html, body { background: #fff !important; } }`}</style>
      <div className="max-w-[860px] mx-auto flex items-center gap-[10px] mb-[16px] print:hidden">
        <Link
          href="/analytics"
          className="h-[36px] px-[14px] rounded-[8px] bg-white border border-[#d9d7e3] text-[13px] font-[500] inline-flex items-center"
        >
          {t('analytics_report_back', 'Back to analytics')}
        </Link>
        <div className="flex-1" />
        <button
          type="button"
          disabled={!data}
          onClick={() => window.print()}
          className="h-[36px] px-[16px] rounded-[8px] bg-[#5b3fe6] text-white text-[13px] font-[600] disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-[#5b3fe6] focus-visible:ring-offset-2"
        >
          {t('analytics_report_save_pdf', 'Save as PDF')}
        </button>
      </div>

      <article className="max-w-[860px] mx-auto bg-white rounded-[16px] print:rounded-none shadow-[0_1px_3px_rgba(0,0,0,0.08)] print:shadow-none p-[40px] mobile:p-[20px] print:p-0 flex flex-col gap-[28px]">
        {!from || !to ? (
          <p className="text-[14px]">
            {t(
              'analytics_report_choose_range',
              'Choose a date range on the Analytics page to build a report.'
            )}
          </p>
        ) : error ? (
          <p role="alert" className="text-[14px] text-[#b42318]">
            {(error as { status?: number }).status === 402
              ? t(
                  'analytics_reports_upgrade',
                  'White-label PDF reports and scheduled emails are part of the Pro and Ultimate plans.'
                )
              : t(
                  'analytics_report_error',
                  'The report could not be built. Check the date range and try again.'
                )}
          </p>
        ) : isLoading || !data ? (
          <div aria-busy="true" className="flex flex-col gap-[16px]">
            {[0, 1, 2].map((p) => (
              <div
                key={p}
                className="h-[120px] rounded-[12px] bg-[#f3f2f8] animate-pulse"
              />
            ))}
          </div>
        ) : (
          <>
            <header className="flex items-center gap-[16px] flex-wrap">
              {!!data.brand.logoUrl && (
                <img
                  src={data.brand.logoUrl}
                  alt=""
                  className="h-[48px] max-w-[180px] object-contain"
                />
              )}
              <div className="flex-1 min-w-[200px]">
                <p className="text-[13px] text-[#6b6b78]">{data.brand.name}</p>
                <h1 className="text-[24px] font-[800] tracking-tight leading-tight">
                  {t('analytics_report_title', 'Social media report')}
                </h1>
                <p className="text-[13px] text-[#6b6b78]">
                  {dayjs(data.from).format('MMMM D, YYYY')} –{' '}
                  {dayjs(data.to).format('MMMM D, YYYY')}
                </p>
              </div>
            </header>

            <Section title={t('analytics_report_summary', 'Summary')}>
              <dl className="grid grid-cols-4 mobile:grid-cols-2 gap-[10px]">
                {data.trends.comparison.map((item) => (
                  <div
                    key={item.key}
                    className="rounded-[10px] border border-[#e7e5ef] bg-[#faf9fd] px-[12px] py-[10px]"
                  >
                    <dt className="text-[11px] text-[#6b6b78]">
                      {compareLabels[item.key]}
                    </dt>
                    <dd className="text-[20px] font-[700] tabular-nums">
                      {value(item.current)}
                    </dd>
                    <dd
                      className={clsx(
                        'text-[11px] font-[600]',
                        item.change === null
                          ? 'text-[#6b6b78]'
                          : item.change >= 0
                          ? 'text-[#2f7a00]'
                          : 'text-[#b42318]'
                      )}
                    >
                      {item.change === null
                        ? t('analytics_report_no_previous', 'No earlier data')
                        : t('analytics_report_change', '{{sign}}{{change}}% vs previous period', {
                            sign: item.change >= 0 ? '+' : '−',
                            change: Math.abs(item.change),
                          })}
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>

            <Section title={t('analytics_trends_followers', 'Follower growth')}>
              {data.trends.followers.channels.length ? (
                <>
                  <LineChart
                    print
                    height={160}
                    dates={data.trends.followers.dates}
                    values={data.trends.followers.total}
                    label={t('analytics_trends_total_followers', 'Total followers')}
                  />
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="text-[#6b6b78] border-b border-[#e7e5ef]">
                        <th scope="col" className="text-start font-[500] py-[4px]">
                          {t('analytics_report_channel', 'Channel')}
                        </th>
                        <th scope="col" className="text-end font-[500] py-[4px]">
                          {t('analytics_report_followers', 'Followers')}
                        </th>
                        <th scope="col" className="text-end font-[500] py-[4px]">
                          {t('analytics_report_gained', 'Gained')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.trends.followers.channels.map((channel) => (
                        <tr key={channel.id} className="border-b border-[#f0eff5]">
                          <td className="py-[4px]">{channel.name}</td>
                          <td className="py-[4px] text-end tabular-nums">
                            {value(channel.current)}
                          </td>
                          <td className="py-[4px] text-end tabular-nums">
                            {channel.gained === null
                              ? '–'
                              : `${channel.gained >= 0 ? '+' : '−'}${formatNumber(
                                  Math.abs(channel.gained)
                                )}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p className="text-[13px] text-[#6b6b78]">
                  {t(
                    'analytics_report_no_followers',
                    'No follower history was recorded in this range.'
                  )}
                </p>
              )}
            </Section>

            <Section title={t('analytics_top_posts_title', 'Top posts')}>
              {data.topPosts.length ? (
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-[#6b6b78] border-b border-[#e7e5ef]">
                      <th scope="col" className="text-start font-[500] py-[4px]">
                        {t('analytics_top_posts_post', 'Post')}
                      </th>
                      <th scope="col" className="text-end font-[500] py-[4px]">
                        {t('analytics_top_posts_views', 'Views')}
                      </th>
                      <th scope="col" className="text-end font-[500] py-[4px]">
                        {t('analytics_top_posts_likes', 'Likes')}
                      </th>
                      <th scope="col" className="text-end font-[500] py-[4px]">
                        {t('analytics_top_posts_comments', 'Comments')}
                      </th>
                      <th scope="col" className="text-end font-[500] py-[4px]">
                        {t('analytics_top_posts_shares', 'Shares')}
                      </th>
                      <th scope="col" className="text-end font-[500] py-[4px]">
                        {t('analytics_top_posts_engagement', 'Engagement')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topPosts.map((post) => (
                      <tr key={post.id} className="border-b border-[#f0eff5] align-top break-inside-avoid">
                        <td className="py-[6px] pe-[8px]">
                          <div className="line-clamp-2">
                            {isWebUrl(post.url) ? (
                              <a href={post.url} className="text-[#111118] underline decoration-[#d9d7e3]">
                                {post.title ||
                                  t('analytics_top_posts_untitled', 'Post without text')}
                              </a>
                            ) : (
                              post.title ||
                              t('analytics_top_posts_untitled', 'Post without text')
                            )}
                          </div>
                          <div className="text-[11px] text-[#6b6b78]">
                            {post.channel.name} ·{' '}
                            {dayjs(post.publishedAt).format('MMM D, YYYY')}
                          </div>
                        </td>
                        <td className="py-[6px] text-end tabular-nums">{value(post.views)}</td>
                        <td className="py-[6px] text-end tabular-nums">{value(post.likes)}</td>
                        <td className="py-[6px] text-end tabular-nums">{value(post.comments)}</td>
                        <td className="py-[6px] text-end tabular-nums">{value(post.shares)}</td>
                        <td className="py-[6px] text-end tabular-nums font-[600]">
                          {value(post.engagement)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-[13px] text-[#6b6b78]">
                  {t(
                    'analytics_report_no_posts',
                    'No post metrics were recorded in this range.'
                  )}
                </p>
              )}
            </Section>

            <Section title={t('analytics_overview_best_times', 'Best days and hours')}>
              {data.bestTimes.basis === 'engagement' ? (
                <div className="grid grid-cols-2 gap-[12px] text-[13px]">
                  <div>
                    <p className="text-[11px] text-[#6b6b78]">
                      {t('analytics_overview_best_days', 'Best days')}
                    </p>
                    <p className="font-[600]">
                      {data.bestTimes.bestDays
                        .map((d) => `${weekdayName(d.weekday, 'dddd')} (${d.score.toFixed(1)}×)`)
                        .join(', ') || '–'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[#6b6b78]">
                      {t('analytics_overview_best_hours', 'Best hours')}
                    </p>
                    <p className="font-[600]">
                      {data.bestTimes.bestHours
                        .map((h) => `${hourName(h.hour)} (${h.score.toFixed(1)}×)`)
                        .join(', ') || '–'}
                    </p>
                  </div>
                  <p className="col-span-2 text-[11px] text-[#6b6b78]">
                    {t(
                      'analytics_best_times_engagement_note',
                      'Based on {{count}} posts with engagement data. 1× is a typical post on its channel. Times are in {{timezone}}.',
                      { count: data.bestTimes.posts, timezone: data.bestTimes.timezone }
                    )}
                  </p>
                </div>
              ) : (
                <p className="text-[13px] text-[#6b6b78]">
                  {t(
                    'analytics_report_best_times_thin',
                    'Not enough posts with engagement data in this range yet ({{count}} of {{required}} needed).',
                    { count: data.bestTimes.posts, required: data.bestTimes.required }
                  )}
                </p>
              )}
            </Section>

            {!!data.insights.posts && (
              <Section title={t('analytics_report_insights', 'Content insights')}>
                <p className="text-[12px] text-[#6b6b78]">
                  {t(
                    'analytics_report_insights_note',
                    'Based on {{count}} posts. “vs typical” compares each group with a typical post on the same channel.',
                    { count: data.insights.posts }
                  )}
                </p>
                <div className="grid grid-cols-2 mobile:grid-cols-1 gap-[20px]">
                  <InsightTable
                    title={t('analytics_insights_content_type', 'By content type')}
                    groups={data.insights.contentTypes}
                    labels={labels.contentTypes}
                  />
                  <InsightTable
                    title={t('analytics_insights_length', 'By post length')}
                    groups={data.insights.lengths}
                    labels={labels.lengths}
                  />
                  <InsightTable
                    title={t('analytics_insights_hashtags', 'Top hashtags')}
                    groups={data.insights.hashtags}
                  />
                  <InsightTable
                    title={t('analytics_insights_tags', 'By tag or campaign')}
                    groups={data.insights.tags}
                  />
                </div>
              </Section>
            )}

            <footer className="text-[11px] text-[#8a8a96] border-t border-[#e7e5ef] pt-[10px]">
              {t('analytics_report_generated', 'Generated {{date}}', {
                date: dayjs(data.generatedAt).format('MMMM D, YYYY HH:mm'),
              })}
            </footer>
          </>
        )}
      </article>
    </div>
  );
};
