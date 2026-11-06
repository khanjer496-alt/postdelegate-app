'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  Card,
  ChannelAvatar,
  formatNumber,
  HistoryEmpty,
  isWebUrl,
  Range,
  Skeleton,
  swrOptions,
  useCsvDownload,
} from '@gitroom/frontend/components/platform-analytics/analytics.ui';

type Sort = 'engagement' | 'views' | 'likes' | 'comments' | 'shares' | 'date';
type Order = 'asc' | 'desc';

interface TopPostChannel {
  id: string;
  name: string;
  picture: string | null;
  identifier: string;
}

interface TopPost {
  id: string;
  postId: string | null;
  externalId: string;
  channel: TopPostChannel;
  title: string | null;
  url: string | null;
  publishedAt: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
  engagement: number | null;
  engagementRate: number | null;
}

interface TopPostsData {
  total: number;
  channels: TopPostChannel[];
  posts: TopPost[];
}

const PAGE = 25;

export const topPostsQuery = (
  days: Range,
  sort: Sort,
  order: Order,
  integrations: string[]
) =>
  `days=${days}&sort=${sort}&order=${order}${
    integrations.length
      ? `&integrations=${encodeURIComponent(integrations.join(','))}`
      : ''
  }`;

const useTopPosts = (
  days: Range,
  sort: Sort,
  order: Order,
  integrations: string[],
  limit: number
) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error('top posts');
    }
    return (await response.json()) as TopPostsData;
  }, []);
  return useSWR(
    `/analytics/top-posts?${topPostsQuery(
      days,
      sort,
      order,
      integrations
    )}&limit=${limit}`,
    load,
    swrOptions
  );
};

const Metric: FC<{ value: number | null }> = ({ value }) => (
  <span className={clsx('tabular-nums', value === null && 'text-newTableText')}>
    {value === null ? '–' : formatNumber(value)}
  </span>
);

const PostLink: FC<{ post: TopPost }> = ({ post }) => {
  const t = useT();
  const title =
    post.title || t('analytics_top_posts_untitled', 'Post without text');
  const href = isWebUrl(post.url)
    ? post.url
    : post.postId
    ? `/p/${post.postId}?share=true`
    : '';
  if (!href) {
    return <span className="line-clamp-2 break-words">{title}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="line-clamp-2 break-words hover:underline focus-visible:underline outline-none"
    >
      {title}
      <span className="sr-only">
        {' '}
        {t('analytics_top_posts_opens_new_tab', '(opens in a new tab)')}
      </span>
    </a>
  );
};

export const TopPostsTable: FC<{
  days: Range;
  // fixed to one channel in the channel view, no filter shown
  integration?: string;
  compact?: boolean;
}> = ({ days, integration, compact = false }) => {
  const t = useT();
  const download = useCsvDownload();
  const [sort, setSort] = useState<Sort>('engagement');
  const [order, setOrder] = useState<Order>('desc');
  const [selected, setSelected] = useState<string[]>([]);
  const [limit, setLimit] = useState(compact ? 5 : PAGE);
  const integrations = integration ? [integration] : selected;
  const { data, isLoading, error } = useTopPosts(
    days,
    sort,
    order,
    integrations,
    limit
  );

  const columns: Array<{ key: Sort; label: string }> = useMemo(
    () => [
      { key: 'views', label: t('analytics_top_posts_views', 'Views') },
      { key: 'likes', label: t('analytics_top_posts_likes', 'Likes') },
      { key: 'comments', label: t('analytics_top_posts_comments', 'Comments') },
      { key: 'shares', label: t('analytics_top_posts_shares', 'Shares') },
      {
        key: 'engagement',
        label: t('analytics_top_posts_engagement', 'Engagement'),
      },
    ],
    []
  );

  const sortBy = useCallback(
    (key: Sort) => {
      if (key === sort) {
        setOrder(order === 'desc' ? 'asc' : 'desc');
      } else {
        setSort(key);
        setOrder('desc');
      }
    },
    [sort, order]
  );

  const toggleChannel = useCallback((id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  }, []);

  // a render helper, not a component, so a header keeps focus after sorting
  const sortHeader = (column: Sort, label: string, className?: string) => (
    <th
      key={column}
      scope="col"
      aria-sort={
        sort === column ? (order === 'asc' ? 'ascending' : 'descending') : 'none'
      }
      className={clsx('font-[500] py-[8px] px-[8px]', className)}
    >
      <button
        type="button"
        onClick={() => sortBy(column)}
        className={clsx(
          'inline-flex items-center gap-[4px] rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary',
          sort === column ? 'text-newTextColor' : 'hover:text-newTextColor'
        )}
      >
        {label}
        <svg
          aria-hidden="true"
          width="8"
          height="10"
          viewBox="0 0 8 10"
          className={clsx(
            sort === column ? 'opacity-100' : 'opacity-30',
            sort === column && order === 'asc' && 'rotate-180'
          )}
        >
          <path d="M4 10 0 5h8z" fill="currentColor" />
        </svg>
      </button>
    </th>
  );

  if (error && !data) {
    return (
      <p role="alert" className="text-[13px] text-red-500">
        {t(
          'analytics_top_posts_error',
          'Top posts could not be loaded. Please try again.'
        )}
      </p>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="flex flex-col gap-[8px]">
        {[0, 1, 2, 3].map((p) => (
          <Skeleton key={p} className="h-[44px]" />
        ))}
      </div>
    );
  }

  if (!data?.total && !selected.length) {
    return (
      <HistoryEmpty>
        {t(
          'analytics_top_posts_empty',
          'Post metrics are saved once a day for posts published in the last 30 days. Your top posts appear after the first daily snapshot.'
        )}
      </HistoryEmpty>
    );
  }

  return (
    <div className="flex flex-col gap-[12px]">
      {!integration && (
        <div className="flex items-center gap-[8px] flex-wrap">
          {(data?.channels.length || 0) > 1 && (
            <div
              role="group"
              aria-label={t('analytics_top_posts_filter', 'Filter by channel')}
              className="flex items-center gap-[6px] flex-wrap flex-1"
            >
              {data?.channels.map((channel) => {
                const active = selected.includes(channel.id);
                return (
                  <button
                    key={channel.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleChannel(channel.id)}
                    className={clsx(
                      'flex items-center gap-[6px] h-[32px] ps-[4px] pe-[10px] rounded-full border text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary',
                      active
                        ? 'border-btnPrimary bg-btnSimple text-newTextColor'
                        : 'border-newTableBorder text-textItemBlur hover:text-newTextColor'
                    )}
                  >
                    <ChannelAvatar
                      picture={channel.picture}
                      identifier={channel.identifier}
                      size={22}
                    />
                    <span className="max-w-[140px] truncate">{channel.name}</span>
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={() =>
              download(
                `/analytics/export/top-posts?${topPostsQuery(
                  days,
                  sort,
                  order,
                  integrations
                )}`,
                `top-posts-${days}d.csv`
              )
            }
            className="ms-auto h-[32px] px-[12px] rounded-[8px] bg-btnSimple text-btnText text-[13px] font-[500] flex items-center gap-[6px] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
          >
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16" />
            </svg>
            {t('analytics_export_csv', 'Export CSV')}
          </button>
        </div>
      )}

      <div className="overflow-x-auto -mx-[4px] px-[4px]" aria-busy={isLoading}>
        <table className="w-full min-w-[640px] text-[13px]">
          <caption className="sr-only">
            {t(
              'analytics_top_posts_caption',
              'Top posts of the last {{days}} days, sorted by {{sort}}',
              {
                days,
                sort:
                  sort === 'date'
                    ? t('analytics_top_posts_date', 'Date')
                    : columns.find((c) => c.key === sort)?.label,
              }
            )}
          </caption>
          <thead>
            <tr className="text-newTableText text-start border-b border-newTableBorder">
              <th scope="col" className="font-[500] py-[8px] pe-[8px] text-start">
                {t('analytics_top_posts_post', 'Post')}
              </th>
              {sortHeader(
                'date',
                t('analytics_top_posts_date', 'Date'),
                'text-start whitespace-nowrap'
              )}
              {columns.map((column) =>
                sortHeader(column.key, column.label, 'text-end whitespace-nowrap')
              )}
            </tr>
          </thead>
          <tbody>
            {(data?.posts || []).map((post) => (
              <tr
                key={post.id}
                className="border-b border-newTableBorder last:border-b-0 align-top"
              >
                <td className="py-[10px] pe-[8px] min-w-[220px] max-w-[360px]">
                  <div className="flex gap-[10px] items-start">
                    <ChannelAvatar
                      picture={post.channel.picture}
                      identifier={post.channel.identifier}
                      size={28}
                    />
                    <div className="min-w-0 flex flex-col gap-[2px]">
                      <div className="text-newTextColor">
                        <PostLink post={post} />
                      </div>
                      <div className="text-[12px] text-newTableText truncate">
                        {post.channel.name}
                        {post.engagementRate !== null &&
                          ` · ${t(
                            'analytics_top_posts_rate',
                            '{{rate}}% engagement rate',
                            { rate: post.engagementRate }
                          )}`}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="py-[10px] px-[8px] whitespace-nowrap text-newTableText">
                  <time dateTime={post.publishedAt}>
                    {dayjs(post.publishedAt).format('MMM D')}
                  </time>
                </td>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={clsx(
                      'py-[10px] px-[8px] text-end',
                      column.key === sort && 'font-[600] text-newTextColor'
                    )}
                  >
                    <Metric value={post[column.key as keyof TopPost] as number | null} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!data?.posts.length && (
          <p className="text-[13px] text-newTableText py-[12px]">
            {t(
              'analytics_top_posts_filtered_empty',
              'No tracked posts for these channels in this range.'
            )}
          </p>
        )}
      </div>

      {!compact && !!data && data.posts.length < data.total && limit < 200 && (
        <button
          type="button"
          onClick={() => setLimit(Math.min(200, limit + PAGE))}
          className="self-center h-[32px] px-[14px] rounded-[8px] bg-btnSimple text-btnText text-[13px] font-[500] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
        >
          {t('analytics_top_posts_more', 'Show more ({{shown}} of {{total}})', {
            shown: data.posts.length,
            total: data.total,
          })}
        </button>
      )}
    </div>
  );
};

export const TopPostsSection: FC<{ days: Range }> = ({ days }) => {
  const t = useT();
  return (
    <Card
      title={t('analytics_top_posts_title', 'Top posts')}
      subtitle={t(
        'analytics_top_posts_hint',
        'Every channel, posts published in the last {{days}} days, as last measured. Engagement is likes, comments and shares.',
        { days }
      )}
    >
      <TopPostsTable days={days} />
    </Card>
  );
};
