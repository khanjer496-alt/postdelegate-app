'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useReviewPrompt } from '@gitroom/frontend/components/reviews/reviews.hooks';
import { openReviewModal } from '@gitroom/frontend/components/reviews/review.form';

// A small card in the corner, never a blocker. The server decides when a
// person is asked (account age, published posts, earlier answers).
export const ReviewPrompt: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const user = useUser();
  const modals = useModals();
  const { data, mutate } = useReviewPrompt();
  const [hidden, setHidden] = useState(false);
  const reported = useRef(false);

  // an admin looking at a customer's workspace must not answer for them
  const show = !!data?.eligible && !hidden && !user?.impersonate;

  useEffect(() => {
    if (show && !reported.current) {
      reported.current = true;
      fetch('/reviews/prompt/shown', { method: 'POST' }).catch(() => {});
    }
  }, [show]);

  const dismiss = useCallback(async () => {
    setHidden(true);
    await fetch('/reviews/prompt/dismiss', { method: 'POST' }).catch(() => {});
    mutate();
  }, [fetch, mutate]);

  const open = useCallback(() => {
    openReviewModal(
      modals.openModal,
      t('review_leave', 'Leave a review'),
      () => {
        setHidden(true);
        mutate();
      }
    );
  }, [modals.openModal, t, mutate]);

  if (!show) {
    return null;
  }

  return (
    <div
      role="complementary"
      className="fixed bottom-[20px] start-[108px] mobile:start-[12px] mobile:end-[12px] mobile:bottom-[84px] z-[400] w-[340px] mobile:w-auto rounded-[12px] border border-newTableBorder bg-newBgColorInner shadow-previewShadow p-[16px] flex flex-col gap-[12px] text-newTextColor"
    >
      <div className="flex items-start gap-[8px]">
        <div className="flex-1 flex flex-col gap-[4px]">
          <div className="text-[15px] font-[600]">
            {t('review_card_title', 'How is PostDelegate working for you?')}
          </div>
          <div className="text-[13px] text-textItemBlur">
            {t(
              'review_card_text',
              'A short review helps us improve and helps others decide.'
            )}
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label={t('review_card_dismiss', 'Not now')}
          className="text-textItemBlur hover:text-newTextColor"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
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
      <div className="flex gap-[8px]">
        <Button onClick={open} className="rounded-[8px] h-[36px] text-[13px]">
          {t('review_leave', 'Leave a review')}
        </Button>
        <Button
          secondary={true}
          onClick={dismiss}
          className="rounded-[8px] h-[36px] text-[13px]"
        >
          {t('review_card_dismiss', 'Not now')}
        </Button>
      </div>
    </div>
  );
};
