'use client';

import { FC, useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useSWRConfig } from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { fromUtc } from '@gitroom/frontend/components/layout/set.timezone';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';
import { ExistingDataContextProvider } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { AddEditModal } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import {
  ReviewItem,
  useApprovalSettings,
  useReviewQueue,
} from '@gitroom/frontend/components/approvals/approvals.hooks';
import { ApprovalStatusBadge } from '@gitroom/frontend/components/approvals/approval.status.badge';
import { useApprovalActions } from '@gitroom/frontend/components/approvals/approval.actions';

const actionClass =
  'h-[36px] px-[14px] rounded-[8px] text-[13px] font-[600] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary disabled:opacity-50 disabled:cursor-not-allowed';

const firstThumbnail = (image?: string | null) => {
  try {
    const media = JSON.parse(image || '[]');
    const first = Array.isArray(media) ? media[0] : undefined;
    if (!first?.path) return undefined;
    if (first.thumbnail) return first.thumbnail as string;
    return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(first.path)
      ? undefined
      : (first.path as string);
  } catch {
    return undefined;
  }
};

// Opens a post in the editor, the same way the calendar does
const useOpenEditor = (onSaved: () => void) => {
  const fetch = useFetch();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();
  const { data: integrations } = useIntegrationList();

  const open = useCallback(
    async (group: string) => {
      const data = await (await fetch(`/posts/group/${group}`)).json();
      if (!data?.posts?.length) {
        toaster.show(t('post_not_found', 'Post not found'), 'warning');
        onSaved();
        return;
      }
      const list = integrations || [];
      modal.openModal({
        id: 'add-edit-modal',
        closeOnClickOutside: false,
        removeLayout: true,
        closeOnEscape: false,
        withCloseButton: false,
        askClose: true,
        fullScreen: true,
        classNames: {
          modal: 'w-[100%] max-w-[1400px] text-textColor',
        },
        children: (
          <ExistingDataContextProvider value={data}>
            <AddEditModal
              allIntegrations={list.map((p: any) => ({ ...p }))}
              reopenModal={() => open(group)}
              mutate={onSaved}
              integrations={list
                .filter((f: any) => f.id === data.integration)
                .map((p: any) => ({
                  ...p,
                  picture: data.integrationPicture,
                }))}
              date={fromUtc(data.posts[0].publishDate)}
            />
          </ExistingDataContextProvider>
        ),
        size: '80%',
        title: ``,
      });
    },
    [fetch, modal, toaster, t, integrations, onSaved]
  );

  return open;
};

const ReviewCard: FC<{
  item: ReviewItem;
  canApprove: boolean;
  selected: boolean;
  onSelect: (value: boolean) => void;
  onChanged: () => void;
  onEdit: () => void;
}> = ({ item, canApprove, selected, onSelect, onChanged, onEdit }) => {
  const t = useT();
  const actions = useApprovalActions();
  const [busy, setBusy] = useState(false);
  const text = useMemo(
    () =>
      stripHtmlValidation('normal', item.content || '', false, true)
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    [item.content]
  );
  const thumbnail = firstThumbnail(item.image);
  const passed = dayjs(item.publishDate).isBefore(dayjs());
  const date = fromUtc(item.publishDate).format(
    isUSCitizen() ? 'ddd, MMM D, hh:mm A' : 'ddd, D MMM, HH:mm'
  );

  const run = useCallback(
    async (action: () => Promise<boolean>) => {
      setBusy(true);
      const changed = await action();
      setBusy(false);
      if (changed) {
        onChanged();
      }
    },
    [onChanged]
  );

  return (
    <li className="rounded-[12px] border border-newTableBorder bg-newBgColorInner p-[16px] mobile:p-[12px] flex gap-[12px]">
      {canApprove && (
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={t('review_select_post', 'Select post for {{channel}}', {
            channel: item.integration.name,
          })}
          className="mt-[4px] w-[18px] h-[18px] shrink-0 accent-btnPrimary cursor-pointer"
        />
      )}
      <div className="flex-1 min-w-0 flex flex-col gap-[10px]">
        <div className="flex items-center gap-[10px] flex-wrap">
          <div className="relative shrink-0 w-[32px] h-[32px]" aria-hidden="true">
            <img
              src={item.integration.picture || '/no-picture.jpg'}
              alt=""
              className="w-full h-full rounded-full object-cover"
              onError={(e) => {
                e.currentTarget.src = '/no-picture.jpg';
              }}
            />
            <img
              src={`/icons/platforms/${item.integration.providerIdentifier}.png`}
              alt=""
              className="absolute -bottom-[2px] -end-[4px] w-[16px] h-[16px] rounded-[4px] border border-newBgColorInner"
            />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[14px] font-[600] truncate">
              {item.integration.name}
            </span>
            <span className="text-[12px] text-textItemBlur truncate">
              {item.agentSource
                ? t('review_from_agent', 'From {{source}}', {
                    source: item.agentSource,
                  })
                : item.submittedBy
                ? t('review_submitted_by', 'Submitted by {{name}}', {
                    name: item.submittedBy,
                  })
                : t('review_submitted', 'Sent for review')}
              {' · '}
              {fromUtc(item.submittedAt).fromNow()}
            </span>
          </div>
          <span className="flex-1" />
          <ApprovalStatusBadge status={item.approvalStatus} />
        </div>

        <div className="flex gap-[12px]">
          <p className="flex-1 min-w-0 text-[14px] leading-[20px] whitespace-pre-wrap break-words line-clamp-5">
            {text || (
              <span className="text-textItemBlur">
                {t('no_content', 'no content')}
              </span>
            )}
          </p>
          {!!thumbnail && (
            <img
              src={thumbnail}
              alt=""
              className="w-[72px] h-[72px] rounded-[8px] object-cover shrink-0"
            />
          )}
        </div>

        <div
          className={clsx(
            'text-[13px]',
            passed ? 'text-orange-400' : 'text-textItemBlur'
          )}
        >
          {passed
            ? t(
                'review_time_passed',
                'Planned for {{date}}, that time has passed. Approving publishes it right away.',
                { date }
              )
            : t('review_planned_for', 'Planned for {{date}}', { date })}
        </div>

        {!!item.changesRequested && (
          <blockquote className="text-[13px] border-s-2 border-orange-500/60 ps-[10px] text-newTextColor/80 whitespace-pre-wrap break-words">
            <span className="font-[600]">
              {t('review_changes_by', '{{name}} asked for changes:', {
                name: item.changesRequested.by || t('activity_a_teammate', 'A teammate'),
              })}
            </span>{' '}
            {item.changesRequested.comment}
          </blockquote>
        )}

        <div className="flex flex-wrap gap-[8px]">
          {canApprove && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(() =>
                  actions.approve({ id: item.id, publishDate: item.publishDate })
                )
              }
              className={clsx(
                actionClass,
                'bg-btnCta text-btnCtaText hover:bg-btnCtaHover'
              )}
            >
              {t('approval_approve', 'Approve')}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onEdit}
            className={clsx(actionClass, 'bg-btnSimple hover:bg-boxHover')}
          >
            {t('review_edit', 'Edit')}
          </button>
          {canApprove && item.approvalStatus === 'IN_REVIEW' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => actions.requestChanges({ id: item.id }))}
              className={clsx(actionClass, 'bg-btnSimple hover:bg-boxHover')}
            >
              {t('approval_request_changes', 'Request changes')}
            </button>
          )}
          {canApprove && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => actions.reject({ id: item.id }))}
              className={clsx(actionClass, 'text-red-500 hover:bg-boxHover')}
            >
              {t('approval_reject', 'Reject')}
            </button>
          )}
        </div>
      </div>
    </li>
  );
};

export const ReviewInbox: FC = () => {
  const t = useT();
  const toaster = useToaster();
  const { mutate: globalMutate } = useSWRConfig();
  const [source, setSource] = useState<'all' | 'agent'>('all');
  const { data: settings } = useApprovalSettings();
  const { data, isLoading, error, mutate } = useReviewQueue(source);
  const actions = useApprovalActions();
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const canApprove = !!settings?.canApprove;

  const refresh = useCallback(() => {
    mutate();
    globalMutate('/approvals/review/count');
  }, [mutate, globalMutate]);

  const openEditor = useOpenEditor(refresh);
  const items = data || [];
  const visibleSelected = selected.filter((id) =>
    items.some((p) => p.id === id)
  );

  const approveSelected = useCallback(async () => {
    const chosen = items.filter((p) => visibleSelected.includes(p.id));
    const passed = chosen.filter((p) =>
      dayjs(p.publishDate).isBefore(dayjs())
    ).length;
    if (
      !(await deleteDialog(
        passed
          ? t(
              'review_approve_selected_passed',
              'Approve {{count}} posts? The planned time of {{passed}} of them has passed, those publish right away.',
              { count: chosen.length, passed }
            )
          : t(
              'review_approve_selected_confirm',
              'Approve {{count}} posts? They will publish at their planned times.',
              { count: chosen.length }
            ),
        t('approval_approve', 'Approve'),
        t('review_approve_selected_title', 'Approve selected posts'),
        t('approval_cancel', 'Cancel')
      ))
    ) {
      return;
    }
    setBulkBusy(true);
    let done = 0;
    for (const item of chosen) {
      if (await actions.approve(item, true)) {
        done++;
      }
    }
    setBulkBusy(false);
    setSelected([]);
    refresh();
    if (done) {
      toaster.show(
        done === 1
          ? t('review_approved_one', '1 post approved')
          : t('review_approved_many', '{{count}} posts approved', {
              count: done,
            }),
        'success'
      );
    }
  }, [items, visibleSelected, actions, refresh, toaster, t]);

  const tabs = [
    { value: 'all' as const, label: t('review_tab_all', 'All') },
    { value: 'agent' as const, label: t('review_tab_agents', 'From AI agents') },
  ];

  return (
    <div className="flex flex-1 min-w-0 flex-col bg-newBgColorInner p-[20px] mobile:p-[12px] gap-[16px] overflow-y-auto">
      <div className="flex items-center gap-[12px] flex-wrap">
        <div className="flex flex-col gap-[2px] flex-1 min-w-[200px]">
          <h1 className="text-[24px] font-[600]">
            {t('review_title', 'Approvals')}
          </h1>
          <p className="text-[14px] text-textItemBlur">
            {t(
              'review_subtitle',
              "Posts from AI agents and teammates that need a yes before they go out. Nothing in this list publishes until it's approved."
            )}
          </p>
        </div>
        {canApprove && !!visibleSelected.length && (
          <button
            type="button"
            disabled={bulkBusy}
            onClick={approveSelected}
            className={clsx(
              actionClass,
              'bg-btnCta text-btnCtaText hover:bg-btnCtaHover h-[40px]'
            )}
          >
            {t('review_approve_selected', 'Approve selected ({{count}})', {
              count: visibleSelected.length,
            })}
          </button>
        )}
      </div>

      <div
        role="tablist"
        aria-label={t('review_filter', 'Filter posts')}
        className="flex gap-[4px] p-[4px] rounded-[10px] bg-newBgColor self-start"
      >
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={source === tab.value}
            onClick={() => {
              setSource(tab.value);
              setSelected([]);
            }}
            className={clsx(
              'h-[34px] px-[14px] rounded-[8px] text-[13px] font-[600] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary',
              source === tab.value
                ? 'bg-boxHover text-newTextColor'
                : 'text-textItemBlur hover:text-newTextColor'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {settings && !canApprove && (
        <p
          role="note"
          className="text-[13px] rounded-[10px] border border-newTableBorder bg-newBgColor px-[14px] py-[10px] text-textItemBlur"
        >
          {t(
            'review_read_only',
            'You can see and edit these posts, but only workspace admins and the approvers they pick can approve them.'
          )}
        </p>
      )}

      {canApprove && !!items.length && (
        <label className="flex items-center gap-[8px] text-[13px] text-textItemBlur cursor-pointer self-start">
          <input
            type="checkbox"
            checked={visibleSelected.length === items.length}
            onChange={(e) =>
              setSelected(e.target.checked ? items.map((p) => p.id) : [])
            }
            className="w-[16px] h-[16px] accent-btnPrimary"
          />
          {t('review_select_all', 'Select all')}
        </label>
      )}

      {isLoading ? (
        <ul className="flex flex-col gap-[12px]" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="h-[160px] rounded-[12px] bg-newBgColor animate-pulse"
            />
          ))}
        </ul>
      ) : error ? (
        <p className="text-[14px] text-textItemBlur">
          {t('review_load_failed', 'Could not load the posts to review.')}
        </p>
      ) : !items.length ? (
        <div className="flex flex-col items-center text-center gap-[10px] py-[60px] px-[20px] rounded-[12px] border border-dashed border-newTableBorder">
          <svg
            aria-hidden="true"
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-textItemBlur"
          >
            <path d="M22 12h-6l-2 3h-4l-2-3H2" />
            <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
          </svg>
          <div className="text-[16px] font-[600]">
            {t('review_empty_title', 'Nothing to review')}
          </div>
          <p className="text-[14px] text-textItemBlur max-w-[460px]">
            {source === 'agent'
              ? t(
                  'review_empty_agents',
                  'When your workspace requires approval for AI posts, anything Claude, ChatGPT or another connected agent creates waits here for you.'
                )
              : t(
                  'review_empty_all',
                  'When an AI agent or a teammate sends a post for review, it shows up here.'
                )}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-[12px]">
          {items.map((item) => (
            <ReviewCard
              key={item.id}
              item={item}
              canApprove={canApprove}
              selected={visibleSelected.includes(item.id)}
              onSelect={(value) =>
                setSelected((list) =>
                  value
                    ? [...list, item.id]
                    : list.filter((id) => id !== item.id)
                )
              }
              onChanged={refresh}
              onEdit={() => openEditor(item.group)}
            />
          ))}
        </ul>
      )}
    </div>
  );
};
