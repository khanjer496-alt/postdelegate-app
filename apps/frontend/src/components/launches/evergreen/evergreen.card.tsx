'use client';

import React, { FC, useCallback } from 'react';
import clsx from 'clsx';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useCalendar } from '@gitroom/frontend/components/launches/calendar.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { RepeatIcon } from '@gitroom/frontend/components/ui/icons';
import { EvergreenModal } from '@gitroom/frontend/components/launches/evergreen/evergreen.modal';

type EvergreenPost = {
  group: string;
  state: string;
  intervalInDays?: number | null;
};

const useEvergreenModal = (group: string) => {
  const modal = useModals();
  const t = useT();
  // the modal renders outside the calendar, so it gets the reload from here
  const { reloadCalendarView } = useCalendar();
  return useCallback(() => {
    modal.openModal({
      title: t('evergreen_title', 'Evergreen post'),
      closeOnClickOutside: true,
      closeOnEscape: true,
      children: (close) => (
        <EvergreenModal
          group={group}
          onChange={reloadCalendarView}
          close={close}
        />
      ),
    });
  }, [group, reloadCalendarView]);
};

const label = (t: ReturnType<typeof useT>, days: number) =>
  days % 7 === 0
    ? days === 7
      ? t('evergreen_every_week', 'Evergreen: every week')
      : t('evergreen_every_n_weeks', 'Evergreen: every {{count}} weeks', {
          count: days / 7,
        })
    : days === 1
    ? t('evergreen_every_day', 'Evergreen: every day')
    : t('evergreen_every_n_days', 'Evergreen: every {{count}} days', {
        count: days,
      });

// The repeat mark next to the post status. The card itself is a button, so
// this mark is for the mouse; keyboard users get EvergreenAction in the
// card's action bar
export const EvergreenBadge: FC<{ post: EvergreenPost }> = ({ post }) => {
  const t = useT();
  const open = useEvergreenModal(post.group);
  if (!post.intervalInDays) {
    return null;
  }
  return (
    <span
      aria-hidden="true"
      data-tooltip-id="tooltip"
      data-tooltip-content={label(t, post.intervalInDays)}
      onClick={(e) => {
        e.stopPropagation();
        open();
      }}
      className="shrink-0 flex items-center text-btnPrimary cursor-pointer hover:opacity-80"
    >
      <RepeatIcon size={13} />
    </span>
  );
};

// "Evergreen settings" for a repeating post, "Make evergreen" for one that
// was not published yet
export const EvergreenAction: FC<{
  post: EvergreenPost;
  className?: string;
}> = ({ post, className }) => {
  const t = useT();
  const open = useEvergreenModal(post.group);
  // a published or failed post can't start re-sharing
  if (
    !post.intervalInDays &&
    (post.state === 'PUBLISHED' || post.state === 'ERROR')
  ) {
    return null;
  }
  const text = post.intervalInDays
    ? label(t, post.intervalInDays)
    : t('evergreen_make', 'Make evergreen');
  return (
    <button
      type="button"
      aria-label={text}
      className={clsx(className)}
      onClick={open}
    >
      <RepeatIcon
        size={15}
        data-tooltip-id="tooltip"
        data-tooltip-content={text}
      />
    </button>
  );
};
