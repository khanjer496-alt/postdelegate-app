'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useHotkeys } from 'react-hotkeys-hook';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useHasOpenModal } from '@gitroom/frontend/components/layout/new-modal';

// the menu (and the composer it can open) loads on first use only
const CommandPaletteDialog = dynamic(
  () =>
    import('@gitroom/frontend/components/layout/command.palette.dialog').then(
      (p) => p.CommandPaletteDialog
    ),
  { ssr: false }
);

export const CommandPalette: FC = () => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const isMac = useMemo(
    () =>
      typeof navigator !== 'undefined' &&
      /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent),
    []
  );

  // not on top of an open modal (the composer, a dialog...)
  const modalOpen = useHasOpenModal();
  useHotkeys('mod+k', () => setOpen((value) => !value), {
    enabled: !modalOpen,
    enableOnFormTags: true,
    preventDefault: true,
  });

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      {/* the negative margin keeps the top-bar icons row at its own height */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
        aria-label={t('quick_menu_open', 'Search and quick actions')}
        className="flex items-center self-center gap-[8px] h-[32px] -my-[4px] ps-[10px] pe-[6px] rounded-[8px] bg-btnSimple text-textItemBlur hover:text-newTextColor transition-colors outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary mobile:w-[40px] mobile:h-[40px] mobile:my-0 mobile:p-0 mobile:justify-center mobile:bg-transparent mobile:hover:bg-boxFocused"
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <span className="text-[13px] tablet:hidden">
          {t('quick_menu_search', 'Search')}
        </span>
        <kbd className="mobile:hidden font-sans text-[11px] leading-none px-[6px] py-[4px] rounded-[5px] border border-newTableBorder bg-newBgColorInner">
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </button>
      {open && <CommandPaletteDialog onClose={close} />}
    </>
  );
};
