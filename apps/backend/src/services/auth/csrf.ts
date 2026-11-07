import { Request } from 'express';

const safeMethods = ['GET', 'HEAD', 'OPTIONS'];

const toOrigin = (value?: string) => {
  try {
    const url = new URL(value!);
    return url.origin === 'null' ? undefined : url.origin;
  } catch (err) {
    return undefined;
  }
};

// The origins allowed to send state changing requests that carry the auth
// cookie: the app itself (FRONTEND_URL, MAIN_URL as the CORS list does) plus
// CSRF_TRUSTED_ORIGINS (comma separated) for anything else you serve the app on
export const getTrustedOrigins = () =>
  [
    process.env.FRONTEND_URL,
    process.env.MAIN_URL,
    ...(process.env.CSRF_TRUSTED_ORIGINS || '').split(','),
  ]
    .map((origin) => toOrigin(origin?.trim()))
    .filter((origin): origin is string => !!origin);

// Cookies are sent by the browser on whatever site triggers the request, so a
// POST/PUT/PATCH/DELETE that is authenticated by the auth cookie has to come
// from our own origin. Requests authenticated by the `auth` header (the web
// app server side, NOT_SECURED mode) are not affected: another site can not
// set that header. Returns true when the request must be rejected
export const isCrossSiteCookieRequest = (req: Request) => {
  if (safeMethods.includes(req.method.toUpperCase())) {
    return false;
  }

  if (req.headers.auth) {
    return false;
  }

  // browsers always send Origin on a cross-origin POST, Referer is the
  // fallback for the ones that don't
  const origin = req.headers.origin
    ? toOrigin(String(req.headers.origin))
    : toOrigin(req.headers.referer as string | undefined);

  return !origin || !getTrustedOrigins().includes(origin);
};
