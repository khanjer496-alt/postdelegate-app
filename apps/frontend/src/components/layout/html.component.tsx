'use client';
import { FC, ReactNode, useEffect, useState } from 'react';
import { useTranslationSettings } from '@gitroom/react/translation/get.transation.service.client';

export const HtmlComponent: FC = () => {
  const settings = useTranslationSettings();
  const [dir, setDir] = useState(settings.dir());

  useEffect(() => {
    settings.on('languageChanged', (lng) => {
      setDir(settings.dir());
    });
  }, []);

  useEffect(() => {
    const htmlElement = document.querySelector('html');
    if (htmlElement) {
      htmlElement.setAttribute('dir', dir);
    }
  }, [dir]);

  // text fields show the focus ring only while the keyboard is in use (global.scss)
  useEffect(() => {
    const html = document.documentElement;
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        html.setAttribute('data-keyboard', '');
      }
    };
    const pointer = () => html.removeAttribute('data-keyboard');
    document.addEventListener('keydown', keyboard, true);
    document.addEventListener('pointerdown', pointer, true);
    return () => {
      document.removeEventListener('keydown', keyboard, true);
      document.removeEventListener('pointerdown', pointer, true);
    };
  }, []);

  return null;
};
