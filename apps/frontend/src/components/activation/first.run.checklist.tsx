'use client';

import { FC, useCallback, useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useCalendar } from '@gitroom/frontend/components/launches/calendar.context';
import { useAddProvider } from '@gitroom/frontend/components/launches/add.provider.component';
import { useCreatePost } from '@gitroom/frontend/components/launches/new.post';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useChecklist } from '@gitroom/frontend/components/activation/activation.hooks';

interface Step {
  id: string;
  title: string;
  hint: string;
  done: boolean;
  blocked: boolean;
  optional?: boolean;
  action: () => void;
}

const CheckIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M5 12.5l4.5 4.5L19 7.5"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ArrowIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className="rtl:rotate-180 shrink-0"
  >
    <path
      d="M9 6l6 6-6 6"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Getting started card above the calendar. Every step is read from the
// workspace's data, so it ticks itself off and goes away once all are done.
export const FirstRunChecklist: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const router = useRouter();
  const user = useUser();
  const { isGeneral } = useVariables();
  const { data, mutate } = useChecklist();
  const { integrations, posts } = useCalendar();
  const { mutate: reloadIntegrations } = useIntegrationList();
  const addChannel = useAddProvider(() => reloadIntegrations());
  const createPost = useCreatePost();

  const canInvite =
    !!user?.tier?.team_members && isGeneral && user?.role !== 'USER';

  const steps = useMemo<Step[]>(() => {
    if (!data) {
      return [];
    }
    const { channel, post, scheduled, teammate } = data.steps;
    const list: Step[] = [
      {
        id: 'channel',
        title: t('checklist_connect_channel', 'Connect a channel'),
        hint: t('checklist_connect_channel_hint', 'Link an account you post to'),
        done: channel,
        blocked: false,
        action: addChannel,
      },
      {
        id: 'post',
        title: t('checklist_create_post', 'Create your first post'),
        hint: channel
          ? t('checklist_create_post_hint', 'Write it once, tweak it per channel')
          : t('checklist_needs_channel', 'Connect a channel first'),
        done: post,
        blocked: !channel,
        action: createPost,
      },
      {
        id: 'scheduled',
        title: t('checklist_schedule', 'Schedule it'),
        hint: channel
          ? t('checklist_schedule_hint', 'Pick a time and add it to the calendar')
          : t('checklist_needs_channel', 'Connect a channel first'),
        done: scheduled,
        blocked: !channel,
        action: createPost,
      },
    ];
    if (canInvite) {
      list.push({
        id: 'teammate',
        title: t('checklist_invite', 'Invite a teammate'),
        hint: t('checklist_invite_hint', 'Optional, plan posts together'),
        done: teammate,
        blocked: false,
        optional: true,
        action: () => router.push('/settings?tab=teams'),
      });
    }
    return list;
  }, [data, canInvite, addChannel, createPost, router, t]);

  const done = steps.filter((step) => step.done).length;
  // the optional teammate step never keeps the card around on its own
  const visible =
    !!data &&
    !data.dismissed &&
    steps.some((step) => !step.done && !step.optional);
  const nextStep = steps.find((step) => !step.done && !step.blocked);

  // a channel was added or a post created, check the steps again
  const calendarState = `${integrations.length}:${posts.length}`;
  const lastCalendarState = useRef(calendarState);
  useEffect(() => {
    if (lastCalendarState.current === calendarState) {
      return;
    }
    lastCalendarState.current = calendarState;
    if (visible) {
      mutate();
    }
  }, [calendarState, visible, mutate]);

  const dismiss = useCallback(async () => {
    if (!data) {
      return;
    }
    mutate({ ...data, dismissed: true }, false);
    try {
      const response = await fetch('/activation/checklist/dismiss', {
        method: 'POST',
      });
      if (!response.ok) {
        mutate();
      }
    } catch (e) {
      mutate();
    }
  }, [data, fetch, mutate]);

  if (!visible) {
    return null;
  }

  const percent = Math.round((done / steps.length) * 100);

  return (
    <section
      aria-labelledby="first-run-checklist-title"
      className="rounded-[12px] border border-newTableBorder bg-newBgColorInner p-[16px] mobile:p-[12px] flex flex-col gap-[12px] text-newTextColor"
    >
      <div className="flex items-start gap-[12px]">
        <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
          <h2
            id="first-run-checklist-title"
            className="text-[16px] font-[600] leading-[1.3]"
          >
            {t('checklist_title', 'Get your first post out')}
          </h2>
          <p className="text-[13px] text-textItemBlur">
            {t('checklist_progress', '{{done}} of {{total}} done', {
              done,
              total: steps.length,
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('checklist_dismiss', 'Hide the getting started list')}
          title={t('checklist_dismiss', 'Hide the getting started list')}
          className="w-[28px] h-[28px] -me-[4px] -mt-[2px] rounded-[8px] flex items-center justify-center text-textItemBlur hover:text-newTextColor hover:bg-boxHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <div
        role="progressbar"
        aria-label={t('checklist_progress_label', 'Getting started progress')}
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
        className="h-[6px] rounded-full bg-btnSimple overflow-hidden"
      >
        <div
          className="h-full rounded-full bg-btnPrimary dark:bg-btnCta transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <ol className="grid gap-[8px] grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        {steps.map((step, index) => {
          const isNext = step === nextStep;
          return (
            <li key={step.id} className="min-w-0">
              <button
                type="button"
                onClick={step.action}
                disabled={step.done || step.blocked}
                aria-current={isNext ? 'step' : undefined}
                className={clsx(
                  'w-full h-full text-start flex items-center gap-[10px] rounded-[10px] p-[10px] border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary',
                  isNext
                    ? 'border-btnPrimary dark:border-btnCta bg-boxHover hover:bg-boxFocused'
                    : 'border-newTableBorder',
                  !step.done && !step.blocked && !isNext && 'hover:bg-boxHover',
                  step.blocked && 'cursor-not-allowed',
                  step.done && 'cursor-default'
                )}
              >
                <span
                  className={clsx(
                    'w-[24px] h-[24px] shrink-0 rounded-full flex items-center justify-center text-[12px] font-[600]',
                    step.done
                      ? 'bg-btnPrimary text-white dark:bg-btnCta dark:text-btnCtaText'
                      : 'border border-newSep text-textItemBlur'
                  )}
                  aria-hidden="true"
                >
                  {step.done ? <CheckIcon /> : index + 1}
                </span>
                <span className="flex-1 min-w-0 flex flex-col">
                  <span
                    className={clsx(
                      'text-[14px] font-[600] truncate',
                      step.done && 'text-textItemBlur line-through'
                    )}
                  >
                    {step.title}
                  </span>
                  <span className="text-[12px] text-textItemBlur line-clamp-2">
                    {step.done ? t('checklist_done', 'Done') : step.hint}
                  </span>
                </span>
                {!step.done && !step.blocked && <ArrowIcon />}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
