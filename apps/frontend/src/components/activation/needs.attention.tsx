'use client';

import { FC, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useCalendar } from '@gitroom/frontend/components/launches/calendar.context';
import { usePostActions } from '@gitroom/frontend/components/launches/calendar';
import { fromUtc } from '@gitroom/frontend/components/layout/set.timezone';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';
import {
  useChannelAttentionText,
  useNeedsAttention,
} from '@gitroom/frontend/components/activation/activation.hooks';

const Avatar: FC<{ picture: string | null; identifier: string }> = ({
  picture,
  identifier,
}) => (
  <div className="relative shrink-0 w-[36px] h-[36px]">
    <ImageWithFallback
      fallbackSrc="/no-picture.jpg"
      src={picture || '/no-picture.jpg'}
      className="rounded-[8px] w-[36px] h-[36px]"
      alt=""
      width={36}
      height={36}
    />
    <img
      src={
        identifier === 'youtube'
          ? '/icons/platforms/youtube.svg'
          : `/icons/platforms/${identifier}.png`
      }
      className="absolute -bottom-[4px] -end-[4px] w-[16px] h-[16px] rounded-[4px] border border-newBgColorInner"
      alt=""
    />
  </div>
);

const Row: FC<{
  avatar: ReactNode;
  title: string;
  detail: ReactNode;
  action?: { label: string; onClick: () => void };
}> = ({ avatar, title, detail, action }) => (
  <li className="flex items-center gap-[12px] mobile:flex-wrap rounded-[10px] bg-newBgColorInner px-[12px] py-[10px]">
    {avatar}
    <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
      <div className="text-[14px] font-[600] truncate">{title}</div>
      <div className="text-[12px] text-textItemBlur line-clamp-2 break-words">
        {detail}
      </div>
    </div>
    {action && (
      <button
        type="button"
        onClick={action.onClick}
        className="h-[32px] px-[12px] rounded-[8px] bg-btnSimple text-btnText text-[13px] font-[600] shrink-0 hover:bg-boxFocused transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary mobile:ms-[48px]"
      >
        {action.label}
      </button>
    )}
  </li>
);

// Above the calendar: posts that failed and channels that will make posts
// fail, each with the fix one click away. Renders nothing when all is well.
export const NeedsAttention: FC<{
  refreshChannel: (integration: any) => () => void;
  continueIntegration: (integration: any) => () => void;
}> = ({ refreshChannel, continueIntegration }) => {
  const t = useT();
  const { integrations, posts } = useCalendar();
  const { data, mutate } = useNeedsAttention();
  // a post fixed from here may sit outside the week in view
  const { editPost } = usePostActions(() => mutate());
  const channelText = useChannelAttentionText();
  const [open, setOpen] = useState(true);

  // look again when a failed post in view changes or a channel's connection
  // does, not on every calendar load
  const calendarState = useMemo(
    () =>
      [
        ...integrations.map(
          (p: any) => `${p.id}:${!!p.refreshNeeded}:${!!p.inBetweenSteps}`
        ),
        ...posts.filter((p) => p.state === 'ERROR').map((p) => p.id),
      ].join(','),
    [integrations, posts]
  );
  const lastCalendarState = useRef(calendarState);
  useEffect(() => {
    if (lastCalendarState.current === calendarState) {
      return;
    }
    lastCalendarState.current = calendarState;
    mutate();
  }, [calendarState, mutate]);

  const total = (data?.failedPostsTotal || 0) + (data?.channels.length || 0);
  if (!data || !total) {
    return null;
  }

  const hiddenPosts = data.failedPostsTotal - data.failedPosts.length;

  return (
    <section
      aria-labelledby="needs-attention-title"
      className="rounded-[12px] border border-red-500/30 bg-red-500/[0.06] p-[12px] flex flex-col gap-[10px] text-newTextColor"
    >
      <div className="flex items-center gap-[10px] px-[4px]">
        <span
          className="w-[22px] h-[22px] rounded-full bg-red-500 text-white flex items-center justify-center shrink-0"
          aria-hidden="true"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              d="M12 7v6M12 17h.01"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <h2
          id="needs-attention-title"
          className="flex-1 text-[15px] font-[600]"
        >
          {t('attention_title', 'Needs attention')}
          <span className="ms-[8px] text-[13px] font-[500] text-textItemBlur">
            {total}
          </span>
        </h2>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="needs-attention-list"
          className="h-[28px] px-[10px] rounded-[8px] text-[13px] font-[500] text-textItemBlur hover:text-newTextColor hover:bg-boxHover transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary"
        >
          {open ? t('attention_hide', 'Hide') : t('attention_show', 'Show')}
        </button>
      </div>
      <ul
        id="needs-attention-list"
        className={clsx('flex flex-col gap-[6px]', !open && 'hidden')}
      >
        {data.channels.map((channel) => {
          const integration = integrations.find((p) => p.id === channel.id);
          const setup = channel.reason === 'finish_setup';
          return (
            <Row
              key={`channel-${channel.id}`}
              avatar={
                <Avatar
                  picture={channel.picture}
                  identifier={channel.identifier}
                />
              }
              title={channel.name}
              detail={channelText(channel)}
              action={
                integration
                  ? {
                      label: setup
                        ? t('attention_finish_setup', 'Finish setup')
                        : t('attention_reconnect', 'Reconnect'),
                      onClick: setup
                        ? continueIntegration(integration)
                        : refreshChannel(integration),
                    }
                  : undefined
              }
            />
          );
        })}
        {data.failedPosts.map((post) => (
          <Row
            key={`post-${post.id}`}
            avatar={
              <Avatar
                picture={post.integration.picture}
                identifier={post.integration.identifier}
              />
            }
            title={t('attention_post_failed', 'Couldn’t publish to {{name}}', {
              name: post.integration.name,
            })}
            detail={
              <>
                <span>
                  {fromUtc(post.publishDate).format(
                    isUSCitizen() ? 'MMM D, hh:mm A' : 'MMM D, LT'
                  )}
                </span>
                {!!post.excerpt && <span> · {post.excerpt}</span>}
                {!!post.error && (
                  <span className="block text-red-600 dark:text-red-400">
                    {post.error}
                  </span>
                )}
              </>
            }
            action={{
              label: t('attention_open_post', 'Open post'),
              onClick: editPost({
                group: post.group,
                publishDate: post.publishDate,
              }),
            }}
          />
        ))}
        {hiddenPosts > 0 && (
          <li className="px-[12px] text-[12px] text-textItemBlur">
            {t(
              'attention_more_failed',
              '{{count}} more from the last 30 days',
              { count: hiddenPosts }
            )}
          </li>
        )}
      </ul>
    </section>
  );
};
