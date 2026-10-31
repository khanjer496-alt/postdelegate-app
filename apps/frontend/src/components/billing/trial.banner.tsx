'use client';

import { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const useRenewal = () => {
  const fetch = useFetch();
  return useSWR<{
    renewsAt: number | null;
    trialing: boolean;
    needsPaymentMethod: boolean;
  }>(
    '/billing/renewal',
    async () => {
      const response = await fetch('/billing/renewal');
      if (!response.ok) {
        throw new Error('Failed to load renewal date');
      }
      return response.json();
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};

export const useAddPaymentMethod = () => {
  const fetch = useFetch();
  return useCallback(async () => {
    const { portal } = await (
      await fetch('/billing/add-payment-method')
    ).json();
    window.location.href = portal;
  }, []);
};

const TrialBannerInner: FC = () => {
  const t = useT();
  const { data: renewal } = useRenewal();
  const addPaymentMethod = useAddPaymentMethod();
  const [loading, setLoading] = useState(false);

  const add = useCallback(async () => {
    setLoading(true);
    try {
      await addPaymentMethod();
    } catch (err) {
      setLoading(false);
    }
  }, [addPaymentMethod]);

  if (!renewal?.needsPaymentMethod || !renewal.renewsAt) {
    return null;
  }

  const days = Math.max(
    Math.ceil((renewal.renewsAt * 1000 - Date.now()) / 86400000),
    0
  );

  return (
    <div className="bg-btnPrimary text-white px-[16px] py-[8px] rounded-[8px] text-[14px] font-[500] flex items-center justify-center gap-[12px] mobile:flex-col mobile:gap-[8px] mb-[8px]">
      <div className="text-center">
        {days === 1
          ? t(
              'trial_banner_one_day_left',
              'Your free trial ends tomorrow. Add a card to keep your plan and your scheduled posts.'
            )
          : t(
              'trial_banner_days_left',
              'Your free trial ends in {{days}} days. Add a card to keep your plan and your scheduled posts.',
              { days }
            )}
      </div>
      <button
        type="button"
        disabled={loading}
        onClick={add}
        className="h-[30px] px-[12px] rounded-[6px] bg-white text-btnPrimary text-[13px] font-[600] shrink-0 hover:opacity-90 transition-opacity disabled:opacity-60"
      >
        {t('add_a_card', 'Add a card')}
      </button>
    </div>
  );
};

// Shown while a trial that started without a card is running. Only admins
// can add the card, so members never see it.
export const TrialBanner: FC = () => {
  const user = useUser();
  if (!user?.isTrailing || user.role === 'USER') {
    return null;
  }
  return <TrialBannerInner />;
};
