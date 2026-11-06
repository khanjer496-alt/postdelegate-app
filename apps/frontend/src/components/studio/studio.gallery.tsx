'use client';

import React, { FC } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import type { StudioTemplate } from '@gitroom/frontend/components/studio/use.studio';

// A small drawing of what each template makes, in a 9:16 phone frame. Only
// colour tokens of the app, so it follows the light and dark themes
const Bar: FC<{ className?: string }> = ({ className }) => (
  <div className={clsx('absolute h-[5px] rounded-full', className)} />
);

const Tile: FC<{ className?: string }> = ({ className }) => (
  <div className={clsx('absolute rounded-[4px] bg-newSep', className)} />
);

const ART: Record<string, FC> = {
  'hook-over-clip': () => (
    <>
      <Tile className="inset-[6px] opacity-60" />
      <Bar className="inset-x-[10px] top-[16px] bg-btnCta" />
      <Bar className="inset-x-[16px] top-[25px] bg-textItemBlur" />
    </>
  ),
  'talking-head-captions': () => (
    <>
      <div className="absolute left-1/2 -translate-x-1/2 top-[22px] w-[26px] h-[26px] rounded-full bg-newSep" />
      <div className="absolute left-1/2 -translate-x-1/2 top-[50px] w-[40px] h-[30px] rounded-t-[16px] bg-newSep" />
      <Bar className="inset-x-[10px] bottom-[20px] bg-btnCta" />
      <Bar className="inset-x-[16px] bottom-[11px] bg-textItemBlur" />
    </>
  ),
  'image-slideshow': () => (
    <>
      <Tile className="inset-[6px] animate-pulse" />
      <Tile className="top-[6px] bottom-[6px] left-[30px] right-[-20px] opacity-70" />
      <Bar className="inset-x-[12px] bottom-[18px] bg-textItemBlur" />
      <div className="absolute bottom-[8px] inset-x-0 flex justify-center gap-[3px]">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className={clsx(
              'w-[4px] h-[4px] rounded-full',
              dot === 0 ? 'bg-btnCta' : 'bg-textItemBlur'
            )}
          />
        ))}
      </div>
    </>
  ),
  'before-after': () => (
    <>
      <Tile className="inset-x-[6px] top-[6px] h-[40px] opacity-60" />
      <Tile className="inset-x-[6px] bottom-[6px] h-[40px]" />
      <Bar className="left-[16px] right-[16px] top-[10px] bg-textItemBlur" />
      <Bar className="left-[16px] right-[16px] top-[54px] bg-btnCta" />
    </>
  ),
  'top-n-list': () => (
    <>
      <Bar className="inset-x-[10px] top-[10px] bg-textItemBlur" />
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="absolute inset-x-[8px] flex items-center gap-[4px]"
          style={{ top: 24 + row * 22 }}
        >
          <span className="text-[9px] font-[700] text-btnCta leading-none">
            #{3 - row}
          </span>
          <span className="flex-1 h-[16px] rounded-[3px] bg-newSep" />
        </div>
      ))}
    </>
  ),
  'quote-card': () => (
    <>
      <div className="absolute top-[18px] left-[10px] text-[22px] leading-none font-[700] text-btnCta">
        “
      </div>
      <Bar className="inset-x-[10px] top-[40px] bg-textItemBlur" />
      <Bar className="left-[10px] right-[18px] top-[50px] bg-textItemBlur" />
      <Bar className="left-[10px] right-[26px] top-[60px] bg-textItemBlur" />
      <Bar className="left-[24px] right-[10px] top-[76px] bg-textItemBlur" />
    </>
  ),
};

// what each template is made from and takes, shown on its card
const TAGS: Record<string, ('video' | 'pictures' | 'music' | 'captions')[]> = {
  'hook-over-clip': ['video', 'music'],
  'talking-head-captions': ['video', 'captions'],
  'image-slideshow': ['pictures', 'music'],
  'before-after': ['pictures', 'video', 'music'],
  'top-n-list': ['pictures', 'video', 'music'],
  'quote-card': ['pictures', 'video', 'music'],
};

const Art: FC<{ identifier: string }> = ({ identifier }) => {
  const Drawing = ART[identifier];
  return (
    <div className="w-[72px] h-[128px] rounded-[10px] bg-newBgLineColor border border-newTableBorder relative overflow-hidden shrink-0">
      {Drawing ? <Drawing /> : null}
    </div>
  );
};

// The templates a new video starts from, each with a drawing of its result
export const StudioTemplateGallery: FC<{
  templates: StudioTemplate[];
  onPick: (template: StudioTemplate) => void;
}> = ({ templates, onPick }) => {
  const t = useT();
  const tag = (name: string) =>
    ({
      video: t('studio_tag_video', 'Video'),
      pictures: t('studio_tag_pictures', 'Pictures'),
      music: t('studio_tag_music', 'Music'),
      captions: t('studio_tag_captions', 'Captions'),
    }[name]);

  return (
    <div className="grid grid-cols-3 tablet:grid-cols-2 mobile:grid-cols-1 gap-[12px]">
      {templates.map((template) => (
        <button
          key={template.identifier}
          type="button"
          onClick={() => onPick(template)}
          className="group flex gap-[14px] items-start text-start p-[14px] rounded-[12px] border border-newTableBorder hover:bg-boxHover hover:border-btnPrimary focus-visible:ring-2 focus-visible:ring-btnPrimary outline-none transition-colors"
        >
          <div className="transition-transform group-hover:-translate-y-[2px]">
            <Art identifier={template.identifier} />
          </div>
          <div className="flex flex-col gap-[6px] min-w-0">
            <div className="text-[16px] font-[600]">{template.title}</div>
            <div className="text-[13px] text-textItemBlur">
              {template.description}
            </div>
            <div className="flex flex-wrap gap-[4px] mt-[2px]">
              {(TAGS[template.identifier] || []).map((name) => (
                <span
                  key={name}
                  className="text-[11px] px-[8px] py-[2px] rounded-full bg-newBgLineColor text-textItemBlur"
                >
                  {tag(name)}
                </span>
              ))}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
};
