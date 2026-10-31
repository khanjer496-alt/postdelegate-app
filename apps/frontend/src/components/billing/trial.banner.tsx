'use client';

import { FC, useCallback, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
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

// Whole days left, rounded up like the trial emails, never negative
export const trialDaysLeft = (renewsAt: number, now = Date.now()) =>
  Math.max(Math.ceil((renewsAt * 1000 - now) / 86400000), 0);

const DISMISS_KEY = 'trial-countdown-dismissed';

const readDismissed = (orgId: string) => {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === orgId;
  } catch (e) {
    return false;
  }
};

const TrialCountdownInner: FC<{ orgId: string }> = ({ orgId }) => {
  const t = useT();
  const { data: renewal } = useRenewal();
  const addPaymentMethod = useAddPaymentMethod();
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(() => readDismissed(orgId));

  const add = useCallback(async () => {
    setLoading(true);
    try {
      await addPaymentMethod();
    } catch (err) {
      setLoading(false);
    }
  }, [addPaymentMethod]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, orgId);
    } catch (e) {
      // private mode, it stays hidden until the page reloads
    }
  }, [orgId]);

  if (dismissed || !renewal?.trialing || !renewal.renewsAt) {
    return null;
  }

  const days = trialDaysLeft(renewal.renewsAt);
  const needsCard = renewal.needsPaymentMethod;
  // a trial that ends without a card stops the plan, warn hard at the end
  const urgent = needsCard && days <= 2;

  const text =
    days === 0
      ? t('trial_countdown_today', 'Your trial ends today')
      : days === 1
      ? t('trial_countdown_one_day', '1 day left in your trial')
      : t('trial_countdown_days', '{{days}} days left in your trial', {
          days,
        });

  return (
    <div
      role="group"
      data-trial-countdown=""
      aria-label={t('trial_countdown_label', 'Free trial')}
      className={clsx(
        'flex items-center h-[32px] rounded-full border text-[13px] font-[500] whitespace-nowrap overflow-hidden',
        urgent
          ? 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400'
          : 'border-newBorder bg-btnSimple text-newTextColor'
      )}
    >
      {needsCard ? (
        <button
          type="button"
          onClick={add}
          disabled={loading}
          data-tooltip-id="tooltip"
          data-tooltip-content={t(
            'trial_countdown_add_card_hint',
            'Add a card to keep your plan and your scheduled posts when the trial ends.'
          )}
          className="h-full flex items-center gap-[6px] ps-[12px] pe-[10px] xs:ps-[10px] xs:pe-[6px] hover:opacity-80 disabled:opacity-60 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-btnPrimary rounded-s-full"
        >
          <span
            aria-hidden="true"
            className={clsx(
              'w-[6px] h-[6px] rounded-full shrink-0 xs:hidden',
              urgent ? 'bg-red-500' : 'bg-btnPrimary dark:bg-btnCta'
            )}
          />
          <span className="mobile:hidden">{text}</span>
          {/* phones: the bare day count, the full sentence stays for screen readers */}
          <span className="hidden mobile:inline" aria-hidden="true">
            {t('trial_countdown_compact', '{{days}}d', { days })}
          </span>
          <span className="hidden mobile:inline sr-only">{text}</span>
          <span aria-hidden="true" className="opacity-50 xs:hidden">
            ·
          </span>
          <span className="font-[600] underline underline-offset-2">
            {t('trial_countdown_add_card', 'Add card')}
          </span>
        </button>
      ) : (
        <Link
          href="/billing"
          className="h-full flex items-center gap-[6px] ps-[12px] pe-[10px] hover:opacity-80 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-btnPrimary rounded-s-full"
        >
          <span
            aria-hidden="true"
            className="w-[6px] h-[6px] rounded-full shrink-0 bg-btnPrimary dark:bg-btnCta"
          />
          <span className="mobile:hidden">{text}</span>
          <span className="hidden mobile:inline">
            {t('trial_countdown_short', '{{days}}d left', { days })}
          </span>
        </Link>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('trial_countdown_dismiss', 'Hide for now')}
        title={t('trial_countdown_dismiss', 'Hide for now')}
        className="h-full w-[28px] flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-btnPrimary rounded-e-full"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
};

// Top bar countdown while the workspace is trialing. Only admins can add the
// card, so members never see it, and paid or lifetime plans don't trial.
export const TrialCountdown: FC = () => {
  const user = useUser();
  if (!user?.isTrailing || user.role === 'USER' || user.isLifetime) {
    return null;
  }
  return <TrialCountdownInner orgId={user.orgId} />;
};
