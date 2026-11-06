'use client';

import { FC, useCallback, useId, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { CopyButton } from '@gitroom/frontend/components/public-api/public.component';
import { fromUtc } from '@gitroom/frontend/components/layout/set.timezone';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import {
  readError,
  useApprovalLinks,
} from '@gitroom/frontend/components/approvals/approvals.hooks';

const EXPIRY_DAYS = [1, 3, 7, 14, 30] as const;

// Creates a link a client opens without an account to approve the posts, and
// lists the links that still work so they can be turned off
export const ShareApprovalModal: FC<{
  postIds: string[];
  onCreated?: () => void;
}> = ({ postIds, onCreated }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const expiryId = useId();
  const [days, setDays] = useState<(typeof EXPIRY_DAYS)[number]>(7);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<{ url: string; expiresAt: string }>();
  const { data: links, mutate } = useApprovalLinks();

  const create = useCallback(async () => {
    setLoading(true);
    const response = await fetch('/approvals/links', {
      method: 'POST',
      body: JSON.stringify({ postIds, expiresInDays: days }),
    });
    setLoading(false);
    if (!response.ok) {
      toaster.show(
        await readError(
          response,
          t('approval_link_failed', 'Could not create the link')
        ),
        'warning'
      );
      return;
    }
    setCreated(await response.json());
    mutate();
    onCreated?.();
  }, [days, postIds, fetch, toaster, t, mutate, onCreated]);

  const revoke = useCallback(
    async (id: string) => {
      if (
        !(await deleteDialog(
          t(
            'approval_link_revoke_confirm',
            'Anyone with this link will no longer be able to open it.'
          ),
          t('approval_link_turn_off', 'Turn off link'),
          t('approval_link_turn_off_title', 'Turn off this link?'),
          t('approval_cancel', 'Cancel'),
          true
        ))
      ) {
        return;
      }
      const response = await fetch(`/approvals/links/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        toaster.show(
          t('approval_link_revoke_failed', 'Could not turn off the link'),
          'warning'
        );
        return;
      }
      toaster.show(t('approval_link_revoked', 'Link turned off'), 'success');
      mutate();
    },
    [fetch, toaster, t, mutate]
  );

  // links that include one of these posts and still work
  const active = (links || []).filter(
    (link) =>
      link.status === 'active' &&
      link.postIds.some((id) => postIds.includes(id))
  );

  return (
    <div className="flex flex-col gap-[20px] w-full text-newTextColor">
      <p className="text-[14px] text-textItemBlur">
        {t(
          'approval_share_description',
          "Your client opens the link without an account, sees the post as it will look, and approves it or asks for changes. While it waits, the post won't publish."
        )}
      </p>

      {!created ? (
        <div className="flex flex-col gap-[12px]">
          <label htmlFor={expiryId} className="text-[14px] font-[600]">
            {t('approval_link_expires_after', 'Link stops working after')}
          </label>
          <select
            id={expiryId}
            value={days}
            onChange={(e) => setDays(+e.target.value as any)}
            className="h-[44px] rounded-[8px] border border-newTableBorder bg-newBgColor px-[12px] text-[14px] text-newTextColor outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
          >
            {EXPIRY_DAYS.map((value) => (
              <option key={value} value={value}>
                {value === 1
                  ? t('approval_one_day', '1 day')
                  : t('approval_n_days', '{{count}} days', { count: value })}
              </option>
            ))}
          </select>
          <div className="flex justify-end">
            <Button
              loading={loading}
              onClick={create}
              className="rounded-[8px]"
            >
              {t('approval_create_link', 'Create link')}
            </Button>
          </div>
        </div>
      ) : (
        <div
          className="flex flex-col gap-[10px] rounded-[12px] border border-newTableBorder bg-newBgColor p-[16px]"
          role="status"
        >
          <div className="text-[14px] font-[600]">
            {t('approval_link_ready', 'Your link is ready')}
          </div>
          <div className="text-[13px] text-textItemBlur">
            {t(
              'approval_link_once',
              "Copy it now, it won't be shown again. It works until {{date}}.",
              {
                date: fromUtc(created.expiresAt).format('D MMM YYYY, HH:mm'),
              }
            )}
          </div>
          <div className="flex items-center gap-[8px] mobile:flex-col mobile:items-stretch">
            <input
              readOnly
              value={created.url}
              aria-label={t('approval_link', 'Approval link')}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 h-[36px] rounded-[8px] border border-newTableBorder bg-newBgColorInner px-[10px] text-[13px] text-newTextColor outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
            />
            <CopyButton text={created.url} label={t('approval_link', 'Approval link')} />
          </div>
        </div>
      )}

      {!!active.length && (
        <div className="flex flex-col gap-[8px]">
          <div className="text-[14px] font-[600]">
            {t('approval_active_links', 'Links that work now')}
          </div>
          <ul className="flex flex-col divide-y divide-newTableBorder rounded-[12px] border border-newTableBorder">
            {active.map((link) => (
              <li
                key={link.id}
                className="flex items-center gap-[12px] px-[12px] py-[10px] text-[13px]"
              >
                <div className="flex-1 min-w-0">
                  <div>
                    {link.postIds.length === 1
                      ? t('approval_link_one_post', '1 post')
                      : t('approval_link_n_posts', '{{count}} posts', {
                          count: link.postIds.length,
                        })}
                    {' · '}
                    {t('approval_link_until', 'until {{date}}', {
                      date: fromUtc(link.expiresAt).format('D MMM, HH:mm'),
                    })}
                  </div>
                  <div className="text-textItemBlur">
                    {link.lastViewedAt
                      ? t('approval_link_opened', 'Opened {{when}}', {
                          when: fromUtc(link.lastViewedAt).fromNow(),
                        })
                      : t('approval_link_not_opened', 'Not opened yet')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => revoke(link.id)}
                  className={clsx(
                    'shrink-0 h-[32px] px-[12px] rounded-[8px] text-[13px] font-[600] text-red-500 hover:bg-boxHover outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary'
                  )}
                >
                  {t('approval_link_turn_off', 'Turn off link')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
