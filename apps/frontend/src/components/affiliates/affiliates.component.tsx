'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Input } from '@gitroom/react/form/input';
import { Button } from '@gitroom/react/form/button';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { CopyButton } from '@gitroom/frontend/components/public-api/public.component';
import { fromUtc } from '@gitroom/frontend/components/layout/set.timezone';

type CommissionStatus = 'PENDING' | 'APPROVED' | 'PAID' | 'REVERSED';

interface AffiliateOverview {
  code: string;
  customCodeSet: boolean;
  payoutEmail: string | null;
  links: { landing: string; register: string };
  terms: {
    commissionPercent: number;
    commissionMonths: number;
    holdDays: number;
    cookieDays: number;
    minPayoutUsd: number;
  };
  stats: {
    signups: number;
    payingCustomers: number;
    currency: string;
    pendingCents: number;
    approvedCents: number;
    paidCents: number;
    reversedCents: number;
  };
  commissions: {
    id: string;
    date: string;
    organization: string;
    amountCents: number;
    reversedCents: number;
    currency: string;
    status: CommissionStatus;
  }[];
}

export const useAffiliateOverview = () => {
  const fetch = useFetch();
  return useSWR<AffiliateOverview>(
    '/affiliates',
    async () => {
      const response = await fetch('/affiliates');
      if (!response.ok) {
        throw new Error('Failed to load affiliate data');
      }
      return response.json();
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};

export const formatCents = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);

const card =
  'rounded-[12px] border border-newTableBorder bg-newBgColorInner shadow-previewShadow p-[24px] mobile:p-[16px] flex flex-col gap-[16px]';

const StatCard: FC<{ label: string; value: string; color?: string }> = ({
  label,
  value,
  color,
}) => (
  <div className="border border-newTableBorder rounded-[12px] p-[16px] bg-newBgColorInner flex flex-col gap-[4px] min-w-0">
    <div className="text-[13px] text-textItemBlur">{label}</div>
    <div className={clsx('text-[24px] font-[600] truncate', color)}>
      {value}
    </div>
  </div>
);

const LinkRow: FC<{ label: string; value: string; copyLabel: string }> = ({
  label,
  value,
  copyLabel,
}) => (
  <div className="flex flex-col gap-[6px]">
    <div className="text-[14px]">{label}</div>
    <div className="flex items-center gap-[8px] mobile:flex-col mobile:items-stretch">
      <div className="flex-1 min-w-0 h-[42px] px-[16px] rounded-[8px] border border-newTableBorder bg-newBgColorInner flex items-center text-[14px] text-textItemBlur">
        <span className="truncate" dir="ltr">
          {value}
        </span>
      </div>
      <CopyButton text={value} label={copyLabel} />
    </div>
  </div>
);

const useErrorMessage = () => {
  const t = useT();
  return useCallback(
    async (response: Response) =>
      (await response.json().catch(() => ({}))).message ||
      t('affiliates_save_failed', 'Something went wrong, please try again'),
    [t]
  );
};

const VanityCode: FC<{ data: AffiliateOverview; reload: () => void }> = ({
  data,
  reload,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const errorMessage = useErrorMessage();
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    const response = await fetch('/affiliates/code', {
      method: 'POST',
      body: JSON.stringify({ code: code.trim().toLowerCase() }),
    });
    setSaving(false);
    if (!response.ok) {
      toaster.show(await errorMessage(response), 'warning');
      return;
    }
    toaster.show(t('affiliates_code_saved', 'Code saved'), 'success');
    setCode('');
    reload();
  }, [code, fetch, toaster, errorMessage, reload, t]);

  return (
    <div className={card}>
      <div className="flex flex-col gap-[4px]">
        <div className="text-[18px] font-[600]">
          {t('affiliates_vanity_title', 'Custom code')}
        </div>
        <div className="text-[14px] text-textItemBlur">
          {data.customCodeSet
            ? t(
                'affiliates_vanity_locked',
                'Your custom code is set and cannot be changed.'
              )
            : t(
                'affiliates_vanity_description',
                'Choose a short code for your links, 3 to 24 letters, numbers or hyphens. You can do this once.'
              )}
        </div>
      </div>
      {!data.customCodeSet && (
        <div className="flex items-start gap-[8px] mobile:flex-col mobile:items-stretch">
          <div className="flex-1">
            <Input
              label=""
              name="affiliateCode"
              disableForm={true}
              removeError={true}
              value={code}
              maxLength={24}
              placeholder={data.code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <Button
            onClick={save}
            loading={saving}
            disabled={code.trim().length < 3}
            className="rounded-[8px] h-[42px]"
          >
            {t('affiliates_save', 'Save')}
          </Button>
        </div>
      )}
    </div>
  );
};

const PayoutDetails: FC<{ data: AffiliateOverview; reload: () => void }> = ({
  data,
  reload,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const errorMessage = useErrorMessage();
  const [email, setEmail] = useState(data.payoutEmail || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEmail(data.payoutEmail || '');
  }, [data.payoutEmail]);

  const save = useCallback(async () => {
    setSaving(true);
    const response = await fetch('/affiliates/payout', {
      method: 'POST',
      body: JSON.stringify({ payoutEmail: email.trim() }),
    });
    setSaving(false);
    if (!response.ok) {
      toaster.show(await errorMessage(response), 'warning');
      return;
    }
    toaster.show(
      t('affiliates_payout_saved', 'Payout details saved'),
      'success'
    );
    reload();
  }, [email, fetch, toaster, errorMessage, reload, t]);

  return (
    <div className={card}>
      <div className="flex flex-col gap-[4px]">
        <div className="text-[18px] font-[600]">
          {t('affiliates_payout_title', 'Payout details')}
        </div>
        <div className="text-[14px] text-textItemBlur">
          {t(
            'affiliates_payout_description',
            'Payouts are sent manually through PayPal once your approved balance reaches {{amount}}.',
            { amount: formatCents(data.terms.minPayoutUsd * 100, 'usd') }
          )}
        </div>
      </div>
      <div className="flex items-end gap-[8px] mobile:flex-col mobile:items-stretch">
        <div className="flex-1">
          <Input
            label={t('affiliates_payout_email', 'PayPal email')}
            name="payoutEmail"
            type="email"
            disableForm={true}
            removeError={true}
            value={email}
            maxLength={254}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button
          onClick={save}
          loading={saving}
          disabled={email.trim() === (data.payoutEmail || '')}
          className="rounded-[8px] h-[42px]"
        >
          {t('affiliates_save', 'Save')}
        </Button>
      </div>
      <div className="text-[13px] text-textItemBlur">
        {t(
          'affiliates_payout_privacy',
          'This email is personal data. It is stored as plain text and used only to pay you.'
        )}
      </div>
    </div>
  );
};

const CommissionsTable: FC<{ data: AffiliateOverview }> = ({ data }) => {
  const t = useT();
  const statuses: Record<CommissionStatus, { label: string; color: string }> =
    {
      PENDING: {
        label: t('affiliates_pending', 'Pending'),
        color: 'text-[#FFAC30]',
      },
      APPROVED: {
        label: t('affiliates_approved', 'Approved'),
        color: 'text-[#32D583]',
      },
      PAID: {
        label: t('affiliates_paid', 'Paid'),
        color: 'text-[#32D583]',
      },
      REVERSED: {
        label: t('affiliates_reversed', 'Reversed'),
        color: 'text-[#F97066]',
      },
    };
  const columns =
    'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-[16px] items-center px-[16px]';

  return (
    <div className={card}>
      <div className="text-[18px] font-[600]">
        {t('affiliates_commissions', 'Commissions')}
      </div>
      <div className="flex flex-col">
        <div
          className={clsx(
            columns,
            'h-[48px] rounded-[8px] border border-newTableBorder bg-newTableHeader text-[14px] text-newTableText mobile:hidden'
          )}
        >
          <div>{t('affiliates_date', 'Date')}</div>
          <div>{t('affiliates_customer', 'Customer')}</div>
          <div>{t('affiliates_amount', 'Commission')}</div>
          <div>{t('affiliates_status', 'Status')}</div>
        </div>
        {!data.commissions.length ? (
          <div className="py-[40px] px-[16px] text-center text-[15px] text-newTableText">
            {t(
              'affiliates_no_commissions',
              'No commissions yet. They show up here when a customer you referred pays.'
            )}
          </div>
        ) : (
          data.commissions.map((row) => {
            const status = statuses[row.status];
            return (
              <div
                key={row.id}
                className={clsx(
                  columns,
                  'min-h-[56px] py-[12px] border-b border-newTableBorder last:border-b-0 text-[14px] mobile:grid-cols-[minmax(0,1fr)_auto] mobile:gap-y-[6px] mobile:px-0'
                )}
              >
                <div className="mobile:col-start-1 mobile:row-start-2 mobile:text-[13px] mobile:text-textItemBlur">
                  <bdi>{fromUtc(row.date).format('D MMM, YYYY')}</bdi>
                </div>
                <div className="truncate mobile:col-start-1 mobile:row-start-1">
                  <bdi>{row.organization}</bdi>
                </div>
                <div className="font-[500] mobile:col-start-2 mobile:row-start-1 mobile:text-end">
                  {formatCents(
                    row.amountCents - row.reversedCents,
                    row.currency
                  )}
                  {row.reversedCents > 0 && (
                    <div className="text-[12px] font-[400] text-textItemBlur">
                      {t('affiliates_reversed_note', '{{amount}} reversed', {
                        amount: formatCents(row.reversedCents, row.currency),
                      })}
                    </div>
                  )}
                </div>
                <div
                  className={clsx(
                    'flex items-center gap-[8px] font-[500] mobile:col-start-2 mobile:row-start-2 mobile:justify-end',
                    status.color
                  )}
                >
                  <span className="w-[8px] h-[8px] rounded-full bg-current shrink-0" />
                  {status.label}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

const TermsSummary: FC<{ terms: AffiliateOverview['terms'] }> = ({ terms }) => {
  const t = useT();
  return (
    <div className={card}>
      <div className="text-[18px] font-[600]">
        {t('affiliates_terms_title', 'How it works')}
      </div>
      <ul className="flex flex-col gap-[8px] text-[14px] text-textItemBlur list-disc ps-[20px]">
        <li>
          {t(
            'affiliates_terms_commission',
            'You earn {{percent}}% of each payment, without tax, for the first {{months}} months after a customer first pays.',
            {
              percent: terms.commissionPercent,
              months: terms.commissionMonths,
            }
          )}
        </li>
        <li>
          {t(
            'affiliates_terms_hold',
            'Commissions are held for {{days}} days in case of refunds, then approved.',
            { days: terms.holdDays }
          )}
        </li>
        <li>
          {t(
            'affiliates_terms_payout',
            'Approved commissions are paid manually once your balance reaches {{amount}}.',
            { amount: formatCents(terms.minPayoutUsd * 100, 'usd') }
          )}
        </li>
        <li>
          {t(
            'affiliates_terms_cookie',
            'Someone who signs up within {{days}} days of opening your link is attributed to you.',
            { days: terms.cookieDays }
          )}
        </li>
        <li>
          {t(
            'affiliates_terms_rules',
            'Self-referrals, spam and paid search ads on our brand name are not allowed.'
          )}
        </li>
      </ul>
      <a
        href="/legal/affiliate-terms"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[14px] font-[500] underline"
      >
        {t('affiliates_terms_link', 'Read the full affiliate terms')}
      </a>
    </div>
  );
};

export const AffiliatesComponent: FC = () => {
  const t = useT();
  const { data, isLoading, error, mutate } = useAffiliateOverview();
  const reload = useCallback(() => {
    mutate();
  }, [mutate]);

  if (isLoading) {
    return <LoadingComponent />;
  }

  if (error || !data) {
    return (
      <div className="text-[15px] text-textItemBlur">
        {t('affiliates_load_failed', 'Could not load your affiliate data')}
      </div>
    );
  }

  const { stats, terms } = data;
  return (
    <div className="flex flex-col gap-[20px] max-w-[1100px] w-full">
      <div className="flex flex-col gap-[4px]">
        <div className="text-[24px] font-[600]">
          {t('affiliates_title', 'Affiliate program')}
        </div>
        <div className="text-[15px] text-textItemBlur">
          {t(
            'affiliates_intro',
            'Earn {{percent}}% of every payment from the customers you refer, for {{months}} months.',
            {
              percent: terms.commissionPercent,
              months: terms.commissionMonths,
            }
          )}
        </div>
      </div>

      <div className={card}>
        <div className="text-[18px] font-[600]">
          {t('affiliates_links', 'Your referral links')}
        </div>
        <LinkRow
          label={t('affiliates_landing_link', 'Website link')}
          value={data.links.landing}
          copyLabel={t('affiliates_copy', 'Copy')}
        />
        <LinkRow
          label={t('affiliates_register_link', 'Sign-up link')}
          value={data.links.register}
          copyLabel={t('affiliates_copy', 'Copy')}
        />
        <LinkRow
          label={t('affiliates_your_code', 'Your code')}
          value={data.code}
          copyLabel={t('affiliates_copy', 'Copy')}
        />
      </div>

      <div className="grid grid-cols-3 mobile:grid-cols-2 gap-[12px]">
        <StatCard
          label={t('affiliates_signups', 'Signups referred')}
          value={stats.signups.toLocaleString()}
        />
        <StatCard
          label={t('affiliates_paying', 'Paying customers')}
          value={stats.payingCustomers.toLocaleString()}
        />
        <StatCard
          label={t('affiliates_pending', 'Pending')}
          value={formatCents(stats.pendingCents, stats.currency)}
          color="text-[#FFAC30]"
        />
        <StatCard
          label={t('affiliates_approved', 'Approved')}
          value={formatCents(stats.approvedCents, stats.currency)}
          color="text-[#32D583]"
        />
        <StatCard
          label={t('affiliates_paid', 'Paid')}
          value={formatCents(stats.paidCents, stats.currency)}
        />
        <StatCard
          label={t('affiliates_reversed', 'Reversed')}
          value={formatCents(stats.reversedCents, stats.currency)}
          color="text-[#F97066]"
        />
      </div>

      <div className="grid grid-cols-2 mobile:grid-cols-1 gap-[20px]">
        <VanityCode data={data} reload={reload} />
        <PayoutDetails data={data} reload={reload} />
      </div>

      <CommissionsTable data={data} />
      <TermsSummary terms={terms} />
    </div>
  );
};
