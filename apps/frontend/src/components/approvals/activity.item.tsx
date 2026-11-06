'use client';

import { FC, ReactNode } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { fromUtc } from '@gitroom/frontend/components/layout/set.timezone';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';
import {
  ActivityAction,
  ActivityItem,
} from '@gitroom/frontend/components/approvals/approvals.hooks';

// the color of the dot next to a history line
const tone: Partial<Record<ActivityAction, string>> = {
  APPROVED: 'bg-green-500',
  PUBLISHED: 'bg-green-500',
  CHANGES_REQUESTED: 'bg-orange-500',
  REJECTED: 'bg-newTextColor/40',
  GUARDRAIL_BLOCKED: 'bg-red-500',
  SUBMITTED: 'bg-amber-400',
};

export const useActivitySentence = () => {
  const t = useT();
  return (item: ActivityItem) => {
    const actor =
      item.actorType === 'CLIENT'
        ? [
            item.actorName || t('activity_a_client', 'A client'),
            item.actorEmail ? `(${item.actorEmail})` : '',
          ]
            .filter(Boolean)
            .join(' ')
        : item.actorType === 'AGENT'
        ? item.actorName || t('activity_an_agent', 'An AI agent')
        : item.actorType === 'SYSTEM'
        ? 'PostDelegate'
        : item.actorName || t('activity_a_teammate', 'A teammate');

    switch (item.action) {
      case 'CREATED':
        return t('activity_created', '{{actor}} created the post', { actor });
      case 'SUBMITTED':
        return t('activity_submitted', '{{actor}} sent it for review', {
          actor,
        });
      case 'APPROVED':
        return t('activity_approved', '{{actor}} approved it', { actor });
      case 'CHANGES_REQUESTED':
        return t('activity_changes_requested', '{{actor}} asked for changes', {
          actor,
        });
      case 'REJECTED':
        return t('activity_rejected', '{{actor}} rejected it', { actor });
      case 'PUBLISHED':
        return t('activity_published', 'The post was published');
      case 'LINK_CREATED':
        return t(
          'activity_link_created',
          '{{actor}} shared it with a client for approval',
          { actor }
        );
      case 'LINK_REVOKED':
        return t(
          'activity_link_revoked',
          '{{actor}} turned off a client approval link',
          { actor }
        );
      case 'LINK_VIEWED':
        return t('activity_link_viewed', 'A client opened the approval link');
      case 'GUARDRAIL_BLOCKED':
        return t(
          'activity_guardrail_blocked',
          '{{actor}} was stopped by a guardrail',
          { actor }
        );
      case 'SETTINGS_CHANGED':
        return t(
          'activity_settings_changed',
          '{{actor}} changed the approval settings',
          { actor }
        );
      default:
        return actor;
    }
  };
};

export const ActivityTime: FC<{ date: string }> = ({ date }) => {
  const value = fromUtc(date);
  return (
    <time
      dateTime={date}
      title={value.format(
        isUSCitizen() ? 'ddd, MMM D YYYY, hh:mm A' : 'ddd, D MMM YYYY, HH:mm'
      )}
      className="text-[12px] text-textItemBlur whitespace-nowrap"
    >
      {value.fromNow()}
    </time>
  );
};

export const ActivityRow: FC<{
  item: ActivityItem;
  // the workspace page names the post, the post history does not
  showPost?: boolean;
  postAction?: ReactNode;
}> = ({ item, showPost, postAction }) => {
  const t = useT();
  const sentence = useActivitySentence()(item);
  const snippet =
    showPost && item.post
      ? stripHtmlValidation('normal', item.post.content || '', false, true)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 120)
      : '';

  return (
    <li className="flex gap-[12px] py-[10px]">
      <span
        aria-hidden="true"
        className={clsx(
          'mt-[6px] shrink-0 w-[8px] h-[8px] rounded-full',
          tone[item.action] || 'bg-btnPrimary'
        )}
      />
      <div className="flex-1 min-w-0 flex flex-col gap-[4px]">
        <div className="flex flex-wrap items-baseline gap-x-[8px] gap-y-[2px]">
          <span className="text-[14px] text-newTextColor break-words">
            {sentence}
          </span>
          <ActivityTime date={item.createdAt} />
        </div>
        {!!item.comment && (
          <blockquote
            className={clsx(
              'text-[13px] border-s-2 ps-[10px] break-words whitespace-pre-wrap',
              item.action === 'GUARDRAIL_BLOCKED'
                ? 'border-red-500/60 text-newTextColor/80'
                : 'border-newTableBorder text-newTextColor/80'
            )}
          >
            {item.comment}
          </blockquote>
        )}
        {showPost && item.post && (
          <div className="flex items-center gap-[8px] min-w-0 text-[13px] text-textItemBlur">
            <img
              src={`/icons/platforms/${item.post.integration.providerIdentifier}.png`}
              alt=""
              className="w-[16px] h-[16px] rounded-[4px] shrink-0"
            />
            <span className="shrink-0">{item.post.integration.name}</span>
            {!!snippet && (
              <span className="truncate min-w-0">· {snippet}</span>
            )}
            {item.post.deleted && (
              <span className="shrink-0">
                ({t('activity_post_deleted', 'deleted')})
              </span>
            )}
            {postAction}
          </div>
        )}
      </div>
    </li>
  );
};
