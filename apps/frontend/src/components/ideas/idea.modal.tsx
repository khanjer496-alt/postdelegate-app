'use client';

import React, { FC, useCallback, useId, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  MediaBox,
  mediaLibrarySize,
} from '@gitroom/frontend/components/media/media.component';
import { useWorkspaceTags } from '@gitroom/frontend/components/launches/select.tags';
import { IdeaMediaThumb } from '@gitroom/frontend/components/ideas/idea.media.thumb';
import type {
  Idea,
  IdeaStatus,
} from '@gitroom/frontend/components/ideas/use.ideas';

const kindLabel = (
  t: ReturnType<typeof useT>,
  kind: 'TAG' | 'CAMPAIGN' | 'PILLAR'
) =>
  kind === 'CAMPAIGN'
    ? t('campaign', 'Campaign')
    : kind === 'PILLAR'
    ? t('pillar', 'Pillar')
    : t('tag', 'Tag');

// Create or edit an idea: a title, notes, pictures from the media library and
// a campaign
export const IdeaForm: FC<{
  idea?: Idea;
  status?: IdeaStatus;
  close: () => void;
  onSaved: () => void;
}> = ({ idea, status, close, onSaved }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const modals = useModals();
  const { data: tagsData } = useWorkspaceTags();
  const notesId = useId();
  const tagId = useId();
  const [title, setTitle] = useState(idea?.title || '');
  const [notes, setNotes] = useState(idea?.notes || '');
  const [media, setMedia] = useState(idea?.media || []);
  const [tag, setTag] = useState(idea?.tag?.id || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const pickMedia = useCallback(() => {
    modals.openModal({
      title: t('media_library', 'Media Library'),
      askClose: false,
      closeOnEscape: true,
      fullScreen: true,
      size: mediaLibrarySize(),
      height: mediaLibrarySize(),
      children: (closeLibrary) => (
        <MediaBox
          setMedia={(selected) => {
            setMedia((current) =>
              [
                ...current,
                ...selected
                  .filter((p) => !current.some((c) => c.id === p.id))
                  .map((p) => ({ id: p.id, path: p.path })),
              ].slice(0, 10)
            );
            closeLibrary();
          }}
          closeModal={closeLibrary}
        />
      ),
    });
  }, [modals, t]);

  const save = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!title.trim()) {
        setError(t('idea_title_required', 'Give the idea a title.'));
        return;
      }
      setSaving(true);
      const response = await fetch(idea ? `/ideas/${idea.id}` : '/ideas', {
        method: idea ? 'PUT' : 'POST',
        body: JSON.stringify({
          title: title.trim(),
          notes,
          media,
          tagId: tag || null,
          ...(!idea && status ? { status } : {}),
        }),
      });
      setSaving(false);
      if (!response.ok) {
        const { message } = await response.json().catch(() => ({}));
        toaster.show(
          typeof message === 'string'
            ? message
            : t('idea_save_failed', 'Could not save the idea'),
          'warning'
        );
        return;
      }
      toaster.show(
        idea
          ? t('idea_updated', 'Idea updated')
          : t('idea_created', 'Idea added'),
        'success'
      );
      onSaved();
      close();
    },
    [title, notes, media, tag, idea, status, onSaved, close]
  );

  return (
    <form onSubmit={save} className="flex flex-col gap-[12px] text-textColor">
      <Input
        name="title"
        disableForm={true}
        label={t('idea_title', 'Title')}
        value={title}
        maxLength={200}
        autoFocus={true}
        error={error || undefined}
        placeholder={t(
          'idea_title_placeholder',
          'What do you want to post about?'
        )}
        onChange={(e) => {
          setTitle(e.target.value);
          setError('');
        }}
      />
      <div className="flex flex-col gap-[6px]">
        <label htmlFor={notesId} className="text-[14px]">
          {t('idea_notes', 'Notes')}
        </label>
        <textarea
          id={notesId}
          value={notes}
          maxLength={10000}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t(
            'idea_notes_placeholder',
            'A draft, links, angles to try. This becomes the post text.'
          )}
          className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px] text-[14px] text-textColor outline-none min-h-[120px] resize-y focus-visible:ring-2 focus-visible:ring-btnPrimary"
        />
      </div>
      <div className="flex flex-col gap-[6px]">
        <div className="text-[14px]">{t('idea_media', 'Media')}</div>
        <div className="flex flex-wrap gap-[8px] items-center">
          {media.map((item) => (
            <div key={item.id} className="relative">
              <IdeaMediaThumb path={item.path} size={64} />
              <button
                type="button"
                onClick={() =>
                  setMedia((current) => current.filter((p) => p.id !== item.id))
                }
                aria-label={t('remove_media', 'Remove media')}
                className="absolute -top-[6px] -end-[6px] w-[22px] h-[22px] rounded-full bg-red-500 text-white text-[12px] flex items-center justify-center"
              >
                ×
              </button>
            </div>
          ))}
          {media.length < 10 && (
            <button
              type="button"
              onClick={pickMedia}
              className="h-[64px] px-[14px] rounded-[8px] border border-dashed border-newTableBorder text-[13px] hover:bg-boxFocused"
            >
              {t('add_media', 'Add media')}
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-[6px]">
        <label htmlFor={tagId} className="text-[14px]">
          {t('campaign_or_tag', 'Campaign, pillar or tag')}
        </label>
        <select
          id={tagId}
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="bg-newBgColorInner h-[42px] border border-newTableBorder rounded-[8px] px-[12px] text-[14px] text-textColor outline-none"
        >
          <option value="">{t('none', 'None')}</option>
          {(tagsData?.tags || []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({kindLabel(t, p.kind)})
            </option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-[8px] mt-[8px]">
        <Button type="button" secondary={true} onClick={close}>
          {t('cancel', 'Cancel')}
        </Button>
        <Button type="submit" loading={saving}>
          {idea ? t('save', 'Save') : t('add_idea', 'Add idea')}
        </Button>
      </div>
    </form>
  );
};

export { kindLabel };
