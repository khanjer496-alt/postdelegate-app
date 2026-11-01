'use client';

import React, { FC, useCallback, useId, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { ConnectAiKey } from '@gitroom/frontend/components/agents/agent';
import {
  StudioTextStyle,
  studioTextStyles,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';
import type {
  StudioPosition,
  StudioSpec,
} from '@gitroom/frontend/components/studio/use.studio';

export interface StudioSettingsProps {
  projectId: string;
  spec: StudioSpec;
  change: (patch: Partial<StudioSpec>) => void;
  // saves what is on screen, so a server call reads the same project
  save: () => Promise<boolean>;
}

const useStyleLabel = () => {
  const t = useT();
  return useCallback(
    (style: StudioTextStyle) =>
      ({
        bold: t('studio_style_bold', 'Bold'),
        impact: t('studio_style_impact', 'Impact'),
        clean: t('studio_style_clean', 'Clean'),
        classic: t('studio_style_classic', 'Classic'),
      }[style]),
    [t]
  );
};

export const Segmented: FC<{
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => (
  <div className="flex flex-col gap-[6px]">
    <div className="text-[14px]">{label}</div>
    <div
      role="radiogroup"
      aria-label={label}
      className="flex p-[4px] border border-newTableBorder rounded-[8px] text-[13px] font-[500] w-fit flex-wrap"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={clsx(
            'px-[12px] pt-[5px] pb-[4px] rounded-[6px]',
            value === option.value && 'text-textItemFocused bg-boxFocused'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

const StyleSelect: FC<{
  label: string;
  value: StudioTextStyle;
  onChange: (value: StudioTextStyle) => void;
}> = ({ label, value, onChange }) => {
  const id = useId();
  const styleLabel = useStyleLabel();
  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={id} className="text-[14px]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as StudioTextStyle)}
        className="bg-newBgColorInner h-[42px] border border-newTableBorder rounded-[8px] px-[12px] text-[14px] text-textColor outline-none"
      >
        {studioTextStyles.map((style) => (
          <option key={style} value={style}>
            {styleLabel(style)}
          </option>
        ))}
      </select>
    </div>
  );
};

const usePositions = () => {
  const t = useT();
  return [
    { value: 'top', label: t('studio_top', 'Top') },
    { value: 'center', label: t('studio_center', 'Center') },
    { value: 'bottom', label: t('studio_bottom', 'Bottom') },
  ];
};

const HookSettings: FC<StudioSettingsProps> = ({ spec, change }) => {
  const t = useT();
  const id = useId();
  const positions = usePositions();
  const hook = spec.hook || { text: '' };

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-col gap-[6px]">
        <label htmlFor={id} className="text-[14px]">
          {t('studio_hook_text', 'Hook')}
        </label>
        <textarea
          id={id}
          value={hook.text}
          maxLength={120}
          rows={3}
          onChange={(e) => change({ hook: { ...hook, text: e.target.value } })}
          placeholder={t(
            'studio_hook_placeholder',
            'The line that stops the scroll'
          )}
          className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px] text-[14px] text-textColor outline-none resize-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
        />
        <div className="text-[12px] text-textItemBlur self-end tabular-nums">
          {hook.text.length}/120
        </div>
      </div>
      <StyleSelect
        label={t('studio_text_style', 'Text style')}
        value={hook.style || 'bold'}
        onChange={(style) => change({ hook: { ...hook, style } })}
      />
      <Segmented
        label={t('studio_position', 'Position')}
        value={hook.position || 'top'}
        options={positions}
        onChange={(position) =>
          change({ hook: { ...hook, position: position as StudioPosition } })
        }
      />
      <Segmented
        label={t('studio_hook_duration', 'Show the hook')}
        value={String(hook.seconds || 0)}
        options={[
          { value: '0', label: t('studio_whole_video', 'Whole video') },
          { value: '3', label: '3s' },
          { value: '5', label: '5s' },
        ]}
        onChange={(value) =>
          change({
            hook: { ...hook, seconds: Number(value) || undefined },
          })
        }
      />
    </div>
  );
};

const CaptionSettings: FC<StudioSettingsProps> = ({
  projectId,
  spec,
  change,
  save,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const user = useUser();
  const scriptId = useId();
  const positions = usePositions();
  const captions = spec.captions || { words: [] };
  const style = captions.style || {};
  const [script, setScript] = useState(captions.script || '');
  const [working, setWorking] = useState<'' | 'whisper' | 'script'>('');

  const transcribe = useCallback(
    async (source: 'whisper' | 'script') => {
      if (!spec.input?.mediaId) {
        toaster.show(t('studio_pick_first', 'Pick a video first'), 'warning');
        return;
      }
      setWorking(source);
      try {
        if (!(await save())) {
          return;
        }
        const response = await fetch(
          `/studio/projects/${projectId}/transcribe`,
          {
            method: 'POST',
            body: JSON.stringify(source === 'script' ? { script } : {}),
          }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          toaster.show(
            typeof data?.message === 'string'
              ? data.message
              : t('studio_transcribe_failed', 'The captions could not be made'),
            'warning'
          );
          return;
        }
        change({
          captions: {
            ...captions,
            source,
            ...(source === 'script' ? { script } : {}),
            words: data.words,
          },
        });
      } finally {
        setWorking('');
      }
    },
    [spec.input, captions, script, projectId, save, change]
  );

  const setStyle = (patch: Partial<NonNullable<typeof captions.style>>) =>
    change({ captions: { ...captions, style: { ...style, ...patch } } });

  return (
    <div className="flex flex-col gap-[14px]">
      <Segmented
        label={t('studio_fit', 'Fit')}
        value={spec.fit || 'crop'}
        options={[
          { value: 'crop', label: t('studio_fit_crop', 'Fill (crop)') },
          { value: 'blur', label: t('studio_fit_blur', 'Whole picture') },
        ]}
        onChange={(fit) => change({ fit: fit as 'crop' | 'blur' })}
      />

      <div className="flex flex-col gap-[8px] border-t border-newTableBorder pt-[14px]">
        <div className="text-[14px] font-[600]">
          {t('studio_captions', 'Captions')}
        </div>
        {user?.aiAvailable ? (
          <button
            type="button"
            disabled={!!working}
            onClick={() => transcribe('whisper')}
            className="h-[40px] px-[14px] rounded-[8px] bg-btnPrimary text-white text-[14px] font-[600] disabled:opacity-50"
          >
            {working === 'whisper'
              ? t('studio_transcribing', 'Listening to the clip…')
              : t('studio_transcribe', 'Make captions with my AI')}
          </button>
        ) : (
          <div className="rounded-[10px] border border-newTableBorder overflow-hidden">
            <ConnectAiKey
              title={t('studio_connect_ai_title', 'Connect your AI')}
              description={t(
                'studio_connect_ai_description',
                'With your own OpenAI key, Studio writes the captions from what is said in the clip. Without one, type the script below.'
              )}
            />
          </div>
        )}
        <label htmlFor={scriptId} className="text-[13px] text-textItemBlur">
          {t(
            'studio_script_label',
            'Or type the script, it is spread over the clip:'
          )}
        </label>
        <textarea
          id={scriptId}
          value={script}
          maxLength={3000}
          rows={4}
          onChange={(e) => setScript(e.target.value)}
          className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px] text-[14px] text-textColor outline-none resize-y focus-visible:ring-2 focus-visible:ring-btnPrimary"
        />
        <button
          type="button"
          disabled={!!working || !script.trim()}
          onClick={() => transcribe('script')}
          className="h-[40px] px-[14px] rounded-[8px] bg-btnSimple text-btnText text-[14px] font-[600] disabled:opacity-50"
        >
          {working === 'script'
            ? t('studio_timing', 'Timing the script…')
            : t('studio_time_script', 'Use this script')}
        </button>
      </div>

      {!!captions.words.length && (
        <div className="flex flex-col gap-[6px]">
          <div className="text-[13px] text-textItemBlur">
            {t('studio_edit_words', 'Fix any word before rendering:')}
          </div>
          <div className="flex flex-wrap gap-[4px] max-h-[160px] overflow-y-auto p-[2px]">
            {captions.words.map((word, index) => (
              <input
                key={index}
                value={word.text}
                maxLength={60}
                aria-label={t('studio_word', 'Word {{n}}', { n: index + 1 })}
                onChange={(e) =>
                  change({
                    captions: {
                      ...captions,
                      words: captions.words.map((p, at) =>
                        at === index ? { ...p, text: e.target.value } : p
                      ),
                    },
                  })
                }
                onBlur={(e) => {
                  // a word left empty is taken out
                  if (!e.target.value.trim()) {
                    change({
                      captions: {
                        ...captions,
                        words: captions.words.filter((_, at) => at !== index),
                      },
                    });
                  }
                }}
                style={{ width: `${Math.max(3, word.text.length + 1)}ch` }}
                className="h-[28px] px-[4px] rounded-[6px] bg-newBgLineColor text-[13px] text-textColor outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-[14px] border-t border-newTableBorder pt-[14px]">
        <StyleSelect
          label={t('studio_caption_style', 'Caption style')}
          value={style.font || 'bold'}
          onChange={(font) => setStyle({ font })}
        />
        <Segmented
          label={t('studio_position', 'Position')}
          value={style.position || 'bottom'}
          options={positions}
          onChange={(position) =>
            setStyle({ position: position as StudioPosition })
          }
        />
        <Segmented
          label={t('studio_words_per_line', 'Words per line')}
          value={String(style.maxWords || 3)}
          options={['1', '2', '3', '4', '5'].map((value) => ({
            value,
            label: value,
          }))}
          onChange={(value) => setStyle({ maxWords: Number(value) })}
        />
        <label className="flex items-center gap-[10px] text-[14px]">
          <input
            type="color"
            value={style.highlight || '#FFD400'}
            onChange={(e) =>
              setStyle({ highlight: e.target.value.toUpperCase() })
            }
            className="w-[36px] h-[28px] rounded-[6px] bg-transparent"
          />
          {t('studio_highlight', 'Highlight colour')}
        </label>
      </div>
    </div>
  );
};

// The settings each template adds to the shared clip controls, and what a
// new project of that template starts with. A new template adds an entry
export const studioTemplateSettings: Record<
  string,
  {
    defaults: Partial<StudioSpec>;
    // the template has what it needs to render
    ready: (spec: StudioSpec) => boolean;
    Settings: FC<StudioSettingsProps>;
  }
> = {
  'hook-over-clip': {
    defaults: { hook: { text: '', style: 'bold', position: 'top' } },
    ready: (spec) => !!spec.hook?.text?.trim(),
    Settings: HookSettings,
  },
  'talking-head-captions': {
    defaults: {
      fit: 'crop',
      captions: {
        words: [],
        style: { font: 'bold', position: 'bottom', maxWords: 3 },
      },
    },
    ready: (spec) => !!spec.captions?.words?.length,
    Settings: CaptionSettings,
  },
};
