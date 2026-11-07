'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Input } from '@gitroom/react/form/input';
import { Button } from '@gitroom/react/form/button';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { useMyReview } from '@gitroom/frontend/components/reviews/reviews.hooks';
import { REVIEW_LOW_RATING_MAX } from '@gitroom/nestjs-libraries/database/prisma/reviews/review.config';
import { StarsInput } from '@gitroom/frontend/components/reviews/review.stars';

export const REVIEW_SUPPORT_MAILTO = 'mailto:support@postdelegate.com';
const TEXT_MAX = 1000;

export const ReviewForm: FC<{
  onSubmitted?: () => void;
  onClose: () => void;
}> = ({ onSubmitted, onClose }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data: existing } = useMyReview(true);

  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roleCompany, setRoleCompany] = useState('');
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState<null | { lowRating: boolean }>(null);

  // a person who already reviewed edits it here
  useEffect(() => {
    if (!existing) {
      return;
    }
    setRating(existing.rating);
    setText(existing.text);
    setDisplayName(existing.displayName || '');
    setRoleCompany(existing.roleCompany || '');
    setConsent(existing.consentToPublish);
  }, [existing]);

  const low = rating > 0 && rating <= REVIEW_LOW_RATING_MAX;
  const consentNeedsName = !low && consent && !displayName.trim();
  const canSend = rating > 0 && !!text.trim() && !consentNeedsName;

  const submit = useCallback(async () => {
    setSaving(true);
    const response = await fetch('/reviews', {
      method: 'POST',
      body: JSON.stringify({
        rating,
        text: text.trim(),
        ...(low
          ? {}
          : {
              displayName: displayName.trim() || undefined,
              roleCompany: roleCompany.trim() || undefined,
              consentToPublish: consent,
            }),
      }),
    });
    setSaving(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      toaster.show(
        body.message ||
          t('review_save_failed', 'Could not send your review, please try again'),
        'warning'
      );
      return;
    }
    const result = await response.json().catch(() => ({}));
    setSent({ lowRating: !!result.lowRating });
    onSubmitted?.();
  }, [rating, text, displayName, roleCompany, consent, low, fetch, toaster, t]);

  if (sent) {
    return (
      <div className="flex flex-col gap-[16px] min-w-[500px] mobile:min-w-0">
        <div className="text-[20px] font-[600]">
          {t('review_thanks_title', 'Thank you!')}
        </div>
        <div className="text-[14px] text-textItemBlur">
          {sent.lowRating
            ? t(
                'review_thanks_low_text',
                'Thank you for being honest, we want to fix this. Your feedback goes to our team and is not published.'
              )
            : t('review_thanks_text', 'Your review means a lot to us.')}
        </div>
        <div className="flex gap-[8px] mobile:flex-col">
          {sent.lowRating && (
            <a
              href={REVIEW_SUPPORT_MAILTO}
              className="rounded-[8px] h-[40px] px-[24px] flex items-center justify-center bg-btnCta shadow-cta text-btnCtaText font-[600]"
            >
              {t('review_tell_support', 'Tell support')}
            </a>
          )}
          <Button
            secondary={sent.lowRating}
            onClick={onClose}
            className="rounded-[8px]"
          >
            {t('review_close', 'Close')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px] min-w-[500px] mobile:min-w-0">
      {!!existing && (
        <div className="text-[13px] text-textItemBlur">
          {t(
            'review_existing_note',
            'You already sent a review, saving updates it.'
          )}
        </div>
      )}
      <div className="flex flex-col gap-[6px]">
        <div className="text-[14px]">{t('review_rating_label', 'Your rating')}</div>
        <StarsInput
          value={rating}
          onChange={setRating}
          label={(stars) =>
            t('review_stars', '{{stars}} out of 5', { stars })
          }
        />
      </div>
      <div className="flex flex-col gap-[6px]">
        <div className="text-[14px]">{t('review_text_label', 'Your review')}</div>
        <textarea
          value={text}
          maxLength={TEXT_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder={t(
            'review_text_placeholder',
            'What do you use PostDelegate for, and how is it going?'
          )}
          className="min-h-[120px] p-[16px] rounded-[8px] bg-newBgColorInner border border-newTableBorder outline-none text-[14px] text-textColor resize-y"
        />
        <div className="text-[12px] text-textItemBlur text-end">
          {text.length}/{TEXT_MAX}
        </div>
      </div>
      {low ? (
        <div className="text-[13px] text-textItemBlur">
          {t(
            'review_low_note',
            'Sorry it has not been better. Your feedback goes straight to our team and is not published.'
          )}
        </div>
      ) : (
        rating > 0 && (
          <>
            <div className="grid grid-cols-2 gap-[12px] mobile:grid-cols-1">
              <Input
                label={t('review_name_label', 'Name to show')}
                name="reviewDisplayName"
                disableForm={true}
                removeError={true}
                value={displayName}
                maxLength={60}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <Input
                label={t('review_role_label', 'Role or company (optional)')}
                name="reviewRoleCompany"
                disableForm={true}
                removeError={true}
                value={roleCompany}
                maxLength={100}
                onChange={(e) => setRoleCompany(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-[6px]">
              <Checkbox
                disableForm={true}
                checked={consent}
                label={t(
                  'review_consent',
                  'PostDelegate may show this review publicly with my name'
                )}
                onChange={(e) => setConsent(e.target.value)}
              />
              {consentNeedsName && (
                <div className="text-red-400 text-[12px]">
                  {t(
                    'review_name_required',
                    'Add the name you want shown with your review'
                  )}
                </div>
              )}
            </div>
          </>
        )
      )}
      <div className="flex gap-[8px] justify-end mobile:flex-col">
        <Button secondary={true} onClick={onClose} className="rounded-[8px]">
          {t('review_card_dismiss', 'Not now')}
        </Button>
        <Button
          onClick={submit}
          loading={saving}
          disabled={!canSend}
          className="rounded-[8px]"
        >
          {t('review_submit', 'Send review')}
        </Button>
      </div>
    </div>
  );
};

export const openReviewModal = (
  openModal: (params: any) => void,
  title: string,
  onSubmitted?: () => void
) =>
  openModal({
    title,
    withCloseButton: true,
    children: (close: () => void) => (
      <ReviewForm onClose={close} onSubmitted={onSubmitted} />
    ),
  });
