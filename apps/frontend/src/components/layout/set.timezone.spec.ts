import dayjs from 'dayjs';
import {
  browserTimezone,
  fromUtc,
  getTimezone,
  newDayjs,
  setUserTimezone,
  timezoneOffset,
} from '@gitroom/frontend/components/layout/set.timezone';

// what the composer does with a picked date and time: the picker's wall clock
// is placed in the user's timezone (date.picker.tsx), the modal sends it as a
// UTC string without the Z (manage.modal.tsx) and the backend, which runs on
// UTC, stores dayjs(date).toDate() (posts.repository.ts)
const schedule = (picked: string) => {
  const sent = newDayjs(picked).utc().format('YYYY-MM-DDTHH:mm:ss');
  return { sent, stored: dayjs.utc(sent).toISOString() };
};

// Jest can't change the machine timezone (process.env.TZ is a copy inside a
// test), so every expectation is an absolute instant: CI runs these on UTC and
// a laptop on its own timezone, and both must get the same results
describe('set.timezone', () => {
  afterEach(() => {
    setUserTimezone(null);
    jest.restoreAllMocks();
  });

  describe('scheduling from the composer', () => {
    it('uses the device timezone when the setting is Automatic', () => {
      // the tester: no saved timezone, so 14:00 is 14:00 on the device. On a
      // UTC browser that is 14:00 UTC, which is 18:00 for a teammate in Dubai
      setUserTimezone(null);
      expect(getTimezone()).toBe(browserTimezone());
      expect(schedule('2026-11-03 14:00:00').stored).toBe(
        new Date(2026, 10, 3, 14).toISOString()
      );
    });

    it('uses the saved timezone, not the device one, when one is saved', () => {
      setUserTimezone('Asia/Dubai');
      expect(getTimezone()).toBe('Asia/Dubai');
      const { sent, stored } = schedule('2026-11-03 14:00:00');
      expect(sent).toBe('2026-11-03T10:00:00');
      expect(stored).toBe('2026-11-03T10:00:00.000Z');
      // the calendar shows the stored post back at the picked time
      expect(fromUtc(stored).format('YYYY-MM-DD HH:mm')).toBe(
        '2026-11-03 14:00'
      );
    });

    it('round trips a saved timezone far from the device', () => {
      setUserTimezone('Pacific/Auckland');
      const { stored } = schedule('2026-11-03 09:15:00');
      // NZDT is UTC+13, so this is the day before in UTC
      expect(stored).toBe('2026-11-02T20:15:00.000Z');
      expect(fromUtc(stored).format('YYYY-MM-DD HH:mm')).toBe(
        '2026-11-03 09:15'
      );
    });

    it('moves a time skipped by DST forward, like a local date', () => {
      setUserTimezone('America/New_York');
      // 02:30 doesn't exist on 8 March in New York, it is 03:30 EDT
      expect(schedule('2026-03-08 02:30:00').stored).toBe(
        '2026-03-08T07:30:00.000Z'
      );
      // the day after the change uses the summer offset
      expect(schedule('2026-03-09 09:00:00').stored).toBe(
        '2026-03-09T13:00:00.000Z'
      );
    });

    it('takes the earlier instant for a time repeated by DST', () => {
      setUserTimezone('America/New_York');
      expect(schedule('2026-11-01 01:30:00').stored).toBe(
        '2026-11-01T05:30:00.000Z'
      );
      expect(schedule('2026-11-02 09:00:00').stored).toBe(
        '2026-11-02T14:00:00.000Z'
      );
    });

    it('sends the instant, not the wall clock, as an ISO date', () => {
      // bulk videos sends the start with toISOString()
      setUserTimezone('Asia/Dubai');
      expect(newDayjs('2026-11-03 14:00:00').toISOString()).toBe(
        '2026-11-03T10:00:00.000Z'
      );
    });
  });

  describe('device and saved timezone', () => {
    // a device on `timezone`: formatters without an explicit timeZone use it,
    // explicit ones keep theirs, like a browser
    const device = (timezone: string) => {
      const Real = Intl.DateTimeFormat;
      jest
        .spyOn(Intl, 'DateTimeFormat')
        .mockImplementation(
          (locales?: string | string[], options?: Intl.DateTimeFormatOptions) =>
            new Real(locales, { timeZone: timezone, ...options })
        );
    };

    it('tells a saved timezone apart from the device one', () => {
      device('UTC');
      setUserTimezone('Asia/Dubai');
      expect(browserTimezone()).toBe('UTC');
      expect(getTimezone()).toBe('Asia/Dubai');
    });

    it('treats a saved timezone that is the device one as the same', () => {
      device('Asia/Dubai');
      setUserTimezone('Asia/Dubai');
      expect(getTimezone()).toBe(browserTimezone());
    });

    it('treats an alias of the device timezone as the same', () => {
      // Chrome reports the old name Asia/Calcutta; Settings offers Asia/Kolkata
      device('Asia/Calcutta');
      setUserTimezone('Asia/Kolkata');
      expect(getTimezone()).toBe(browserTimezone());
    });

    it('ignores a saved name that is not a timezone', () => {
      device('UTC');
      setUserTimezone('Europe/Nowhere');
      expect(getTimezone()).toBe('UTC');
    });
  });

  describe('timezoneOffset', () => {
    it('labels whole and partial hour offsets', () => {
      const at = Date.UTC(2026, 10, 3, 12);
      expect(timezoneOffset('Asia/Dubai', at)).toBe('UTC+4');
      expect(timezoneOffset('UTC', at)).toBe('UTC+0');
      expect(timezoneOffset('Asia/Kolkata', at)).toBe('UTC+5:30');
      expect(timezoneOffset('Asia/Kathmandu', at)).toBe('UTC+5:45');
      expect(timezoneOffset('America/St_Johns', at)).toBe('UTC-3:30');
    });

    it('follows DST', () => {
      expect(timezoneOffset('Europe/London', Date.UTC(2026, 0, 15))).toBe(
        'UTC+0'
      );
      expect(timezoneOffset('Europe/London', Date.UTC(2026, 6, 15))).toBe(
        'UTC+1'
      );
      expect(timezoneOffset('America/New_York', Date.UTC(2026, 6, 15))).toBe(
        'UTC-4'
      );
    });
  });
});
