'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  MediaBox,
  mediaLibrarySize,
} from '@gitroom/frontend/components/media/media.component';
import { STUDIO_MAX_SECONDS } from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';
import {
  StudioProject,
  StudioSpec,
  StudioTemplate,
} from '@gitroom/frontend/components/studio/use.studio';
import { StudioTimeline } from '@gitroom/frontend/components/studio/studio.timeline';
import {
  StudioCrop,
  StudioPreview,
} from '@gitroom/frontend/components/studio/studio.preview';
import {
  Segmented,
  studioTemplateSettings,
} from '@gitroom/frontend/components/studio/studio.settings';
import { StudioRenderPanel } from '@gitroom/frontend/components/studio/studio.render.panel';

const SPEEDS = [0.5, 1, 1.5, 2] as const;
// a new clip starts as the first 30 seconds of the video
const FIRST_CLIP = 30;

// One project: the player and timeline on the left, the template's settings
// and the render on the right. Every change is saved after a short pause and
// before anything the server reads (captions, render)
export const StudioEditor: FC<{
  project: StudioProject;
  template?: StudioTemplate;
  onChanged: () => void;
}> = ({ project, template, onChanged }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const modals = useModals();
  const video = useRef<HTMLVideoElement | null>(null);
  const settings = studioTemplateSettings[project.template];
  const [spec, setSpec] = useState<StudioSpec>(() => ({
    ...(settings?.defaults || {}),
    ...project.spec,
  }));
  const [name, setName] = useState(project.name);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const saved = useRef(JSON.stringify(spec));
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(spec);
  latest.current = spec;

  const save = useCallback(async () => {
    clearTimeout(pending.current);
    const body = JSON.stringify(latest.current);
    if (body === saved.current) {
      return true;
    }
    const response = await fetch(`/studio/projects/${project.id}`, {
      method: 'PUT',
      body: JSON.stringify({ spec: latest.current }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      toaster.show(
        Array.isArray(data?.message)
          ? data.message.join('. ')
          : data?.message || t('studio_save_failed', 'Could not save'),
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

  const pickVideo = useCallback(() => {
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
            const media = selected[0];
            if (media) {
              setDuration(0);
              change({
                input: { mediaId: media.id, path: media.path },
                trim: undefined,
                focus: { x: 0.5, y: 0.5 },
              });
            }
            close();
          }}
          closeModal={close}
        />
      ),
    });
  }, [modals, change]);

  // the length comes from the player, a media record has none. A length the
  // player does not know yet (0, NaN, Infinity) is waited out, and a clip
  // that does not fit the video (none yet, empty, past its end) starts over
  const onDuration = useCallback(
    (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds <= 0) {
        return;
      }
      setDuration(seconds);
      const trim = latest.current.trim;
      if (!trim || trim.end <= trim.start || trim.end > seconds + 0.5) {
        change({
          trim: {
            start: 0,
            end: Number(Math.min(seconds, FIRST_CLIP).toFixed(2)),
          },
        });
      }
    },
    [change]
  );

  const trim = spec.trim || { start: 0, end: 0 };
  const speed = spec.speed || 1;
  const outputSeconds = (trim.end - trim.start) / speed;

  // playback stays inside the clip, at the chosen speed
  useEffect(() => {
    const player = video.current;
    if (!player) {
      return;
    }
    player.playbackRate = speed;
    const loop = () => {
      if (
        player.currentTime >= trim.end ||
        player.currentTime < trim.start - 0.25
      ) {
        player.currentTime = trim.start;
      }
    };
    const play = () => setPlaying(true);
    const pause = () => setPlaying(false);
    player.addEventListener('timeupdate', loop);
    player.addEventListener('play', play);
    player.addEventListener('pause', pause);
    return () => {
      player.removeEventListener('timeupdate', loop);
      player.removeEventListener('play', play);
      player.removeEventListener('pause', pause);
    };
  }, [trim.start, trim.end, speed, spec.input?.path]);

  const getTime = useCallback(() => video.current?.currentTime || 0, []);
  const seek = useCallback((seconds: number) => {
    if (video.current) {
      video.current.currentTime = seconds;
    }
  }, []);

  const Settings = settings?.Settings;
  const src = spec.input?.path;
  // checked before a render is sent, in the words the server would use
  const missing = !spec.input?.mediaId
    ? t('studio_missing_video', 'Pick a video from your media library')
    : !spec.trim || trim.end <= trim.start
    ? t('studio_missing_trim', 'Wait for the video to load, then trim the clip')
    : settings && !settings.ready(spec)
    ? settings.missing(t)
    : undefined;

  return (
    <div className="flex flex-1 gap-[20px] tablet:flex-col min-w-0">
      <div className="w-[300px] tablet:w-full tablet:max-w-[340px] tablet:self-center shrink-0 flex flex-col gap-[10px]">
        {src ? (
          <>
            <StudioPreview
              src={src}
              spec={spec}
              videoRef={video}
              onDuration={onDuration}
            />
            <div className="flex items-center gap-[10px]">
              <button
                type="button"
                onClick={() =>
                  video.current?.paused
                    ? video.current.play().catch(() => undefined)
                    : video.current?.pause()
                }
                aria-label={
                  playing
                    ? t('studio_pause', 'Pause')
                    : t('studio_play', 'Play')
                }
                className="w-[40px] h-[40px] rounded-full bg-btnSimple text-btnText flex items-center justify-center"
              >
                {playing ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    aria-hidden="true"
                  >
                    <rect
                      x="2"
                      y="1"
                      width="3.5"
                      height="12"
                      rx="1"
                      fill="currentColor"
                    />
                    <rect
                      x="8.5"
                      y="1"
                      width="3.5"
                      height="12"
                      rx="1"
                      fill="currentColor"
                    />
                  </svg>
                ) : (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    aria-hidden="true"
                  >
                    <path d="M3 1.5v11l9-5.5z" fill="currentColor" />
                  </svg>
                )}
              </button>
              <div
                className={clsx(
                  'text-[13px] tabular-nums',
                  outputSeconds > STUDIO_MAX_SECONDS
                    ? 'text-red-400'
                    : 'text-textItemBlur'
                )}
              >
                {t('studio_output_length', 'Video length: {{seconds}}s', {
                  seconds: outputSeconds.toFixed(1),
                })}
              </div>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={pickVideo}
            className="w-full aspect-[9/16] rounded-[12px] border-[2px] border-dashed border-newTableBorder flex flex-col items-center justify-center gap-[8px] text-[14px] text-textItemBlur hover:bg-boxHover"
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M15 10l4.55-2.28A1 1 0 0121 8.62v6.76a1 1 0 01-1.45.9L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t('studio_pick_video', 'Pick a video from your media library')}
          </button>
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-[18px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <input
            value={name}
            maxLength={100}
            aria-label={t('studio_project_name', 'Project name')}
            onChange={(e) => setName(e.target.value)}
            onBlur={rename}
            className="flex-1 min-w-[200px] h-[42px] bg-transparent text-[20px] font-[600] text-textColor outline-none border-b border-transparent focus:border-newTableBorder"
          />
          {!!template && (
            <span className="text-[13px] text-textItemBlur px-[10px] py-[4px] rounded-full bg-newBgLineColor">
              {template.title}
            </span>
          )}
          {!!src && (
            <button
              type="button"
              onClick={pickVideo}
              className="h-[36px] px-[12px] rounded-[8px] bg-btnSimple text-btnText text-[13px]"
            >
              {t('studio_change_video', 'Change video')}
            </button>
          )}
        </div>

        {src ? (
          <>
            <StudioTimeline
              src={src}
              duration={duration}
              trim={trim}
              maxLength={STUDIO_MAX_SECONDS * speed}
              onTrim={(value) => change({ trim: value })}
              getTime={getTime}
              onSeek={seek}
            />
            <div className="flex flex-wrap gap-[20px]">
              <Segmented
                label={t('studio_speed', 'Speed')}
                value={String(speed)}
                options={SPEEDS.map((value) => ({
                  value: String(value),
                  label: `${value}×`,
                }))}
                onChange={(value) =>
                  change({ speed: Number(value) as StudioSpec['speed'] })
                }
              />
              <Segmented
                label={t('studio_sound', 'Sound')}
                value={spec.mute ? 'off' : 'on'}
                options={[
                  { value: 'on', label: t('studio_sound_on', 'On') },
                  { value: 'off', label: t('studio_sound_off', 'Muted') },
                ]}
                onChange={(value) => change({ mute: value === 'off' })}
              />
            </div>
            {spec.fit !== 'blur' && (
              <div className="max-w-[420px]">
                <StudioCrop
                  videoRef={video}
                  focus={spec.focus || { x: 0.5, y: 0.5 }}
                  onFocus={(focus) => change({ focus })}
                />
              </div>
            )}
          </>
        ) : (
          <div className="text-[14px] text-textItemBlur">
            {t(
              'studio_upload_hint',
              'Upload a video to your media library or pick one you already have. Studio cuts it to a vertical 1080×1920 video.'
            )}
          </div>
        )}
      </div>

      <div className="w-[320px] tablet:w-full shrink-0 flex flex-col gap-[20px]">
        {!!Settings && (
          <Settings
            projectId={project.id}
            spec={spec}
            change={change}
            save={save}
          />
        )}
        <div className="border-t border-newTableBorder pt-[16px]">
          <StudioRenderPanel
            projectId={project.id}
            latest={project.renders?.[0]}
            missing={missing}
            tooLong={outputSeconds > STUDIO_MAX_SECONDS}
            save={save}
            onRendered={onChanged}
          />
        </div>
      </div>
    </div>
  );
};
