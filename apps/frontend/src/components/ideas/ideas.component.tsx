'use client';

import React, { useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { DNDProvider } from '@gitroom/frontend/components/launches/helpers/dnd.provider';
import {
  IdeasBoard,
  useIdeaActions,
} from '@gitroom/frontend/components/ideas/ideas.board';
import { CampaignsComponent } from '@gitroom/frontend/components/ideas/campaigns.component';
import { useWorkspaceTags } from '@gitroom/frontend/components/launches/select.tags';

const NewIdeaButton = () => {
  const t = useT();
  const { edit } = useIdeaActions();
  return (
    <button
      type="button"
      onClick={() => edit()}
      className="h-[42px] px-[16px] rounded-[10px] bg-btnCta text-btnCtaText hover:bg-btnCtaHover shadow-cta font-[600] text-[14px] flex items-center gap-[6px]"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 21 20"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M10.5001 4.16699V15.8337M4.66675 10.0003H16.3334"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {t('new_idea', 'New idea')}
    </button>
  );
};

// The Ideas page: a board of unscheduled ideas, and the campaigns, pillars
// and tags that label them
export const IdeasComponent = () => {
  const t = useT();
  const [tab, setTab] = useState<'board' | 'campaigns'>('board');
  const [filterTag, setFilterTag] = useState('');
  const { data: tagsData } = useWorkspaceTags();
  const tags = tagsData?.tags || [];

  return (
    <DNDProvider>
      <div className="bg-newBgColorInner p-[20px] mobile:p-[16px] flex flex-1 flex-col gap-[16px] text-textColor min-w-0">
        <div className="flex flex-wrap items-center gap-[10px]">
          <div
            role="tablist"
            aria-label={t('ideas', 'Ideas')}
            className="flex p-[4px] border border-newTableBorder rounded-[8px] text-[14px] font-[500]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'board'}
              onClick={() => setTab('board')}
              className={clsx(
                'px-[14px] pt-[6px] pb-[5px] rounded-[6px]',
                tab === 'board' && 'text-textItemFocused bg-boxFocused'
              )}
            >
              {t('ideas_board', 'Ideas board')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'campaigns'}
              onClick={() => setTab('campaigns')}
              className={clsx(
                'px-[14px] pt-[6px] pb-[5px] rounded-[6px]',
                tab === 'campaigns' && 'text-textItemFocused bg-boxFocused'
              )}
            >
              {t('campaigns_and_pillars', 'Campaigns & pillars')}
            </button>
          </div>
          {tab === 'board' && !!tags.length && (
            <select
              aria-label={t('filter_by_campaign', 'Filter by campaign or tag')}
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
              className="h-[42px] px-[10px] rounded-[8px] bg-newBgColorInner border border-newTableBorder text-[14px] text-textColor outline-none max-w-[220px]"
            >
              <option value="">
                {t('all_campaigns', 'All campaigns and tags')}
              </option>
              {tags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}
                </option>
              ))}
            </select>
          )}
          <div className="flex-1" />
          {tab === 'board' && <NewIdeaButton />}
        </div>
        <div role="tabpanel">
          {tab === 'board' ? (
            <IdeasBoard filterTag={filterTag} />
          ) : (
            <CampaignsComponent />
          )}
        </div>
      </div>
    </DNDProvider>
  );
};
