'use client';

import { FC, useCallback, useId, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import Link from 'next/link';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { sanitizePostContent } from '@gitroom/helpers/utils/sanitize.post.content';
import { VideoOrImage } from '@gitroom/react/helpers/video.or.image';
import { LogoTextComponent } from '@gitroom/frontend/components/ui/logo-text.component';
import { readError } from '@gitroom/frontend/components/approvals/approvals.hooks';

type ClientStatus =
  | 'waiting'
  | 'approved'
  | 'changes_requested'
  | 'rejected'
  | 'published';

interface ClientPost {
  id: string;
  publishDate: string;
  status: ClientStatus;
  integration: {
    name: string;
    picture: string | null;
    providerIdentifier: string;
    profile: string | null;
  } | null;
  values: { id: string; content: string; image: string | null }[];
}

interface ClientLink {
  workspace: string | null;
  expiresAt: string;
  posts: ClientPost[];
}

class LinkError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const usePublicApproval = (token: string) => {
  const fetch = useFetch();
  const load = useCallback(
    async (path: string) => {
      const response = await fetch(path);
      if (!response.ok) {
        throw new LinkError(
          response.status,
          await readError(response, 'This approval link is not valid.')
        );
      }
      return response.json();
    },
    [fetch]
  );
  return useSWR<ClientLink>(`/public/approvals/${token}`, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  });
};

const formatDate = (date: string) => {
  try {
    return new Date(date).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return date;
  }
};

const media = (image: string | null) => {
  try {
    const list = JSON.parse(image || '[]');
    return Array.isArray(list) ? (list as { path: string }[]) : [];
  } catch {
    return [];
  }
};

const fieldClass =
  'h-[44px] w-full rounded-[8px] border border-newTableBorder bg-newBgColor px-[12px] text-[15px] text-newTextColor outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary';

const StatusChip: FC<{ status: ClientStatus }> = ({ status }) => {
  const t = useT();
  const label =
    status === 'approved'
      ? t('approval_client_status_approved', 'Approved')
      : status === 'changes_requested'
      ? t('approval_client_status_changes', 'Changes requested')
      : status === 'rejected'
      ? t('approval_client_status_rejected', 'Not going out')
      : status === 'published'
      ? t('approval_client_status_published', 'Published')
      : t('approval_client_status_waiting', 'Waiting for you');
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-[6px] h-[26px] px-[10px] rounded-full border text-[12px] font-[600] text-newTextColor whitespace-nowrap',
        status === 'waiting' && 'border-amber-400/70 bg-amber-400/10',
        (status === 'approved' || status === 'published') &&
          'border-green-500/70 bg-green-500/10',
        status === 'changes_requested' && 'border-orange-500/70 bg-orange-500/10',
        status === 'rejected' && 'border-newTableBorder'
      )}
    >
      <span aria-hidden="true">
        {status === 'approved' || status === 'published'
          ? '✓'
          : status === 'changes_requested'
          ? '!'
          : status === 'rejected'
          ? '×'
          : '•'}
      </span>
      {label}
    </span>
  );
};

type Identity = { name: string; email: string };

const DecisionForm: FC<{
  decision: 'approve' | 'request_changes';
  identity: Identity;
  onIdentity: (value: Identity) => void;
  onCancel: () => void;
  onSubmit: (comment: string) => Promise<void>;
}> = ({ decision, identity, onIdentity, onCancel, onSubmit }) => {
  const t = useT();
  const id = useId();
  const [comment, setComment] = useState('');
  const [editIdentity, setEditIdentity] = useState(
    !identity.name || !identity.email
  );
  const [loading, setLoading] = useState(false);
  const needsComment = decision === 'request_changes';
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.email.trim());
  const ready =
    !!identity.name.trim() && validEmail && (!needsComment || !!comment.trim());

  return (
    <form
      className="flex flex-col gap-[12px] rounded-[12px] border border-newTableBorder bg-newBgColor p-[16px]"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready || loading) {
          return;
        }
        setLoading(true);
        await onSubmit(comment.trim());
        setLoading(false);
      }}
    >
      {editIdentity ? (
        <div className="grid grid-cols-2 mobile:grid-cols-1 gap-[12px]">
          <div className="flex flex-col gap-[6px]">
            <label htmlFor={`${id}-name`} className="text-[14px] font-[600]">
              {t('approval_client_name', 'Your name')}
            </label>
            <input
              id={`${id}-name`}
              autoComplete="name"
              required
              maxLength={80}
              value={identity.name}
              onChange={(e) => onIdentity({ ...identity, name: e.target.value })}
              className={fieldClass}
            />
          </div>
          <div className="flex flex-col gap-[6px]">
            <label htmlFor={`${id}-email`} className="text-[14px] font-[600]">
              {t('approval_client_email', 'Your email')}
            </label>
            <input
              id={`${id}-email`}
              type="email"
              autoComplete="email"
              required
              maxLength={200}
              value={identity.email}
              onChange={(e) => onIdentity({ ...identity, email: e.target.value })}
              className={fieldClass}
            />
          </div>
          <p className="col-span-2 mobile:col-span-1 text-[13px] text-textItemBlur">
            {t(
              'approval_client_identity_help',
              'The team sees who approved or asked for changes, and when.'
            )}
          </p>
        </div>
      ) : (
        <div className="text-[14px] text-textItemBlur">
          {t('approval_client_as', 'As {{name}} ({{email}})', identity)}{' '}
          <button
            type="button"
            onClick={() => setEditIdentity(true)}
            className="underline underline-offset-2 text-newTextColor rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
          >
            {t('approval_client_change', 'Change')}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-[6px]">
        <label htmlFor={`${id}-comment`} className="text-[14px] font-[600]">
          {needsComment
            ? t('approval_what_to_change', 'What should change?')
            : t('approval_client_note', 'Note for the team')}
          {!needsComment && (
            <span className="font-[400] text-textItemBlur">
              {' '}
              {t('approval_optional', '(optional)')}
            </span>
          )}
        </label>
        <textarea
          id={`${id}-comment`}
          required={needsComment}
          maxLength={2000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="min-h-[100px] w-full rounded-[8px] border border-newTableBorder bg-newBgColor p-[12px] text-[15px] text-newTextColor outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary resize-y"
        />
      </div>

      <div className="flex gap-[8px] justify-end flex-wrap">
        <button
          type="button"
          onClick={onCancel}
          className="h-[44px] px-[18px] rounded-[10px] bg-btnSimple hover:bg-boxHover text-[15px] font-[600] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
        >
          {t('approval_cancel', 'Cancel')}
        </button>
        <button
          type="submit"
          disabled={!ready || loading}
          className="h-[44px] px-[18px] rounded-[10px] bg-btnCta text-btnCtaText hover:bg-btnCtaHover text-[15px] font-[600] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading
            ? t('approval_client_sending', 'Sending…')
            : decision === 'approve'
            ? t('approval_client_confirm_approve', 'Approve post')
            : t('approval_send_feedback', 'Send feedback')}
        </button>
      </div>
    </form>
  );
};

const PostCard: FC<{
  post: ClientPost;
  token: string;
  identity: Identity;
  onIdentity: (value: Identity) => void;
  onDone: (status: ClientStatus) => void;
}> = ({ post, token, identity, onIdentity, onDone }) => {
  const t = useT();
  const fetch = useFetch();
  const [decision, setDecision] = useState<'approve' | 'request_changes'>();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const [root, ...comments] = post.values;
  const actionable =
    post.status === 'waiting' || post.status === 'changes_requested';

  const send = useCallback(
    async (comment: string) => {
      const response = await fetch(`/public/approvals/${token}`, {
        method: 'POST',
        body: JSON.stringify({
          postId: post.id,
          decision,
          name: identity.name.trim(),
          email: identity.email.trim(),
          ...(comment ? { comment } : {}),
        }),
      });
      if (!response.ok) {
        setMessage({
          tone: 'error',
          text:
            response.status === 429
              ? t(
                  'approval_client_too_many',
                  'Too many attempts. Please wait a few minutes and try again.'
                )
              : await readError(
                  response,
                  t('approval_client_failed', 'Something went wrong, please try again.')
                ),
        });
        return;
      }
      const result = await response.json();
      setDecision(undefined);
      setMessage({
        tone: 'ok',
        text: t('approval_client_thanks', 'Thanks! The team was notified.'),
      });
      onDone(result.status as ClientStatus);
    },
    [fetch, token, post.id, decision, identity, t, onDone]
  );

  return (
    <article
      aria-labelledby={`post-${post.id}`}
      className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[20px] mobile:p-[16px] flex flex-col gap-[16px]"
    >
      <header className="flex items-center gap-[12px] flex-wrap">
        <div className="relative shrink-0 w-[44px] h-[44px]">
          <img
            className="w-full h-full rounded-full bg-newBgColor object-cover"
            alt=""
            src={post.integration?.picture || '/no-picture.jpg'}
            onError={(e) => {
              e.currentTarget.src = '/no-picture.jpg';
            }}
          />
          {!!post.integration && (
            <img
              className="absolute -end-[4px] -bottom-[4px] w-[20px] h-[20px] rounded-full bg-newBgColor"
              alt=""
              src={`/icons/platforms/${post.integration.providerIdentifier}.png`}
            />
          )}
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <h2 id={`post-${post.id}`} className="text-[15px] font-[600] truncate">
            {post.integration?.name}
          </h2>
          <span className="text-[13px] text-textItemBlur truncate">
            {post.integration?.profile ? `@${post.integration.profile} · ` : ''}
            {t('approval_client_planned', 'Planned for {{date}}', {
              date: formatDate(post.publishDate),
            })}
          </span>
        </div>
        <StatusChip status={post.status} />
      </header>

      {[root, ...comments].filter(Boolean).map((value, index) => (
        <div
          key={value.id}
          className={clsx(
            'flex flex-col gap-[12px]',
            index > 0 && 'border-s-2 border-newTableBorder ps-[14px]'
          )}
        >
          {index > 0 && (
            <span className="text-[12px] text-textItemBlur">
              {t('approval_client_comment', 'Comment {{number}}', {
                number: index,
              })}
            </span>
          )}
          <div
            className="text-[15px] leading-[1.55] break-words [&_p]:min-h-[1em] [&_a]:underline"
            dangerouslySetInnerHTML={{ __html: sanitizePostContent(value.content) }}
          />
          {!!media(value.image).length && (
            <div className="grid grid-cols-2 mobile:grid-cols-1 gap-[10px]">
              {media(value.image).map((item) => (
                <div
                  key={item.path}
                  className="rounded-[10px] max-h-[420px] overflow-hidden bg-newBgColor"
                >
                  <VideoOrImage isContain={true} src={item.path} autoplay={false} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {!!message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={clsx(
            'text-[14px] rounded-[10px] px-[14px] py-[10px] border',
            message.tone === 'ok'
              ? 'border-green-500/50 bg-green-500/10'
              : 'border-red-500/50 bg-red-500/10'
          )}
        >
          {message.text}
        </p>
      )}

      {actionable &&
        (decision ? (
          <DecisionForm
            decision={decision}
            identity={identity}
            onIdentity={onIdentity}
            onCancel={() => setDecision(undefined)}
            onSubmit={send}
          />
        ) : (
          <div className="flex gap-[8px] flex-wrap">
            <button
              type="button"
              onClick={() => {
                setMessage(undefined);
                setDecision('approve');
              }}
              className="h-[44px] px-[20px] rounded-[10px] bg-btnCta text-btnCtaText hover:bg-btnCtaHover text-[15px] font-[600] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary mobile:flex-1"
            >
              {t('approval_approve', 'Approve')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMessage(undefined);
                setDecision('request_changes');
              }}
              className="h-[44px] px-[20px] rounded-[10px] bg-btnSimple hover:bg-boxHover text-[15px] font-[600] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary mobile:flex-1"
            >
              {t('approval_request_changes', 'Request changes')}
            </button>
          </div>
        ))}
    </article>
  );
};

export const ClientApproval: FC<{ token: string }> = ({ token }) => {
  const t = useT();
  const { data, error, isLoading, mutate } = usePublicApproval(token);
  const [identity, setIdentity] = useState<Identity>({ name: '', email: '' });

  const header = (
    <div className="flex bg-newBgColorInner rounded-[12px] min-h-[72px] px-[20px] py-[12px] items-center gap-[16px] flex-wrap">
      <Link
        href="/"
        className="flex items-center text-textColor rounded-[6px] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
        aria-label="PostDelegate"
      >
        <LogoTextComponent />
      </Link>
    </div>
  );

  if (isLoading) {
    return (
      <main className="mx-auto w-full max-w-[760px] p-[12px] flex flex-col gap-[12px]">
        {header}
        <div className="h-[240px] rounded-[12px] bg-newBgColorInner animate-pulse" aria-busy="true" />
      </main>
    );
  }

  if (error || !data) {
    const status = (error as LinkError)?.status;
    return (
      <main className="mx-auto w-full max-w-[760px] p-[12px] flex flex-col gap-[12px]">
        {header}
        <div
          role="alert"
          className="bg-newBgColorInner rounded-[12px] p-[32px] mobile:p-[20px] flex flex-col gap-[8px] text-center items-center"
        >
          <h1 className="text-[20px] font-[600]">
            {status === 410
              ? t('approval_client_link_closed', 'This link no longer works')
              : status === 429
              ? t('approval_client_slow_down', 'Please wait a moment')
              : t('approval_client_link_invalid', "We couldn't open this link")}
          </h1>
          <p className="text-[15px] text-textItemBlur max-w-[460px]">
            {status === 429
              ? t(
                  'approval_client_too_many',
                  'Too many attempts. Please wait a few minutes and try again.'
                )
              : status === 410
              ? `${(error as Error).message} ${t(
                  'approval_client_ask_new',
                  'Ask the team that shared it for a new one.'
                )}`
              : t(
                  'approval_client_check_link',
                  'Check that you copied the whole link, or ask the team that shared it for a new one.'
                )}
          </p>
        </div>
      </main>
    );
  }

  const waiting = data.posts.filter(
    (p) => p.status === 'waiting' || p.status === 'changes_requested'
  ).length;

  return (
    <main className="mx-auto w-full max-w-[760px] p-[12px] flex flex-col gap-[12px] text-newTextColor">
      {header}
      <section className="bg-newBgColorInner rounded-[12px] px-[20px] py-[16px] flex flex-col gap-[4px]">
        <h1 className="text-[20px] font-[600]">
          {data.posts.length === 1
            ? t('approval_client_title_one', '{{workspace}} asked you to review a post', {
                workspace: data.workspace || t('approval_client_the_team', 'The team'),
              })
            : t(
                'approval_client_title_many',
                '{{workspace}} asked you to review {{count}} posts',
                {
                  workspace: data.workspace || t('approval_client_the_team', 'The team'),
                  count: data.posts.length,
                }
              )}
        </h1>
        <p className="text-[14px] text-textItemBlur">
          {waiting
            ? t(
                'approval_client_intro',
                "This is how each post will look. Approve it, or tell the team what to change. Nothing publishes until it's approved."
              )
            : t('approval_client_all_done', "You're all done. Thanks!")}{' '}
          {t('approval_client_expires', 'This link works until {{date}}.', {
            date: formatDate(data.expiresAt),
          })}
        </p>
      </section>

      {!data.posts.length && (
        <p className="bg-newBgColorInner rounded-[12px] p-[20px] text-[15px] text-textItemBlur">
          {t('approval_client_no_posts', 'These posts were removed by the team.')}
        </p>
      )}

      {data.posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          token={token}
          identity={identity}
          onIdentity={setIdentity}
          onDone={(status) =>
            mutate(
              {
                ...data,
                posts: data.posts.map((p) =>
                  p.id === post.id ? { ...p, status } : p
                ),
              },
              { revalidate: false }
            )
          }
        />
      ))}

      <p className="text-center text-[12px] text-textItemBlur py-[12px]">
        {t('approval_client_footer', 'Shared securely with PostDelegate')}
      </p>
    </main>
  );
};
