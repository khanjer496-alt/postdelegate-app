import {
  AFFILIATE_CODE_REGEX,
  buildAffiliateCookieValue,
  parseAffiliateCookieValue,
} from './affiliate.cookie';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 30, 12);

describe('affiliate cookie', () => {
  it('reads back the code it wrote', () => {
    const value = buildAffiliateCookieValue('Friend-1', NOW);
    expect(value).toBe(`friend-1.${NOW}`);
    expect(parseAffiliateCookieValue(value, 60, NOW + DAY)).toBe('friend-1');
  });

  it('accepts a cookie right before the window ends', () => {
    const value = buildAffiliateCookieValue('abc23', NOW);
    expect(parseAffiliateCookieValue(value, 60, NOW + 60 * DAY)).toBe('abc23');
  });

  it('rejects an expired cookie', () => {
    const value = buildAffiliateCookieValue('abc23', NOW);
    expect(
      parseAffiliateCookieValue(value, 60, NOW + 60 * DAY + 1)
    ).toBeUndefined();
  });

  it('follows the configured number of days', () => {
    const value = buildAffiliateCookieValue('abc23', NOW);
    expect(parseAffiliateCookieValue(value, 7, NOW + 8 * DAY)).toBeUndefined();
    expect(parseAffiliateCookieValue(value, 90, NOW + 80 * DAY)).toBe('abc23');
  });

  it.each([
    undefined,
    '',
    'abc23',
    '.123',
    'abc23.',
    'abc23.notanumber',
    'a.1',
    'UPPER.1',
    '-bad.1',
    'bad code.1',
  ])('rejects the malformed value %p', (value) => {
    expect(parseAffiliateCookieValue(value as any, 60, NOW)).toBeUndefined();
  });

  it('rejects a timestamp from the future', () => {
    expect(
      parseAffiliateCookieValue(`abc23.${NOW + 5 * DAY}`, 60, NOW)
    ).toBeUndefined();
  });

  it('defines the code shape', () => {
    expect(AFFILIATE_CODE_REGEX.test('abc')).toBe(true);
    expect(AFFILIATE_CODE_REGEX.test('ab')).toBe(false);
    expect(AFFILIATE_CODE_REGEX.test('a'.repeat(24))).toBe(true);
    expect(AFFILIATE_CODE_REGEX.test('a'.repeat(25))).toBe(false);
    expect(AFFILIATE_CODE_REGEX.test('my-code')).toBe(true);
    expect(AFFILIATE_CODE_REGEX.test('My-code')).toBe(false);
    expect(AFFILIATE_CODE_REGEX.test('my_code')).toBe(false);
  });
});
