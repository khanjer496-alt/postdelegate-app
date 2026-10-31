'use client';

import React, { FC, useCallback, useId, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  WorkspaceTag,
  useWorkspaceTags,
} from '@gitroom/frontend/components/launches/select.tags';
import { kindLabel } from '@gitroom/frontend/components/ideas/idea.modal';

const KINDS: WorkspaceTag['kind'][] = ['CAMPAIGN', 'PILLAR', 'TAG'];

const PALETTE = [
  '#7357FF',
  '#2F80ED',
  '#14B8A6',
  '#22A45D',
  '#9BCB2C',
  '#F2C94C',
  '#F2994A',
  '#EB5757',
  '#E0529C',
  '#6B7280',
];

const HEX = /^#[0-9a-f]{6}$/i;

const TagForm: FC<{
  tag?: WorkspaceTag;
  kind: WorkspaceTag['kind'];
  close: () => void;
  onSaved: () => void;
}> = ({ tag, kind: initialKind, close, onSaved }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const hexId = useId();
  const descriptionId = useId();
  const [name, setName] = useState(tag?.name || '');
  const [color, setColor] = useState(tag?.color || PALETTE[0]);
  const [kind, setKind] = useState<WorkspaceTag['kind']>(
    tag?.kind || initialKind
  );
  const [description, setDescription] = useState(tag?.description || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim()) {
        setError(t('campaign_name_required', 'Give it a name.'));
        return;
      }
      if (!HEX.test(color)) {
        setError(
          t('campaign_color_invalid', 'Use a colour like #7357FF.')
        );
        return;
      }
      setSaving(true);
      const response = await fetch(
        tag ? `/posts/tags/${tag.id}` : '/posts/tags',
        {
          method: tag ? 'PUT' : 'POST',
          body: JSON.stringify({
            name: name.trim(),
            color,
            kind,
            description: description.trim(),
          }),
        }
      );
      setSaving(false);
      if (!response.ok) {
        toaster.show(t('campaign_save_failed', 'Could not save it'), 'warning');
        return;
      }
      onSaved();
      close();
    },
    [name, color, kind, description, tag, onSaved, close]
  );

  return (
    <form onSubmit={save} className="flex flex-col gap-[12px] text-textColor">
      <fieldset className="flex flex-col gap-[6px]">
        <legend className="text-[14px] mb-[6px]">{t('type', 'Type')}</legend>
        <div className="flex gap-[6px] p-[4px] border border-newTableBorder rounded-[8px] w-fit">
          {KINDS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => setKind(option)}
              className={clsx(
                'px-[12px] h-[32px] rounded-[6px] text-[14px]',
                kind === option && 'bg-boxFocused text-textItemFocused'
              )}
            >
              {kindLabel(t, option)}
            </button>
          ))}
        </div>
      </fieldset>
      <Input
        name="name"
        disableForm={true}
        label={t('name', 'Name')}
        value={name}
        maxLength={100}
        autoFocus={true}
        error={error || undefined}
        onChange={(e) => {
          setName(e.target.value);
          setError('');
        }}
      />
      <fieldset className="flex flex-col gap-[8px]">
        <legend className="text-[14px] mb-[6px]">{t('color', 'Colour')}</legend>
        <div className="flex flex-wrap gap-[8px]">
          {PALETTE.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={swatch}
              aria-pressed={color.toLowerCase() === swatch.toLowerCase()}
              onClick={() => setColor(swatch)}
              className={clsx(
                'w-[30px] h-[30px] rounded-full border-2',
                color.toLowerCase() === swatch.toLowerCase()
                  ? 'border-textColor'
                  : 'border-transparent'
              )}
              style={{ backgroundColor: swatch }}
            />
          ))}
        </div>
        <div className="flex items-center gap-[8px]">
          <span
            aria-hidden="true"
            className="w-[30px] h-[30px] rounded-[8px] border border-newTableBorder"
            style={{ backgroundColor: HEX.test(color) ? color : 'transparent' }}
          />
          <label htmlFor={hexId} className="sr-only">
            {t('hex_color', 'Hex colour')}
          </label>
          <input
            id={hexId}
            value={color}
            maxLength={7}
            onChange={(e) => {
              setColor(e.target.value);
              setError('');
            }}
            className="bg-newBgColorInner h-[36px] w-[120px] border border-newTableBorder rounded-[8px] px-[10px] text-[14px] text-textColor outline-none font-mono"
          />
        </div>
      </fieldset>
      <div className="flex flex-col gap-[6px]">
        <label htmlFor={descriptionId} className="text-[14px]">
          {t('description_optional', 'Description (optional)')}
        </label>
        <textarea
          id={descriptionId}
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
          className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px] text-[14px] text-textColor outline-none min-h-[70px] resize-y"
        />
      </div>
      <div className="flex justify-end gap-[8px] mt-[8px]">
        <Button type="button" secondary={true} onClick={close}>
          {t('cancel', 'Cancel')}
        </Button>
        <Button type="submit" loading={saving}>
          {t('save', 'Save')}
        </Button>
      </div>
    </form>
  );
};

// Campaigns, content pillars and plain tags: all of them label posts and
// ideas, and color the calendar cards
export const CampaignsComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const modal = useModals();
  const { data, mutate, isLoading } = useWorkspaceTags();
  const tags = data?.tags || [];

  const open = useCallback(
    (kind: WorkspaceTag['kind'], tag?: WorkspaceTag) => {
      modal.openModal({
        title: tag
          ? t('edit_name', 'Edit {{name}}', { name: tag.name })
          : t('new_label', 'New {{kind}}', {
              kind: kindLabel(t, kind).toLowerCase(),
            }),
        closeOnClickOutside: false,
        askClose: false,
        size: '520px',
        children: (close) => (
          <TagForm tag={tag} kind={kind} close={close} onSaved={() => mutate()} />
        ),
      });
    },
    [modal, mutate, t]
  );

  const remove = useCallback(
    async (tag: WorkspaceTag) => {
      if (
        !(await deleteDialog(
          t(
            'delete_campaign_confirm',
            'Delete "{{name}}"? Posts and ideas keep their content but lose this label.',
            { name: tag.name }
          ),
          t('yes_delete_it', 'Yes, delete it!')
        ))
      ) {
        return;
      }
      await fetch(`/posts/tags/${tag.id}`, { method: 'DELETE' });
      mutate();
    },
    [mutate, t]
  );

  if (isLoading) {
    return (
      <div className="animate-pulse text-[14px]">{t('loading', 'Loading...')}</div>
    );
  }

  const sections: Array<{
    kind: WorkspaceTag['kind'];
    title: string;
    description: string;
  }> = [
    {
      kind: 'CAMPAIGN',
      title: t('campaigns', 'Campaigns'),
      description: t(
        'campaigns_description',
        'Time-boxed pushes, like a launch or a seasonal sale.'
      ),
    },
    {
      kind: 'PILLAR',
      title: t('content_pillars', 'Content pillars'),
      description: t(
        'pillars_description',
        'The recurring themes you post about, like tips, behind the scenes or customer stories.'
      ),
    },
    {
      kind: 'TAG',
      title: t('tags', 'Tags'),
      description: t('tags_description', 'Any other label for your posts.'),
    },
  ];

  return (
    <div className="flex flex-col gap-[20px]">
      <p className="text-[14px] text-newTextColor/70 max-w-[640px]">
        {t(
          'campaigns_intro',
          'Add a campaign or pillar to a post from the composer tags, or to an idea. Its colour shows on the calendar cards, and you can filter the calendar by it.'
        )}
      </p>
      <div className="grid grid-cols-3 gap-[12px] mobile:grid-cols-1">
        {sections.map((section) => {
          const list = tags.filter((tag) => (tag.kind || 'TAG') === section.kind);
          return (
            <section
              key={section.kind}
              aria-label={section.title}
              className="flex flex-col gap-[10px] rounded-[12px] p-[14px] bg-newBgColor"
            >
              <div className="flex items-start gap-[8px]">
                <div className="flex-1">
                  <h2 className="text-[15px] font-[600]">{section.title}</h2>
                  <div className="text-[12px] text-newTextColor/60">
                    {section.description}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => open(section.kind)}
                  className="h-[32px] px-[12px] rounded-[8px] bg-btnCta text-btnCtaText hover:bg-btnCtaHover text-[13px] font-[600] whitespace-nowrap"
                >
                  {t('add', 'Add')}
                </button>
              </div>
              <ul className="flex flex-col gap-[6px]">
                {list.map((tag) => (
                  <li
                    key={tag.id}
                    className="flex items-center gap-[10px] bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[10px] py-[8px]"
                  >
                    <span
                      aria-hidden="true"
                      className="w-[14px] h-[14px] min-w-[14px] rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] truncate">{tag.name}</div>
                      {!!tag.description && (
                        <div className="text-[12px] text-newTextColor/60 truncate">
                          {tag.description}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => open(section.kind, tag)}
                      className="text-[13px] px-[8px] h-[28px] rounded-[6px] hover:bg-boxFocused"
                    >
                      {t('edit', 'Edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(tag)}
                      aria-label={t('delete_name', 'Delete {{name}}', {
                        name: tag.name,
                      })}
                      className="text-[13px] px-[8px] h-[28px] rounded-[6px] text-red-500 hover:bg-boxFocused"
                    >
                      {t('delete', 'Delete')}
                    </button>
                  </li>
                ))}
                {!list.length && (
                  <li className="text-[13px] text-newTextColor/60 border border-dashed border-newTableBorder rounded-[8px] p-[12px] text-center">
                    {t('nothing_here_yet', 'Nothing here yet.')}
                  </li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
};
