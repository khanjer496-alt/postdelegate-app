'use client';

import React, { FC, useCallback, useId, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  Avatar,
  StatusChip,
} from '@gitroom/frontend/components/launches/import/import.posts.modal';
import {
  SettingInput,
  cleanSettings,
  initialSettings,
} from '@gitroom/frontend/components/launches/import/bulk.videos.modal';
import { Segmented } from '@gitroom/frontend/components/studio/studio.settings';
import {
  StudioFinishedRender,
  StudioScheduleChannel,
  useStudioFinishedRenders,
  useStudioScheduleChannels,
} from '@gitroom/frontend/components/studio/use.studio';

// the limits of POST /studio/renders/schedule, the bulk video ones
const MAX_VIDEOS = 50;
const MAX_CHANNELS = 20;

type ScheduleResult = {
  type: 'schedule' | 'draft';
  created: number;
  skipped: number;
  failed: number;
  limitReached: string | null;
  alreadyCreated?: boolean;
  posts: { index: number; status: string; error?: string }[];
};

// The settings a network needs, with the same inputs and defaults as the
// bulk video upload
const ChannelSettings: FC<{
  channel: StudioScheduleChannel;
  values: Record<string, any>;
  onChange: (values: Record<string, any>) => void;
}> = ({ channel, values, onChange }) => {
  const fields = channel.settings.filter((field) => field.required);
  if (!fields.length) {
    return null;
  }
  return (
    <div className="flex flex-col gap-[8px] ps-[32px]">
      {fields.map((field) => (
        <SettingInput
          key={field.key}
          field={field}
          value={values[field.key]}
          onChange={(value) => onChange({ ...values, [field.key]: value })}
        />
      ))}
    </div>
  );
};

// Picks the channels and the text, then schedules every video in the next
// free time slots of each channel, through the same checks as the composer
const ScheduleRenders: FC<{
  renders: StudioFinishedRender[];
  close: () => void;
  onDone: () => void;
}> = ({ renders, close, onDone }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const captionId = useId();
  const { data: channels, isLoading } = useStudioScheduleChannels();
  const [picked, setPicked] = useState<Record<string, Record<string, any>>>({});
  const [content, setContent] = useState('');
  const [type, setType] = useState<'schedule' | 'draft'>('schedule');
  const [sending, setSending] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [result, setResult] = useState<ScheduleResult>();

  const usable = (channels || []).filter(
    (channel) => channel.acceptsVideo && !channel.refreshNeeded
  );
  const pickedIds = Object.keys(picked);

  const send = useCallback(async () => {
    setSending(true);
    setProblems([]);
    try {
      const response = await fetch('/studio/renders/schedule', {
        method: 'POST',
        body: JSON.stringify({
          renderIds: renders.map((render) => render.id),
          integrations: pickedIds.map((id) => ({
            id,
            settings: cleanSettings(picked[id]),
          })),
          content,
          type,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblems(
          Array.isArray(data?.message)
            ? data.message
            : [
                data?.message ||
                  t('studio_schedule_failed', 'The videos could not be scheduled'),
              ]
        );
        return;
      }
      setResult(data);
      onDone();
      toaster.show(
        type === 'draft'
          ? t('studio_drafts_added', '{{count}} drafts added', { count: data.created })
          : t('studio_scheduled', '{{count}} videos scheduled', { count: data.created }),
        'success'
      );
    } finally {
      setSending(false);
    }
  }, [renders, picked, content, type]);

  if (result) {
    return (
      <div className="flex flex-col gap-[14px] text-textColor">
        <div className="flex flex-wrap gap-[8px]">
          <StatusChip tone="ok">
            {t('studio_result_created', '{{count}} added', { count: result.created })}
          </StatusChip>
          {!!result.skipped && (
            <StatusChip tone="warn">
              {t('studio_result_skipped', '{{count}} skipped', { count: result.skipped })}
            </StatusChip>
          )}
          {!!result.failed && (
            <StatusChip tone="error">
              {t('studio_result_failed', '{{count}} failed', { count: result.failed })}
            </StatusChip>
          )}
        </div>
        {result.alreadyCreated && (
          <div className="text-[13px] text-textItemBlur">
            {t(
              'studio_already_scheduled',
              'These videos were already scheduled today on these channels, nothing was added twice.'
            )}
          </div>
        )}
        {!!result.limitReached && (
          <div className="text-[13px] text-red-400">{result.limitReached}</div>
        )}
        <ul className="flex flex-col gap-[4px] text-[13px]">
          {result.posts
            .filter((post) => post.error)
            .map((post) => (
              <li key={post.index} className="list-none text-textItemBlur">
                {t('studio_video_n', 'Video {{n}}', { n: post.index + 1 })}: {post.error}
              </li>
            ))}
        </ul>
        <button
          type="button"
          onClick={close}
          className="h-[40px] px-[16px] rounded-[8px] bg-btnPrimary text-white text-[14px] font-[600] self-end"
        >
          {t('studio_done', 'Done')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px] text-textColor">
      <div className="text-[14px] text-textItemBlur">
        {t(
          'studio_schedule_intro',
          '{{count}} videos, one post each on every channel you pick, in the next free time slots of the channel.',
          { count: renders.length }
        )}
      </div>

      <div className="flex flex-col gap-[8px]">
        <div className="text-[14px] font-[600]">
          {t('studio_channels', 'Channels')}
        </div>
        {isLoading ? (
          <div className="h-[80px] rounded-[10px] bg-newBgLineColor animate-pulse" />
        ) : !usable.length ? (
          <div className="text-[13px] text-textItemBlur">
            {t(
              'studio_no_video_channels',
              'No connected channel takes videos. Connect one in the calendar first.'
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-[6px] max-h-[300px] overflow-y-auto">
            {usable.map((channel) => {
              const checked = !!picked[channel.id];
              const blocked = type === 'schedule' && channel.draftsOnly;
              return (
                <li key={channel.id} className="flex flex-col gap-[8px] list-none">
                  <label
                    className={clsx(
                      'flex items-center gap-[10px] text-[14px] p-[6px] rounded-[8px] hover:bg-boxHover',
                      blocked && 'opacity-50'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={
                        blocked ||
                        (!checked && pickedIds.length >= MAX_CHANNELS)
                      }
                      onChange={(e) =>
                        setPicked((current) => {
                          const next = { ...current };
                          if (e.target.checked) {
                            next[channel.id] = initialSettings(channel.settings);
                          } else {
                            delete next[channel.id];
                          }
                          return next;
                        })
                      }
                      className="w-[16px] h-[16px] accent-btnPrimary"
                    />
                    <Avatar
                      picture={channel.picture}
                      identifier={channel.identifier}
                      name={channel.name}
                    />
                    <span className="truncate">{channel.name}</span>
                    {blocked && (
                      <span className="text-[12px] text-textItemBlur ms-auto">
                        {t('studio_drafts_only', 'Drafts only')}
                      </span>
                    )}
                  </label>
                  {checked && (
                    <ChannelSettings
                      channel={channel}
                      values={picked[channel.id]}
                      onChange={(values) =>
                        setPicked((current) => ({ ...current, [channel.id]: values }))
                      }
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-[6px]">
        <label htmlFor={captionId} className="text-[14px] font-[600]">
          {t('studio_post_text', 'Text of every post')}
        </label>
        <textarea
          id={captionId}
          value={content}
          maxLength={10000}
          rows={4}
          onChange={(e) => setContent(e.target.value)}
          className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px] text-[14px] text-textColor outline-none resize-y focus-visible:ring-2 focus-visible:ring-btnPrimary"
        />
      </div>

      <Segmented
        label={t('studio_add_as', 'Add them as')}
        value={type}
        options={[
          { value: 'schedule', label: t('studio_add_scheduled', 'Scheduled posts') },
          { value: 'draft', label: t('studio_add_drafts', 'Drafts') },
        ]}
        onChange={(value) => {
          setType(value as 'schedule' | 'draft');
          // a network that needs the composer only takes drafts
          if (value === 'schedule') {
            setPicked((current) =>
              Object.fromEntries(
                Object.entries(current).filter(
                  ([id]) => !usable.find((p) => p.id === id)?.draftsOnly
                )
              )
            );
          }
        }}
      />

      {!!problems.length && (
        <ul
          className="flex flex-col gap-[4px] text-[13px] text-red-400 p-[10px] rounded-[8px] border border-red-400/40"
          aria-live="polite"
        >
          {problems.map((problem, index) => (
            <li key={index} className="list-none">
              {problem}
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end gap-[8px]">
        <button
          type="button"
          onClick={close}
          className="h-[40px] px-[16px] rounded-[8px] bg-btnSimple text-btnText text-[14px]"
        >
          {t('studio_cancel', 'Cancel')}
        </button>
        <button
          type="button"
          disabled={!pickedIds.length || sending}
          onClick={send}
          className="h-[40px] px-[16px] rounded-[8px] bg-btnCta text-btnCtaText hover:bg-btnCtaHover shadow-cta text-[14px] font-[600] disabled:opacity-50 disabled:hover:bg-btnCta"
        >
          {sending
            ? t('studio_scheduling', 'Scheduling…')
            : type === 'draft'
            ? t('studio_add_drafts_n', 'Add {{count}} drafts', { count: renders.length })
            : t('studio_schedule_n', 'Schedule {{count}} videos', { count: renders.length })}
        </button>
      </div>
    </div>
  );
};

// The finished videos of every project: pick some and schedule them at once
export const StudioFinishedVideos: FC = () => {
  const t = useT();
  const modals = useModals();
  const { data: renders, mutate } = useStudioFinishedRenders();
  const [selected, setSelected] = useState<string[]>([]);
  const chosen = useMemo(
    () => (renders || []).filter((render) => selected.includes(render.id)),
    [renders, selected]
  );

  const schedule = useCallback(() => {
    modals.openModal({
      title: t('studio_schedule_title', 'Schedule finished videos'),
      askClose: false,
      size: '640px',
      children: (close) => (
        <ScheduleRenders
          renders={chosen}
          close={close}
          onDone={() => {
            setSelected([]);
            mutate();
          }}
        />
      ),
    });
  }, [chosen]);

  if (!renders?.length) {
    return null;
  }

  const all = selected.length === Math.min(renders.length, MAX_VIDEOS);

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <h2 className="text-[18px] font-[600] me-auto">
          {t('studio_finished_videos', 'Finished videos')}
        </h2>
        <button
          type="button"
          onClick={() =>
            setSelected(
              all ? [] : renders.slice(0, MAX_VIDEOS).map((render) => render.id)
            )
          }
          className="h-[36px] px-[12px] rounded-[8px] bg-btnSimple text-btnText text-[13px]"
        >
          {all
            ? t('studio_select_none', 'Clear selection')
            : t('studio_select_all', 'Select all')}
        </button>
        <button
          type="button"
          disabled={!selected.length}
          onClick={schedule}
          className="h-[36px] px-[14px] rounded-[8px] bg-btnCta text-btnCtaText hover:bg-btnCtaHover shadow-cta text-[13px] font-[600] disabled:opacity-50 disabled:hover:bg-btnCta"
        >
          {t('studio_schedule_all', 'Schedule all ({{count}})', {
            count: selected.length,
          })}
        </button>
      </div>
      <ul className="grid grid-cols-6 tablet:grid-cols-4 mobile:grid-cols-3 gap-[10px]">
        {renders.map((render) => {
          const checked = selected.includes(render.id);
          return (
            <li key={render.id} className="list-none">
              <label
                className={clsx(
                  'flex flex-col gap-[6px] cursor-pointer rounded-[10px] p-[4px] border-[2px]',
                  checked ? 'border-btnPrimary' : 'border-transparent hover:bg-boxHover'
                )}
              >
                <div className="relative w-full aspect-[9/16] rounded-[8px] overflow-hidden bg-black">
                  {render.thumbnail ? (
                    <img
                      src={render.thumbnail}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : null}
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && selected.length >= MAX_VIDEOS}
                    onChange={(e) =>
                      setSelected((current) =>
                        e.target.checked
                          ? [...current, render.id]
                          : current.filter((id) => id !== render.id)
                      )
                    }
                    aria-label={t('studio_select_video', 'Select {{name}}', {
                      name: render.project.name,
                    })}
                    className="absolute top-[6px] start-[6px] w-[16px] h-[16px] accent-btnPrimary"
                  />
                  <span className="absolute bottom-[6px] end-[6px] text-[11px] px-[6px] rounded-full bg-black/60 text-white tabular-nums">
                    {render.seconds}s
                  </span>
                </div>
                <span className="text-[12px] truncate">{render.project.name}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
