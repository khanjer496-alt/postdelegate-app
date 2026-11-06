export const fallbackLng = 'en';
export const languages = [
  fallbackLng,
  'ru',
  'zh',
  'fr',
  'es',
  'pt',
  'de',
  'it',
  'ja',
  'ko',
  'ar',
  'tr',
  'vi',
];

export const normalizeLanguage = (language?: string | null) => {
  const baseLanguage = language?.trim().toLowerCase().split(/[-_]/)[0];
  return baseLanguage && languages.includes(baseLanguage)
    ? baseLanguage
    : fallbackLng;
};

export const defaultNS = 'translation';
export const cookieName = 'i18next';
export const headerName = 'x-i18next-current-language';
