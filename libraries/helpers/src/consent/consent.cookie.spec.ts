import {
  buildConsentCookie,
  CONSENT_COOKIE_NAME,
  CONSENT_DAYS,
  hasConsent,
  parseConsent,
  readConsent,
  readCookieValue,
  serializeConsent,
} from './consent.cookie';

describe('consent cookie', () => {
  it('is kept for at most 6 months', () => {
    expect(CONSENT_COOKIE_NAME).toBe('pd_consent');
    expect(CONSENT_DAYS).toBeLessThanOrEqual(183);
  });

  it('reads the per category format', () => {
    expect(parseConsent('v1|ref:1|analytics:0')).toEqual({
      ref: true,
      analytics: false,
    });
    expect(parseConsent('v1|ref:0|analytics:1')).toEqual({
      ref: false,
      analytics: true,
    });
  });

  it('still reads the yes / no of the referral prompt', () => {
    expect(parseConsent('yes')).toEqual({ ref: true, analytics: false });
    expect(parseConsent('no')).toEqual({ ref: false, analytics: false });
  });

  it('treats a missing category as off and ignores unknown ones', () => {
    expect(parseConsent('v1|ref:1')).toEqual({ ref: true, analytics: false });
    expect(parseConsent('v1|ads:1|ref:1')).toEqual({
      ref: true,
      analytics: false,
    });
    expect(parseConsent('v1|ref:yes')).toEqual({ ref: false, analytics: false });
  });

  it.each([undefined, null, '', 'YES', '1', 'v2|ref:1', 'v0|ref:1', 'ref:1'])(
    'asks again for %p',
    (value) => {
      expect(parseConsent(value as any)).toBeUndefined();
    }
  );

  it('writes what it reads', () => {
    const value = serializeConsent({ ref: true, analytics: false });
    expect(value).toBe('v1|ref:1|analytics:0');
    expect(parseConsent(value)).toEqual({ ref: true, analytics: false });
  });

  it('reads one cookie out of document.cookie', () => {
    const cookies = 'showorg=o1; pd_ref=friend.1; pd_consent=v1|ref:1|analytics:0';
    expect(readCookieValue(cookies, 'pd_ref')).toBe('friend.1');
    expect(readCookieValue(cookies, 'missing')).toBeUndefined();
    expect(readCookieValue('xpd_ref=1', 'pd_ref')).toBeUndefined();
    expect(readConsent(cookies)).toEqual({ ref: true, analytics: false });
  });

  it('allows nothing optional until the visitor chose', () => {
    expect(hasConsent('ref', '')).toBe(false);
    expect(hasConsent('analytics', 'pd_consent=yes')).toBe(false);
    expect(hasConsent('ref', 'pd_consent=no')).toBe(false);
    expect(hasConsent('ref', 'a=1; pd_consent=v1|ref:1|analytics:0')).toBe(true);
    expect(hasConsent('analytics', 'pd_consent=v1|ref:0|analytics:1')).toBe(
      true
    );
  });

  it('builds a 6 month cookie, shared only when a domain is given', () => {
    const shared = buildConsentCookie(
      { ref: true, analytics: false },
      '.postdelegate.com',
      true
    );
    expect(shared).toBe(
      'pd_consent=v1|ref:1|analytics:0; max-age=15552000; path=/; samesite=lax; secure; domain=.postdelegate.com'
    );
    expect(
      buildConsentCookie({ ref: false, analytics: false }, '', false)
    ).toBe('pd_consent=v1|ref:0|analytics:0; max-age=15552000; path=/; samesite=lax');
  });
});
