'use client';

import { FC, useCallback, useId, useState } from 'react';
import dayjs from 'dayjs';
import { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { Button } from '@gitroom/react/form/button';
import { readError } from '@gitroom/frontend/components/approvals/approvals.hooks';

// A comment box in a modal, for "request changes" and "reject"
export const CommentModal: FC<{
  label: string;
  description?: string;
  placeholder?: string;
  required?: boolean;
  confirmLabel: string;
  destructive?: boolean;
  onSubmit: (comment: string) => Promise<boolean>;
  close: () => void;
}> = ({
  label,
  description,
  placeholder,
  required,
  confirmLabel,
  destructive,
  onSubmit,
  close,
}) => {
  const t = useT();
  const id = useId();
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const empty = required && !comment.trim();

  const submit = useCallback(async () => {
    if (empty || loading) {
      return;
    }
    setLoading(true);
    const done = await onSubmit(comment.trim());
    setLoading(false);
    if (done) {
      close();
    }
  }, [comment, empty, loading, onSubmit, close]);

  return (
    <form
      className="flex flex-col gap-[12px] w-full"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {!!description && (
        <p className="text-[14px] text-textItemBlur">{description}</p>
      )}
      <label htmlFor={id} className="text-[14px] font-[600]">
        {label}
        {!required && (
          <span className="font-[400] text-textItemBlur">
            {' '}
            {t('approval_optional', '(optional)')}
          </span>
        )}
      </label>
      <textarea
        id={id}
        autoFocus
        value={comment}
        maxLength={2000}
        required={required}
        placeholder={placeholder}
        onChange={(e) => setComment(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        className="min-h-[120px] w-full rounded-[8px] border border-newTableBorder bg-newBgColor p-[12px] text-[14px] text-newTextColor outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary resize-y"
      />
      <div className="flex justify-end gap-[8px] flex-wrap">
        <button
          type="button"
          onClick={close}
          className="h-[40px] px-[16px] rounded-[8px] bg-btnSimple hover:bg-boxHover text-[14px] font-[600] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
        >
          {t('approval_cancel', 'Cancel')}
        </button>
        <Button
          type="submit"
          loading={loading}
          disabled={empty}
          className={
            destructive
              ? '!bg-red-600 !text-white !shadow-none rounded-[8px]'
              : 'rounded-[8px]'
          }
        >
          {confirmLabel}
        </Button>
      </div>
    </form>
  );
};

type PostRef = {
  id: string;
  publishDate?: string | Date | null;
  // the version shown: approving refuses (409) a post edited since
  updatedAt?: string | Date | null;
  // the channel, named when the action also covers it
  name?: string;
};

// the other channels an action also changes, added to its dialog
const alsoOn = (others: PostRef[], t: ReturnType<typeof useT>) => {
  const names = others.map((post) => post.name).filter(Boolean);
  return names.length
    ? ' ' +
        String(
          t('approval_also_applies_to', 'This also applies to: {{channels}}.', {
            channels: names.join(', '),
          })
        )
    : '';
};

// what an approval sends: it approves the version that was shown
const approveBody = (post: PostRef) =>
  post.updatedAt
    ? { expectedUpdatedAt: new Date(post.updatedAt).toISOString() }
    : {};

// approve, request changes, reject and submit, with the dialogs they need.
// Each resolves to true when the post changed.
export const useApprovalActions = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const modals = useModals();
  const { mutate } = useSWRConfig();

  const call = useCallback(
    async (path: string, body: Record<string, any>, fallback: string) => {
      const response = await fetch(path, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        toaster.show(await readError(response, fallback), 'warning');
        return null;
      }
      // the menu badge counts the posts waiting for review
      mutate('/approvals/review/count');
      return response.json();
    },
    [fetch, toaster, mutate]
  );

  // the other channels of the post get the same decision, each one that
  // fails says so on its own
  const callOthers = useCallback(
    async (
      others: PostRef[],
      action: string,
      body: Record<string, any>,
      fallback: string
    ) => {
      for (const other of others) {
        await call(`/approvals/posts/${other.id}/${action}`, body, fallback);
      }
    },
    [call]
  );

  const approve = useCallback(
    async (post: PostRef, silent = false, others: PostRef[] = []) => {
      const passed = [post, ...others].some(
        (p) => !!p.publishDate && dayjs(p.publishDate).isBefore(dayjs())
      );
      if (
        passed &&
        !silent &&
        !(await deleteDialog(
          t(
            'approval_time_passed_confirm',
            'The planned time has passed. Approving will publish it right away.'
          ),
          t('approval_approve_and_publish', 'Approve and publish now'),
          t('approval_publish_now_title', 'Publish now?'),
          t('approval_cancel', 'Cancel')
        ))
      ) {
        return false;
      }
      const result = await call(
        `/approvals/posts/${post.id}/approve`,
        approveBody(post),
        t('approval_approve_failed', 'Could not approve the post')
      );
      if (!result) {
        return false;
      }
      // each channel's post is its own version
      for (const other of others) {
        await call(
          `/approvals/posts/${other.id}/approve`,
          approveBody(other),
          t('approval_approve_failed', 'Could not approve the post')
        );
      }
      if (!silent) {
        toaster.show(
          result.publishedNow
            ? t('approval_approved_now', 'Approved, publishing now')
            : t('approval_approved', 'Approved and scheduled'),
          'success'
        );
      }
      return true;
    },
    [call, t, toaster]
  );

  const askComment = useCallback(
    (params: {
      title: string;
      label: string;
      description?: string;
      required?: boolean;
      confirmLabel: string;
      destructive?: boolean;
      send: (comment: string) => Promise<boolean>;
    }) =>
      new Promise<boolean>((resolve) => {
        let done = false;
        modals.openModal({
          title: params.title,
          askClose: false,
          withCloseButton: true,
          classNames: { modal: 'w-[100%] max-w-[520px] text-textColor' },
          onClose: () => resolve(done),
          children: (close: () => void) => (
            <CommentModal
              label={params.label}
              description={params.description}
              required={params.required}
              confirmLabel={params.confirmLabel}
              destructive={params.destructive}
              onSubmit={async (comment) => {
                done = await params.send(comment);
                if (done) {
                  resolve(true);
                }
                return done;
              }}
              close={close}
            />
          ),
        });
      }),
    [modals]
  );

  const requestChanges = useCallback(
    (post: PostRef, others: PostRef[] = []) =>
      askComment({
        title: t('approval_request_changes', 'Request changes'),
        label: t('approval_what_to_change', 'What should change?'),
        description:
          t(
            'approval_request_changes_description',
            "The post won't publish until it's sent for review again and approved."
          ) + alsoOn(others, t),
        required: true,
        confirmLabel: t('approval_send_feedback', 'Send feedback'),
        send: async (comment) => {
          const result = await call(
            `/approvals/posts/${post.id}/request-changes`,
            { comment },
            t('approval_request_failed', 'Could not send the feedback')
          );
          if (result) {
            await callOthers(
              others,
              'request-changes',
              { comment },
              t('approval_request_failed', 'Could not send the feedback')
            );
            toaster.show(
              t(
                'approval_changes_requested_toast',
                'Feedback sent to the author'
              ),
              'success'
            );
          }
          return !!result;
        },
      }),
    [askComment, call, callOthers, t, toaster]
  );

  const reject = useCallback(
    (post: PostRef, others: PostRef[] = []) =>
      askComment({
        title: t('approval_reject', 'Reject'),
        label: t('approval_reject_reason', 'Reason'),
        description:
          t(
            'approval_reject_description',
            "Rejected posts won't publish. They stay as a draft you can delete or send for review again."
          ) + alsoOn(others, t),
        confirmLabel: t('approval_reject_post', 'Reject post'),
        destructive: true,
        send: async (comment) => {
          const result = await call(
            `/approvals/posts/${post.id}/reject`,
            comment ? { comment } : {},
            t('approval_reject_failed', 'Could not reject the post')
          );
          if (result) {
            await callOthers(
              others,
              'reject',
              comment ? { comment } : {},
              t('approval_reject_failed', 'Could not reject the post')
            );
            toaster.show(
              t('approval_rejected_toast', 'Post rejected'),
              'success'
            );
          }
          return !!result;
        },
      }),
    [askComment, call, callOthers, t, toaster]
  );

  const submit = useCallback(
    async (post: PostRef, others: PostRef[] = []) => {
      const result = await call(
        `/approvals/posts/${post.id}/submit`,
        {},
        t('approval_submit_failed', 'Could not send the post for review')
      );
      if (result) {
        await callOthers(
          others,
          'submit',
          {},
          t('approval_submit_failed', 'Could not send the post for review')
        );
        toaster.show(
          t('approval_sent_for_review', 'Sent for review'),
          'success'
        );
      }
      return !!result;
    },
    [call, callOthers, t, toaster]
  );

  return { approve, requestChanges, reject, submit };
};
