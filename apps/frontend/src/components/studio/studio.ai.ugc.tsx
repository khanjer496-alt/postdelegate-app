'use client';

import React, {
  FC,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import copy from 'copy-to-clipboard';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import {
  MediaBox,
  mediaLibrarySize,
} from '@gitroom/frontend/components/media/media.component';
import { ConnectAiKey } from '@gitroom/frontend/components/settings/connect.ai.key';
import { studioTextStyles } from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';
import {
  STUDIO_AI_LINE_CHARS,
  STUDIO_AI_MAX_FOOTAGE,
  STUDIO_AI_MAX_LINES,
  STUDIO_AI_POST_CHARS,
  studioAiTones,
} from '@gitroom/nestjs-libraries/dtos/studio/ai.ugc.limits';
import {
  StudioAiScript,
  StudioPosition,
  StudioProject,
  StudioSpec,
  StudioTemplate,
  useStudioAi,
} from '@gitroom/frontend/components/studio/use.studio';
import { Segmented } from '@gitroom/frontend/components/studio/studio.settings';
import { studioFontStyle } from '@gitroom/frontend/components/studio/studio.preview';
import { StudioRenderPanel } from '@gitroom/frontend/components/studio/studio.render.panel';
import { StudioMusicPicker } from '@gitroom/frontend/components/studio/studio.music';

const LENGTHS = [15, 20, 30, 45];
const EMPTY_SCRIPT: StudioAiScript = {
  hook: '',
  lines: [],
  cta: '',
  postText: '',
};

const inputClass =
  'bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] text-[14px] text-textColor outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary';

// The draft as the server takes it: a field that is not valid yet (a topic of
// two letters, an empty hook) is left out instead of failing every autosave
const forSave = (spec: StudioSpec): StudioSpec => {
  const { topic, script, footage, ...rest } = spec;
  return {
    ...rest,
    ...(topic && topic.trim().length >= 3 ? { topic } : {}),
    ...(script && script.hook.trim() ? { script } : {}),
    ...(footage?.length ? { footage } : {}),
  };
};

const messageOf = (data: any, fallback: string) =>
  Array.isArray(data?.message)
    ? data.message.join(', ')
    : typeof data?.message === 'string'
    ? data.message
    : fallback;

// Says, wherever the AI is about to be used, who pays for it
const BillingNote: FC = () => {
  const t = useT();
  return (
    <div className="text-[12px] text-textItemBlur flex items-center gap-[6px]">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M12 8v.01M12 11v5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      {t('studio_ai_billing', 'Uses your OpenAI key; OpenAI bills you.')}
    </div>
  );
};

const Field: FC<{
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}> = ({ label, htmlFor, children }) => (
  <div className="flex flex-col gap-[6px]">
    <label htmlFor={htmlFor} className="text-[14px]">
      {label}
    </label>
    {children}
  </div>
);

// "AI UGC": a script the workspace's own AI writes (or the customer, or
// their assistant over MCP), voiced and cut over their footage with
// word-by-word captions. Every change is saved after a short pause and
// before anything the server reads (script, voice, render)
export const StudioAiUgcEditor: FC<{
  project: StudioProject;
  template?: StudioTemplate;
  onChanged: () => void;
}> = ({ project, template, onChanged }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const modals = useModals();
  const user = useUser();
  const { data: ai } = useStudioAi();
  const topicId = useId();
  const hookId = useId();
  const ctaId = useId();
  const postId = useId();
  const voiceId = useId();
  const fontId = useId();
  const [spec, setSpec] = useState<StudioSpec>(() => ({
    tone: 'friendly',
    seconds: 30,
    voiceover: true,
    stills: 0,
    footage: [],
    captionStyle: { font: 'bold', position: 'bottom', maxWords: 3 },
    ...project.spec,
  }));
  const [name, setName] = useState(project.name);
  const [working, setWorking] = useState<'' | 'script' | 'voice'>('');
  const [voice, setVoice] = useState<{ path: string; seconds: number }>();
  const saved = useRef(JSON.stringify(forSave(spec)));
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(spec);
  latest.current = spec;

  const connected = !!ai?.connected || !!user?.aiAvailable;
  const script = spec.script || EMPTY_SCRIPT;
  const footage = spec.footage || [];
  const voiced = spec.voiceover !== false;

  const save = useCallback(async () => {
    clearTimeout(pending.current);
    const body = JSON.stringify(forSave(latest.current));
    if (body === saved.current) {
      return true;
    }
    const response = await fetch(`/studio/projects/${project.id}`, {
      method: 'PUT',
      body: JSON.stringify({ spec: forSave(latest.current) }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      toaster.show(
        messageOf(data, t('studio_save_failed', 'Could not save')),
        'warning'
      );
      return false;
    }
    saved.current = body;
    return true;
  }, [project.id]);

  const change = useCallback(
    (patch: Partial<StudioSpec>) => {
      setSpec((current) => ({ ...current, ...patch }));
      clearTimeout(pending.current);
      pending.current = setTimeout(() => save(), 800);
    },
    [save]
  );

  // what is left unsaved goes when the editor closes
  useEffect(() => () => void save(), [save]);

  // a voice heard before is for the script it was made from
  const voiceFor = JSON.stringify([
    script.hook,
    script.lines,
    script.cta,
    spec.voice,
    spec.tone,
    voiced,
  ]);
  useEffect(() => {
    setVoice(undefined);
  }, [voiceFor]);

  const setScript = (patch: Partial<StudioAiScript>) =>
    change({ script: { ...script, ...patch } });

  const rename = useCallback(async () => {
    if (!name.trim() || name === project.name) {
      return;
    }
    await fetch(`/studio/projects/${project.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: name.trim() }),
    });
    onChanged();
  }, [name, project]);

  const pickFootage = useCallback(() => {
    modals.openModal({
      title: t('media_library', 'Media Library'),
      askClose: false,
      closeOnEscape: true,
      fullScreen: true,
      size: mediaLibrarySize(),
      height: mediaLibrarySize(),
      children: (close) => (
        <MediaBox
          type="video"
          setMedia={(selected) => {
            change({
              footage: [
                ...(latest.current.footage || []),
                ...selected.map((media) => ({
                  mediaId: media.id,
                  path: media.path,
                })),
              ].slice(0, STUDIO_AI_MAX_FOOTAGE),
            });
            close();
          }}
          closeModal={close}
        />
      ),
    });
  }, [modals, change]);

  const writeScript = useCallback(async () => {
    if ((spec.topic || '').trim().length < 3) {
      toaster.show(
        t('studio_ai_topic_first', 'Describe the topic or product first'),
        'warning'
      );
      return;
    }
    setWorking('script');
    try {
      if (!(await save())) {
        return;
      }
      const response = await fetch(`/studio/projects/${project.id}/ai-script`, {
        method: 'POST',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toaster.show(
          messageOf(
            data,
            t('studio_ai_script_failed', 'The script could not be written')
          ),
          'warning'
        );
        return;
      }
      change({ script: { ...EMPTY_SCRIPT, ...data.script } });
    } finally {
      setWorking('');
    }
  }, [spec.topic, project.id, save, change]);

  const previewVoice = useCallback(async () => {
    setWorking('voice');
    try {
      if (!(await save())) {
        return;
      }
      const response = await fetch(`/studio/projects/${project.id}/voiceover`, {
        method: 'POST',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toaster.show(
          messageOf(
            data,
            t('studio_ai_voice_failed', 'The voice could not be made')
          ),
          'warning'
        );
        return;
      }
      setVoice(data);
    } finally {
      setWorking('');
    }
  }, [project.id, save]);

  const toneLabels: Record<(typeof studioAiTones)[number], string> = {
    friendly: t('studio_tone_friendly', 'Friendly'),
    excited: t('studio_tone_excited', 'Excited'),
    calm: t('studio_tone_calm', 'Calm'),
    expert: t('studio_tone_expert', 'Expert'),
    funny: t('studio_tone_funny', 'Funny'),
  };
  const styleLabels = {
    bold: t('studio_style_bold', 'Bold'),
    impact: t('studio_style_impact', 'Impact'),
    clean: t('studio_style_clean', 'Clean'),
    classic: t('studio_style_classic', 'Classic'),
  };
  const captionStyle = spec.captionStyle || {};
  const setCaptionStyle = (
    patch: Partial<NonNullable<StudioSpec['captionStyle']>>
  ) => change({ captionStyle: { ...captionStyle, ...patch } });

  // what is still needed before a render, in the words the panel shows
  const missing = !footage.length
    ? t('studio_ai_need_footage', 'Add at least one clip of footage')
    : !script.hook.trim()
    ? t('studio_ai_need_script', 'Write or type the script first')
    : voiced && !connected
    ? t(
        'studio_ai_need_key',
        'Connect your OpenAI key for the AI voice, or pick "No voice, captions only"'
      )
    : undefined;

  return (
    <div className="flex flex-1 gap-[20px] tablet:flex-col min-w-0">
      {/* the footage, and a frame of what the video looks like */}
      <div className="w-[300px] tablet:w-full tablet:max-w-[340px] tablet:self-center shrink-0 flex flex-col gap-[10px]">
        <div className="w-full aspect-[9/16] rounded-[12px] bg-black overflow-hidden relative">
          {footage[0]?.path ? (
            <video
              src={footage[0].path}
              muted
              loop
              autoPlay
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <button
              type="button"
              onClick={pickFootage}
              className="absolute inset-0 border-[2px] border-dashed border-newTableBorder rounded-[12px] flex flex-col items-center justify-center gap-[8px] text-[14px] text-textItemBlur hover:bg-boxHover px-[20px] text-center"
            >
              {t(
                'studio_ai_pick_footage',
                'Pick the footage the script is spoken over'
              )}
            </button>
          )}
          {!!script.hook.trim() && (
            <div
              className="absolute inset-x-[12px] text-center pointer-events-none"
              style={
                captionStyle.position === 'top'
                  ? { top: '16%' }
                  : captionStyle.position === 'center'
                  ? { top: '50%', transform: 'translateY(-50%)' }
                  : { bottom: '22%' }
              }
            >
              <span
                style={studioFontStyle(
                  captionStyle.font,
                  captionStyle.font === 'impact' ? 96 : 80,
                  0.26
                )}
              >
                {script.hook
                  .split(/\s+/)
                  .slice(0, captionStyle.maxWords || 3)
                  .join(' ')}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-[8px]">
          <div className="flex items-center justify-between text-[14px]">
            <span className="font-[600]">
              {t('studio_ai_footage', 'Footage')}
            </span>
            <span className="text-[12px] text-textItemBlur tabular-nums">
              {footage.length}/{STUDIO_AI_MAX_FOOTAGE}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-[6px]">
            {footage.map((item, index) => (
              <div
                key={`${item.mediaId}-${index}`}
                className="relative aspect-[9/16] rounded-[8px] overflow-hidden bg-newBgLineColor"
              >
                {!!item.path && (
                  <video
                    src={item.path}
                    muted
                    preload="metadata"
                    className="w-full h-full object-cover"
                  />
                )}
                <button
                  type="button"
                  onClick={() =>
                    change({ footage: footage.filter((_, at) => at !== index) })
                  }
                  aria-label={t(
                    'studio_ai_remove_footage',
                    'Remove this footage'
                  )}
                  className="absolute top-[4px] end-[4px] w-[22px] h-[22px] rounded-full bg-black/70 text-white flex items-center justify-center"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    aria-hidden="true"
                  >
                    <path
                      d="M1 1l8 8M9 1L1 9"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            ))}
            {footage.length < STUDIO_AI_MAX_FOOTAGE && (
              <button
                type="button"
                onClick={pickFootage}
                aria-label={t('studio_ai_add_footage', 'Add footage')}
                className="aspect-[9/16] rounded-[8px] border border-dashed border-newTableBorder text-textItemBlur hover:bg-boxHover flex items-center justify-center"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 21 20"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M10.5 4.17V15.83M4.67 10H16.33"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </div>
          <div className="text-[12px] text-textItemBlur">
            {t(
              'studio_ai_footage_hint',
              'Each line of the script gets the next clip, cut to its length. Clips repeat when there are more lines than clips.'
            )}
          </div>
        </div>
      </div>

      {/* the script, then the voice */}
      <div className="flex-1 min-w-0 flex flex-col gap-[18px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <label className="flex-1 min-w-[200px] flex flex-col">
            <span className="text-[12px] text-textItemBlur">
              {t('studio_project_title', 'Project title')}
            </span>
            <input
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              className="w-full h-[42px] bg-transparent text-[20px] leading-[1.4] font-[600] text-textColor outline-none border-b border-transparent focus:border-newTableBorder"
            />
          </label>
          {!!template && (
            <span className="text-[13px] text-textItemBlur px-[10px] py-[4px] rounded-full bg-newBgLineColor">
              {template.title}
            </span>
          )}
        </div>

        <section className="flex flex-col gap-[14px]">
          <h2 className="text-[16px] font-[600]">
            {t('studio_ai_step_script', '1. Script')}
          </h2>
          {connected ? (
            <>
              <Field
                label={t('studio_ai_topic', 'Topic or product')}
                htmlFor={topicId}
              >
                <textarea
                  id={topicId}
                  value={spec.topic || ''}
                  maxLength={500}
                  rows={3}
                  onChange={(e) => change({ topic: e.target.value })}
                  placeholder={t(
                    'studio_ai_topic_placeholder',
                    'A foldable standing desk for small flats, $199, ships in 2 days'
                  )}
                  className={`${inputClass} py-[10px] resize-none`}
                />
              </Field>
              <div className="flex flex-wrap gap-[20px]">
                <Segmented
                  label={t('studio_ai_tone', 'Tone')}
                  value={spec.tone || 'friendly'}
                  options={studioAiTones.map((tone) => ({
                    value: tone,
                    label: toneLabels[tone],
                  }))}
                  onChange={(tone) =>
                    change({ tone: tone as StudioSpec['tone'] })
                  }
                />
                <Segmented
                  label={t('studio_ai_length', 'Length')}
                  value={String(spec.seconds || 30)}
                  options={LENGTHS.map((seconds) => ({
                    value: String(seconds),
                    label: `${seconds}s`,
                  }))}
                  onChange={(seconds) => change({ seconds: Number(seconds) })}
                />
              </div>
              <div className="flex flex-col gap-[6px]">
                <button
                  type="button"
                  disabled={!!working}
                  onClick={writeScript}
                  className="h-[40px] px-[14px] rounded-[8px] bg-btnPrimary text-white text-[14px] font-[600] disabled:opacity-50 self-start"
                >
                  {working === 'script'
                    ? t('studio_ai_writing', 'Writing the script…')
                    : script.hook
                    ? t('studio_ai_rewrite', 'Write it again with my AI')
                    : t('studio_ai_write', 'Write the script with my AI')}
                </button>
                <BillingNote />
              </div>
            </>
          ) : (
            <div className="rounded-[10px] border border-newTableBorder overflow-hidden">
              <ConnectAiKey
                mcp
                title={t(
                  'studio_ai_connect_title',
                  'Connect your AI to write and voice the script'
                )}
                description={t(
                  'studio_ai_connect_description',
                  'AI UGC runs on your own OpenAI key, so OpenAI bills you, not PostDelegate. Or let Claude or ChatGPT write the script over MCP. You can also type the script below and render it with captions only.'
                )}
              />
            </div>
          )}

          <div className="flex flex-col gap-[10px] border-t border-newTableBorder pt-[14px]">
            <div className="text-[13px] text-textItemBlur">
              {t(
                'studio_ai_edit_script',
                'Edit anything before rendering. Each line is one cut.'
              )}
            </div>
            <Field label={t('studio_ai_hook', 'Hook')} htmlFor={hookId}>
              <input
                id={hookId}
                value={script.hook}
                maxLength={STUDIO_AI_LINE_CHARS}
                onChange={(e) => setScript({ hook: e.target.value })}
                placeholder={t(
                  'studio_hook_placeholder',
                  'The line that stops the scroll'
                )}
                className={`${inputClass} h-[42px]`}
              />
            </Field>
            <div className="flex flex-col gap-[6px]">
              <div className="text-[14px]">{t('studio_ai_lines', 'Lines')}</div>
              {script.lines.map((line, index) => (
                <div key={index} className="flex gap-[6px] items-start">
                  <textarea
                    value={line}
                    rows={2}
                    maxLength={STUDIO_AI_LINE_CHARS}
                    aria-label={t('studio_ai_line', 'Line {{n}}', {
                      n: index + 1,
                    })}
                    onChange={(e) =>
                      setScript({
                        lines: script.lines.map((p, at) =>
                          at === index ? e.target.value : p
                        ),
                      })
                    }
                    className={`${inputClass} flex-1 py-[8px] resize-none`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setScript({
                        lines: script.lines.filter((_, at) => at !== index),
                      })
                    }
                    aria-label={t(
                      'studio_ai_remove_line',
                      'Remove line {{n}}',
                      { n: index + 1 }
                    )}
                    className="w-[32px] h-[32px] mt-[6px] rounded-[6px] text-textItemBlur hover:text-red-400 hover:bg-boxHover flex items-center justify-center"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 10 10"
                      aria-hidden="true"
                    >
                      <path
                        d="M1 1l8 8M9 1L1 9"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              ))}
              {script.lines.length < STUDIO_AI_MAX_LINES && (
                <button
                  type="button"
                  onClick={() => setScript({ lines: [...script.lines, ''] })}
                  className="h-[36px] px-[12px] rounded-[8px] bg-btnSimple text-btnText text-[13px] self-start"
                >
                  {t('studio_ai_add_line', 'Add a line')}
                </button>
              )}
            </div>
            <Field label={t('studio_ai_cta', 'Call to action')} htmlFor={ctaId}>
              <input
                id={ctaId}
                value={script.cta || ''}
                maxLength={STUDIO_AI_LINE_CHARS}
                onChange={(e) => setScript({ cta: e.target.value })}
                className={`${inputClass} h-[42px]`}
              />
            </Field>
            <Field
              label={t('studio_ai_post_text', 'Post text')}
              htmlFor={postId}
            >
              <textarea
                id={postId}
                value={script.postText || ''}
                maxLength={STUDIO_AI_POST_CHARS}
                rows={3}
                onChange={(e) => setScript({ postText: e.target.value })}
                className={`${inputClass} py-[10px] resize-y`}
              />
            </Field>
            {!!script.postText?.trim() && (
              <button
                type="button"
                onClick={() => {
                  copy(script.postText || '');
                  toaster.show(
                    t('studio_ai_post_copied', 'Post text copied'),
                    'success'
                  );
                }}
                className="h-[32px] px-[12px] rounded-[8px] bg-btnSimple text-btnText text-[13px] self-start"
              >
                {t('studio_ai_copy_post', 'Copy the post text')}
              </button>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-[14px] border-t border-newTableBorder pt-[16px]">
          <h2 className="text-[16px] font-[600]">
            {t('studio_ai_step_voice', '2. Voice, look and music')}
          </h2>
          <Segmented
            label={t('studio_ai_voiceover', 'Voiceover')}
            value={voiced ? 'on' : 'off'}
            options={[
              { value: 'on', label: t('studio_ai_voice_on', 'AI voice') },
              {
                value: 'off',
                label: t('studio_ai_voice_off', 'No voice, captions only'),
              },
            ]}
            onChange={(value) => change({ voiceover: value === 'on' })}
          />
          {voiced && connected && (
            <div className="flex flex-col gap-[10px]">
              {!!ai?.voices?.length && (
                <Field label={t('studio_ai_voice', 'Voice')} htmlFor={voiceId}>
                  <select
                    id={voiceId}
                    value={spec.voice || ai.voices[0]}
                    onChange={(e) => change({ voice: e.target.value })}
                    className={`${inputClass} h-[42px] capitalize max-w-[240px]`}
                  >
                    {ai.voices.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="flex flex-wrap items-center gap-[10px]">
                <button
                  type="button"
                  disabled={!!working || !script.hook.trim()}
                  onClick={previewVoice}
                  className="h-[40px] px-[14px] rounded-[8px] bg-btnSimple text-btnText text-[14px] font-[600] disabled:opacity-50"
                >
                  {working === 'voice'
                    ? t('studio_ai_voicing', 'Making the voice…')
                    : t('studio_ai_preview_voice', 'Hear the voice')}
                </button>
                {!!voice && (
                  <audio
                    src={voice.path}
                    controls
                    autoPlay
                    className="h-[40px] max-w-full"
                  />
                )}
              </div>
              <div className="text-[12px] text-textItemBlur">
                {t(
                  'studio_ai_voice_hint',
                  'The render uses the voice you heard. Without a preview it is made when you render.'
                )}
              </div>
              <Segmented
                label={t('studio_ai_stills', 'AI stills between the clips')}
                value={String(spec.stills || 0)}
                options={['0', '1', '2', '3'].map((value) => ({
                  value,
                  label:
                    value === '0' ? t('studio_ai_stills_none', 'None') : value,
                }))}
                onChange={(value) => change({ stills: Number(value) })}
              />
              <BillingNote />
            </div>
          )}
          {!voiced && (
            <Segmented
              label={t('studio_ai_length', 'Length')}
              value={String(spec.seconds || 30)}
              options={LENGTHS.map((seconds) => ({
                value: String(seconds),
                label: `${seconds}s`,
              }))}
              onChange={(seconds) => change({ seconds: Number(seconds) })}
            />
          )}
          <div className="flex flex-wrap gap-[20px] items-end">
            <Field
              label={t('studio_caption_style', 'Caption style')}
              htmlFor={fontId}
            >
              <select
                id={fontId}
                value={captionStyle.font || 'bold'}
                onChange={(e) =>
                  setCaptionStyle({
                    font: e.target.value as (typeof studioTextStyles)[number],
                  })
                }
                className={`${inputClass} h-[42px]`}
              >
                {studioTextStyles.map((style) => (
                  <option key={style} value={style}>
                    {styleLabels[style]}
                  </option>
                ))}
              </select>
            </Field>
            <Segmented
              label={t('studio_position', 'Position')}
              value={captionStyle.position || 'bottom'}
              options={[
                { value: 'top', label: t('studio_top', 'Top') },
                { value: 'center', label: t('studio_center', 'Center') },
                { value: 'bottom', label: t('studio_bottom', 'Bottom') },
              ]}
              onChange={(position) =>
                setCaptionStyle({ position: position as StudioPosition })
              }
            />
            <label className="flex items-center gap-[10px] text-[14px] h-[42px]">
              <input
                type="color"
                value={captionStyle.highlight || '#FFD400'}
                onChange={(e) =>
                  setCaptionStyle({ highlight: e.target.value.toUpperCase() })
                }
                className="w-[36px] h-[28px] rounded-[6px] bg-transparent"
              />
              {t('studio_highlight', 'Highlight colour')}
            </label>
          </div>
          <StudioMusicPicker spec={spec} change={change} underSound={voiced} />
        </section>
      </div>

      <div className="w-[320px] tablet:w-full shrink-0 flex flex-col gap-[12px]">
        {voiced && connected && <BillingNote />}
        <StudioRenderPanel
          projectId={project.id}
          latest={project.renders?.[0]}
          missing={missing}
          tooLong={false}
          save={save}
          onRendered={onChanged}
          content={script.postText}
        />
      </div>
    </div>
  );
};
