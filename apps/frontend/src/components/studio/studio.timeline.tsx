'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const FRAMES = 10;

const formatTime = (seconds: number) => {
  const whole = Math.max(0, seconds);
  const m = Math.floor(whole / 60);
  const s = whole - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

// A strip of frames drawn from a hidden copy of the video: it is seeked to
// evenly spaced times and each frame is drawn on the canvas as it lands
const Filmstrip: FC<{ src: string; duration: number }> = ({
  src,
  duration,
}) => {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!duration || !canvas.current) {
      return;
    }

    let cancelled = false;
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.src = src;

    const context = canvas.current.getContext('2d');
    const width = canvas.current.width / FRAMES;
    const height = canvas.current.height;
    let index = 0;

    const draw = () => {
      if (cancelled || !context) {
        return;
      }
      // cover each slot with the frame, like the vertical crop would
      const scale = Math.max(
        width / (video.videoWidth || 1),
        height / (video.videoHeight || 1)
      );
      const w = video.videoWidth * scale;
      const h = video.videoHeight * scale;
      context.save();
      context.beginPath();
      context.rect(index * width, 0, width, height);
      context.clip();
      context.drawImage(
        video,
        index * width + (width - w) / 2,
        (height - h) / 2,
        w,
        h
      );
      context.restore();
      index++;
      if (index < FRAMES) {
        video.currentTime = ((index + 0.5) * duration) / FRAMES;
      }
    };

    video.addEventListener('seeked', draw);
    video.addEventListener(
      'loadeddata',
      () => {
        video.currentTime = (0.5 * duration) / FRAMES;
      },
      { once: true }
    );

    return () => {
      cancelled = true;
      video.removeEventListener('seeked', draw);
      video.removeAttribute('src');
      video.load();
    };
  }, [src, duration]);

  return (
    <canvas
      ref={canvas}
      width={FRAMES * 96}
      height={54}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full rounded-[8px] opacity-80"
    />
  );
};

// The source video as a strip with the kept part between two handles. The
// playhead follows the player; a click on the strip seeks there
export const StudioTimeline: FC<{
  src: string;
  duration: number;
  trim: { start: number; end: number };
  maxLength: number;
  onTrim: (trim: { start: number; end: number }) => void;
  getTime: () => number;
  onSeek: (seconds: number) => void;
}> = ({ src, duration, trim, maxLength, onTrim, getTime, onSeek }) => {
  const t = useT();
  const track = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null);

  // the playhead moves every frame without re-rendering the timeline
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (playhead.current && duration) {
        playhead.current.style.insetInlineStart = `${
          (Math.min(getTime(), duration) / duration) * 100
        }%`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, getTime]);

  const timeAt = useCallback(
    (clientX: number) => {
      const rect = track.current!.getBoundingClientRect();
      const ratio = Math.min(
        1,
        Math.max(0, (clientX - rect.left) / rect.width)
      );
      return Number((ratio * duration).toFixed(2));
    },
    [duration]
  );

  const move = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) {
        return;
      }
      const at = timeAt(e.clientX);
      if (dragging === 'start') {
        const start = Math.min(at, trim.end - 0.5);
        onTrim({
          start: Math.max(0, start),
          end: Math.min(trim.end, start + maxLength),
        });
        onSeek(Math.max(0, start));
      } else {
        const end = Math.max(at, trim.start + 0.5);
        onTrim({
          start: Math.max(trim.start, end - maxLength),
          end: Math.min(duration, end),
        });
        onSeek(Math.min(duration, end));
      }
    },
    [dragging, timeAt, trim, maxLength, duration, onTrim, onSeek]
  );

  const nudge = useCallback(
    (handle: 'start' | 'end', delta: number) => {
      if (handle === 'start') {
        const start = Math.min(Math.max(0, trim.start + delta), trim.end - 0.5);
        onTrim({ start, end: Math.min(trim.end, start + maxLength) });
      } else {
        const end = Math.max(
          Math.min(duration, trim.end + delta),
          trim.start + 0.5
        );
        onTrim({ start: Math.max(trim.start, end - maxLength), end });
      }
    },
    [trim, maxLength, duration, onTrim]
  );

  if (!duration) {
    return (
      <div className="h-[72px] rounded-[8px] bg-newBgLineColor animate-pulse" />
    );
  }

  const left = (trim.start / duration) * 100;
  const right = (trim.end / duration) * 100;

  return (
    <div className="flex flex-col gap-[6px] select-none">
      <div
        ref={track}
        className="relative h-[54px] rounded-[8px] bg-newBgLineColor overflow-hidden cursor-pointer touch-none"
        onPointerMove={move}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
        onClick={(e) => !dragging && onSeek(timeAt(e.clientX))}
      >
        <Filmstrip src={src} duration={duration} />
        <div
          className="absolute inset-y-0 start-0 bg-black/60"
          style={{ width: `${left}%` }}
        />
        <div
          className="absolute inset-y-0 end-0 bg-black/60"
          style={{ width: `${100 - right}%` }}
        />
        <div
          className="absolute inset-y-0 border-y-[3px] border-btnCta pointer-events-none"
          style={{ insetInlineStart: `${left}%`, width: `${right - left}%` }}
        />
        {(['start', 'end'] as const).map((handle) => (
          <div
            key={handle}
            role="slider"
            tabIndex={0}
            aria-label={
              handle === 'start'
                ? t('studio_trim_start', 'Start of the clip')
                : t('studio_trim_end', 'End of the clip')
            }
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Number(trim[handle].toFixed(1))}
            aria-valuetext={formatTime(trim[handle])}
            onPointerDown={(e) => {
              e.stopPropagation();
              (e.currentTarget.parentElement as HTMLElement).setPointerCapture(
                e.pointerId
              );
              setDragging(handle);
            }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                nudge(
                  handle,
                  (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 0.1)
                );
              }
            }}
            className="absolute inset-y-0 w-[14px] -ms-[7px] bg-btnCta rounded-[4px] cursor-ew-resize flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
            style={{
              insetInlineStart: `${handle === 'start' ? left : right}%`,
            }}
          >
            <div className="w-[2px] h-[18px] bg-black/40 rounded-full" />
          </div>
        ))}
        <div
          ref={playhead}
          className="absolute inset-y-0 w-[2px] bg-white shadow pointer-events-none"
        />
      </div>
      <div className="flex justify-between text-[12px] text-textItemBlur tabular-nums">
        <span>{formatTime(trim.start)}</span>
        <span>
          {t('studio_clip_length', 'Clip')} {formatTime(trim.end - trim.start)}
        </span>
        <span>{formatTime(trim.end)}</span>
      </div>
    </div>
  );
};
