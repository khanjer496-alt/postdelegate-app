'use client';

import React, { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import useSWR from 'swr';
import { useClickOutside } from '@mantine/hooks';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useCalendar } from '@gitroom/frontend/components/launches/calendar.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { Check } from '@gitroom/frontend/components/launches/tags.component';

export type WorkspaceTag = {
  id: string;
  name: string;
  color: string;
  kind: 'TAG' | 'CAMPAIGN' | 'PILLAR';
  description?: string | null;
};

// the workspace tags, campaigns and pillars; the same cache as the composer
export const useWorkspaceTags = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/posts/tags')).json();
  }, []);
  return useSWR<{ tags: WorkspaceTag[] }>('load-tags', load, {
    revalidateOnFocus: false,
  });
};

const TagDot: FC<{ color: string }> = ({ color }) => (
  <span
    aria-hidden="true"
    className="w-[12px] h-[12px] min-w-[12px] rounded-full border border-black/10"
    style={{ backgroundColor: color }}
  />
);

// Filters the calendar by campaign, pillar or tag. Shown only when the
// workspace has some.
export const SelectTags: FC<{
  list?: boolean;
}> = ({ list }) => {
  const { selectedTags, setSelectedTags } = useCalendar();
  const { data } = useWorkspaceTags();
  const t = useT();
  const [pos, setPos] = useState<any>({});
  const [open, setOpen] = useState(false);
  const ref = useClickOutside(() => {
    if (open) {
      setOpen(false);
    }
  });

  const tags = data?.tags || [];
  const selectedIds = selectedTags ?? tags.map((tag) => tag.id);
  const allSelected = tags.every((tag) => selectedIds.includes(tag.id));

  const openClose = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    const { x, y, height } = ref.current?.getBoundingClientRect();
    setPos({ top: y + height, left: Math.min(x, window.innerWidth - 270) });
    setOpen(true);
  }, [open]);

  const toggleAll = useCallback(() => {
    setSelectedTags(allSelected ? [] : null);
  }, [allSelected]);

  const toggle = useCallback(
    (id: string) => () => {
      const next = selectedIds.includes(id)
        ? selectedIds.filter((s) => s !== id)
        : [...selectedIds, id];
      setSelectedTags(next.length === tags.length ? null : next);
    },
    [selectedIds, tags]
  );

  if (!tags.length) {
    return null;
  }

  if (list) {
    return (
      <div className="flex flex-col gap-[4px] mt-[8px]">
        <div className="text-[14px] font-[600] text-textItemBlur">
          {t('campaigns_and_tags', 'Campaigns and tags')}
        </div>
        <button
          type="button"
          onClick={toggleAll}
          className="flex items-center gap-[12px] py-[8px] min-h-[44px] cursor-pointer select-none text-start"
        >
          <div className="flex-1 text-[14px] font-[600]">
            {t('select_all', 'Select all')}
          </div>
          <Check onChange={() => {}} value={allSelected} />
        </button>
        {tags.map((tag) => (
          <button
            type="button"
            key={tag.id}
            onClick={toggle(tag.id)}
            aria-pressed={selectedIds.includes(tag.id)}
            className="flex items-center gap-[12px] py-[8px] min-h-[44px] cursor-pointer select-none text-start"
          >
            <TagDot color={tag.color} />
            <div className="flex-1 text-[14px] truncate">{tag.name}</div>
            <Check onChange={() => {}} value={selectedIds.includes(tag.id)} />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="relative select-none z-[500]" ref={ref}>
      <button
        type="button"
        data-tooltip-id="tooltip"
        data-tooltip-content={t('filter_by_campaign', 'Filter by campaign or tag')}
        aria-label={t('filter_by_campaign', 'Filter by campaign or tag')}
        aria-expanded={open}
        onClick={openClose}
        className={clsx(
          'relative z-[20] cursor-pointer h-[42px] rounded-[8px] px-[12px] border flex items-center gap-[6px] text-[14px]',
          open || !allSelected ? 'border-btnPrimary' : 'border-newColColor'
        )}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 11.6V4.2C3 3.54 3.54 3 4.2 3h7.4c.32 0 .62.13.85.35l8.2 8.2a1.2 1.2 0 0 1 0 1.7l-7.4 7.4a1.2 1.2 0 0 1-1.7 0l-8.2-8.2A1.2 1.2 0 0 1 3 11.6Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" />
        </svg>
        {!allSelected && (
          <span className="tabular-nums">{selectedIds.length}</span>
        )}
      </button>
      {open && (
        <div
          style={pos}
          className="flex flex-col fixed py-[12px] bg-newBgColorInner menu-shadow min-w-[250px] max-h-[320px] overflow-y-auto"
        >
          <div className="p-[12px] hover:bg-newBgColor text-[14px] font-[600] flex items-center">
            <Checkbox
              disableForm={true}
              checked={allSelected}
              onChange={toggleAll}
              label={t('select_all', 'Select all')}
            />
          </div>
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="p-[12px] hover:bg-newBgColor text-[14px] font-[500] flex items-center gap-[10px]"
            >
              <Checkbox
                disableForm={true}
                checked={selectedIds.includes(tag.id)}
                onChange={toggle(tag.id)}
              />
              <TagDot color={tag.color} />
              <div className="truncate">{tag.name}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
