'use client';

import React, { FC, useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  Card,
  formatNumber,
  HistoryEmpty,
  Range,
  Skeleton,
  swrOptions,
} from '@gitroom/frontend/components/platform-analytics/analytics.ui';

export interface InsightGroup {
  key: string;
  label: string;
  color?: string;
  posts: number;
  avgEngagement: number | null;
  avgViews: number | null;
  score: number | null;
}

export interface InsightsData {
  posts: number;
  contentTypes: InsightGroup[];
  lengths: InsightGroup[];
  hashtags: InsightGroup[];
  tags: InsightGroup[];
}

const useAnalyticsInsights = (days: Range) => {
  const fetch = useFetch();
  const load = useCallback(async (path: string) => {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error('insights');
    }
    return (await response.json()) as InsightsData;
  }, []);
  return useSWR(`/analytics/insights?days=${days}`, load, swrOptions);
};

// Rows of one breakdown: the bar is the engagement relative to each
// channel's typical post, so channels of any size compare fairly
export const InsightList: FC<{
  groups: InsightGroup[];
  labels?: Record<string, string>;
  empty: string;
}> = ({ groups, labels = {}, empty }) => {
  const t = useT();
  const max = Math.max(1, ...groups.map((group) => group.score || 0));
  if (!groups.length) {
    return <p className="text-[13px] text-newTableText">{empty}</p>;
  }
  return (
    <ul className="flex flex-col gap-[12px]">
      {groups.map((group) => {
        const label = labels[group.key] || group.label;
        const score = group.score ?? 0;
        const summary = t(
          'analytics_insights_row',
          '{{posts}} posts, {{engagement}} average engagement, {{score}}× typical',
          {
            posts: group.posts,
            engagement:
              group.avgEngagement === null
                ? '–'
                : formatNumber(group.avgEngagement),
            score: score.toFixed(1),
          }
        );
        return (
          <li key={group.key} className="flex flex-col gap-[6px] min-w-0">
            <div className="flex items-center gap-[8px] min-w-0">
              {!!group.color && (
                <span
                  aria-hidden="true"
                  className="w-[10px] h-[10px] rounded-full shrink-0"
                  style={{ backgroundColor: group.color }}
                />
              )}
              <span className="flex-1 truncate text-[14px] text-newTextColor">
                {label}
              </span>
              <span className="text-[12px] text-newTableText whitespace-nowrap tabular-nums">
                {t('analytics_insights_posts', '{{count}} posts', {
                  count: group.posts,
                })}
                {group.avgViews !== null &&
                  ` · ${t('analytics_insights_views', '{{views}} avg views', {
                    views: formatNumber(group.avgViews),
                  })}`}
              </span>
              <span className="w-[64px] text-end text-[13px] font-[600] tabular-nums text-newTextColor">
                {t('analytics_insights_score', '{{score}}×', {
                  score: score.toFixed(1),
                })}
              </span>
            </div>
            <div
              role="img"
              aria-label={`${label}: ${summary}`}
              data-tooltip-id="tooltip"
              data-tooltip-content={summary}
              className="relative h-[6px] w-full rounded-full bg-newTableBorder overflow-hidden"
            >
              <div
                className="h-full rounded-full bg-btnPrimary"
                style={{ width: `${(score / max) * 100}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export const useInsightLabels = () => {
  const t = useT();
  return {
    contentTypes: {
      video: t('analytics_insights_type_video', 'Video'),
      carousel: t('analytics_insights_type_carousel', 'Carousel'),
      image: t('analytics_insights_type_image', 'Image'),
      text: t('analytics_insights_type_text', 'Text only'),
    },
    lengths: {
      short: t('analytics_insights_length_short', 'Up to 80 characters'),
      medium: t('analytics_insights_length_medium', '81 to 280 characters'),
      long: t('analytics_insights_length_long', '281 to 1,000 characters'),
      very_long: t('analytics_insights_length_very_long', 'Over 1,000 characters'),
    },
  };
};

export const InsightsSection: FC<{ days: Range }> = ({ days }) => {
  const t = useT();
  const labels = useInsightLabels();
  const { data, isLoading, error } = useAnalyticsInsights(days);

  if (error && !data) {
    return (
      <p role="alert" className="text-[13px] text-red-500">
        {t(
          'analytics_insights_error',
          'Insights could not be loaded. Please try again.'
        )}
      </p>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="grid grid-cols-2 tablet:grid-cols-1 gap-[12px]">
        {[0, 1, 2, 3].map((p) => (
          <Skeleton key={p} className="h-[180px]" />
        ))}
      </div>
    );
  }

  if (!data?.posts) {
    return (
      <HistoryEmpty>
        {t(
          'analytics_insights_empty',
          'Insights compare your posts by format, length, hashtags and tags. They start once posts published through PostDelegate have their first daily metrics.'
        )}
      </HistoryEmpty>
    );
  }

  return (
    <div className="flex flex-col gap-[12px]">
      <p className="text-[13px] text-newTableText">
        {t(
          'analytics_insights_basis',
          'Based on {{count}} posts published through PostDelegate in the last {{days}} days. 1× is a typical post on its channel; higher is better.',
          { count: data.posts, days }
        )}
      </p>
      <div className="grid grid-cols-2 tablet:grid-cols-1 gap-[12px]">
        <Card
          title={t('analytics_insights_content_type', 'By content type')}
          subtitle={t(
            'analytics_insights_content_type_hint',
            'From the media attached to each post'
          )}
        >
          <InsightList
            groups={data.contentTypes}
            labels={labels.contentTypes}
            empty={t('analytics_insights_none', 'Not enough posts yet.')}
          />
        </Card>
        <Card
          title={t('analytics_insights_length', 'By post length')}
          subtitle={t(
            'analytics_insights_length_hint',
            'Characters of text, without formatting'
          )}
        >
          <InsightList
            groups={data.lengths}
            labels={labels.lengths}
            empty={t('analytics_insights_none', 'Not enough posts yet.')}
          />
        </Card>
        <Card
          title={t('analytics_insights_hashtags', 'Top hashtags')}
          subtitle={t(
            'analytics_insights_hashtags_hint',
            'The hashtags you used most and how those posts did'
          )}
        >
          <InsightList
            groups={data.hashtags}
            empty={t(
              'analytics_insights_hashtags_empty',
              'None of these posts used hashtags.'
            )}
          />
        </Card>
        <Card
          title={t('analytics_insights_tags', 'By tag or campaign')}
          subtitle={t(
            'analytics_insights_tags_hint',
            'The tags you add to posts in the calendar'
          )}
        >
          <InsightList
            groups={data.tags}
            empty={t(
              'analytics_insights_tags_empty',
              'Tag posts in the calendar to compare campaigns here.'
            )}
          />
        </Card>
      </div>
    </div>
  );
};
