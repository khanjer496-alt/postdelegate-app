'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import ReactLoading from '@gitroom/frontend/components/layout/loading';
import { usePaymentAction } from '@gitroom/frontend/components/billing/use.payment.action';
import { timer } from '@gitroom/helpers/utils/timer';

type ExtraChannelsInfo = {
  available: boolean;
  trialing?: boolean;
  extraChannels?: number;
  includedChannels?: number;
  activeChannels?: number;
  unitPrice?: number;
  period?: 'MONTHLY' | 'YEARLY';
  max?: number;
};

export const useExtraChannels = () => {
  const fetch = useFetch();
  return useSWR<ExtraChannelsInfo>(
    '/billing/extra-channels',
    async () => {
      const response = await fetch('/billing/extra-channels');
      if (!response.ok) {
        throw new Error('Failed to load extra channels');
      }
      return response.json();
    },
    {
      revalidateOnFocus: false,
    }
  );
};

const stepButton =
  'w-[44px] h-[44px] rounded-[8px] bg-btnSimple text-btnText text-[20px] flex items-center justify-center transition-opacity hover:opacity-80 disabled:opacity-40 disabled:cursor-default';

const ExtraChannelsControl: FC<{
  info: Required<ExtraChannelsInfo>;
}> = ({ info }) => {
  const t = useT();
  const fetch = useFetch();
  const toast = useToaster();
  const paymentAction = usePaymentAction();
  const { mutate } = useSWRConfig();
  const queryParams = useSearchParams();
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(info.extraChannels);
  const [loading, setLoading] = useState(false);
  const highlight = !!queryParams.get('extraChannels');

  useEffect(() => {
    setValue(info.extraChannels);
  }, [info.extraChannels]);

  useEffect(() => {
    if (highlight) {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlight]);

  // never below the channels already connected
  const min = Math.max(0, info.activeChannels - info.includedChannels);
  const yearly = info.period === 'YEARLY';
  const cost = Math.round(value * info.unitPrice * 100) / 100;
  const disabled = info.trialing || loading;

  const change = useCallback(
    (next: number) => {
      if (Number.isNaN(next)) {
        return;
      }
      setValue(Math.min(info.max, Math.max(0, Math.floor(next))));
    },
    [info.max]
  );

  const confirmed = useCallback(async (target: number) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      await timer(1000);
      try {
        const current = await (await fetch('/billing/extra-channels')).json();
        if (current?.extraChannels === target) {
          return true;
        }
      } catch (err) {
        // keep waiting
      }
    }
    return false;
  }, []);

  const save = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/billing/extra-channels', {
        method: 'POST',
        body: JSON.stringify({ extraChannels: value }),
      });
      const result = await response.json();
      if (!response.ok) {
        toast.show(
          result?.message ||
            t(
              'extra_channels_update_failed',
              'Your extra channels could not be updated'
            ),
          'warning'
        );
        return;
      }
      if (result.requiresAction) {
        const { error } = await paymentAction(result.clientSecret);
        if (error) {
          toast.show(error, 'warning');
          return;
        }
      }
      // a change waiting for its payment is stored by the Stripe webhook once
      // it is paid: wait for it like a plan change does
      if (result.pending && !(await confirmed(value))) {
        toast.show(
          t(
            'extra_channels_payment_processing',
            'Your payment is processing. Your extra channels update as soon as it goes through.'
          )
        );
        return;
      }
      toast.show(
        t('extra_channels_updated', 'Your extra channels were updated')
      );
    } catch (err) {
      toast.show(
        t(
          'extra_channels_update_failed',
          'Your extra channels could not be updated'
        ),
        'warning'
      );
    } finally {
      mutate('/billing/extra-channels');
      mutate('/user/subscription');
      mutate('/billing/invoices');
      setLoading(false);
    }
  }, [value, paymentAction, confirmed]);

  return (
    <div
      ref={ref}
      className={clsx(
        'flex items-center gap-[16px] rounded-[12px] border bg-newBgColorInner shadow-previewShadow px-[24px] py-[20px] mobile:flex-col mobile:items-stretch mobile:p-[16px]',
        highlight ? 'border-btnPrimary' : 'border-newTableBorder'
      )}
    >
      <div className="w-[48px] h-[48px] rounded-full bg-[#7357ff]/10 text-btnPrimary flex items-center justify-center shrink-0 mobile:hidden">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      </div>
      <div className="flex-1 flex flex-col gap-[4px]">
        <div className="text-[16px] font-[600]">
          {t('extra_channels', 'Extra channels')}
        </div>
        <div className="text-[14px] text-textItemBlur">
          {t(
            'extra_channels_description',
            'Your plan includes {{included}} channels. Add more for ${{price}} {{period}} each.',
            {
              included: info.includedChannels,
              price: info.unitPrice.toFixed(info.unitPrice % 1 ? 2 : 0),
              period: yearly
                ? t('extra_channels_a_year', 'a year')
                : t('extra_channels_a_month', 'a month'),
            }
          )}{' '}
          {info.trialing
            ? t(
                'extra_channels_after_trial',
                'You can add them once your trial ends, or finish the trial now to add them today.'
              )
            : t(
                'extra_channels_proration',
                'Changes are prorated: adding channels charges the rest of this billing period today, removing them credits your next invoice.'
              )}
        </div>
        <div className="text-[14px]">
          <bdi className="font-[600]">
            {t('extra_channels_total', '{{total}} channels in total', {
              total: info.includedChannels + value,
            })}
          </bdi>
          {value > 0 && (
            <span className="text-textItemBlur">
              {' · '}${cost.toFixed(cost % 1 ? 2 : 0)}{' '}
              {yearly
                ? t('billing_per_year', '/ year')
                : t('billing_per_month', '/ month')}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-[8px] mobile:justify-between">
        <button
          type="button"
          aria-label={t('extra_channels_remove_one', 'Remove one channel')}
          className={stepButton}
          disabled={disabled || value <= min}
          onClick={() => change(value - 1)}
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          aria-label={t('extra_channels', 'Extra channels')}
          min={min}
          max={info.max}
          value={value}
          disabled={disabled}
          onChange={(e) => change(parseInt(e.target.value || '0', 10))}
          className="w-[72px] h-[44px] rounded-[8px] border border-newTableBorder bg-newBgColor text-center text-[16px] font-[600] outline-none disabled:opacity-60"
        />
        <button
          type="button"
          aria-label={t('extra_channels_add_one', 'Add one channel')}
          className={stepButton}
          disabled={disabled || value >= info.max}
          onClick={() => change(value + 1)}
        >
          +
        </button>
        <button
          type="button"
          disabled={disabled || value === info.extraChannels || value < min}
          onClick={save}
          className="h-[44px] min-w-[96px] px-[16px] rounded-[8px] bg-btnCta shadow-cta text-btnCtaText text-[14px] font-[600] hover:bg-btnCtaHover transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-default"
        >
          {loading ? (
            <ReactLoading
              type="spin"
              color="currentColor"
              width={18}
              height={18}
            />
          ) : (
            t('save', 'Save')
          )}
        </button>
      </div>
    </div>
  );
};

// Ultimate (any tier that sells extra channels) buys channels above its own
export const ExtraChannels: FC = () => {
  const { data } = useExtraChannels();
  if (!data?.available) {
    return null;
  }
  return <ExtraChannelsControl info={data as Required<ExtraChannelsInfo>} />;
};
