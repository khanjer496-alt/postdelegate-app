import { FC, useCallback, useState } from 'react';
import dayjs from 'dayjs';
import clsx from 'clsx';
import Link from 'next/link';
import { Calendar, TimeInput } from '@mantine/dates';
import { useClickOutside } from '@mantine/hooks';
import { Button } from '@gitroom/react/form/button';
import { isUSCitizen } from './isuscitizen.utils';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  browserTimezone,
  getTimezone,
  newDayjs,
  timezoneOffset,
  toPickerDate,
} from '@gitroom/frontend/components/layout/set.timezone';
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DropdownArrowIcon,
} from '@gitroom/frontend/components/ui/icons';

// The timezone times are picked and shown in, with a link to change it, and a
// notice when the device is on another one (a teammate's browser on UTC while
// their saved timezone is Asia/Dubai). The link opens a new tab from a modal,
// so a post being written isn't lost.
export const TimezoneHint: FC<{
  // the offset at this instant, for a date across a DST change
  at?: number;
  newTab?: boolean;
  className?: string;
}> = ({ at, newTab, className }) => {
  const t = useT();
  const timezone = getTimezone();
  const device = browserTimezone();
  const values = {
    timezone,
    device,
    offset: timezoneOffset(timezone, at),
    interpolation: { escapeValue: false },
  };

  return (
    <div
      className={clsx(
        // the date button around the popover is bold and doesn't wrap
        'text-[12px] font-[400] whitespace-normal text-start text-newTextColor/60 flex flex-col gap-[2px]',
        className
      )}
    >
      <div>
        {device === timezone
          ? t(
              'times_in_device_timezone',
              "Times in {{timezone}} ({{offset}}), your device's timezone",
              values
            )
          : t(
              'times_in_timezone',
              'Times in {{timezone}} ({{offset}})',
              values
            )}{' '}
        <Link
          href="/settings?tab=global_settings"
          {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="underline hover:text-textItemFocused"
        >
          {t('change_timezone', 'Change')}
          {newTab && (
            <span className="sr-only">
              {' '}
              ({t('opens_in_new_tab', 'opens in a new tab')})
            </span>
          )}
        </Link>
      </div>
      {device !== timezone && (
        <div>
          {t(
            'device_timezone_differs',
            'Your device is on {{device}}; posts use {{timezone}}',
            values
          )}
        </div>
      )}
    </div>
  );
};

// one part of the time in the mobile sheet, typed or stepped with the arrows
const TimeField: FC<{
  value: number;
  min: number;
  max: number;
  pad?: boolean;
  onChange: (value: number) => void;
}> = ({ value, min, max, pad, onChange }) => {
  const [text, setText] = useState<string | null>(null);
  const format = (num: number) =>
    pad ? String(num).padStart(2, '0') : String(num);
  const step = (delta: number) => () => {
    const range = max - min + 1;
    onChange(((value - min + delta + range) % range) + min);
  };

  return (
    <div className="w-[74px] min-w-[56px] flex flex-col items-center gap-[4px] text-textItemBlur">
      <div onClick={step(1)} className="cursor-pointer">
        <DropdownArrowIcon rotated={true} />
      </div>
      <input
        value={text ?? format(value)}
        placeholder={format(value)}
        inputMode="numeric"
        maxLength={2}
        onFocus={() => setText('')}
        onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
        onBlur={() => {
          const num = parseInt(text || '', 10);
          if (!isNaN(num)) {
            onChange(Math.min(max, Math.max(min, num)));
          }
          setText(null);
        }}
        className="w-full h-[52px] rounded-[10px] border border-newColColor focus:border-btnPrimary bg-newBgColorInner text-center text-[14px] text-textColor outline-none"
      />
      <div onClick={step(-1)} className="cursor-pointer">
        <DropdownArrowIcon />
      </div>
    </div>
  );
};

// the calendar and the time, in the desktop popover or in the mobile sheet
export const DatePickerPanel: FC<{
  date: dayjs.Dayjs;
  onChange: (day: dayjs.Dayjs) => void;
  sheet?: boolean;
}> = (props) => {
  const { date, onChange, sheet } = props;
  const t = useT();
  const [month, setMonth] = useState(toPickerDate(date));

  // the pickers give machine-local dates, so their wall clock is read with
  // plain dayjs and then placed in the user's timezone
  const changeDate = useCallback(
    (type: 'date' | 'time') => (day: Date) => {
      onChange(
        newDayjs(
          type === 'time'
            ? date.format('YYYY-MM-DD') + ' ' + dayjs(day).format('HH:mm:ss')
            : dayjs(day).format('YYYY-MM-DD') + ' ' + date.format('HH:mm:ss')
        )
      );
    },
    [date]
  );

  const changeTime = useCallback(
    (hour: number, minute: number) => {
      onChange(
        newDayjs(
          date.format('YYYY-MM-DD') +
            ' ' +
            [hour, minute, 0].map((p) => String(p).padStart(2, '0')).join(':')
        )
      );
    },
    [date]
  );

  if (sheet) {
    const twelveHours = isUSCitizen();
    const pm = date.hour() >= 12;
    return (
      <div className="flex flex-col">
        <div className="flex items-center gap-[16px] mb-[12px]">
          <div className="w-[55px] text-[15px] font-[600]">
            {t('date', 'Date')}
          </div>
          <div className="flex-1 h-[52px] px-[16px] flex items-center rounded-[10px] border border-newColColor bg-newBgColorInner text-[14px]">
            {date.format('ddd, D MMMM')}
          </div>
        </div>
        <div className="bg-newSettings rounded-[12px] px-[16px] py-[12px] mb-[24px]">
          <div className="flex items-center gap-[8px] mb-[12px]">
            <div className="flex-1 text-[15px] font-[600]">
              {dayjs(month).format('MMMM, YYYY')}
            </div>
            <div
              onClick={() =>
                setMonth(dayjs(month).subtract(1, 'month').toDate())
              }
              className="w-[32px] h-[32px] flex justify-center items-center cursor-pointer text-textItemBlur"
            >
              <ChevronLeftIcon
                size={20}
                strokeWidth={1.8}
                className="rtl:rotate-180"
              />
            </div>
            <div
              onClick={() => setMonth(dayjs(month).add(1, 'month').toDate())}
              className="w-[32px] h-[32px] flex justify-center items-center cursor-pointer text-textItemBlur"
            >
              <ChevronRightIcon
                size={20}
                strokeWidth={1.8}
                className="rtl:rotate-180"
              />
            </div>
          </div>
          <Calendar
            fullWidth={true}
            locale={dayjs.locale()}
            month={month}
            onMonthChange={setMonth}
            onChange={(day) => {
              setMonth(day);
              changeDate('date')(day);
            }}
            value={toPickerDate(date)}
            dayClassName={(day, modifiers) =>
              clsx(
                '!w-full !max-w-[40px] !h-[40px] !leading-[40px] !rounded-[8px] !text-[14px]',
                modifiers.selected
                  ? '!bg-boxFocused !text-textItemFocused !font-[600] !outline-none'
                  : modifiers.outside
                  ? '!text-newTextColor/20 !font-[400]'
                  : dayjs(day).isSame(toPickerDate(newDayjs()), 'day')
                  ? '!text-[#FC69FF] !font-[600]'
                  : '!text-textItemBlur !font-[400]'
              )
            }
            classNames={{
              calendarHeader: '!hidden',
              cell: '!py-[4px] !border-t-0 text-center',
              day: 'hover:bg-boxHover',
              weekday: '!text-[15px] !font-[600] !text-textItemBlur',
              weekdayCell: '!pb-[4px] !h-[39px]',
            }}
          />
        </div>
        <div className="flex items-center gap-[16px]">
          <div className="w-[55px] text-[15px] font-[600]">
            {t('time', 'Time')}
          </div>
          <div className="flex items-center gap-[12px] min-w-0">
            <div className="flex rtl:flex-row-reverse items-center gap-[4px] min-w-0">
              {twelveHours ? (
                <TimeField
                  value={date.hour() % 12 || 12}
                  min={1}
                  max={12}
                  onChange={(hour) =>
                    changeTime((hour % 12) + (pm ? 12 : 0), date.minute())
                  }
                />
              ) : (
                <TimeField
                  value={date.hour()}
                  min={0}
                  max={23}
                  pad={true}
                  onChange={(hour) => changeTime(hour, date.minute())}
                />
              )}
              <div className="text-[14px] font-[600]">:</div>
              <TimeField
                value={date.minute()}
                min={0}
                max={59}
                pad={true}
                onChange={(minute) => changeTime(date.hour(), minute)}
              />
            </div>
            {twelveHours && (
              <div className="h-[52px] flex gap-[3px] p-[4px] rounded-[8px] border border-newColColor bg-newBgColorInner">
                {[false, true].map((isPm) => (
                  <div
                    key={String(isPm)}
                    onClick={() =>
                      changeTime(
                        (date.hour() % 12) + (isPm ? 12 : 0),
                        date.minute()
                      )
                    }
                    className={clsx(
                      'w-[44px] h-[44px] flex justify-center items-center rounded-[6px] text-[14px] cursor-pointer select-none',
                      isPm === pm
                        ? 'bg-boxFocused text-textItemFocused'
                        : 'text-textItemBlur'
                    )}
                  >
                    {isPm ? 'pm' : 'am'}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <TimezoneHint at={date.valueOf()} newTab={true} className="mt-[16px]" />
      </div>
    );
  }

  return (
    <>
      <Calendar
        onChange={changeDate('date')}
        value={toPickerDate(date)}
        dayClassName={(date, modifiers) => {
          if (modifiers.weekend) {
            return '!text-customColor28';
          }
          if (modifiers.outside) {
            return '!text-gray';
          }
          if (modifiers.selected) {
            return '!text-white !bg-seventh !outline-none';
          }
          return '!text-textColor';
        }}
        classNames={{
          day: 'hover:bg-seventh',
          calendarHeaderControl: 'text-textColor hover:bg-third',
          calendarHeaderLevel: 'text-textColor hover:bg-third', // cell: 'child:!text-textColor'
        }}
      />
      <TimeInput
        onChange={changeDate('time')}
        format={isUSCitizen() ? '12' : '24'}
        label="Pick time"
        classNames={{
          label: 'text-textColor py-[12px]',
          input:
            'bg-sixth h-[40px] border border-tableBorder text-textColor rounded-[4px] outline-none',
        }}
        defaultValue={toPickerDate(date)}
      />
      {/* as wide as the calendar, long timezone names wrap */}
      <TimezoneHint
        at={date.valueOf()}
        newTab={true}
        className="mt-[12px] w-0 min-w-full"
      />
    </>
  );
};

export const DatePicker: FC<{
  date: dayjs.Dayjs;
  onChange: (day: dayjs.Dayjs) => void;
  // opens a picker somewhere else instead of the popover
  onOpen?: () => void;
}> = (props) => {
  const { date, onChange, onOpen } = props;
  const [open, setOpen] = useState(false);
  const t = useT();

  const changeShow = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);
  const ref = useClickOutside<HTMLDivElement>(() => {
    setOpen(false);
  });
  return (
    <div
      className="px-[16px] border border-newTextColor/10 mobile:border-newTextColor/[0.08] rounded-[8px] mobile:rounded-[6px] justify-center flex gap-[8px] items-center relative h-[44px] mobile:h-[34px] text-[15px] mobile:text-[13px] whitespace-nowrap font-[600] ml-[7px] mobile:ml-0 select-none flex-1 mobile:min-w-0"
      onClick={onOpen || changeShow}
      ref={ref}
    >
      <div className="cursor-pointer">
        <CalendarIcon />
      </div>
      <div className="cursor-pointer mobile:hidden">
        {date.format(isUSCitizen() ? 'MM/DD/YYYY hh:mm A' : 'DD/MM/YYYY HH:mm')}
      </div>
      <div className="cursor-pointer hidden mobile:block truncate">
        {date.format(isUSCitizen() ? 'MMM D, h:mm A' : 'D MMM, HH:mm')}
      </div>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="animate-fadeIn absolute bottom-[100%] mb-[16px] start-[50%] -translate-x-[50%] bg-sixth border border-tableBorder text-textColor rounded-[16px] z-[300] p-[16px] flex flex-col"
        >
          <DatePickerPanel date={date} onChange={onChange} />
          <Button className="mt-[12px]" onClick={changeShow}>
            {t('close', 'Close')}
          </Button>
        </div>
      )}
    </div>
  );
};
