'use client';

import { FC, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useActivity } from '@gitroom/frontend/components/approvals/approvals.hooks';
import { ActivityRow } from '@gitroom/frontend/components/approvals/activity.item';

const pageButton =
  'h-[36px] px-[14px] rounded-[8px] bg-btnSimple hover:bg-boxHover text-[13px] font-[600] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary disabled:opacity-50 disabled:cursor-not-allowed';

// Everything that happened to the workspace's posts and approval settings,
// newest first. The history is append-only.
export const WorkspaceActivity: FC = () => {
  const t = useT();
  const [page, setPage] = useState(0);
  const { data, isLoading, error } = useActivity(page);
  const pages = data?.pages || 0;

  return (
    <div className="flex flex-col gap-[16px] text-newTextColor">
      <div className="flex flex-col gap-[4px]">
        <h2 className="text-[20px] font-[600]">
          {t('activity_title', 'Activity')}
        </h2>
        <p className="text-[14px] text-textItemBlur">
          {t(
            'activity_intro',
            'Who created, reviewed, approved and published posts, including AI agents and clients. This history cannot be edited.'
          )}
        </p>
      </div>

      <div className="rounded-[12px] border border-newTableBorder bg-newBgColorInner px-[20px] mobile:px-[12px] py-[6px]">
        {isLoading ? (
          <div className="flex flex-col gap-[10px] py-[12px]" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[44px] rounded-[8px] bg-newBgColor animate-pulse"
              />
            ))}
          </div>
        ) : error ? (
          <p className="text-[14px] text-textItemBlur py-[16px]">
            {t('activity_load_failed', 'Could not load the activity.')}
          </p>
        ) : !data?.items.length ? (
          <p className="text-[14px] text-textItemBlur py-[16px]">
            {t(
              'activity_empty',
              'No activity yet. It starts with the next post someone creates.'
            )}
          </p>
        ) : (
          <ul className="divide-y divide-newTableBorder">
            {data.items.map((item) => (
              <ActivityRow key={item.id} item={item} showPost={true} />
            ))}
          </ul>
        )}
      </div>

      {pages > 1 && (
        <nav
          aria-label={t('activity_pages', 'Activity pages')}
          className="flex items-center justify-between gap-[12px]"
        >
          <button
            type="button"
            className={pageButton}
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            {t('activity_previous', 'Previous')}
          </button>
          <span className="text-[13px] text-textItemBlur" aria-live="polite">
            {t('activity_page_of', 'Page {{page}} of {{pages}}', {
              page: page + 1,
              pages,
            })}
          </span>
          <button
            type="button"
            className={pageButton}
            disabled={page >= pages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('activity_next', 'Next')}
          </button>
        </nav>
      )}
    </div>
  );
};
