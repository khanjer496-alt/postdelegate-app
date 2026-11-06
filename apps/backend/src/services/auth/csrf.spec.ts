import { isCrossSiteCookieRequest } from './csrf';

const request = (method: string, headers: Record<string, string> = {}) =>
  ({ method, headers } as any);

describe('isCrossSiteCookieRequest', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    delete process.env.MAIN_URL;
    delete process.env.CSRF_TRUSTED_ORIGINS;
  });
  afterAll(() => {
    process.env = env;
  });

  it('never blocks reads', () => {
    expect(
      isCrossSiteCookieRequest(
        request('GET', { origin: 'https://evil.example.org' })
      )
    ).toBe(false);
    expect(isCrossSiteCookieRequest(request('OPTIONS'))).toBe(false);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'blocks a cross-site %s',
    (method) => {
      expect(
        isCrossSiteCookieRequest(
          request(method, { origin: 'https://evil.example.org' })
        )
      ).toBe(true);
    }
  );

  it('blocks a null origin (sandboxed iframe or redirect) and a lookalike', () => {
    expect(isCrossSiteCookieRequest(request('POST', { origin: 'null' }))).toBe(
      true
    );
    expect(
      isCrossSiteCookieRequest(
        request('POST', { origin: 'https://app.example.com.evil.org' })
      )
    ).toBe(true);
    expect(
      isCrossSiteCookieRequest(
        request('POST', { origin: 'http://app.example.com' })
      )
    ).toBe(true);
  });

  it('allows the frontend origin', () => {
    expect(
      isCrossSiteCookieRequest(
        request('POST', { origin: 'https://app.example.com' })
      )
    ).toBe(false);
  });

  it('falls back to the referer when there is no origin', () => {
    expect(
      isCrossSiteCookieRequest(
        request('POST', { referer: 'https://app.example.com/launches?x=1' })
      )
    ).toBe(false);
    expect(
      isCrossSiteCookieRequest(
        request('POST', { referer: 'https://evil.example.org/form' })
      )
    ).toBe(true);
  });

  it('blocks a write that tells nothing about where it came from', () => {
    expect(isCrossSiteCookieRequest(request('POST'))).toBe(true);
  });

  it('ignores the referer when an origin is present', () => {
    expect(
      isCrossSiteCookieRequest(
        request('POST', {
          origin: 'https://evil.example.org',
          referer: 'https://app.example.com/',
        })
      )
    ).toBe(true);
  });

  it('does not apply to requests authenticated by the auth header', () => {
    expect(
      isCrossSiteCookieRequest(request('POST', { auth: 'token' }))
    ).toBe(false);
  });

  it('accepts MAIN_URL and the extra trusted origins', () => {
    process.env.MAIN_URL = 'https://www.example.com';
    process.env.CSRF_TRUSTED_ORIGINS =
      ' https://staging.example.com/ , https://other.example.net ';
    for (const origin of [
      'https://www.example.com',
      'https://staging.example.com',
      'https://other.example.net',
    ]) {
      expect(isCrossSiteCookieRequest(request('POST', { origin }))).toBe(false);
    }
  });
});
