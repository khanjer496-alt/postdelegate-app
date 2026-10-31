// The first-party cookie that carries the referral code from the landing page
// to the registration. Written by the frontend, read by the backend.
export const AFFILIATE_COOKIE_NAME = 'pd_ref';
export const DEFAULT_AFFILIATE_COOKIE_DAYS = 60;

// 3 to 24 characters, lowercase letters, digits and hyphens, no leading hyphen
export const AFFILIATE_CODE_REGEX = /^[a-z0-9][a-z0-9-]{2,23}$/;

const DAY = 24 * 60 * 60 * 1000;

// The value is "<code>.<unix ms>", the time lets the server enforce the
// attribution window on its own instead of trusting the browser expiry
export const buildAffiliateCookieValue = (code: string, now = Date.now()) =>
  `${code.toLowerCase()}.${now}`;

export const parseAffiliateCookieValue = (
  value: string | undefined | null,
  maxAgeDays: number,
  now = Date.now()
): string | undefined => {
  if (!value || typeof value !== 'string') {
    return undefined;
  }

  const separator = value.lastIndexOf('.');
  if (separator < 1) {
    return undefined;
  }

  const code = value.slice(0, separator);
  const issuedAt = Number(value.slice(separator + 1));
  if (
    !AFFILIATE_CODE_REGEX.test(code) ||
    !Number.isFinite(issuedAt) ||
    issuedAt > now + DAY ||
    now - issuedAt > maxAgeDays * DAY
  ) {
    return undefined;
  }

  return code;
};
