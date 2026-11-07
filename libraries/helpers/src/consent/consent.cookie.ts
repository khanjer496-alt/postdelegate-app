// The visitor's cookie choices, shared by the marketing site and the app.
// Nothing outside "Strictly necessary" is stored, or loaded, before the
// matching category is switched on. The cookie only remembers the choice, so
// it is strictly necessary itself, and it is kept for 6 months (CNIL).
// Format: "v1|ref:1|analytics:0". The plain "yes" / "no" of the first version
// only answered the referral question and still counts as that.
// Raise CONSENT_VERSION when a category is added that people never saw, so
// everyone is asked again.
export const CONSENT_COOKIE_NAME = 'pd_consent';
export const CONSENT_DAYS = 180;
export const CONSENT_VERSION = 1;
export const CONSENT_CHANGE_EVENT = 'pd-consent-change';
export const COOKIE_SETTINGS_EVENT = 'pd-cookie-settings';

export const CONSENT_CATEGORIES = ['ref', 'analytics'] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];
export type ConsentChoices = Record<ConsentCategory, boolean>;

export const NO_CONSENT: ConsentChoices = { ref: false, analytics: false };

export const parseConsent = (
  value: string | undefined | null
): ConsentChoices | undefined => {
  if (value === 'yes' || value === 'no') {
    return { ...NO_CONSENT, ref: value === 'yes' };
  }

  const [version, ...parts] = (value || '').split('|');
  if (version !== `v${CONSENT_VERSION}`) {
    return undefined;
  }

  const choices = { ...NO_CONSENT };
  for (const part of parts) {
    const [name, flag] = part.split(':');
    if ((CONSENT_CATEGORIES as readonly string[]).includes(name)) {
      choices[name as ConsentCategory] = flag === '1';
    }
  }
  return choices;
};

export const serializeConsent = (choices: ConsentChoices) =>
  [
    `v${CONSENT_VERSION}`,
    ...CONSENT_CATEGORIES.map((name) => `${name}:${choices[name] ? 1 : 0}`),
  ].join('|');

// One value out of a document.cookie string
export const readCookieValue = (cookies: string, name: string) =>
  cookies
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
    ?.slice(name.length + 1);

export const readConsent = (cookies: string) =>
  parseConsent(readCookieValue(cookies, CONSENT_COOKIE_NAME));

// The one check every optional cookie, storage or script goes through
export const hasConsent = (
  category: ConsentCategory,
  cookies = typeof document === 'undefined' ? '' : document.cookie
) => !!readConsent(cookies)?.[category];

// domain: ".postdelegate.com" to share the choice with the marketing site,
// empty for a cookie on this host only (staging, self-hosted)
export const buildConsentCookie = (
  choices: ConsentChoices,
  domain: string,
  secure: boolean
) =>
  `${CONSENT_COOKIE_NAME}=${serializeConsent(choices)}; max-age=${
    CONSENT_DAYS * 24 * 60 * 60
  }; path=/; samesite=lax${secure ? '; secure' : ''}${
    domain ? `; domain=${domain}` : ''
  }`;

export const saveConsent = (choices: ConsentChoices, domain: string) => {
  document.cookie = buildConsentCookie(
    choices,
    domain,
    window.location.protocol === 'https:'
  );
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT));
};

// Opens the cookie banner on its settings view, from a footer or settings link
export const openCookieSettings = () =>
  window.dispatchEvent(new CustomEvent(COOKIE_SETTINGS_EVENT));
