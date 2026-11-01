'use client';

import React, {
  FC,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  groupCaptionLines,
  wordsOnOutput,
} from '@gitroom/helpers/utils/studio.captions';
import {
  StudioTextStyle,
  studioFonts,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';
import type {
  StudioPosition,
  StudioSpec,
} from '@gitroom/frontend/components/studio/use.studio';

// The canvas the render draws on; the preview is the same frame scaled down
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
// The same margins as the ASS styles of the render, on the 1920 high frame
const POSITION_MARGIN: Record<StudioPosition, number> = {
  top: 300,
  center: 0,
  bottom: 420,
};
// how long and how often a video that does not load yet is asked for again
const RETRY_MS = 3000;
const MAX_RETRIES = 20;

// The bundled fonts under their own names, so they never clash with the
// app's fonts. The files are the ones the render uses
export const StudioFonts: FC = () => (
  <style>
    {Object.values(studioFonts)
      .map(
        (font) =>
          `@font-face{font-family:'PD Studio ${
            font.family
          }';src:url('/fonts/studio/${
            font.file
          }') format('truetype');font-weight:${
            font.bold ? 700 : 400
          };font-display:swap;}`
      )
      .join('')}
  </style>
);

export const studioFontStyle = (
  style: StudioTextStyle | undefined,
  size: number,
  scale: number
): React.CSSProperties => {
  const font = studioFonts[style || 'bold'] || studioFonts.bold;
  return {
    fontFamily: `'PD Studio ${font.family}', sans-serif`,
    fontWeight: font.bold ? 700 : 400,
    fontSize: size * scale,
    lineHeight: 1.15,
    color: '#FFFFFF',
    WebkitTextStroke: `${6 * scale * 2}px #000`,
    paintOrder: 'stroke fill',
  };
};

const TextLayer: FC<{
  position: StudioPosition;
  scale: number;
  children: React.ReactNode;
}> = ({ position, scale, children }) => (
  <div
    className={clsx(
      'absolute inset-x-0 flex px-[7%] text-center pointer-events-none',
      position === 'top' && 'items-start',
      position === 'center' && 'items-center inset-y-0',
      position === 'bottom' && 'items-end'
    )}
    style={
      position === 'top'
        ? { top: POSITION_MARGIN.top * scale }
        : position === 'bottom'
        ? { bottom: POSITION_MARGIN.bottom * scale }
        : undefined
    }
  >
    <div className="w-full break-words">{children}</div>
  </div>
);

// The output frame: the clip cropped (or over a blurred copy of itself) with
// the hook and the captions drawn where the render will burn them in
export const StudioPreview: FC<{
  src: string;
  spec: StudioSpec;
  videoRef: RefObject<HTMLVideoElement | null>;
  onDuration: (seconds: number) => void;
}> = ({ src, spec, videoRef, onDuration }) => {
  const t = useT();
  const frame = useRef<HTMLDivElement>(null);
  const background = useRef<HTMLVideoElement>(null);
  const [width, setWidth] = useState(270);
  const [now, setNow] = useState(0);
  const trim = spec.trim || { start: 0, end: 0 };
  const speed = spec.speed || 1;
  const duration = Math.max(0, (trim.end - trim.start) / speed);
  const scale = width / OUTPUT_WIDTH;
  // failed loads of this video in a row: a video picked right after its
  // upload can still be processing, so it is asked for again for a minute
  const [failures, setFailures] = useState(0);
  const probing = useRef(false);

  useEffect(() => {
    setFailures(0);
  }, [src]);

  useEffect(() => {
    if (!failures || failures > MAX_RETRIES) {
      return;
    }
    const timer = setTimeout(() => {
      videoRef.current?.load();
      // the blurred copy reads the same file and failed the same way
      background.current?.load();
    }, RETRY_MS);
    return () => clearTimeout(timer);
  }, [failures]);

  // The length is read on loadedmetadata and again whenever it changes. A
  // file without its length in the header reports Infinity until the player
  // has read it to the end, so it is seeked past the end once to find out
  const readDuration = useCallback(
    (player: HTMLVideoElement) => {
      if (player.duration === Infinity) {
        probing.current = true;
        player.currentTime = Number.MAX_SAFE_INTEGER;
        return;
      }
      if (probing.current && Number.isFinite(player.duration)) {
        probing.current = false;
        player.currentTime = 0;
      }
      onDuration(player.duration);
    },
    [onDuration]
  );

  useEffect(() => {
    if (!frame.current) {
      return;
    }
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width)
    );
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);

  // the time on the output timeline, and the blurred copy kept in step
  useEffect(() => {
    let animation = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video) {
        const at = Math.max(0, (video.currentTime - trim.start) / speed);
        setNow((current) => (Math.abs(current - at) > 0.04 ? at : current));
        if (
          background.current &&
          Math.abs(background.current.currentTime - video.currentTime) > 0.3
        ) {
          background.current.currentTime = video.currentTime;
        }
      }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [videoRef, trim.start, speed]);

  const lines = useMemo(
    () =>
      spec.captions?.words?.length
        ? groupCaptionLines(
            wordsOnOutput(spec.captions.words, trim, speed, duration),
            spec.captions.style?.maxWords || 3,
            spec.captions.style?.maxChars || 22
          )
        : [],
    [spec.captions, trim.start, trim.end, speed, duration]
  );
  const line = lines.find(
    (p) => now >= p[0].start && now <= p[p.length - 1].end
  );
  const spoken = line
    ? line.reduce(
        (found, word, index) => (now >= word.start ? index : found),
        0
      )
    : -1;

  const blur = spec.fit === 'blur';
  const objectPosition = `${(spec.focus?.x ?? 0.5) * 100}% ${
    (spec.focus?.y ?? 0.5) * 100
  }%`;

  return (
    <div
      ref={frame}
      className="relative w-full aspect-[9/16] rounded-[12px] overflow-hidden bg-black"
      aria-label={t('studio_preview', 'Preview of the vertical video')}
    >
      {blur && (
        <video
          ref={background}
          src={src}
          muted
          playsInline
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 opacity-80"
        />
      )}
      <video
        ref={videoRef as RefObject<HTMLVideoElement>}
        src={src}
        playsInline
        preload="auto"
        muted={!!spec.mute}
        onLoadedMetadata={(e) => {
          setFailures(0);
          readDuration(e.currentTarget);
        }}
        onDurationChange={(e) => readDuration(e.currentTarget)}
        onError={() => setFailures((current) => current + 1)}
        onPlay={() => background.current?.play().catch(() => undefined)}
        onPause={() => background.current?.pause()}
        className={clsx(
          'absolute inset-0 w-full h-full',
          blur ? 'object-contain' : 'object-cover'
        )}
        style={blur ? undefined : { objectPosition }}
      />
      {failures > 0 && (
        <div
          role="status"
          className="absolute inset-0 flex items-center justify-center p-[24px] text-center text-[14px] text-white bg-black/70"
        >
          {failures > MAX_RETRIES
            ? t(
                'studio_video_failed',
                'This video could not be loaded. Pick it again or pick another one.'
              )
            : t(
                'studio_video_processing',
                'Loading the video… A video you just uploaded can take a moment to finish processing.'
              )}
        </div>
      )}
      {!!spec.hook?.text &&
        now <= Math.min(duration, spec.hook.seconds || duration) && (
          <TextLayer position={spec.hook.position || 'top'} scale={scale}>
            <span
              style={studioFontStyle(
                spec.hook.style,
                spec.hook.style === 'impact' ? 112 : 92,
                scale
              )}
            >
              {spec.hook.text}
            </span>
          </TextLayer>
        )}
      {!!line && (
        <TextLayer
          position={spec.captions?.style?.position || 'bottom'}
          scale={scale}
        >
          <span
            style={studioFontStyle(
              spec.captions?.style?.font,
              spec.captions?.style?.font === 'impact' ? 96 : 80,
              scale
            )}
          >
            {line.map((word, index) => (
              <React.Fragment key={index}>
                {index > 0 && ' '}
                <span
                  style={
                    index === spoken
                      ? { color: spec.captions?.style?.highlight || '#FFD400' }
                      : { color: spec.captions?.style?.color || '#FFFFFF' }
                  }
                >
                  {word.text}
                </span>
              </React.Fragment>
            ))}
          </span>
        </TextLayer>
      )}
    </div>
  );
};

// The source frame with the 9:16 window on it. Dragging the window moves the
// focus, the part of the picture the crop keeps
export const StudioCrop: FC<{
  videoRef: RefObject<HTMLVideoElement | null>;
  focus: { x: number; y: number };
  onFocus: (focus: { x: number; y: number }) => void;
}> = ({ videoRef, focus, onFocus }) => {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 16, h: 9 });
  const drag = useRef<{ x: number; y: number; focus: typeof focus } | null>(
    null
  );

  // the current frame of the player, redrawn whenever it lands on a new one
  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const draw = () => {
      if (!canvas.current || !video.videoWidth) {
        return;
      }
      setSize({ w: video.videoWidth, h: video.videoHeight });
      canvas.current.width = 320;
      canvas.current.height = Math.round(
        (320 * video.videoHeight) / video.videoWidth
      );
      canvas.current
        .getContext('2d')
        ?.drawImage(video, 0, 0, canvas.current.width, canvas.current.height);
    };
    draw();
    video.addEventListener('loadeddata', draw);
    video.addEventListener('seeked', draw);
    video.addEventListener('pause', draw);
    return () => {
      video.removeEventListener('loadeddata', draw);
      video.removeEventListener('seeked', draw);
      video.removeEventListener('pause', draw);
    };
  }, [videoRef]);

  // the window as a share of the frame: full height on a wide video, full
  // width on a tall one
  const aspect = size.w / size.h;
  const windowWidth = aspect > 9 / 16 ? (9 / 16 / aspect) * 100 : 100;
  const windowHeight = aspect > 9 / 16 ? 100 : (aspect / (9 / 16)) * 100;

  const move = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drag.current) {
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const free = {
        x: rect.width * (1 - windowWidth / 100),
        y: rect.height * (1 - windowHeight / 100),
      };
      const clamp = (value: number) => Math.min(1, Math.max(0, value));
      onFocus({
        x: free.x
          ? Number(
              clamp(
                drag.current.focus.x + (e.clientX - drag.current.x) / free.x
              ).toFixed(3)
            )
          : 0.5,
        y: free.y
          ? Number(
              clamp(
                drag.current.focus.y + (e.clientY - drag.current.y) / free.y
              ).toFixed(3)
            )
          : 0.5,
      });
    },
    [windowWidth, windowHeight, onFocus]
  );

  return (
    <div className="flex flex-col gap-[6px]">
      <div className="text-[13px] text-textItemBlur">
        {t(
          'studio_crop_hint',
          'Drag the frame to choose what stays in the vertical video.'
        )}
      </div>
      <div
        className="relative w-full rounded-[8px] overflow-hidden bg-black touch-none"
        style={{ aspectRatio: `${size.w} / ${size.h}` }}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <canvas ref={canvas} className="absolute inset-0 w-full h-full" />
        <div
          role="slider"
          tabIndex={0}
          aria-label={t('studio_crop_window', 'Vertical crop')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(
            (windowWidth < 100 ? focus.x : focus.y) * 100
          )}
          onPointerDown={(e) => {
            e.currentTarget.parentElement!.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, focus };
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.1 : 0.02;
            const clamp = (value: number) =>
              Number(Math.min(1, Math.max(0, value)).toFixed(3));
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              onFocus({
                ...focus,
                x: clamp(focus.x + (e.key === 'ArrowLeft' ? -step : step)),
              });
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              onFocus({
                ...focus,
                y: clamp(focus.y + (e.key === 'ArrowUp' ? -step : step)),
              });
            }
          }}
          className="absolute border-[2px] border-btnCta rounded-[4px] cursor-move shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
          style={{
            width: `${windowWidth}%`,
            height: `${windowHeight}%`,
            left: `${(100 - windowWidth) * focus.x}%`,
            top: `${(100 - windowHeight) * focus.y}%`,
          }}
        />
      </div>
    </div>
  );
};
