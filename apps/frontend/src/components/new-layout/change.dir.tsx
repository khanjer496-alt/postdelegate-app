'use client';

import useCookie from 'react-use-cookie';
import {
  cookieName,
  normalizeLanguage,
} from '@gitroom/react/translation/i18n.config';
import i18next from 'i18next';
import { FC, useEffect } from 'react';

export const ChangeDir: FC = () => {
  const currentLanguage = normalizeLanguage(i18next.resolvedLanguage);
  const [language, setLanguage] = useCookie(cookieName, currentLanguage);

  useEffect(() => {
    const nextLanguage = normalizeLanguage(language);
    if (language !== nextLanguage) {
      setLanguage(nextLanguage);
    }
    const dir = nextLanguage === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('dir', dir);
  }, [language, setLanguage]);

  return null;
};
