'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  ApprovalStatus,
  useApprovalSettings,
  usePostHistory,
} from '@gitroom/frontend/components/approvals/approvals.hooks';
import { ApprovalStatusBadge } from '@gitroom/frontend/components/approvals/approval.status.badge';
import { useApprovalActions } from '@gitroom/frontend/components/approvals/approval.actions';
import { ActivityRow } from '@gitroom/frontend/components/approvals/activity.item';
import { ShareApprovalModal } from '@gitroom/frontend/components/approvals/share.approval.modal';

const actionClass =
  'h-[36px] px-[14px] rounded-[8px] text-[13px] font-[600] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary disabled:opacity-50 disabled:cursor-not-allowed';

// The review state of an existing post in the editor: who can do what, a
// client link, and the post history
export const PostReviewPanel: FC<{
  postId: string;
  state?: string;
  approvalStatus?: ApprovalStatus | string | null;
  publishDate?: string | Date | null;
  mutate?: () => void;
}> = ({ postId, state, approvalStatus, publishDate, mutate }) => {
  const t = useT();
  const modals = useModals();
  const { data: settings } = useApprovalSettings();
  const { data: history, mutate: mutateHistory } = usePostHistory(postId);
  const actions = useApprovalActions();
  const [status, setStatus] = useState(approvalStatus || 'NONE');
  // the editor reloads the post after a save, follow its status
  useEffect(() => {
    setStatus(approvalStatus || 'NONE');
  }, [approvalStatus]);
  const [busy, setBusy] = useState(false);

  const waiting = status === 'IN_REVIEW' || status === 'CHANGES_REQUESTED';
  const published = state === 'PUBLISHED' || state === 'ERROR';
  const canApprove = !!settings?.canApprove;
  // a scheduled post whose time came is already going out
  const goingOut =
    state === 'QUEUE' && !!publishDate && dayjs(publishDate).isBefore(dayjs());
  const canSubmit =
    !published &&
    !goingOut &&
    (status === 'CHANGES_REQUESTED' ||
      status === 'REJECTED' ||
      (status === 'NONE' && state === 'DRAFT'));

  const run = useCallback(
    async (
      action: () => Promise<boolean>,
      after: { status?: string; close?: boolean }
    ) => {
      setBusy(true);
      const changed = await action();
      setBusy(false);
      if (!changed) {
        return;
      }
      mutate?.();
      if (after.close) {
        modals.closeAll();
        return;
      }
      if (after.status) {
        setStatus(after.status);
      }
      mutateHistory();
    },
    [mutate, modals, mutateHistory]
  );

  const share = useCallback(() => {
    modals.openModal({
      title: t('approval_share_title', 'Share for approval'),
      withCloseButton: true,
      askClose: false,
      classNames: { modal: 'w-[100%] max-w-[560px] text-textColor' },
      children: (
        <ShareApprovalModal
          postIds={[postId]}
          onCreated={() => {
            setStatus('IN_REVIEW');
            mutate?.();
            mutateHistory();
          }}
        />
      ),
    });
  }, [modals, postId, t, mutate, mutateHistory]);

  return (
    <details
      open={waiting}
      className="group mb-[16px] rounded-[12px] border border-newTableBorder bg-newBgColor"
    >
      <summary className="flex items-center gap-[10px] px-[14px] h-[48px] cursor-pointer list-none rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary [&::-webkit-details-marker]:hidden">
        <span className="text-[14px] font-[600]">
          {t('approval_review_and_history', 'Review and history')}
        </span>
        <ApprovalStatusBadge status={status} />
        <span className="flex-1" />
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-textItemBlur transition-transform group-open:rotate-180"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>

      <div className="flex flex-col gap-[14px] px-[14px] pb-[14px]">
        {waiting && !canApprove && (
          <p className="text-[13px] text-textItemBlur">
            {status === 'IN_REVIEW'
              ? t(
                  'approval_waiting_for_approver',
                  'Waiting for an approver. It will publish once it is approved.'
                )
              : t(
                  'approval_fix_and_resubmit',
                  'Make the requested changes, then save with "Submit for review".'
                )}
          </p>
        )}

        {!published && (
          <div className="flex flex-wrap gap-[8px]">
            {canApprove && waiting && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() => actions.approve({ id: postId, publishDate }), {
                      close: true,
                    })
                  }
                  className={clsx(
                    actionClass,
                    'bg-btnCta text-btnCtaText hover:bg-btnCtaHover'
                  )}
                >
                  {t('approval_approve', 'Approve')}
                </button>
                {status === 'IN_REVIEW' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(() => actions.requestChanges({ id: postId }), {
                        status: 'CHANGES_REQUESTED',
                      })
                    }
                    className={clsx(actionClass, 'bg-btnSimple hover:bg-boxHover')}
                  >
                    {t('approval_request_changes', 'Request changes')}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() => actions.reject({ id: postId }), { close: true })
                  }
                  className={clsx(actionClass, 'text-red-500 hover:bg-boxHover')}
                >
                  {t('approval_reject', 'Reject')}
                </button>
              </>
            )}
            {canSubmit && (
              <button
                type="button"
                disabled={busy}
                title={t(
                  'approval_submit_saved_hint',
                  'Sends the saved version. To include your edits, save with the main button.'
                )}
                onClick={() =>
                  run(() => actions.submit({ id: postId }), {
                    status: 'IN_REVIEW',
                  })
                }
                className={clsx(actionClass, 'bg-btnSimple hover:bg-boxHover')}
              >
                {t('approval_submit_for_review', 'Submit for review')}
              </button>
            )}
            {/* a client's approval publishes, so only approvers share links */}
            {!goingOut && canApprove && (
              <button
                type="button"
                onClick={share}
                className={clsx(actionClass, 'bg-btnSimple hover:bg-boxHover')}
              >
                {t('approval_share_title', 'Share for approval')}
              </button>
            )}
          </div>
        )}

        <div>
          <h3 className="text-[13px] font-[600] text-textItemBlur">
            {t('approval_post_history', 'Post history')}
          </h3>
          {!history ? (
            <div className="h-[40px] animate-pulse rounded-[8px] bg-newBgColorInner mt-[8px]" />
          ) : !history.items.length ? (
            <p className="text-[13px] text-textItemBlur mt-[6px]">
              {t(
                'approval_no_history',
                'No history yet. Reviews, approvals and publishing will show here.'
              )}
            </p>
          ) : (
            <ul className="divide-y divide-newTableBorder">
              {history.items.map((item) => (
                <ActivityRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </details>
  );
};
