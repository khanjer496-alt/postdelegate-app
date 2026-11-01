'use client';

import 'reflect-metadata';
import React, { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  StudioTemplate,
  useStudioProject,
  useStudioProjects,
  useStudioTemplates,
} from '@gitroom/frontend/components/studio/use.studio';
import { StudioEditor } from '@gitroom/frontend/components/studio/studio.editor';
import { StudioFonts } from '@gitroom/frontend/components/studio/studio.preview';
import { StudioUsageNote } from '@gitroom/frontend/components/studio/studio.render.panel';

const TemplateIcon: FC<{ captions: boolean }> = ({ captions }) => (
  <div className="w-[54px] h-[96px] rounded-[8px] bg-newBgLineColor relative overflow-hidden shrink-0">
    <div
      className={clsx(
        'absolute inset-x-[6px] h-[6px] rounded-full bg-btnCta',
        captions ? 'bottom-[18px]' : 'top-[14px]'
      )}
    />
    <div
      className={clsx(
        'absolute inset-x-[12px] h-[6px] rounded-full bg-newSep',
        captions ? 'bottom-[8px]' : 'top-[24px]'
      )}
    />
  </div>
);

// The templates a new video starts from
const TemplatePicker: FC<{
  templates: StudioTemplate[];
  onPick: (template: StudioTemplate) => void;
}> = ({ templates, onPick }) => (
  <div className="grid grid-cols-2 mobile:grid-cols-1 gap-[12px]">
    {templates.map((template) => (
      <button
        key={template.identifier}
        type="button"
        onClick={() => onPick(template)}
        className="flex gap-[14px] items-start text-start p-[14px] rounded-[12px] border border-newTableBorder hover:bg-boxHover focus-visible:ring-2 focus-visible:ring-btnPrimary outline-none"
      >
        <TemplateIcon captions={template.captions} />
        <div className="flex flex-col gap-[6px]">
          <div className="text-[16px] font-[600]">{template.title}</div>
          <div className="text-[13px] text-textItemBlur">
            {template.description}
          </div>
        </div>
      </button>
    ))}
  </div>
);

// Studio: vertical videos made from the media library, rendered on our
// servers and saved back to it, ready for the composer
export const StudioComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const modals = useModals();
  const { data: templates } = useStudioTemplates();
  const { data: projects, mutate: mutateProjects } = useStudioProjects();
  const [selected, setSelected] = useState<string>();
  const { data: project, mutate: mutateProject } = useStudioProject(selected);

  const create = useCallback(
    async (template: StudioTemplate) => {
      const response = await fetch('/studio/projects', {
        method: 'POST',
        body: JSON.stringify({
          name: `${template.title} ${dayjs().format('MMM D, HH:mm')}`,
          template: template.identifier,
        }),
      });
      if (!response.ok) {
        toaster.show(
          t('studio_create_failed', 'Could not create the project'),
          'warning'
        );
        return;
      }
      const { id } = await response.json();
      await mutateProjects();
      setSelected(id);
    },
    [mutateProjects]
  );

  const newVideo = useCallback(() => {
    modals.openModal({
      title: t('studio_new_video', 'New video'),
      askClose: false,
      size: '720px',
      children: (close) => (
        <TemplatePicker
          templates={templates || []}
          onPick={(template) => {
            close();
            create(template);
          }}
        />
      ),
    });
  }, [templates, create]);

  const remove = useCallback(
    async (id: string, name: string) => {
      if (
        !(await deleteDialog(
          t('studio_delete_confirm', 'Delete the project "{{name}}"?', {
            name,
          }),
          t('yes_delete_it', 'Yes, delete it!')
        ))
      ) {
        return;
      }
      await fetch(`/studio/projects/${id}`, { method: 'DELETE' });
      if (selected === id) {
        setSelected(undefined);
      }
      mutateProjects();
    },
    [selected, mutateProjects]
  );

  const template = templates?.find((p) => p.identifier === project?.template);

  return (
    <div className="bg-newBgColorInner p-[20px] mobile:p-[16px] flex flex-1 gap-[20px] mobile:flex-col text-textColor min-w-0">
      <StudioFonts />
      <div className="w-[240px] mobile:w-full shrink-0 flex flex-col gap-[12px]">
        <button
          type="button"
          onClick={newVideo}
          disabled={!templates?.length}
          className="h-[42px] px-[16px] rounded-[10px] bg-btnCta text-btnCtaText hover:bg-btnCtaHover shadow-cta font-[600] text-[14px] flex items-center justify-center gap-[6px] disabled:opacity-50"
        >
          <svg
            width="18"
            height="18"
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
          {t('studio_new_video', 'New video')}
        </button>
        <ul className="flex flex-col gap-[4px] mobile:max-h-[200px] overflow-y-auto">
          {(projects || []).map((item) => (
            <li key={item.id} className="group relative list-none">
              <button
                type="button"
                onClick={() => setSelected(item.id)}
                aria-current={selected === item.id}
                className={clsx(
                  'w-full text-start px-[12px] py-[9px] pe-[36px] rounded-[8px] hover:bg-boxHover',
                  selected === item.id && 'bg-boxFocused text-textItemFocused'
                )}
              >
                <div className="text-[14px] font-[500] truncate">
                  {item.name}
                </div>
                <div className="text-[12px] text-textItemBlur truncate">
                  {templates?.find((p) => p.identifier === item.template)
                    ?.title || item.template}
                </div>
              </button>
              <button
                type="button"
                onClick={() => remove(item.id, item.name)}
                aria-label={t('studio_delete_project', 'Delete project')}
                className="absolute end-[6px] top-1/2 -translate-y-1/2 w-[26px] h-[26px] rounded-[6px] text-textItemBlur hover:text-red-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 flex items-center justify-center"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4h6v3"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-auto mobile:mt-0">
          <StudioUsageNote />
        </div>
      </div>

      <div className="flex flex-1 flex-col min-w-0">
        {selected && project?.id === selected ? (
          <StudioEditor
            key={project.id}
            project={project}
            template={template}
            onChanged={() => {
              mutateProjects();
              mutateProject();
            }}
          />
        ) : selected ? (
          <div className="flex-1 rounded-[12px] bg-newBgLineColor animate-pulse" />
        ) : (
          <div className="flex flex-col gap-[16px] max-w-[760px]">
            <div>
              <h1 className="text-[22px] font-[600]">
                {t('studio_title', 'Studio')}
              </h1>
              <div className="text-[14px] text-textItemBlur">
                {t(
                  'studio_intro',
                  'Turn a video from your media library into a vertical 1080×1920 video with a hook or word-by-word captions. It is rendered on our servers and saved to your media library, ready to post.'
                )}
              </div>
            </div>
            <TemplatePicker templates={templates || []} onPick={create} />
          </div>
        )}
      </div>
    </div>
  );
};
