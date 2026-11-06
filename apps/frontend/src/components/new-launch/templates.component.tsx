'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { Button } from '@gitroom/react/form/button';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { TrashIcon } from '@gitroom/frontend/components/ui/icons';

interface Template {
  id: string;
  name?: string | null;
  content: string;
}

// templates are signatures of the TEMPLATE type, they never auto add
export const useTemplates = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await (await fetch('/signatures/templates')).json()) as Template[];
  }, [fetch]);

  return useSWR('signature-templates', load);
};

const plainText = (content: string) =>
  stripHtmlValidation('normal', content || '', false, true).trim();

// the toolbar button of the editor, next to the signature one
export const TemplatesBox: FC<{
  editor: any;
  value: string;
}> = ({ editor, value }) => {
  const t = useT();
  const modals = useModals();

  const insert = useCallback(
    (content: string) => {
      editor?.chain()?.focus()?.insertContent(content)?.run();
    },
    [editor]
  );

  const open = useCallback(() => {
    modals.openModal({
      title: t('post_templates', 'Post Templates'),
      withCloseButton: true,
      closeOnEscape: true,
      classNames: {
        modal: 'w-[100%] max-w-[600px]',
      },
      children: (close) => (
        <TemplatesModal value={value} insert={insert} close={close} />
      ),
    });
  }, [value, insert, t]);

  return (
    <button
      type="button"
      onClick={open}
      aria-label={t('post_templates', 'Post Templates')}
      data-tooltip-id="tooltip"
      data-tooltip-content={t('post_templates', 'Post Templates')}
      className="select-none cursor-pointer rounded-[6px] mobile:rounded-[8px] w-[30px] h-[30px] mobile:w-[40px] mobile:h-[40px] bg-newColColor mobile:bg-newSettings flex justify-center items-center outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="mobile:w-[20px] mobile:h-[20px]"
      >
        <rect
          x="2"
          y="2"
          width="12"
          height="12"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path
          d="M2 6H14M6 6V14"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
};

const TemplatesModal: FC<{
  value: string;
  insert: (content: string) => void;
  close: () => void;
}> = ({ value, insert, close }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, mutate, isLoading } = useTemplates();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const hasContent = !!plainText(value);

  const save = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!hasContent || !name.trim() || saving) {
        return;
      }
      setSaving(true);
      let ok = false;
      try {
        const response = await fetch('/signatures', {
          method: 'POST',
          body: JSON.stringify({
            type: 'TEMPLATE',
            name: name.trim().slice(0, 100),
            content: value,
            autoAdd: false,
          }),
        });
        ok = response.ok;
      } catch (err) {
        ok = false;
      } finally {
        setSaving(false);
      }
      if (!ok) {
        toaster.show(
          t('template_save_failed', 'Could not save the template'),
          'warning'
        );
        return;
      }
      setName('');
      mutate();
      toaster.show(t('template_saved', 'Template saved'), 'success');
    },
    [hasContent, name, saving, value, mutate, toaster, t]
  );

  const remove = useCallback(
    (template: Template) => async () => {
      if (
        !(await deleteDialog(
          t(
            'are_you_sure_delete_template',
            'Are you sure you want to delete this template?'
          ),
          t('yes_delete_it', 'Yes, delete it!')
        ))
      ) {
        return;
      }
      await fetch(`/signatures/${template.id}`, {
        method: 'DELETE',
      });
      mutate();
    },
    [mutate, t]
  );

  return (
    <div className="flex flex-col gap-[20px] text-textColor">
      <form onSubmit={save} className="flex flex-col gap-[8px]">
        <label
          htmlFor="template-name"
          className="text-[14px] font-[600]"
        >
          {t('save_post_as_template', 'Save this post as a template')}
        </label>
        <div className="flex gap-[8px] mobile:flex-col">
          <div className="flex-1 h-[42px] bg-newBgColorInner border-newTableBorder border rounded-[8px] flex items-center focus-within:border-btnPrimary">
            <input
              id="template-name"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              disabled={!hasContent}
              className="h-full w-full bg-transparent outline-none px-[16px] text-[14px] text-textColor placeholder:text-newTextColor/50 disabled:cursor-not-allowed"
              placeholder={t('template_name', 'Template name')}
            />
          </div>
          <Button
            type="submit"
            className="rounded-[8px] h-[42px]"
            disabled={!hasContent || !name.trim()}
            loading={saving}
          >
            {t('save_template', 'Save template')}
          </Button>
        </div>
        {!hasContent && (
          <div className="text-[12px] text-newTextColor/60">
            {t(
              'template_write_first',
              'Write something in the editor first, then save it here.'
            )}
          </div>
        )}
      </form>
      <div className="flex flex-col gap-[8px]">
        <div className="text-[14px] font-[600]">
          {t('your_templates', 'Your templates')}
        </div>
        {!isLoading && !data?.length && (
          <div className="text-[13px] text-newTextColor/60">
            {t(
              'no_templates_yet',
              'No templates yet. Save a post you reuse often and insert it in one click.'
            )}
          </div>
        )}
        <ul className="flex flex-col gap-[8px] max-h-[360px] overflow-y-auto scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner">
          {(data || []).map((template) => (
            <li
              key={template.id}
              className="flex items-center gap-[12px] p-[12px] rounded-[8px] border border-newTableBorder bg-newBgColorInner"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-[600] truncate">
                  {template.name || t('untitled_template', 'Untitled template')}
                </div>
                <div className="text-[13px] text-newTextColor/70 line-clamp-2 break-words whitespace-pre-wrap">
                  {plainText(template.content)}
                </div>
              </div>
              <Button
                className="rounded-[8px] shrink-0"
                onClick={() => {
                  insert(template.content);
                  close();
                }}
              >
                {t('insert', 'Insert')}
              </Button>
              <button
                type="button"
                onClick={remove(template)}
                aria-label={t('delete_template', 'Delete template')}
                className="shrink-0 w-[32px] h-[32px] flex items-center justify-center rounded-[6px] text-[#FF3F3F] hover:bg-newColColor outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
