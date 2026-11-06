'use client';

import React, { FC, useCallback, useId, useRef, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { errorMessage } from '@gitroom/frontend/components/launches/import/import.posts.modal';
import type { StudioSpec } from '@gitroom/frontend/components/studio/use.studio';

// the same cap and types as POST /studio/assets
const MAX_MUSIC_SIZE = 30 * 1024 * 1024;
const MUSIC_TYPES = '.mp3,.m4a,.wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav';
const DEFAULT_VOLUME = 0.25;

// Your own music under the video: uploaded for Studio only, never shown in
// the media library. Under a clip with sound it is lowered and ducked while
// the clip speaks; on its own it plays at full loudness
export const StudioMusicPicker: FC<{
  spec: StudioSpec;
  change: (patch: Partial<StudioSpec>) => void;
  // the video has its own sound the music goes under
  underSound?: boolean;
}> = ({ spec, change, underSound }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const input = useRef<HTMLInputElement>(null);
  const volumeId = useId();
  const startId = useId();
  const [uploading, setUploading] = useState(false);
  const music = spec.music;

  const upload = useCallback(
    async (file?: File) => {
      if (!file) {
        return;
      }
      if (file.size > MAX_MUSIC_SIZE) {
        toaster.show(
          t('studio_music_too_large', 'Music files are 30 MB at most'),
          'warning'
        );
        return;
      }
      setUploading(true);
      try {
        const body = new FormData();
        body.append('file', file);
        const response = await fetch('/studio/assets', {
          method: 'POST',
          body,
        });
        if (!response.ok) {
          toaster.show(
            await errorMessage(
              response,
              t('studio_music_failed', 'The music could not be added')
            ),
            'warning'
          );
          return;
        }
        const asset = await response.json();
        change({
          music: {
            assetId: asset.id,
            name: asset.name || file.name,
            path: asset.path,
            volume: music?.volume ?? DEFAULT_VOLUME,
          },
        });
      } finally {
        setUploading(false);
        if (input.current) {
          input.current.value = '';
        }
      }
    },
    [music, change]
  );

  return (
    <div className="flex flex-col gap-[10px] border-t border-newTableBorder pt-[14px]">
      <div className="flex items-center justify-between gap-[10px]">
        <div className="text-[14px] font-[600]">
          {t('studio_music', 'Music')}
        </div>
        {!!music && (
          <button
            type="button"
            onClick={() => change({ music: undefined })}
            className="text-[13px] text-textItemBlur hover:text-red-400"
          >
            {t('studio_music_remove', 'Remove')}
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={MUSIC_TYPES}
        className="hidden"
        onChange={(e) => upload(e.target.files?.[0])}
      />
      {music ? (
        <>
          <div className="flex items-center gap-[10px] p-[10px] rounded-[8px] bg-newBgLineColor">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className="shrink-0 text-textItemBlur"
            >
              <path
                d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="text-[13px] truncate flex-1">
              {music.name || t('studio_music_track', 'Your track')}
            </div>
            <button
              type="button"
              disabled={uploading}
              onClick={() => input.current?.click()}
              className="text-[13px] text-textItemBlur hover:text-textColor shrink-0"
            >
              {t('studio_music_replace', 'Replace')}
            </button>
          </div>
          {!!music.path && (
            <audio
              src={music.path}
              controls
              preload="none"
              className="w-full h-[36px]"
            />
          )}
          <div className="flex flex-col gap-[6px]">
            <label htmlFor={startId} className="text-[13px]">
              {t('studio_music_start', 'Start the track at {{seconds}}s', {
                seconds: music.start || 0,
              })}
            </label>
            <input
              id={startId}
              type="range"
              min={0}
              max={180}
              step={1}
              value={music.start || 0}
              onChange={(e) =>
                change({ music: { ...music, start: Number(e.target.value) } })
              }
              className="accent-btnPrimary"
            />
          </div>
          {underSound && (
            <div className="flex flex-col gap-[6px]">
              <label htmlFor={volumeId} className="text-[13px]">
                {t(
                  'studio_music_volume',
                  'Music level under the sound: {{percent}}%',
                  {
                    percent: Math.round(
                      (music.volume ?? DEFAULT_VOLUME) * 100
                    ),
                  }
                )}
              </label>
              <input
                id={volumeId}
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={music.volume ?? DEFAULT_VOLUME}
                onChange={(e) =>
                  change({
                    music: { ...music, volume: Number(e.target.value) },
                  })
                }
                className="accent-btnPrimary"
              />
            </div>
          )}
        </>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => input.current?.click()}
          className="h-[40px] px-[14px] rounded-[8px] bg-btnSimple text-btnText text-[14px] font-[600] disabled:opacity-50"
        >
          {uploading
            ? t('studio_music_uploading', 'Adding the music…')
            : t('studio_music_add', 'Add your music')}
        </button>
      )}
      <div className="text-[12px] text-textItemBlur leading-[1.5]">
        {t(
          'studio_music_hint',
          'MP3, M4A or WAV up to 30 MB. An M4A saved as an MP4 video is refused, export it as M4A or MP3. Use music you have the rights to. It loops if it is shorter than the video and fades out at the end.'
        )}
      </div>
    </div>
  );
};
