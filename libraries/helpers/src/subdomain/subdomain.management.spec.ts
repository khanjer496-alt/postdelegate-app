import { getAuthCookieOptions, getCookieSameSite } from './subdomain.management';

describe('auth cookie options', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('is Lax when the app and the API share the host', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://app.example.com/api';
    expect(getCookieSameSite()).toBe('lax');
  });

  it('is Lax when the API is a subdomain of the same site', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://api.example.com';
    expect(getCookieSameSite()).toBe('lax');
  });

  it('stays None only when the two are really cross-site', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://api.example.net';
    expect(getCookieSameSite()).toBe('none');
  });

  it('is secure and httpOnly unless NOT_SECURED', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://app.example.com/api';
    delete process.env.NOT_SECURED;
    expect(getAuthCookieOptions()).toEqual({
      domain: '.example.com',
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
    });
    process.env.NOT_SECURED = 'true';
    expect(getAuthCookieOptions()).toEqual({ domain: '.example.com' });
  });
});
