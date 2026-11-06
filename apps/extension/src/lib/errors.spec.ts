import { PostDelegateError } from '@postdelegate/node';
import { mapApiError } from './errors';

const apiError = (status: number, message = 'server said no') =>
  new PostDelegateError(message, status, { msg: message });

describe('mapApiError', () => {
  it('maps 401 to a reconnect prompt', () => {
    const mapped = mapApiError(apiError(401, 'Unauthorized'));
    expect(mapped.kind).toBe('auth');
    expect(mapped.reconnect).toBe(true);
    expect(mapped.message).toMatch(/reconnect/i);
  });

  it('maps 429 to a rate limit message without forcing a reconnect', () => {
    const mapped = mapApiError(apiError(429));
    expect(mapped.kind).toBe('rate_limit');
    expect(mapped.reconnect).toBe(false);
    expect(mapped.message).toMatch(/rate limit/i);
  });

  it('keeps the server detail for 403 plan and permission errors', () => {
    const mapped = mapApiError(apiError(403, 'limit reached'));
    expect(mapped.kind).toBe('forbidden');
    expect(mapped.message).toContain('limit reached');
  });

  it('shows validation messages from the API as they are', () => {
    const mapped = mapApiError(apiError(400, 'x: post is too long, please fix it'));
    expect(mapped.kind).toBe('validation');
    expect(mapped.message).toBe('x: post is too long, please fix it');
  });

  it('hides server internals on 5xx', () => {
    const mapped = mapApiError(apiError(502, '<html>Bad gateway</html>'));
    expect(mapped.kind).toBe('server');
    expect(mapped.message).not.toContain('html');
  });

  it('maps fetch failures to a network message', () => {
    const mapped = mapApiError(new TypeError('Failed to fetch'));
    expect(mapped.kind).toBe('network');
    expect(mapped.message).toMatch(/internet connection/i);
  });

  it('falls back for unknown errors', () => {
    expect(mapApiError(new Error('boom')).message).toBe('boom');
    expect(mapApiError('weird').kind).toBe('unknown');
    expect(mapApiError(undefined).message).toMatch(/try again/i);
  });
});
