'use client';

import React, { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { Button } from '@gitroom/react/form/button';
import {
  AdminReview,
  ReviewStatus,
  useAdminReviews,
} from '@gitroom/frontend/components/reviews/reviews.hooks';
import { StarsDisplay } from '@gitroom/frontend/components/reviews/review.stars';

const FILTERS: { value: ReviewStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'NEW', label: 'New' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'HIDDEN', label: 'Hidden' },
];

const statusColor: Record<ReviewStatus, string> = {
  NEW: 'bg-blue-600',
  APPROVED: 'bg-green-600',
  HIDDEN: 'bg-gray-600',
};

const ReviewRow: FC<{ review: AdminReview; reload: () => void }> = ({
  review,
  reload,
}) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const [saving, setSaving] = useState(false);

  const setStatus = useCallback(
    async (status: ReviewStatus) => {
      setSaving(true);
      const response = await fetch(`/admin/reviews/${review.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      setSaving(false);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toaster.show(body.message || 'Could not update the review', 'warning');
        return;
      }
      reload();
    },
    [review.id, fetch, toaster, reload]
  );

  return (
    <div className="flex flex-col gap-[8px] px-[12px] py-[12px] text-[13px] border-b border-newTableBorder last:border-b-0">
      <div className="flex items-center gap-[12px] flex-wrap">
        <StarsDisplay rating={review.rating} />
        <span
          className={clsx(
            'px-[8px] rounded-[4px] text-white text-[12px]',
            statusColor[review.status]
          )}
        >
          {review.status}
        </span>
        <span
          className={clsx(
            'px-[8px] rounded-[4px] text-[12px] border',
            review.consentToPublish
              ? 'border-green-600 text-green-500'
              : 'border-newTableBorder text-textItemBlur'
          )}
        >
          {review.consentToPublish ? 'Consent to publish' : 'Not for publishing'}
        </span>
        <span className="text-textItemBlur">
          {new Date(review.createdAt).toLocaleDateString()}
        </span>
      </div>
      <div className="whitespace-pre-wrap break-words">{review.text}</div>
      <div className="text-textItemBlur">
        {review.displayName ? (
          <span className="text-newTextColor">
            {review.displayName}
            {review.roleCompany ? `, ${review.roleCompany}` : ''}
          </span>
        ) : (
          'No display name'
        )}
        {' · '}
        {review.email}
        {' · '}
        {review.organization}
      </div>
      <div className="flex gap-[8px]">
        {review.status !== 'APPROVED' && (
          <Button
            onClick={() => setStatus('APPROVED')}
            loading={saving}
            className="rounded-[8px] h-[34px] text-[13px]"
          >
            Approve
          </Button>
        )}
        {review.status !== 'HIDDEN' && (
          <Button
            secondary={true}
            onClick={() => setStatus('HIDDEN')}
            loading={saving}
            className="rounded-[8px] h-[34px] text-[13px]"
          >
            Hide
          </Button>
        )}
        {review.status !== 'NEW' && (
          <Button
            secondary={true}
            onClick={() => setStatus('NEW')}
            loading={saving}
            className="rounded-[8px] h-[34px] text-[13px]"
          >
            Back to new
          </Button>
        )}
      </div>
    </div>
  );
};

export const AdminReviewsComponent: FC = () => {
  const user = useUser();
  const fetch = useFetch();
  const toaster = useToaster();
  const [status, setStatus] = useState<ReviewStatus | ''>('');
  const { data, isLoading, error, mutate } = useAdminReviews(status);
  const [exporting, setExporting] = useState(false);

  const reload = useCallback(() => {
    mutate();
  }, [mutate]);

  // The same list as the public feed, ready to save as
  // site/src/data/testimonials.json
  const exportApproved = useCallback(async () => {
    setExporting(true);
    const response = await fetch('/admin/reviews/export');
    setExporting(false);
    if (!response.ok) {
      toaster.show('Could not export the reviews', 'warning');
      return;
    }
    const reviews = await response.json();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(reviews, null, 2) + '\n'], {
        type: 'application/json',
      })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'testimonials.json';
    link.click();
    URL.revokeObjectURL(url);
  }, [fetch, toaster]);

  if (!user?.isSuperAdmin) {
    return (
      <div className="text-textColor p-[20px]">
        You do not have access to this page.
      </div>
    );
  }

  if (isLoading) {
    return <LoadingComponent />;
  }

  return (
    <div className="flex flex-col gap-[16px] text-textColor">
      <div className="flex items-center justify-between gap-[12px] flex-wrap">
        <div>
          <div className="text-[20px] font-[600]">Reviews</div>
          <div className="text-[13px] text-textItemBlur">
            Only approved reviews whose author agreed to publish are shown on
            the site and in the export.
          </div>
        </div>
        <Button
          onClick={exportApproved}
          loading={exporting}
          className="rounded-[8px] h-[36px] text-[13px]"
        >
          Export approved (JSON)
        </Button>
      </div>
      <div className="flex gap-[8px] flex-wrap">
        {FILTERS.map((filter) => (
          <button
            key={filter.value || 'all'}
            onClick={() => setStatus(filter.value)}
            className={clsx(
              'px-[14px] h-[32px] rounded-[8px] text-[13px] border border-newTableBorder',
              status === filter.value
                ? 'bg-boxFocused text-textItemFocused'
                : 'text-textItemBlur hover:text-newTextColor'
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>
      {error ? (
        <div className="text-[13px] text-textItemBlur">
          Failed to load reviews.
        </div>
      ) : (
        <div className="border border-newTableBorder rounded-[8px] overflow-hidden">
          {!data?.length ? (
            <div className="px-[12px] py-[10px] text-[13px] text-textItemBlur">
              No reviews yet.
            </div>
          ) : (
            data.map((review) => (
              <ReviewRow key={review.id} review={review} reload={reload} />
            ))
          )}
        </div>
      )}
    </div>
  );
};
