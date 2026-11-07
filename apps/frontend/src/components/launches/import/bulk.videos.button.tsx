'use client';

import React, { useCallback } from 'react';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useCalendar } from '@gitroom/frontend/components/launches/calendar.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { BulkVideosModal } from '@gitroom/frontend/components/launches/import/bulk.videos.modal';

// Opens the bulk video scheduling next to the CSV import
export const BulkVideosButton = () => {
  const t = useT();
  const modal = useModals();
  // the modal renders outside the calendar, so it gets what it needs here
  const { reloadCalendarView } = useCalendar();

  const open = useCallback(() => {
    modal.openModal({
      title: t('bulk_videos', 'Bulk schedule videos'),
      closeOnClickOutside: false,
      closeOnEscape: false,
      children: (close) => (
        <BulkVideosModal onCreated={reloadCalendarView} close={close} />
      ),
    });
  }, [reloadCalendarView]);

  return (
    <button
      type="button"
      onClick={open}
      aria-label={t('bulk_videos', 'Bulk schedule videos')}
      data-tooltip-id="tooltip"
      data-tooltip-content={t(
        'bulk_videos_tooltip',
        'Bulk schedule videos: one post for every video'
      )}
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
          d="M5 1.667h10M3.333 4.167h13.334M8.333 9.583v3.334c0 .396 0 .594.083.71a.42.42 0 0 0 .298.172c.142.016.31-.09.645-.302l2.62-1.666c.29-.185.435-.278.485-.396a.42.42 0 0 0 0-.326c-.05-.118-.195-.21-.485-.395l-2.62-1.667c-.335-.212-.503-.318-.645-.302a.42.42 0 0 0-.298.172c-.083.116-.083.314-.083.71ZM5.667 18.333h8.666c1.4 0 2.1 0 2.635-.272a2.5 2.5 0 0 0 1.093-1.093c.272-.535.272-1.235.272-2.635v-2.666c0-1.4 0-2.1-.272-2.635a2.5 2.5 0 0 0-1.093-1.093c-.535-.272-1.235-.272-2.635-.272H5.667c-1.4 0-2.1 0-2.635.272a2.5 2.5 0 0 0-1.093 1.093c-.272.535-.272 1.235-.272 2.635v2.666c0 1.4 0 2.1.272 2.635a2.5 2.5 0 0 0 1.093 1.093c.535.272 1.235.272 2.635.272Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
};
