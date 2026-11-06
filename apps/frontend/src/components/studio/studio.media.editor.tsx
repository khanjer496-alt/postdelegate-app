'use client';

import React, { FC, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  MediaBox,
  mediaLibrarySize,
} from '@gitroom/frontend/components/media/media.component';
import { STUDIO_MAX_SECONDS } from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';
import type {
  StudioCompareSide,
  StudioListItem,
  StudioMediaItem,
  StudioProject,
  StudioSlide,
  StudioSpec,
  StudioTemplate,
} from '@gitroom/frontend/components/studio/use.studio';
import {
  Segmented,
  StudioSettingsProps,
  StyleSelect,
  usePositions,
} from '@gitroom/frontend/components/studio/studio.settings';
import { StudioMusicPicker } from '@gitroom/frontend/components/studio/studio.music';
import {
  StudioMediaFill,
  StudioMediaPreview,
  isStudioVideo,
  studioListItemLength,
} from '@gitroom/frontend/components/studio/studio.media.preview';
import { StudioRenderPanel } from '@gitroom/frontend/components/studio/studio.render.panel';

// the same limits as the DTOs of the templates
const MAX_SLIDES = 10;
const MIN_SLIDES = 2;
const MAX_ITEMS = 7;
const MIN_ITEMS = 3;
const TRANSITION_SECONDS = 0.5;
const PICTURES = ['png', 'jpg', 'jpeg', 'webp'];

const isPicture = (path?: string) =>
  !!path && PICTURES.some((ext) => hasExtension(path, ext));

interface StudioMediaEditorProps {
  spec: StudioSpec;
  change: (patch: Partial<StudioSpec>) => void;
}

const inputClass =
  'bg-newBgColorInner h-[38px] border border-newTableBorder rounded-[8px] px-[10px] text-[14px] text-textColor outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary min-w-0';

// Opens the media library; only pictures Studio reads (png, jpg, webp) and
// mp4 videos come back
const usePickMedia = () => {
  const t = useT();
  const modals = useModals();
  const toaster = useToaster();

  return useCallback(
    (
      kind: 'image' | 'any',
      onPick: (media: StudioMediaItem[]) => void
    ) => {
      modals.openModal({
        title: t('media_library', 'Media Library'),
        askClose: false,
        closeOnEscape: true,
        fullScreen: true,
        size: mediaLibrarySize(),
        height: mediaLibrarySize(),
        children: (close) => (
          <MediaBox
            type={kind === 'image' ? 'image' : undefined}
            setMedia={(selected) => {
              const usable = selected.filter(
                (media) =>
                  isPicture(media.path) ||
                  (kind === 'any' && isStudioVideo(media.path))
              );
              if (usable.length < selected.length) {
                toaster.show(
                  t(
                    'studio_pictures_only',
                    'Studio reads pictures in PNG, JPG or WebP and MP4 videos, the others were left out'
                  ),
                  'warning'
                );
              }
              if (usable.length) {
                onPick(
                  usable.map((media) => ({
                    mediaId: media.id,
                    path: media.path,
                  }))
                );
              }
              close();
            }}
            closeModal={close}
          />
        ),
      });
    },
    [modals]
  );
};

const IconButton: FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, children }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
    className="w-[30px] h-[30px] rounded-[6px] text-textItemBlur hover:text-textColor hover:bg-boxHover flex items-center justify-center disabled:opacity-30 disabled:hover:bg-transparent"
  >
    {children}
  </button>
);

// Move up, move down and remove for a row of a list
const RowActions: FC<{
  index: number;
  count: number;
  move: (from: number, to: number) => void;
  remove: (index: number) => void;
}> = ({ index, count, move, remove }) => {
  const t = useT();
  return (
    <div className="flex items-center shrink-0">
      <IconButton
        label={t('studio_move_up', 'Move up')}
        disabled={index === 0}
        onClick={() => move(index, index - 1)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </IconButton>
      <IconButton
        label={t('studio_move_down', 'Move down')}
        disabled={index === count - 1}
        onClick={() => move(index, index + 1)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </IconButton>
      <IconButton
        label={t('studio_remove', 'Remove')}
        onClick={() => remove(index)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </IconButton>
    </div>
  );
};

const moveIn = <T,>(list: T[], from: number, to: number) => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

const Thumb: FC<{ item?: StudioMediaItem; onClick?: () => void }> = ({
  item,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="w-[54px] h-[96px] rounded-[8px] overflow-hidden shrink-0 bg-newBgLineColor relative focus-visible:ring-2 focus-visible:ring-btnPrimary outline-none"
  >
    <StudioMediaFill path={item?.path} className="absolute inset-0 w-full h-full" />
  </button>
);

const AddButton: FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
}> = ({ label, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="h-[44px] rounded-[10px] border-[2px] border-dashed border-newTableBorder text-[14px] text-textItemBlur hover:bg-boxHover flex items-center justify-center gap-[6px] disabled:opacity-50 disabled:hover:bg-transparent"
  >
    <svg width="16" height="16" viewBox="0 0 21 20" fill="none" aria-hidden="true">
      <path d="M10.5001 4.16699V15.8337M4.66675 10.0003H16.3334" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    {label}
  </button>
);

const SlideshowEditor: FC<StudioMediaEditorProps> = ({ spec, change }) => {
  const t = useT();
  const pick = usePickMedia();
  const slides = spec.slides || [];
  const setSlides = (next: StudioSlide[]) => change({ slides: next });

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="text-[14px] text-textItemBlur">
        {t(
          'studio_slides_hint',
          '{{min}} to {{max}} pictures, each on screen for 1.5 to 5 seconds with its own line of text.',
          { min: MIN_SLIDES, max: MAX_SLIDES }
        )}
      </div>
      <ul className="flex flex-col gap-[8px]">
        {slides.map((slide, index) => (
          <li
            key={`${slide.mediaId}-${index}`}
            className="flex gap-[10px] items-center p-[8px] rounded-[10px] border border-newTableBorder list-none"
          >
            <Thumb
              item={slide}
              onClick={() =>
                pick('image', ([media]) =>
                  setSlides(
                    slides.map((p, at) =>
                      at === index ? { ...p, ...media } : p
                    )
                  )
                )
              }
            />
            <div className="flex flex-col gap-[6px] flex-1 min-w-0">
              <input
                value={slide.text || ''}
                maxLength={120}
                placeholder={t('studio_slide_text', 'Text on this slide')}
                aria-label={t('studio_slide_text_n', 'Text of slide {{n}}', {
                  n: index + 1,
                })}
                onChange={(e) =>
                  setSlides(
                    slides.map((p, at) =>
                      at === index ? { ...p, text: e.target.value } : p
                    )
                  )
                }
                className={inputClass}
              />
              <label className="flex items-center gap-[8px] text-[13px] text-textItemBlur">
                <input
                  type="range"
                  min={1.5}
                  max={5}
                  step={0.5}
                  value={slide.seconds}
                  onChange={(e) =>
                    setSlides(
                      slides.map((p, at) =>
                        at === index
                          ? { ...p, seconds: Number(e.target.value) }
                          : p
                      )
                    )
                  }
                  className="accent-btnPrimary flex-1"
                />
                <span className="tabular-nums w-[36px]">{slide.seconds}s</span>
              </label>
            </div>
            <RowActions
              index={index}
              count={slides.length}
              move={(from, to) => setSlides(moveIn(slides, from, to))}
              remove={(at) => setSlides(slides.filter((_, i) => i !== at))}
            />
          </li>
        ))}
      </ul>
      <AddButton
        label={t('studio_add_pictures', 'Add pictures')}
        disabled={slides.length >= MAX_SLIDES}
        onClick={() =>
          pick('image', (media) =>
            setSlides(
              [
                ...slides,
                ...media.map((item) => ({ ...item, seconds: 3 })),
              ].slice(0, MAX_SLIDES)
            )
          )
        }
      />
    </div>
  );
};

const SideEditor: FC<{
  title: string;
  side?: StudioCompareSide;
  onChange: (side: StudioCompareSide) => void;
}> = ({ title, side, onChange }) => {
  const t = useT();
  const pick = usePickMedia();
  const labelId = useId();
  const startId = useId();

  return (
    <div className="flex gap-[12px] p-[10px] rounded-[10px] border border-newTableBorder">
      <Thumb
        item={side}
        onClick={() =>
          pick('any', ([media]) =>
            onChange({ ...side, ...media, start: undefined })
          )
        }
      />
      <div className="flex flex-col gap-[8px] flex-1 min-w-0">
        <div className="text-[14px] font-[600]">{title}</div>
        {side?.mediaId ? (
          <>
            <label htmlFor={labelId} className="sr-only">
              {t('studio_label', 'Label')}
            </label>
            <input
              id={labelId}
              value={side.label || ''}
              maxLength={40}
              placeholder={t('studio_label', 'Label')}
              onChange={(e) => onChange({ ...side, label: e.target.value })}
              className={inputClass}
            />
            {isStudioVideo(side.path) && (
              <label
                htmlFor={startId}
                className="flex items-center gap-[8px] text-[13px] text-textItemBlur"
              >
                {t('studio_starts_at', 'Starts at')}
                <input
                  id={startId}
                  type="number"
                  min={0}
                  max={600}
                  step={0.5}
                  value={side.start || 0}
                  onChange={(e) =>
                    onChange({
                      ...side,
                      start: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className={`${inputClass} w-[80px]`}
                />
                s
              </label>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={() =>
              pick('any', ([media]) => onChange({ ...side, ...media }))
            }
            className="h-[36px] px-[12px] rounded-[8px] bg-btnSimple text-btnText text-[13px] w-fit"
          >
            {t('studio_pick_media', 'Pick a picture or video')}
          </button>
        )}
      </div>
    </div>
  );
};

const BeforeAfterEditor: FC<StudioMediaEditorProps> = ({ spec, change }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-[10px]">
      <SideEditor
        title={t('studio_before', 'Before')}
        side={spec.before}
        onChange={(before) => change({ before })}
      />
      <SideEditor
        title={t('studio_after', 'After')}
        side={spec.after}
        onChange={(after) => change({ after })}
      />
    </div>
  );
};

const ListItemEditor: FC<{
  item: StudioListItem;
  index: number;
  onChange: (item: StudioListItem) => void;
  onPick: () => void;
}> = ({ item, index, onChange, onPick }) => {
  const t = useT();
  const video = isStudioVideo(item.path);
  const trim = item.trim || { start: 0, end: 3 };

  return (
    <>
      <Thumb item={item} onClick={onPick} />
      <div className="flex flex-col gap-[6px] flex-1 min-w-0">
        <input
          value={item.label}
          maxLength={60}
          placeholder={t('studio_item_label', 'What this one is')}
          aria-label={t('studio_item_label_n', 'Label of item {{n}}', {
            n: index + 1,
          })}
          onChange={(e) => onChange({ ...item, label: e.target.value })}
          className={inputClass}
        />
        {video ? (
          <div className="flex items-center gap-[6px] text-[13px] text-textItemBlur flex-wrap">
            {t('studio_plays_from', 'Plays from')}
            <input
              type="number"
              min={0}
              max={600}
              step={0.5}
              value={trim.start}
              aria-label={t('studio_trim_start', 'Start')}
              onChange={(e) =>
                onChange({
                  ...item,
                  trim: { ...trim, start: Math.max(0, Number(e.target.value) || 0) },
                })
              }
              className={`${inputClass} w-[72px]`}
            />
            {t('studio_to', 'to')}
            <input
              type="number"
              min={0.5}
              max={600}
              step={0.5}
              value={trim.end}
              aria-label={t('studio_trim_end', 'End')}
              onChange={(e) =>
                onChange({
                  ...item,
                  trim: { ...trim, end: Math.max(0.5, Number(e.target.value) || 0.5) },
                })
              }
              className={`${inputClass} w-[72px]`}
            />
            s
          </div>
        ) : (
          <label className="flex items-center gap-[8px] text-[13px] text-textItemBlur">
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={item.seconds || 3}
              onChange={(e) =>
                onChange({ ...item, seconds: Number(e.target.value) })
              }
              className="accent-btnPrimary flex-1"
            />
            <span className="tabular-nums w-[36px]">{item.seconds || 3}s</span>
          </label>
        )}
      </div>
    </>
  );
};

const TopNEditor: FC<StudioMediaEditorProps> = ({ spec, change }) => {
  const t = useT();
  const pick = usePickMedia();
  const titleId = useId();
  const items = spec.items || [];
  const setItems = (next: StudioListItem[]) => change({ items: next });
  // a new clip plays its first 3 seconds, a new picture stays 3 seconds
  const newItem = (media: StudioMediaItem): StudioListItem => ({
    ...media,
    label: '',
    ...(isStudioVideo(media.path)
      ? { trim: { start: 0, end: 3 } }
      : { seconds: 3 }),
  });

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="flex flex-col gap-[6px]">
        <label htmlFor={titleId} className="text-[14px]">
          {t('studio_list_title', 'Title')}
        </label>
        <input
          id={titleId}
          value={spec.title || ''}
          maxLength={80}
          placeholder={t('studio_list_title_placeholder', 'Top 5 tools I use every day')}
          onChange={(e) => change({ title: e.target.value })}
          className={inputClass}
        />
      </div>
      <div className="text-[14px] text-textItemBlur">
        {t(
          'studio_items_hint',
          '{{min}} to {{max}} pictures or clips, each numbered with its label.',
          { min: MIN_ITEMS, max: MAX_ITEMS }
        )}
      </div>
      <ul className="flex flex-col gap-[8px]">
        {items.map((item, index) => (
          <li
            key={`${item.mediaId}-${index}`}
            className="flex gap-[10px] items-center p-[8px] rounded-[10px] border border-newTableBorder list-none"
          >
            <span className="w-[28px] text-center text-[14px] font-[600] text-textItemBlur shrink-0 tabular-nums">
              #{spec.countdown === false ? index + 1 : items.length - index}
            </span>
            <ListItemEditor
              item={item}
              index={index}
              onChange={(next) =>
                setItems(items.map((p, at) => (at === index ? next : p)))
              }
              onPick={() =>
                pick('any', ([media]) =>
                  setItems(
                    items.map((p, at) =>
                      at === index ? { ...newItem(media), label: p.label } : p
                    )
                  )
                )
              }
            />
            <RowActions
              index={index}
              count={items.length}
              move={(from, to) => setItems(moveIn(items, from, to))}
              remove={(at) => setItems(items.filter((_, i) => i !== at))}
            />
          </li>
        ))}
      </ul>
      <AddButton
        label={t('studio_add_items', 'Add pictures or clips')}
        disabled={items.length >= MAX_ITEMS}
        onClick={() =>
          pick('any', (media) =>
            setItems([...items, ...media.map(newItem)].slice(0, MAX_ITEMS))
          )
        }
      />
    </div>
  );
};

const QuoteEditor: FC<StudioMediaEditorProps> = ({ spec, change }) => {
  const t = useT();
  const pick = usePickMedia();
  const quoteId = useId();
  const authorId = useId();
  const background = spec.background || {};
  const quote = spec.quote || '';

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-col gap-[6px]">
        <label htmlFor={quoteId} className="text-[14px]">
          {t('studio_quote', 'Quote')}
        </label>
        <textarea
          id={quoteId}
          value={quote}
          maxLength={300}
          rows={4}
          onChange={(e) => change({ quote: e.target.value })}
          placeholder={t('studio_quote_placeholder', 'The words that stay with people')}
          className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px] text-[14px] text-textColor outline-none resize-none focus-visible:ring-2 focus-visible:ring-btnPrimary"
        />
        <div className="text-[12px] text-textItemBlur self-end tabular-nums">
          {quote.length}/300
        </div>
      </div>
      <div className="flex flex-col gap-[6px]">
        <label htmlFor={authorId} className="text-[14px]">
          {t('studio_author', 'Author')}
        </label>
        <input
          id={authorId}
          value={spec.author || ''}
          maxLength={80}
          onChange={(e) => change({ author: e.target.value })}
          className={inputClass}
        />
      </div>
      <Segmented
        label={t('studio_background', 'Background')}
        value={background.mediaId ? 'media' : 'color'}
        options={[
          { value: 'color', label: t('studio_background_color', 'Colour') },
          { value: 'media', label: t('studio_background_media', 'Picture or video') },
        ]}
        onChange={(value) =>
          value === 'color'
            ? change({ background: { color: background.color || '#111111' } })
            : pick('any', ([media]) =>
                change({ background: { ...background, ...media } })
              )
        }
      />
      {background.mediaId ? (
        <div className="flex gap-[12px] items-center">
          <Thumb
            item={background as StudioMediaItem}
            onClick={() =>
              pick('any', ([media]) =>
                change({ background: { ...background, ...media, start: undefined } })
              )
            }
          />
          <div className="text-[13px] text-textItemBlur">
            {t('studio_background_change', 'Click the picture to change it.')}
          </div>
        </div>
      ) : (
        <label className="flex items-center gap-[10px] text-[14px]">
          <input
            type="color"
            value={background.color || '#111111'}
            onChange={(e) =>
              change({ background: { color: e.target.value.toUpperCase() } })
            }
            className="w-[36px] h-[28px] rounded-[6px] bg-transparent"
          />
          {t('studio_background_colour', 'Background colour')}
        </label>
      )}
    </div>
  );
};

const SoundSetting: FC<StudioSettingsProps> = ({ spec, change }) => {
  const t = useT();
  return (
    <Segmented
      label={t('studio_sound', 'Sound')}
      value={spec.mute ? 'off' : 'on'}
      options={[
        { value: 'on', label: t('studio_sound_on', 'On') },
        { value: 'off', label: t('studio_sound_off', 'Muted') },
      ]}
      onChange={(value) => change({ mute: value === 'off' })}
    />
  );
};

const SlideshowSettings: FC<StudioSettingsProps> = (props) => {
  const t = useT();
  const positions = usePositions();
  const { spec, change } = props;
  return (
    <div className="flex flex-col gap-[14px]">
      <Segmented
        label={t('studio_transition', 'Transition')}
        value={spec.transition || 'fade'}
        options={[
          { value: 'fade', label: t('studio_transition_fade', 'Fade') },
          { value: 'slideleft', label: t('studio_transition_slide', 'Slide') },
          { value: 'wipeleft', label: t('studio_transition_wipe', 'Wipe') },
          { value: 'circleopen', label: t('studio_transition_circle', 'Circle') },
          { value: 'none', label: t('studio_transition_none', 'Cut') },
        ]}
        onChange={(transition) => change({ transition })}
      />
      <Segmented
        label={t('studio_pan', 'Slow pan')}
        value={spec.pan === false ? 'off' : 'on'}
        options={[
          { value: 'on', label: t('studio_on', 'On') },
          { value: 'off', label: t('studio_off', 'Off') },
        ]}
        onChange={(value) => change({ pan: value === 'on' })}
      />
      <StyleSelect
        label={t('studio_text_style', 'Text style')}
        value={spec.style || 'bold'}
        onChange={(style) => change({ style })}
      />
      <Segmented
        label={t('studio_position', 'Position')}
        value={spec.position || 'bottom'}
        options={positions}
        onChange={(position) =>
          change({ position: position as StudioSpec['position'] })
        }
      />
      <StudioMusicPicker spec={spec} change={change} />
    </div>
  );
};

const BeforeAfterSettings: FC<StudioSettingsProps> = (props) => {
  const t = useT();
  const { spec, change } = props;
  const sound = [spec.before, spec.after].some((side) =>
    isStudioVideo(side?.path)
  );
  return (
    <div className="flex flex-col gap-[14px]">
      <Segmented
        label={t('studio_layout', 'Layout')}
        value={spec.layout || 'stack'}
        options={[
          { value: 'stack', label: t('studio_layout_stack', 'Stacked') },
          { value: 'wipe', label: t('studio_layout_wipe', 'Wipe') },
        ]}
        onChange={(layout) => change({ layout: layout as 'stack' | 'wipe' })}
      />
      <Segmented
        label={t('studio_length', 'Length')}
        value={String(spec.seconds || 6)}
        options={['4', '6', '8', '10', '15'].map((value) => ({
          value,
          label: `${value}s`,
        }))}
        onChange={(value) => change({ seconds: Number(value) })}
      />
      <StyleSelect
        label={t('studio_text_style', 'Text style')}
        value={spec.style || 'bold'}
        onChange={(style) => change({ style })}
      />
      {sound && <SoundSetting {...props} />}
      <StudioMusicPicker
        spec={spec}
        change={change}
        underSound={sound && !spec.mute}
      />
    </div>
  );
};

const TopNSettings: FC<StudioSettingsProps> = (props) => {
  const t = useT();
  const { spec, change } = props;
  const sound = (spec.items || []).some((item) => isStudioVideo(item.path));
  return (
    <div className="flex flex-col gap-[14px]">
      <Segmented
        label={t('studio_numbers', 'Numbers')}
        value={spec.countdown === false ? 'up' : 'down'}
        options={[
          { value: 'down', label: t('studio_countdown', 'Count down to #1') },
          { value: 'up', label: t('studio_countup', 'From #1') },
        ]}
        onChange={(value) => change({ countdown: value === 'down' })}
      />
      <StyleSelect
        label={t('studio_text_style', 'Text style')}
        value={spec.style || 'bold'}
        onChange={(style) => change({ style })}
      />
      {sound && <SoundSetting {...props} />}
      <StudioMusicPicker
        spec={spec}
        change={change}
        underSound={sound && !spec.mute}
      />
    </div>
  );
};

const QuoteSettings: FC<StudioSettingsProps> = ({ spec, change, ...rest }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-[14px]">
      <Segmented
        label={t('studio_length', 'Length')}
        value={String(spec.seconds || 8)}
        options={['5', '8', '10', '12', '15'].map((value) => ({
          value,
          label: `${value}s`,
        }))}
        onChange={(value) => change({ seconds: Number(value) })}
      />
      <StyleSelect
        label={t('studio_text_style', 'Text style')}
        value={spec.style || 'bold'}
        onChange={(style) => change({ style })}
      />
      <label className="flex items-center gap-[10px] text-[14px]">
        <input
          type="color"
          value={spec.textColor || '#FFFFFF'}
          onChange={(e) => change({ textColor: e.target.value.toUpperCase() })}
          className="w-[36px] h-[28px] rounded-[6px] bg-transparent"
        />
        {t('studio_text_colour', 'Text colour')}
      </label>
      {!!spec.background?.mediaId && (
        <Segmented
          label={t('studio_dim', 'Darken the background')}
          value={spec.dim === false ? 'off' : 'on'}
          options={[
            { value: 'on', label: t('studio_on', 'On') },
            { value: 'off', label: t('studio_off', 'Off') },
          ]}
          onChange={(value) => change({ dim: value === 'on' })}
        />
      )}
      <StudioMusicPicker spec={spec} change={change} />
    </div>
  );
};

const slideshowLength = (spec: StudioSpec) => {
  const slides = spec.slides || [];
  const overlap = spec.transition === 'none' ? 0 : TRANSITION_SECONDS;
  return Math.max(
    0,
    slides.reduce((all, slide) => all + slide.seconds, 0) -
      Math.max(0, slides.length - 1) * overlap
  );
};

// The templates made of pictures and clips: what a new project starts with,
// how long the video is, what it still needs before it can render (shown by
// the render button, nothing when it can), and its editor and settings. A
// new template of this kind adds an entry
export const studioMediaTemplates: Record<
  string,
  {
    defaults: Partial<StudioSpec>;
    missing: (
      spec: StudioSpec,
      t: ReturnType<typeof useT>
    ) => string | undefined;
    duration: (spec: StudioSpec) => number;
    Editor: FC<StudioMediaEditorProps>;
    Settings: FC<StudioSettingsProps>;
  }
> = {
  'image-slideshow': {
    defaults: { slides: [], transition: 'fade', style: 'bold', position: 'bottom' },
    missing: (spec, t) =>
      (spec.slides || []).length < MIN_SLIDES
        ? t('studio_slides_missing', 'Add at least {{count}} pictures', {
            count: MIN_SLIDES,
          })
        : undefined,
    duration: slideshowLength,
    Editor: SlideshowEditor,
    Settings: SlideshowSettings,
  },
  'before-after': {
    defaults: { layout: 'stack', seconds: 6, style: 'bold' },
    missing: (spec, t) =>
      !spec.before?.mediaId
        ? t('studio_before_missing', 'Pick the before picture or video')
        : !spec.after?.mediaId
        ? t('studio_after_missing', 'Pick the after picture or video')
        : undefined,
    duration: (spec) => spec.seconds || 6,
    Editor: BeforeAfterEditor,
    Settings: BeforeAfterSettings,
  },
  'top-n-list': {
    defaults: { title: '', items: [], style: 'bold' },
    missing: (spec, t) => {
      const items = spec.items || [];
      const unlabelled = items.findIndex((item) => !item.label.trim());
      const untrimmed = items.findIndex(
        (item) => !!item.trim && item.trim.end <= item.trim.start
      );
      return !spec.title?.trim()
        ? t('studio_list_title_missing', 'Add a title')
        : items.length < MIN_ITEMS
        ? t('studio_items_missing', 'Add at least {{count}} pictures or clips', {
            count: MIN_ITEMS,
          })
        : unlabelled !== -1
        ? t('studio_item_label_missing', 'Item {{n}}: Add a label', {
            n: unlabelled + 1,
          })
        : untrimmed !== -1
        ? t(
            'studio_item_trim_missing',
            'Item {{n}}: The end must be after the start',
            { n: untrimmed + 1 }
          )
        : undefined;
    },
    duration: (spec) =>
      (spec.items || []).reduce(
        (all, item) => all + studioListItemLength(item),
        0
      ),
    Editor: TopNEditor,
    Settings: TopNSettings,
  },
  'quote-card': {
    defaults: {
      quote: '',
      background: { color: '#111111' },
      seconds: 8,
      style: 'bold',
    },
    missing: (spec, t) =>
      !spec.quote?.trim()
        ? t('studio_quote_missing', 'Write the quote')
        : undefined,
    duration: (spec) => spec.seconds || 8,
    Editor: QuoteEditor,
    Settings: QuoteSettings,
  },
};

// One project of a template made of pictures and clips: the preview on the
// left, the pictures and text in the middle, the settings and the render on
// the right. Every change is saved after a short pause and before a render
export const StudioMediaEditor: FC<{
  project: StudioProject;
  template?: StudioTemplate;
  onChanged: () => void;
}> = ({ project, template, onChanged }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const kind = studioMediaTemplates[project.template];
  const [spec, setSpec] = useState<StudioSpec>(() => ({
    ...(kind?.defaults || {}),
    ...project.spec,
  }));
  const [name, setName] = useState(project.name);
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

  if (!kind) {
    return null;
  }

  const duration = kind.duration(spec);
  const { Editor, Settings } = kind;

  return (
    <div className="flex flex-1 gap-[20px] tablet:flex-col min-w-0">
      <div className="w-[300px] tablet:w-full tablet:max-w-[340px] tablet:self-center shrink-0">
        <StudioMediaPreview
          template={project.template}
          spec={spec}
          duration={duration}
          maxSeconds={STUDIO_MAX_SECONDS}
        />
      </div>

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
        <Editor spec={spec} change={change} />
      </div>

      <div className="w-[320px] tablet:w-full shrink-0 flex flex-col gap-[20px]">
        <Settings projectId={project.id} spec={spec} change={change} save={save} />
        <div className="border-t border-newTableBorder pt-[16px]">
          <StudioRenderPanel
            projectId={project.id}
            latest={project.renders?.[0]}
            missing={kind.missing(spec, t)}
            tooLong={duration > STUDIO_MAX_SECONDS}
            save={save}
            onRendered={onChanged}
          />
        </div>
      </div>
    </div>
  );
};
