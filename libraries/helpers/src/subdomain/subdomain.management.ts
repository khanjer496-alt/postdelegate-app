import { parse } from 'tldts';

export function getCookieUrlFromDomain(domain: string) {
  const url = parse(domain);
  return url.domain! ? '.' + url.domain! : url.hostname!;
}

// SameSite for the auth, showorg and impersonate cookies. When the app and the
// API live on the same site (app.example.com and app.example.com/api, or
// api.example.com) the cookie is Lax, so a form posted from another site
// never carries it. None is only kept when the two are genuinely cross-site
export function getCookieSameSite(): 'lax' | 'none' {
  const frontend = parse(process.env.FRONTEND_URL || '');
  const backend = parse(process.env.NEXT_PUBLIC_BACKEND_URL || '');
  const frontendSite = frontend.domain || frontend.hostname;
  const backendSite = backend.domain || backend.hostname;

  return frontendSite && backendSite && frontendSite !== backendSite
    ? 'none'
    : 'lax';
}

// Options of the cookies that carry a login (auth, showorg, impersonate)
export function getAuthCookieOptions() {
  return {
    domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
    ...(!process.env.NOT_SECURED
      ? {
          secure: true,
          httpOnly: true,
          sameSite: getCookieSameSite(),
        }
      : {}),
  };
}
