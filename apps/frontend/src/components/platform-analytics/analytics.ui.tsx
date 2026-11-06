'use client';

import React, { FC, KeyboardEvent, useCallback, useRef } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';

// Building blocks shared by the sections of the Analytics page

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

export const swrOptions = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  refreshWhenHidden: false,
  refreshWhenOffline: false,
  keepPreviousData: true,
};

export const formatNumber = (value: number) =>
  new Intl.NumberFormat(undefined, {
    notation: value >= 100000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);

// 0 = Sunday, like the backend buckets
export const weekdayName = (weekday: number, format: 'ddd' | 'dddd' = 'ddd') =>
  dayjs().day(weekday).format(format);

export const hourName = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

export const Skeleton: FC<{ className?: string }> = ({ className }) => (
  <div
    aria-hidden="true"
    className={clsx('animate-pulse rounded-[8px] bg-newTableBorder', className)}
  />
);

// A headline number of a section
export const StatTile: FC<{
  label: string;
  hint: string;
  value?: number;
  tone?: 'default' | 'danger';
  loading: boolean;
}> = ({ label, hint, value, tone = 'default', loading }) => (
  <div className="flex flex-col gap-[6px] bg-newTableHeader border border-newTableBorder rounded-[12px] px-[16px] py-[14px] min-w-0">
    <div className="text-[13px] font-[500] text-newTableText">{label}</div>
    {loading ? (
      <Skeleton className="h-[36px] w-[72px]" />
    ) : (
      <div
        className={clsx(
          'text-[32px] leading-[36px] font-[600] tracking-tight flex items-center gap-[8px]',
          tone === 'danger' && !!value ? 'text-red-500' : 'text-newTextColor'
        )}
      >
        {tone === 'danger' && !!value && (
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5v5.5M12 16.5h.01" />
          </svg>
        )}
        {formatNumber(value || 0)}
      </div>
    )}
    <div className="text-[12px] text-newTableText">{hint}</div>
  </div>
);

export const Card: FC<{
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, className, children }) => (
  <section
    className={clsx(
      'flex flex-col gap-[14px] bg-newTableHeader border border-newTableBorder rounded-[12px] p-[16px] min-w-0',
      className
    )}
  >
    <div className="flex flex-col gap-[2px]">
      <h3 className="text-[15px] font-[600] text-newTextColor">{title}</h3>
      {!!subtitle && (
        <p className="text-[13px] text-newTableText">{subtitle}</p>
      )}
    </div>
    {children}
  </section>
);

export const RangePicker: FC<{ value: Range; onChange: (value: Range) => void }> = ({
  value,
  onChange,
}) => {
  const t = useT();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const labels: Record<Range, string> = {
    7: t('7_days', '7 Days'),
    30: t('30_days', '30 Days'),
    90: t('90_days', '90 Days'),
  };

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      // left and right follow the reading direction
      const forward = document.dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      const backward = document.dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
      const step =
        e.key === forward || e.key === 'ArrowDown'
          ? 1
          : e.key === backward || e.key === 'ArrowUp'
          ? -1
          : 0;
      if (!step) {
        return;
      }
      e.preventDefault();
      const next =
        (RANGES.indexOf(value) + step + RANGES.length) % RANGES.length;
      onChange(RANGES[next]);
      refs.current[next]?.focus();
    },
    [value, onChange]
  );

  return (
    <div
      role="radiogroup"
      aria-label={t('analytics_overview_range', 'Date range')}
      onKeyDown={onKeyDown}
      className="flex p-[3px] gap-[2px] rounded-[10px] bg-btnSimple"
    >
      {RANGES.map((range, index) => (
        <button
          key={range}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === range}
          tabIndex={value === range ? 0 : -1}
          onClick={() => onChange(range)}
          className={clsx(
            'h-[32px] px-[12px] rounded-[8px] text-[13px] font-[500] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary',
            value === range
              ? 'bg-newBgColorInner text-newTextColor shadow-menu'
              : 'text-textItemBlur hover:text-newTextColor'
          )}
        >
          {labels[range]}
        </button>
      ))}
    </div>
  );
};

// up or down against the previous period, "new" when there was nothing before
export const DeltaBadge: FC<{
  change: number | null;
  previous: number | null;
  current: number | null;
}> = ({ change, previous, current }) => {
  const t = useT();
  if (current === null || previous === null) {
    return (
      <span className="text-[12px] text-newTableText">
        {t('analytics_delta_no_history', 'No earlier data yet')}
      </span>
    );
  }
  if (change === null) {
    return (
      <span className="text-[12px] text-newTableText">
        {current > 0
          ? t('analytics_delta_new', 'New this period')
          : t('analytics_delta_flat', 'No change')}
      </span>
    );
  }
  const up = change > 0;
  const flat = change === 0;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-[4px] text-[12px] font-[600] tabular-nums',
        flat ? 'text-newTableText' : up ? 'text-green-500' : 'text-red-500'
      )}
    >
      {!flat && (
        <svg
          aria-hidden="true"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={clsx(!up && 'rotate-180')}
        >
          <path d="M5 1.5 9 7.5H1z" fill="currentColor" />
        </svg>
      )}
      <span className="sr-only">
        {flat
          ? t('analytics_delta_flat', 'No change')
          : up
          ? t('analytics_delta_up', 'Up')
          : t('analytics_delta_down', 'Down')}
      </span>
      {`${Math.abs(change)}%`}
    </span>
  );
};

export const ChannelAvatar: FC<{
  picture: string | null;
  identifier: string;
  size?: number;
}> = ({ picture, identifier, size = 32 }) => (
  <div className="relative shrink-0">
    <ImageWithFallback
      fallbackSrc={`/icons/platforms/${identifier}.png`}
      src={picture || `/icons/platforms/${identifier}.png`}
      className="rounded-[8px]"
      alt=""
      width={size}
      height={size}
    />
    <img
      src={`/icons/platforms/${identifier}.png`}
      className="rounded-[4px] absolute -bottom-[3px] -end-[3px] w-[14px] h-[14px] border border-newTableHeader"
      alt=""
    />
  </div>
);

// The history starts with the first daily snapshot, explain that instead of
// showing an empty chart
export const HistoryEmpty: FC<{ children?: React.ReactNode }> = ({
  children,
}) => {
  const t = useT();
  return (
    <div className="flex flex-col items-center text-center gap-[6px] py-[28px] px-[12px] rounded-[10px] border border-dashed border-newTableBorder">
      <svg
        aria-hidden="true"
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-newTableText"
      >
        <path d="M3 3v18h18" />
        <path d="m7 15 4-4 3 3 5-6" />
      </svg>
      <p className="text-[14px] font-[500] text-newTextColor">
        {t('analytics_history_empty_title', 'Collecting data from today')}
      </p>
      <p className="text-[13px] text-newTableText max-w-[440px]">
        {children ||
          t(
            'analytics_history_empty_body',
            'PostDelegate saves your channels’ followers and post metrics once a day. Trends and comparisons fill in as the days add up.'
          )}
      </p>
    </div>
  );
};

// Only web links from platform data are rendered as links
export const isWebUrl = (url?: string | null): url is string =>
  !!url && /^https?:\/\//i.test(url);

// Downloads a CSV export of the backend as a file
export const useCsvDownload = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  return useCallback(async (path: string, filename: string) => {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error('export');
      }
      // a blob keeps the byte order mark that Excel needs for UTF-8
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toaster.show(
        t('analytics_export_failed', 'The export could not be downloaded.'),
        'warning'
      );
    }
  }, []);
};
