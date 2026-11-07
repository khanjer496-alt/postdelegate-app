'use client';

import React, { useCallback } from 'react';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useCalendar } from '@gitroom/frontend/components/launches/calendar.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ImportPostsModal } from '@gitroom/frontend/components/launches/import/import.posts.modal';

// Opens the CSV import next to the Create Post button
export const ImportPostsButton = () => {
  const t = useT();
  const modal = useModals();
  // the modal renders outside the calendar, so it gets what it needs here
  const { integrations, reloadCalendarView } = useCalendar();

  const open = useCallback(() => {
    modal.openModal({
      title: t('import_posts', 'Import posts'),
      closeOnClickOutside: false,
      closeOnEscape: true,
      children: (close) => (
        <ImportPostsModal
          integrations={integrations}
          onImported={reloadCalendarView}
          close={close}
        />
      ),
    });
  }, [integrations, reloadCalendarView]);

  return (
    <button
      type="button"
      onClick={open}
      aria-label={t('import_posts', 'Import posts')}
      data-tooltip-id="tooltip"
      data-tooltip-content={t('import_posts_tooltip', 'Import posts from a CSV file')}
      className="h-[44px] w-[44px] min-w-[44px] group-[.sidebar]:w-full bg-btnSimple text-btnText justify-center items-center flex rounded-[8px] cursor-pointer hover:bg-boxHover transition-colors"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M11.6667 1.89v3.44c0 .47 0 .7.09.88.08.16.21.29.37.37.18.09.41.09.88.09h3.44M13.3333 10.83H6.6667M13.3333 14.17H6.6667M8.3333 7.5H6.6667M11.6667 1.67H7.3333c-1.4 0-2.1 0-2.635.272a2.5 2.5 0 0 0-1.093 1.093C3.333 3.567 3.333 4.267 3.333 5.667v8.666c0 1.4 0 2.1.272 2.635a2.5 2.5 0 0 0 1.093 1.093c.535.272 1.235.272 2.635.272h5.334c1.4 0 2.1 0 2.635-.272a2.5 2.5 0 0 0 1.093-1.093c.272-.535.272-1.235.272-2.635V6.667L11.667 1.667Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
};
