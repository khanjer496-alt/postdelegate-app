'use client';

import React, {
  FC,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import { capitalize } from 'lodash';
import { useShallow } from 'zustand/react/shallow';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { useExistingData } from '@gitroom/frontend/components/launches/helpers/use.existing.data';

interface ChannelCheck {
  id: string;
  identifier: string;
  name: string;
  valid: boolean;
  settingsError?: string;
  errors: string | true;
  emptyContent: boolean;
  tooLong: boolean;
}

// the server checks a schedule runs (`/posts/valid`), for the post as it is
// now. The key is a short id per version of the post, not the post itself
const useChannelChecks = (check: { key: string; body: string } | null) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const response = await fetch('/posts/valid', {
      method: 'POST',
      body: check!.body,
    });
    if (!response.ok) {
      return [] as ChannelCheck[];
    }
    const data = await response.json();
    return (Array.isArray(data) ? data : []) as ChannelCheck[];
  }, [fetch, check]);

  return useSWR(check ? ['posts-valid', check.key] : null, load, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  });
};

// Shows, while the post is written, what would stop each channel from being
// scheduled, with the same messages the schedule button shows. Generic: every
// message comes from the provider checks on the server.
export const ChannelChecks: FC<{
  providers: RefObject<any>;
  // where === 'fix' opens the channel settings
  onFix: (where: 'fix' | 'preview') => void;
}> = ({ providers, onFix }) => {
  const t = useT();
  const { global, internal, selectedIntegrations, date, channelDates } =
    useLaunchStore(
      useShallow((state) => ({
        global: state.global,
        internal: state.internal,
        selectedIntegrations: state.selectedIntegrations,
        date: state.date,
        channelDates: state.channelDates,
      }))
    );

  // a channel that already went out (or is going out right now) is saved as
  // an update, like the schedule button does
  const existingData = useExistingData();
  const publishedChannels = useMemo(
    () =>
      [existingData, ...(existingData.siblings || [])]
        .filter(
          (p) =>
            p.posts?.[0]?.state === 'PUBLISHED' ||
            (p.posts?.[0]?.state === 'QUEUE' &&
              dayjs().isAfter((channelDates[p.integration] || date).utc()))
        )
        .map((p) => p.integration),
    [existingData, channelDates, date]
  );

  // the channel settings live in their own forms, a change there checks again
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = (e: Event) => {
      if ((e.target as HTMLElement)?.closest?.('#wrapper-settings')) {
        setRevision((r) => r + 1);
      }
    };
    document.addEventListener('input', changed, true);
    document.addEventListener('change', changed, true);
    document.addEventListener('click', changed, true);
    return () => {
      document.removeEventListener('input', changed, true);
      document.removeEventListener('change', changed, true);
      document.removeEventListener('click', changed, true);
    };
  }, []);

  // checked once the typing pauses, and only once there is something to check
  const [check, setCheck] = useState<{ key: string; body: string } | null>(
    null
  );
  const [scope] = useState(() => makeId(10));
  const version = useRef(0);
  const setBody = useCallback(
    (body: string | null) => {
      setCheck((previous) =>
        !body
          ? null
          : previous?.body === body
          ? previous
          : { key: `${scope}-${++version.current}`, body }
      );
    },
    [scope]
  );
  useEffect(() => {
    const timer = setTimeout(async () => {
      let values: any[] = [];
      try {
        values = ((await providers.current?.getAllValues?.()) || []).filter(
          Boolean
        );
      } catch (e) {
        // a channel that was just added is not mounted yet
        return;
      }

      const hasContent = values.some((post) =>
        (post.values || []).some(
          (value: any) =>
            !!value.media?.length ||
            !!stripHtmlValidation('normal', value.content || '', true).trim()
        )
      );

      if (!hasContent) {
        setBody(null);
        return;
      }

      setBody(
        JSON.stringify({
          type: 'schedule',
          date: date.utc().format('YYYY-MM-DDTHH:mm:ss'),
          posts: values.map((post) => ({
            integration: { id: post.id },
            type: publishedChannels.includes(post.id) ? 'update' : 'schedule',
            ...(channelDates[post.id]
              ? {
                  date: channelDates[post.id]
                    .utc()
                    .format('YYYY-MM-DDTHH:mm:ss'),
                }
              : {}),
            settings: post.settings || {},
            value: (post.values || []).map((value: any) => ({
              content: value.content,
              image: (value.media || []).map(
                ({ id, path, alt, thumbnail, thumbnailTimestamp }: any) => ({
                  id,
                  path,
                  alt,
                  thumbnail,
                  thumbnailTimestamp,
                })
              ),
            })),
          })),
        })
      );
    }, 800);

    return () => clearTimeout(timer);
  }, [
    global,
    internal,
    selectedIntegrations,
    date,
    channelDates,
    publishedChannels,
    revision,
  ]);

  const { data } = useChannelChecks(check);

  const issues = (check ? data || [] : [])
    .filter((item) =>
      selectedIntegrations.some((p) => p.integration.id === item.id)
    )
    .flatMap((item) => {
      const messages: { where: 'fix' | 'preview'; message: string }[] = [];
      if (item.emptyContent) {
        messages.push({
          where: 'preview',
          message: t(
            'post_needs_content_or_image',
            'Your post should have at least one character or one image.'
          ),
        });
      }
      if (item.valid === false) {
        messages.push({
          where: 'fix',
          message:
            item.settingsError ||
            t('please_fix_your_settings', 'Please fix your settings'),
        });
      }
      if (item.errors !== true && item.errors) {
        messages.push({ where: 'preview', message: item.errors });
      }
      if (item.tooLong) {
        messages.push({
          where: 'preview',
          message: t('post_is_too_long', 'post is too long, please fix it'),
        });
      }
      return messages.map((m) => ({ ...m, item }));
    });

  const focus = useCallback(
    (id: string, where: 'fix' | 'preview') => () => {
      selectedIntegrations
        .find((p) => p.integration.id === id)
        ?.ref?.current?.[where]?.();
      onFix(where);
    },
    [selectedIntegrations, onFix]
  );

  const channels = new Set(issues.map((p) => p.item.id)).size;
  const summary = !channels
    ? ''
    : channels === 1
    ? t(
        'one_channel_needs_attention',
        '1 channel needs attention before scheduling'
      )
    : t(
        'channels_need_attention',
        '{{count}} channels need attention before scheduling',
        { count: channels }
      );

  return (
    <>
      {/* always mounted, so screen readers hear the summary when it changes */}
      <div className="sr-only" role="status" aria-live="polite">
        {summary}
      </div>
      {!!issues.length && (
        <ChecksList summary={summary} issues={issues} focus={focus} />
      )}
    </>
  );
};

const ChecksList: FC<{
  summary: string;
  issues: {
    item: ChannelCheck;
    where: 'fix' | 'preview';
    message: string;
  }[];
  focus: (id: string, where: 'fix' | 'preview') => () => void;
}> = ({ summary, issues, focus }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-[8px] rounded-[12px] border border-[#FF3F3F]/40 bg-newSettings p-[12px] mobile:bg-transparent">
      <div
        className="flex items-center gap-[8px] text-[14px] font-[600]"
        aria-hidden="true"
      >
        <WarningIcon />
        <div>{summary}</div>
      </div>
      <ul className="flex flex-col gap-[2px]">
        {issues.map(({ item, where, message }, index) => (
          <li key={`${item.id}-${index}`}>
            <button
              type="button"
              onClick={focus(item.id, where)}
              className="w-full flex items-center gap-[10px] text-start rounded-[8px] px-[8px] py-[6px] hover:bg-newBgColorInner outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
            >
              <SafeImage
                src={`/icons/platforms/${item.identifier}.png`}
                alt=""
                width={18}
                height={18}
                className="rounded-[4px] w-[18px] h-[18px] min-w-[18px]"
              />
              <div className="flex-1 min-w-0 text-[13px]">
                <span className="font-[600]">
                  {item.name} ({capitalize(item.identifier.split('-')[0])}):
                </span>{' '}
                <span className="text-newTextColor/80 break-words">
                  {message}
                </span>
              </div>
              <span
                className={clsx(
                  'shrink-0 text-[12px] font-[600] text-btnPrimary'
                )}
              >
                {where === 'fix'
                  ? t('open_settings', 'Open settings')
                  : t('show_channel', 'Show')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const WarningIcon: FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
    className="text-[#FF3F3F] shrink-0"
  >
    <path
      d="M8.00049 6.00015V8.66682M8.00049 11.3335H8.00715M7.07737 2.59464L1.59411 12.0657C1.28997 12.591 1.1379 12.8537 1.16038 13.0693C1.17998 13.2573 1.2785 13.4282 1.4314 13.5394C1.60671 13.6668 1.91022 13.6668 2.51723 13.6668H13.4837C14.0908 13.6668 14.3943 13.6668 14.5696 13.5394C14.7225 13.4282 14.821 13.2573 14.8406 13.0693C14.8631 12.8537 14.711 12.591 14.4069 12.0657L8.92361 2.59463C8.62056 2.07119 8.46904 1.80947 8.27135 1.72157C8.09892 1.64489 7.90206 1.64489 7.72962 1.72157C7.53193 1.80947 7.38041 2.07119 7.07737 2.59464Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
