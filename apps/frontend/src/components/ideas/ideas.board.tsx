'use client';

import React, { FC, useCallback, useMemo } from 'react';
import clsx from 'clsx';
import { plainTextToHtml } from '@gitroom/helpers/utils/plain.text.to.html';
import { useDrag, useDrop } from 'react-dnd';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { fromUtc } from '@gitroom/frontend/components/layout/set.timezone';
import { AddEditModal } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { IdeaForm } from '@gitroom/frontend/components/ideas/idea.modal';
import { IdeaMediaThumb } from '@gitroom/frontend/components/ideas/idea.media.thumb';
import {
  Idea,
  IdeaStatus,
  useIdeas,
} from '@gitroom/frontend/components/ideas/use.ideas';

const STATUSES: IdeaStatus[] = ['IDEA', 'DRAFTING', 'USED'];

const useStatusLabel = () => {
  const t = useT();
  return useCallback(
    (status: IdeaStatus) =>
      status === 'IDEA'
        ? t('ideas_column_ideas', 'Ideas')
        : status === 'DRAFTING'
        ? t('ideas_column_drafting', 'Drafting')
        : t('ideas_column_used', 'Used'),
    [t]
  );
};

// the idea as the composer's text, escaped so notes are never read as HTML
// the title, an empty line and the notes, as editor paragraphs
const ideaContent = (idea: Idea) =>
  plainTextToHtml(
    idea.notes ? `${idea.title}\n\n${idea.notes}` : idea.title
  );

export const useIdeaActions = () => {
  const fetch = useFetch();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();
  const { mutate } = useIdeas();
  const { data: integrations } = useIntegrationList();

  const update = useCallback(
    async (idea: Idea, body: Partial<{ status: IdeaStatus }>) => {
      // the card moves right away, the list reloads after the save
      await mutate(
        (list) =>
          (list || []).map((p) => (p.id === idea.id ? { ...p, ...body } : p)),
        { revalidate: false }
      );
      const response = await fetch(`/ideas/${idea.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        toaster.show(t('idea_save_failed', 'Could not save the idea'), 'warning');
      }
      await mutate();
    },
    [mutate]
  );

  const edit = useCallback(
    (idea?: Idea, status?: IdeaStatus) => {
      modal.openModal({
        title: idea
          ? t('edit_idea', 'Edit idea')
          : t('new_idea', 'New idea'),
        closeOnClickOutside: false,
        askClose: false,
        size: '600px',
        children: (close) => (
          <IdeaForm
            idea={idea}
            status={status}
            close={close}
            onSaved={() => mutate()}
          />
        ),
      });
    },
    [modal, mutate, t]
  );

  const remove = useCallback(
    async (idea: Idea) => {
      if (
        !(await deleteDialog(
          t('delete_idea_confirm', 'Delete the idea "{{title}}"?', {
            title: idea.title,
          }),
          t('yes_delete_it', 'Yes, delete it!')
        ))
      ) {
        return;
      }
      await mutate((list) => (list || []).filter((p) => p.id !== idea.id), {
        revalidate: false,
      });
      await fetch(`/ideas/${idea.id}`, { method: 'DELETE' });
      await mutate();
    },
    [mutate, t]
  );

  // opens the composer with the idea as its text and media; once the post is
  // saved the idea moves to Used
  const openComposer = useCallback(
    async (idea: Idea) => {
      if (!integrations?.length) {
        toaster.show(
          t(
            'ideas_no_channels',
            'Connect a channel in the calendar first, then turn this idea into a post.'
          ),
          'warning'
        );
        return;
      }
      const date = (await (await fetch('/posts/find-slot')).json()).date;
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
          <AddEditModal
            allIntegrations={integrations.map((p: any) => ({ ...p }))}
            integrations={integrations}
            reopenModal={() => openComposer(idea)}
            mutate={() => {
              if (idea.status !== 'USED') {
                update(idea, { status: 'USED' });
              }
            }}
            date={fromUtc(date)}
            onlyValues={[
              {
                content: ideaContent(idea),
                image: idea.media,
              },
            ]}
          />
        ),
        size: '80%',
        title: ``,
      });
    },
    [integrations, modal, update, t]
  );

  return { update, edit, remove, openComposer, hasChannels: !!integrations?.length };
};

const IdeaCard: FC<{
  idea: Idea;
  actions: ReturnType<typeof useIdeaActions>;
}> = ({ idea, actions }) => {
  const t = useT();
  const statusLabel = useStatusLabel();
  const [{ isDragging }, drag] = useDrag(
    () => ({
      type: 'idea',
      item: { id: idea.id },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [idea.id]
  );

  return (
    <li
      // @ts-ignore
      ref={drag}
      className={clsx(
        'list-none bg-newBgColorInner border border-newTableBorder rounded-[10px] p-[12px] flex flex-col gap-[8px] cursor-grab',
        isDragging && 'opacity-40'
      )}
      style={
        idea.tag?.color
          ? { borderInlineStartColor: idea.tag.color, borderInlineStartWidth: 4 }
          : undefined
      }
    >
      <div className="flex items-start gap-[8px]">
        <button
          type="button"
          onClick={() => actions.edit(idea)}
          className="flex-1 text-start text-[14px] font-[600] leading-[19px] break-words hover:underline outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary rounded-[4px]"
        >
          {idea.title}
        </button>
      </div>
      {!!idea.notes && (
        <div className="text-[13px] leading-[18px] text-newTextColor/70 line-clamp-3 break-words whitespace-pre-line">
          {idea.notes}
        </div>
      )}
      {!!idea.media.length && (
        <div className="flex gap-[6px] flex-wrap">
          {idea.media.slice(0, 4).map((item) => (
            <IdeaMediaThumb key={item.id} path={item.path} size={44} />
          ))}
          {idea.media.length > 4 && (
            <div className="w-[44px] h-[44px] rounded-[8px] bg-newBgColor text-[12px] flex items-center justify-center">
              +{idea.media.length - 4}
            </div>
          )}
        </div>
      )}
      {!!idea.tag && (
        <div className="flex items-center gap-[6px] text-[12px] text-newTextColor/80">
          <span
            aria-hidden="true"
            className="w-[10px] h-[10px] rounded-full"
            style={{ backgroundColor: idea.tag.color }}
          />
          <span className="truncate">{idea.tag.name}</span>
        </div>
      )}
      <div className="flex items-center gap-[6px] flex-wrap pt-[4px]">
        <button
          type="button"
          onClick={() => actions.openComposer(idea)}
          className="h-[32px] px-[12px] rounded-[8px] bg-btnCta text-btnCtaText hover:bg-btnCtaHover text-[13px] font-[600]"
        >
          {t('use_in_post', 'Use in a post')}
        </button>
        <select
          aria-label={t('move_idea_to', 'Move to')}
          value={idea.status}
          onChange={(e) =>
            actions.update(idea, { status: e.target.value as IdeaStatus })
          }
          className="h-[32px] px-[8px] rounded-[8px] bg-newBgColor border border-newTableBorder text-[13px] text-textColor outline-none"
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => actions.remove(idea)}
          aria-label={t('delete_idea', 'Delete idea')}
          className="ms-auto h-[32px] w-[32px] rounded-[8px] flex items-center justify-center text-red-500 hover:bg-boxFocused"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </li>
  );
};

const IdeaColumn: FC<{
  status: IdeaStatus;
  ideas: Idea[];
  all: Idea[];
  actions: ReturnType<typeof useIdeaActions>;
}> = ({ status, ideas, all, actions }) => {
  const t = useT();
  const statusLabel = useStatusLabel();
  const [{ isOver }, drop] = useDrop(
    () => ({
      accept: 'idea',
      drop: (item: { id: string }) => {
        const idea = all.find((p) => p.id === item.id);
        if (idea && idea.status !== status) {
          actions.update(idea, { status });
        }
      },
      collect: (monitor) => ({ isOver: monitor.isOver() }),
    }),
    [all, status, actions.update]
  );

  const headingId = `ideas-column-${status}`;
  return (
    <section
      // @ts-ignore
      ref={drop}
      aria-labelledby={headingId}
      className={clsx(
        'flex-1 min-w-0 flex flex-col gap-[10px] rounded-[12px] p-[12px] bg-newBgColor border transition-colors',
        isOver ? 'border-btnPrimary' : 'border-transparent'
      )}
    >
      <div className="flex items-center gap-[8px]">
        <h2 id={headingId} className="text-[15px] font-[600]">
          {statusLabel(status)}
        </h2>
        <span className="text-[13px] text-newTextColor/60 tabular-nums">
          {ideas.length}
        </span>
        {status !== 'USED' && (
          <button
            type="button"
            onClick={() => actions.edit(undefined, status)}
            aria-label={t('add_idea_to', 'Add an idea to {{column}}', {
              column: statusLabel(status),
            })}
            className="ms-auto w-[28px] h-[28px] rounded-[8px] flex items-center justify-center hover:bg-boxFocused"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 21 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M10.5001 4.16699V15.8337M4.66675 10.0003H16.3334"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-[10px] min-h-[60px]">
        {ideas.map((idea) => (
          <IdeaCard key={idea.id} idea={idea} actions={actions} />
        ))}
        {!ideas.length && (
          <li className="list-none text-[13px] text-newTextColor/60 border border-dashed border-newTableBorder rounded-[10px] p-[16px] text-center">
            {status === 'USED'
              ? t(
                  'ideas_used_empty',
                  'Ideas you turn into posts land here.'
                )
              : t('ideas_column_empty', 'Drop an idea here.')}
          </li>
        )}
      </ul>
    </section>
  );
};

export const IdeasBoard: FC<{ filterTag: string }> = ({ filterTag }) => {
  const t = useT();
  const { data, isLoading } = useIdeas();
  const actions = useIdeaActions();

  const ideas = useMemo(
    () =>
      (data || []).filter((idea) => !filterTag || idea.tag?.id === filterTag),
    [data, filterTag]
  );

  if (isLoading) {
    return (
      <div className="animate-pulse text-[14px]">{t('loading', 'Loading...')}</div>
    );
  }

  if (!data?.length) {
    return (
      <div className="flex flex-col items-center text-center gap-[12px] py-[60px] px-[16px] max-w-[460px] mx-auto">
        <div className="text-[18px] font-[600]">
          {t('ideas_empty_title', 'Keep your post ideas in one place')}
        </div>
        <div className="text-[14px] text-newTextColor/70">
          {t(
            'ideas_empty_text',
            'Jot down ideas before they have a date or a channel. Tag them with a campaign, move them along as you work on them, and turn any idea into a post in one click.'
          )}
        </div>
        <button
          type="button"
          onClick={() => actions.edit()}
          className="mt-[8px] h-[44px] px-[20px] rounded-[10px] bg-btnCta text-btnCtaText hover:bg-btnCtaHover shadow-cta font-[600] text-[14px]"
        >
          {t('add_first_idea', 'Add your first idea')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[12px]">
      {!actions.hasChannels && (
        <div className="text-[13px] rounded-[8px] border border-newTableBorder p-[12px]">
          {t(
            'ideas_no_channels_banner',
            'To turn ideas into posts, connect a channel first.'
          )}{' '}
          <a href="/launches" className="underline font-[600]">
            {t('go_to_calendar', 'Go to the calendar')}
          </a>
        </div>
      )}
      <div className="flex gap-[12px] items-start mobile:flex-col mobile:items-stretch">
        {STATUSES.map((status) => (
          <IdeaColumn
            key={status}
            status={status}
            all={data}
            ideas={ideas.filter((idea) => idea.status === status)}
            actions={actions}
          />
        ))}
      </div>
    </div>
  );
};
