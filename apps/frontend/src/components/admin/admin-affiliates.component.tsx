'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { Button } from '@gitroom/react/form/button';
import { formatCents } from '@gitroom/frontend/components/affiliates/affiliates.component';

interface Payout {
  affiliateId: string;
  code: string;
  userEmail: string;
  payoutEmail: string | null;
  commissions: number;
  totalCents: number;
  currency: string;
  meetsMinimum: boolean;
}

const useAffiliatePayouts = () => {
  const fetch = useFetch();
  return useSWR<Payout[]>(
    '/admin/affiliates/payouts',
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error('Failed to load payouts');
      }
      return res.json();
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};

const PayoutRow: FC<{ payout: Payout; reload: () => void }> = ({
  payout,
  reload,
}) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);

  const markPaid = useCallback(async () => {
    const amount = formatCents(payout.totalCents, payout.currency);
    if (
      !(await deleteDialog(
        `Mark ${amount} as paid to ${payout.payoutEmail || payout.userEmail}? Send the money first, no payment is made from here.`,
        'Mark as paid',
        'Mark as paid'
      ))
    ) {
      return;
    }

    setSaving(true);
    const response = await fetch(
      `/admin/affiliates/payouts/${payout.affiliateId}/paid`,
      {
        method: 'POST',
        body: JSON.stringify({
          expectedAmountCents: payout.totalCents,
          reference: reference.trim() || undefined,
        }),
      }
    );
    setSaving(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      toaster.show(body.message || 'Could not mark as paid', 'warning');
      reload();
      return;
    }
    toaster.show('Marked as paid', 'success');
    reload();
  }, [payout, reference, fetch, toaster, reload]);

  return (
    <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.5fr)_100px_120px_minmax(0,1.5fr)_140px] gap-[12px] px-[12px] py-[10px] text-[13px] items-center border-b border-newTableBorder last:border-b-0 mobile:grid-cols-1">
      <div className="truncate">
        <div>{payout.userEmail}</div>
        <div className="opacity-70">{payout.code}</div>
      </div>
      <div className="truncate">
        {payout.payoutEmail || <span className="opacity-70">No payout details</span>}
      </div>
      <div>{payout.commissions}</div>
      <div className="font-[600]">
        {formatCents(payout.totalCents, payout.currency)}
        {!payout.meetsMinimum && (
          <div className="text-[12px] font-[400] opacity-70">Below minimum</div>
        )}
      </div>
      <input
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        maxLength={200}
        placeholder="Payment reference (optional)"
        className="h-[36px] px-[12px] rounded-[8px] bg-newBgColorInner border border-newTableBorder outline-none text-[13px]"
      />
      <Button
        onClick={markPaid}
        loading={saving}
        className="rounded-[8px] h-[36px] text-[13px]"
      >
        Mark as paid
      </Button>
    </div>
  );
};

export const AdminAffiliatesComponent: FC = () => {
  const user = useUser();
  const { data, isLoading, error, mutate } = useAffiliatePayouts();
  const reload = useCallback(() => {
    mutate();
  }, [mutate]);

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
      <div className="flex items-center justify-between">
        <div className="text-[20px] font-[600]">Affiliate payouts</div>
        <div className="text-[13px] opacity-70">
          Approved and unpaid commissions
        </div>
      </div>
      {error ? (
        <div className="text-[13px] opacity-70">Failed to load payouts.</div>
      ) : (
        <div className="border border-newTableBorder rounded-[8px] overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.5fr)_100px_120px_minmax(0,1.5fr)_140px] gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder mobile:hidden">
            <div>Affiliate</div>
            <div>Payout email</div>
            <div>Items</div>
            <div>Total</div>
            <div>Reference</div>
            <div />
          </div>
          {!data?.length ? (
            <div className="px-[12px] py-[10px] text-[13px] opacity-70">
              Nothing to pay out.
            </div>
          ) : (
            data.map((payout) => (
              <PayoutRow
                key={payout.affiliateId}
                payout={payout}
                reload={reload}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};
