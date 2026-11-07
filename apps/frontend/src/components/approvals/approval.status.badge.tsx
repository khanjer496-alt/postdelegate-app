'use client';

import { FC } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ApprovalStatus } from '@gitroom/frontend/components/approvals/approvals.hooks';

export const useApprovalLabel = () => {
  const t = useT();
  return (status?: ApprovalStatus | string | null) =>
    status === 'IN_REVIEW'
      ? t('approval_status_in_review', 'In review')
      : status === 'CHANGES_REQUESTED'
      ? t('approval_status_changes_requested', 'Changes requested')
      : status === 'APPROVED'
      ? t('approval_status_approved', 'Approved')
      : status === 'REJECTED'
      ? t('approval_status_rejected', 'Rejected')
      : '';
};

// A small mark per review status, each with its own shape so the status never
// relies on color alone
export const ApprovalMark: FC<{
  status?: ApprovalStatus | string | null;
  className?: string;
}> = ({ status, className }) => (
  <span
    aria-hidden="true"
    className={clsx(
      'shrink-0 w-[12px] h-[12px] rounded-full flex items-center justify-center text-[9px] leading-none font-bold',
      status === 'IN_REVIEW' &&
        'border-[2px] border-amber-400 border-t-transparent bg-transparent',
      status === 'CHANGES_REQUESTED' && 'bg-orange-500 text-white',
      status === 'APPROVED' && 'border-[2px] border-green-500 text-green-500',
      status === 'REJECTED' && 'bg-newTextColor/40 text-newBgColorInner',
      className
    )}
  >
    {status === 'CHANGES_REQUESTED'
      ? '!'
      : status === 'APPROVED'
      ? '✓'
      : status === 'REJECTED'
      ? '×'
      : ''}
  </span>
);

export const ApprovalStatusBadge: FC<{
  status?: ApprovalStatus | string | null;
  size?: 'sm' | 'md';
  className?: string;
}> = ({ status, size = 'sm', className }) => {
  const label = useApprovalLabel()(status);
  if (!label) {
    return null;
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-[6px] rounded-full border font-[600] whitespace-nowrap',
        size === 'sm'
          ? 'h-[22px] px-[8px] text-[11px]'
          : 'h-[28px] px-[12px] text-[13px]',
        // the text keeps the theme color for contrast, the border and the
        // mark carry the status color
        'text-newTextColor',
        status === 'IN_REVIEW' && 'border-amber-400/70 bg-amber-400/10',
        status === 'CHANGES_REQUESTED' && 'border-orange-500/70 bg-orange-500/10',
        status === 'APPROVED' && 'border-green-500/70 bg-green-500/10',
        status === 'REJECTED' && 'border-newTableBorder',
        className
      )}
    >
      <ApprovalMark status={status} />
      {label}
    </span>
  );
};
