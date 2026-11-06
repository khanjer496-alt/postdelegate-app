import { defaultScheduleValue, isInFuture, localInputToIso, toLocalInputValue } from './schedule';

describe('localInputToIso', () => {
  it('converts local wall-clock time to a UTC ISO string', () => {
    const iso = localInputToIso('2027-03-15T09:30');
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
    const date = new Date(iso as string);
    // reading it back in local time gives the original wall-clock time
    expect([date.getFullYear(), date.getMonth() + 1, date.getDate()]).toEqual([2027, 3, 15]);
    expect([date.getHours(), date.getMinutes()]).toEqual([9, 30]);
    expect(date.getTime()).toBe(new Date(2027, 2, 15, 9, 30).getTime());
  });

  it('round-trips through toLocalInputValue', () => {
    const iso = localInputToIso('2027-12-31T23:59') as string;
    expect(toLocalInputValue(new Date(iso))).toBe('2027-12-31T23:59');
  });

  it('rejects empty, malformed and impossible values', () => {
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('tomorrow')).toBeNull();
    expect(localInputToIso('2027-03-15')).toBeNull();
    expect(localInputToIso('2027-02-31T10:00')).toBeNull();
    expect(localInputToIso('2027-13-01T10:00')).toBeNull();
    expect(localInputToIso('2027-03-15T25:00')).toBeNull();
  });
});

describe('defaultScheduleValue', () => {
  it('suggests the start of the next hour', () => {
    expect(defaultScheduleValue(new Date(2027, 5, 1, 10, 5))).toBe('2027-06-01T11:00');
  });

  it('skips an hour when the next one is less than 15 minutes away', () => {
    expect(defaultScheduleValue(new Date(2027, 5, 1, 10, 50))).toBe('2027-06-01T12:00');
  });

  it('rolls over midnight', () => {
    expect(defaultScheduleValue(new Date(2027, 5, 1, 23, 5))).toBe('2027-06-02T00:00');
  });
});

describe('isInFuture', () => {
  const now = new Date('2027-01-01T10:00:00.000Z');

  it('requires at least a minute of lead time', () => {
    expect(isInFuture('2027-01-01T10:00:30.000Z', now)).toBe(false);
    expect(isInFuture('2027-01-01T10:01:00.000Z', now)).toBe(true);
    expect(isInFuture('2026-12-31T10:00:00.000Z', now)).toBe(false);
  });
});
