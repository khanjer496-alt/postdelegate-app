'use client';

import React, { FC, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import {
  TextLayer,
  studioFontStyle,
} from '@gitroom/frontend/components/studio/studio.preview';
import type {
  StudioFocus,
  StudioSpec,
} from '@gitroom/frontend/components/studio/use.studio';

// the same numbers as the templates of the render
const OUTPUT_WIDTH = 1080;
const TRANSITION_SECONDS = 0.5;
const LIST_ITEM_SECONDS = 3;

export const isStudioVideo = (path?: string) =>
  !!path && hasExtension(path, 'mp4');

// The time on the output timeline while the preview plays, looping
export const useStudioClock = (duration: number) => {
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const latest = useRef(0);
  const started = useRef(0);

  useEffect(() => {
    if (!playing || duration <= 0) {
      return;
    }
    let animation = 0;
    // resumes where it was paused
    started.current = performance.now() - latest.current * 1000;
    const tick = () => {
      const at = ((performance.now() - started.current) / 1000) % duration;
      latest.current = at;
      setNow(at);
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [playing, duration]);

  return {
    playing,
    now: Math.min(now, duration),
    toggle: () => setPlaying((value) => !value),
  };
};

// A picture or a video of the media library filling its box like COVER
export const StudioMediaFill: FC<{
  path?: string;
  focus?: StudioFocus;
  className?: string;
  style?: React.CSSProperties;
}> = ({ path, focus, className, style }) => {
  if (!path) {
    return <div className={clsx('bg-newBgLineColor', className)} />;
  }
  const objectPosition = `${(focus?.x ?? 0.5) * 100}% ${
    (focus?.y ?? 0.5) * 100
  }%`;
  return isStudioVideo(path) ? (
    <video
      src={path}
      muted
      autoPlay
      loop
      playsInline
      className={clsx('object-cover', className)}
      style={{ objectPosition, ...style }}
    />
  ) : (
    <img
      src={path}
      alt=""
      className={clsx('object-cover', className)}
      style={{ objectPosition, ...style }}
    />
  );
};

const Frame: FC<{
  children: (scale: number) => React.ReactNode;
  background?: string;
}> = ({ children, background }) => {
  const t = useT();
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(270);

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

  return (
    <div
      ref={frame}
      className="relative w-full aspect-[9/16] rounded-[12px] overflow-hidden bg-black"
      style={background ? { background } : undefined}
      aria-label={t('studio_preview', 'Preview of the vertical video')}
    >
      {children(width / OUTPUT_WIDTH)}
    </div>
  );
};

const SlideshowFrame: FC<{ spec: StudioSpec; now: number }> = ({
  spec,
  now,
}) => {
  const slides = spec.slides || [];
  const overlap = spec.transition === 'none' ? 0 : TRANSITION_SECONDS;
  const starts = slides.reduce<number[]>(
    (all, slide, index) =>
      index === 0
        ? [0]
        : [...all, all[index - 1] + slides[index - 1].seconds - overlap],
    []
  );

  return (
    <Frame>
      {(scale) =>
        slides.map((slide, index) => {
          const start = starts[index];
          const end = start + slide.seconds;
          if (now < start || now > end) {
            return null;
          }
          const progress = (now - start) / slide.seconds;
          const along = index % 2 === 0 ? progress : 1 - progress;
          // fades in while the previous one is still there
          const opacity =
            index > 0 && overlap ? Math.min(1, (now - start) / overlap) : 1;
          const last = index === slides.length - 1;
          const textEnd = end - (last ? 0 : overlap);
          return (
            <div key={index} className="absolute inset-0" style={{ opacity }}>
              <StudioMediaFill
                path={slide.path}
                focus={slide.focus}
                className="absolute inset-0 w-full h-full"
                style={
                  spec.pan === false
                    ? undefined
                    : {
                        transform: `scale(1.15) translate(${
                          (0.5 - along) * 13
                        }%, ${(0.5 - along) * 13}%)`,
                      }
                }
              />
              {!!slide.text?.trim() && now <= textEnd && (
                <TextLayer position={spec.position || 'bottom'} scale={scale}>
                  <span
                    style={studioFontStyle(
                      spec.style,
                      spec.style === 'impact' ? 100 : 84,
                      scale
                    )}
                  >
                    {slide.text}
                  </span>
                </TextLayer>
              )}
            </div>
          );
        })
      }
    </Frame>
  );
};

const Label: FC<{
  text?: string;
  spec: StudioSpec;
  scale: number;
  top: number;
}> = ({ text, spec, scale, top }) =>
  text?.trim() ? (
    <div
      className="absolute inset-x-0 text-center px-[7%] pointer-events-none"
      style={{ top: top * scale }}
    >
      <span
        style={studioFontStyle(
          spec.style,
          spec.style === 'impact' ? 96 : 80,
          scale
        )}
      >
        {text}
      </span>
    </div>
  ) : null;

const BeforeAfterFrame: FC<{ spec: StudioSpec; now: number }> = ({
  spec,
  now,
}) => {
  const seconds = spec.seconds || 6;
  const wipeLength = Math.min(1.5, seconds / 5);
  const wipeStart = seconds * 0.4;
  const reveal = Math.min(1, Math.max(0, (now - wipeStart) / wipeLength));

  return (
    <Frame>
      {(scale) =>
        spec.layout === 'wipe' ? (
          <>
            <StudioMediaFill
              path={spec.before?.path}
              focus={spec.before?.focus}
              className="absolute inset-0 w-full h-full"
            />
            <StudioMediaFill
              path={spec.after?.path}
              focus={spec.after?.focus}
              className="absolute inset-0 w-full h-full"
              style={{ clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)` }}
            />
            <Label
              text={
                now < wipeStart + wipeLength / 2
                  ? spec.before?.label
                  : spec.after?.label
              }
              spec={spec}
              scale={scale}
              top={300}
            />
          </>
        ) : (
          <>
            <StudioMediaFill
              path={spec.before?.path}
              focus={spec.before?.focus}
              className="absolute inset-x-0 top-0 w-full h-1/2"
            />
            <StudioMediaFill
              path={spec.after?.path}
              focus={spec.after?.focus}
              className="absolute inset-x-0 bottom-0 w-full h-1/2"
            />
            <Label
              text={spec.before?.label}
              spec={spec}
              scale={scale}
              top={90}
            />
            <Label
              text={spec.after?.label}
              spec={spec}
              scale={scale}
              top={1050}
            />
          </>
        )
      }
    </Frame>
  );
};

export const studioListItemLength = (item: {
  trim?: { start: number; end: number };
  seconds?: number;
}) =>
  item.trim
    ? Math.max(0, item.trim.end - item.trim.start)
    : item.seconds || LIST_ITEM_SECONDS;

const TopNFrame: FC<{ spec: StudioSpec; now: number }> = ({ spec, now }) => {
  const items = spec.items || [];
  let start = 0;
  const current = items.findIndex((item) => {
    const end = start + studioListItemLength(item);
    const found = now >= start && now < end;
    start = end;
    return found;
  });
  const index = current === -1 ? 0 : current;
  const item = items[index];
  const number =
    spec.countdown === false ? index + 1 : items.length - index;

  return (
    <Frame>
      {(scale) => (
        <>
          {!!item && (
            <StudioMediaFill
              key={index}
              path={item.path}
              focus={item.focus}
              className="absolute inset-0 w-full h-full"
            />
          )}
          {!!spec.title?.trim() && (
            <TextLayer position="top" scale={scale}>
              <span
                style={studioFontStyle(
                  spec.style,
                  spec.style === 'impact' ? 104 : 88,
                  scale
                )}
              >
                {spec.title}
              </span>
            </TextLayer>
          )}
          {!!item?.label?.trim() && (
            <TextLayer position="bottom" scale={scale}>
              <span
                style={{
                  ...studioFontStyle(
                    spec.style,
                    spec.style === 'impact' ? 96 : 80,
                    scale
                  ),
                  color: '#FFD400',
                }}
              >
                #{number} {item.label}
              </span>
            </TextLayer>
          )}
        </>
      )}
    </Frame>
  );
};

const QuoteFrame: FC<{ spec: StudioSpec; now: number }> = ({ spec, now }) => {
  const quote = (spec.quote || '').trim();
  const words = quote.split(/\s+/).filter(Boolean);
  const seconds = spec.seconds || 8;
  const reveal = Math.min(seconds * 0.6, Math.max(1, words.length * 0.18));
  const step = reveal / Math.max(1, words.length);
  const base = quote.length <= 80 ? 84 : quote.length <= 160 ? 72 : 60;
  const size = spec.style === 'impact' ? base + 12 : base;
  const background = spec.background || {};
  const media = !!background.mediaId;

  return (
    <Frame background={media ? undefined : background.color || '#111111'}>
      {(scale) => (
        <>
          {media && (
            <>
              <StudioMediaFill
                path={background.path}
                focus={background.focus}
                className="absolute inset-0 w-full h-full"
              />
              {spec.dim !== false && (
                <div className="absolute inset-0 bg-black/45" />
              )}
            </>
          )}
          <div className="absolute inset-0 flex items-center px-[7%] text-center pointer-events-none">
            <div
              className="w-full break-words"
              style={{
                ...studioFontStyle(spec.style, size, scale),
                color: spec.textColor || '#FFFFFF',
              }}
            >
              {words.map((word, index) => (
                <React.Fragment key={index}>
                  {index > 0 && ' '}
                  <span
                    style={{
                      opacity: Math.min(1, Math.max(0, (now - index * step) / 0.3)),
                    }}
                  >
                    {word}
                  </span>
                </React.Fragment>
              ))}
              {!!spec.author?.trim() && (
                <div
                  style={{
                    fontSize: Math.round(size * 0.6) * scale,
                    opacity: Math.min(1, Math.max(0, (now - reveal) / 0.4)),
                  }}
                >
                  — {spec.author}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </Frame>
  );
};

const FRAMES: Record<string, FC<{ spec: StudioSpec; now: number }>> = {
  'image-slideshow': SlideshowFrame,
  'before-after': BeforeAfterFrame,
  'top-n-list': TopNFrame,
  'quote-card': QuoteFrame,
};

// The output frame of a template made of pictures and clips, with a play
// button running its timeline. The text sits where the render burns it in,
// with the same fonts
export const StudioMediaPreview: FC<{
  template: string;
  spec: StudioSpec;
  duration: number;
  maxSeconds: number;
}> = ({ template, spec, duration, maxSeconds }) => {
  const t = useT();
  const clock = useStudioClock(duration);
  const Preview = FRAMES[template];

  return (
    <div className="flex flex-col gap-[10px]">
      {Preview ? <Preview spec={spec} now={clock.now} /> : null}
      <div className="flex items-center gap-[10px]">
        <button
          type="button"
          onClick={clock.toggle}
          disabled={duration <= 0}
          aria-label={
            clock.playing ? t('studio_pause', 'Pause') : t('studio_play', 'Play')
          }
          className="w-[40px] h-[40px] rounded-full bg-btnSimple text-btnText flex items-center justify-center disabled:opacity-50"
        >
          {clock.playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" />
              <rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M3 1.5v11l9-5.5z" fill="currentColor" />
            </svg>
          )}
        </button>
        <div
          className={clsx(
            'text-[13px] tabular-nums',
            duration > maxSeconds ? 'text-red-400' : 'text-textItemBlur'
          )}
        >
          {t('studio_output_length', 'Video length: {{seconds}}s', {
            seconds: duration.toFixed(1),
          })}
        </div>
      </div>
    </div>
  );
};
