'use client';

import React, { FC, ReactNode, useEffect, useId } from 'react';
import {
  ChevronRightIcon,
  CloseIcon,
} from '@gitroom/frontend/components/ui/icons';
import { useDialogFocus } from '@gitroom/frontend/components/layout/new-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const BottomSheetHeader: FC<{
  title: ReactNode;
  onClose: () => void;
  titleId?: string;
}> = ({ title, onClose, titleId }) => {
  const t = useT();
  return (
    <>
      <div className="self-center w-[33px] h-[4px] mb-[8px] rounded-[2px] bg-newSep" />
      <div className="flex items-center gap-[8px] h-[60px] mb-[16px] px-[16px]">
        <div id={titleId} className="flex-1 text-[20px] font-[600]">
          {title}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close', 'Close')}
          className="w-[44px] h-[44px] -me-[6px] flex justify-end items-center cursor-pointer text-[#A3A3A3]"
        >
          <CloseIcon />
        </button>
      </div>
    </>
  );
};

export const BottomSheetButton: FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
}> = ({ label, onClick, disabled }) => {
  return (
    <div className="px-[16px] pt-[12px]">
      <button
        disabled={disabled}
        onClick={onClick}
        className="w-full h-[44px] rounded-[10px] bg-btnCta shadow-cta text-btnCtaText text-[15px] font-[600] disabled:bg-btnSimple disabled:text-textItemBlur"
      >
        {label}
      </button>
    </div>
  );
};

// slides up from the bottom of the screen, opened from the mobile layout
export const BottomSheet: FC<{
  title: string;
  onClose: () => void;
  children: ReactNode;
  // the main action under the content, like Done or Save
  button?: { label: string; onClick: () => void; disabled?: boolean };
}> = ({ title, onClose, children, button }) => {
  const titleId = useId();
  const dialog = useDialogFocus();
  // the support chat bubble would cover the sheet button
  useEffect(() => {
    document.querySelector('body')?.classList.add('bottomSheetOpen');
    return () => {
      document.querySelector('body')?.classList.remove('bottomSheetOpen');
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[600] flex flex-col justify-end"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div
        onClick={onClose}
        className="absolute inset-0 bg-popup backdrop-blur-[8px] animate-fadeIn touch-none"
      />
      <div
        ref={dialog.ref}
        onKeyDown={dialog.onKeyDown}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[90%] flex flex-col bg-newBgColorInner rounded-t-[24px] pt-[8px] pb-[24px] animate-fade"
      >
        <BottomSheetHeader title={title} onClose={onClose} titleId={titleId} />
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-[16px] scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner">
          {children}
        </div>
        {button && <BottomSheetButton {...button} />}
      </div>
    </div>
  );
};

export const BottomSheetRow: FC<{
  icon: ReactNode;
  label: string;
  onClick: () => void;
}> = ({ icon, label, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-[12px] py-[8px] min-h-[44px] text-start cursor-pointer select-none"
    >
      <div className="text-[#A3A3A3]">{icon}</div>
      <div className="flex-1 text-[15px] font-[600]">{label}</div>
      <ChevronRightIcon size={20} className="text-[#A3A3A3] rtl:rotate-180" />
    </button>
  );
};
