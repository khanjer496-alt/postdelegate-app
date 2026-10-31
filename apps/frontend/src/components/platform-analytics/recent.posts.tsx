'use client';

import React, { FC, ReactNode, useCallback, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface RecentPost {
  id: string;
  title: string;
  thumbnailUrl?: string;
  url?: string;
  publishedAt: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
}

interface RecentPostsData {
  supported: boolean;
  unavailable?: boolean;
  posts: RecentPost[];
}

type Metric = 'views' | 'likes' | 'comments' | 'shares';

const METRICS: Metric[] = ['views', 'likes', 'comments', 'shares'];

const useRecentPosts = (integrationId: string) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error('Recent posts could not be loaded');
    }
    return (await response.json()) as RecentPostsData;
  }, []);
  return useSWR(`/analytics/${integrationId}/recent-posts`, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};

const formatNumber = (value: number) =>
  new Intl.NumberFormat(undefined, {
    notation: value >= 100000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
};

const MetricIcon: FC<{ metric: Metric }> = ({ metric }) => (
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
    className="shrink-0"
  >
    {metric === 'views' && (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </>
    )}
    {metric === 'likes' && (
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z" />
    )}
    {metric === 'comments' && (
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" />
    )}
    {metric === 'shares' && (
      <>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
      </>
    )}
  </svg>
);

const Thumbnail: FC<{ src?: string }> = ({ src }) => {
  const [failed, setFailed] = useState(false);

  return (
    <div className="w-[56px] h-[74px] shrink-0 rounded-[8px] overflow-hidden bg-newTableBorder flex items-center justify-center text-newTableText">
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <svg
          aria-hidden="true"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M10 8l6 4-6 4V8z" />
        </svg>
      )}
    </div>
  );
};

const Section: FC<{ busy?: boolean; children: ReactNode }> = ({
  busy,
  children,
}) => {
  const t = useT();

  return (
    <section
      aria-labelledby="analytics-recent-posts-title"
      aria-busy={busy}
      className="flex flex-col gap-[14px] bg-newTableHeader border border-newTableBorder rounded-[12px] p-[16px] mobile:p-[12px] min-w-0"
    >
      <div className="flex flex-col gap-[2px]">
        <h3
          id="analytics-recent-posts-title"
          className="text-[15px] font-[600] text-newTextColor"
        >
          {t('analytics_recent_posts', 'Recent posts')}
        </h3>
        <p className="text-[13px] text-newTableText">
          {t(
            'analytics_recent_posts_subtitle',
            'Your latest posts on this channel, newest first.'
          )}
        </p>
      </div>
      {children}
    </section>
  );
};

const PostRow: FC<{ post: RecentPost }> = ({ post }) => {
  const t = useT();
  const labels: Record<Metric, string> = {
    views: t('analytics_recent_posts_views', 'Views'),
    likes: t('analytics_recent_posts_likes', 'Likes'),
    comments: t('analytics_recent_posts_comments', 'Comments'),
    shares: t('analytics_recent_posts_shares', 'Shares'),
  };
  const title =
    post.title || t('analytics_recent_posts_untitled', 'Untitled post');
  const date = formatDate(post.publishedAt);

  return (
    <li className="flex items-center gap-[16px] mobile:flex-col mobile:items-stretch mobile:gap-[12px] rounded-[10px] bg-newBgColorInner border border-newTableBorder p-[12px] min-w-0">
      <div className="flex items-center gap-[12px] flex-1 min-w-0">
        <Thumbnail src={post.thumbnailUrl} />
        <div className="flex flex-col gap-[4px] min-w-0">
          <p
            className="text-[14px] font-[500] text-newTextColor line-clamp-2 break-words"
            title={post.title || undefined}
          >
            {title}
          </p>
          {!!date && (
            <time
              dateTime={post.publishedAt}
              className="text-[12px] text-newTableText"
            >
              {date}
            </time>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-4 gap-[8px] shrink-0 w-[300px] xl:w-[360px] mobile:w-full">
        {METRICS.map((metric) => (
          <div key={metric} className="flex flex-col gap-[2px] min-w-0">
            <dt className="flex items-center gap-[4px] text-[11px] text-newTableText">
              <MetricIcon metric={metric} />
              <span className="truncate">{labels[metric]}</span>
            </dt>
            <dd className="text-[15px] font-[600] text-newTextColor tabular-nums">
              {typeof post[metric] === 'number' ? (
                formatNumber(post[metric] as number)
              ) : (
                <>
                  <span aria-hidden="true">-</span>
                  <span className="sr-only">
                    {t('analytics_recent_posts_not_available', 'Not available')}
                  </span>
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {post.url ? (
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 inline-flex items-center justify-center gap-[6px] h-[36px] px-[12px] rounded-[8px] text-[13px] font-[600] text-btnText bg-btnSimple hover:bg-boxHover transition-colors"
        >
          {t('analytics_recent_posts_open', 'Open')}
          <span className="sr-only">
            {t(
              'analytics_recent_posts_open_label',
              '{{title}} on the platform (opens in a new tab)',
              { title }
            )}
          </span>
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
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
          </svg>
        </a>
      ) : (
        <span className="shrink-0 w-[78px] mobile:hidden" aria-hidden="true" />
      )}
    </li>
  );
};

export const RecentPosts: FC<{ integrationId: string }> = ({
  integrationId,
}) => {
  const t = useT();
  const { data, error, isLoading, isValidating, mutate } =
    useRecentPosts(integrationId);

  if (isLoading && !data) {
    return (
      <Section busy={true}>
        <span className="sr-only" role="status">
          {t('analytics_recent_posts_loading', 'Loading recent posts')}
        </span>
        <ul aria-hidden="true" className="flex flex-col gap-[8px]">
          {[0, 1, 2].map((p) => (
            <li
              key={p}
              className="animate-pulse h-[98px] rounded-[10px] bg-newTableBorder"
            />
          ))}
        </ul>
      </Section>
    );
  }

  // the provider has no per-post list, the capability flag should have kept
  // this from rendering
  if (data && !data.supported) {
    return null;
  }

  if (error || !data || data.unavailable) {
    return (
      <Section busy={isValidating}>
        <div
          role="status"
          className="flex flex-col items-start gap-[10px] mobile:items-stretch"
        >
          <p className="text-[13px] text-newTableText">
            {t(
              'analytics_recent_posts_error',
              'Recent posts could not be loaded right now.'
            )}
          </p>
          <button
            type="button"
            onClick={() => mutate()}
            disabled={isValidating}
            className={clsx(
              'inline-flex items-center justify-center h-[36px] px-[14px] rounded-[8px] text-[13px] font-[600] text-btnText bg-btnSimple hover:bg-boxHover transition-colors',
              isValidating && 'opacity-60 cursor-wait'
            )}
          >
            {t('analytics_recent_posts_retry', 'Try again')}
          </button>
        </div>
      </Section>
    );
  }

  if (!data.posts.length) {
    return (
      <Section>
        <p className="text-[13px] text-newTableText">
          {t('analytics_recent_posts_empty', 'No posts yet')}
        </p>
      </Section>
    );
  }

  return (
    <Section>
      <ul
        className="flex flex-col gap-[8px]"
        aria-label={t('analytics_recent_posts', 'Recent posts')}
      >
        {data.posts.map((post) => (
          <PostRow key={post.id} post={post} />
        ))}
      </ul>
    </Section>
  );
};
