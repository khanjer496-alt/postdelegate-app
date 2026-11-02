'use client';

import React, { FC, useCallback, useId, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import {
  getTimezone,
  newDayjs,
} from '@gitroom/frontend/components/layout/set.timezone';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';
import { TimezoneHint } from '@gitroom/frontend/components/launches/helpers/date.picker';
import type { Integrations } from '@gitroom/frontend/components/launches/calendar.context';

const MAX_FILE_SIZE = 1_000_000;
const ROW_LIMIT = 200;

type Issue = { field: string; message: string; hint?: string };

type PreviewRow = {
  row: number;
  date: string | null;
  timezone: string;
  channels: Array<{
    id: string;
    name: string;
    identifier: string;
    picture?: string | null;
  }>;
  text: string;
  images: string[];
  tags: string[];
  errors: Issue[];
  warnings: string[];
};

type Preview = {
  limit: number;
  fileErrors: string[];
  total: number;
  valid: number;
  invalid: number;
  rows: PreviewRow[];
};

type ImportResult = {
  created: number;
  skipped: number;
  failed: number;
  rows: Array<{
    row: number;
    status: 'created' | 'skipped' | 'failed';
    error?: string;
  }>;
  alreadyImported?: boolean;
};

const csvCell = (value: string) =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

// a ready-to-fill file with the user's own channel names
const templateCsv = (channels: string[]) => {
  const first = channels[0] || 'My channel';
  const both = channels.slice(0, 2).join(' | ') || first;
  const format = 'YYYY-MM-DD HH:mm';
  const rows = [
    ['date', 'timezone', 'channels', 'text', 'image_urls', 'settings', 'tags'],
    [
      newDayjs().add(1, 'day').hour(9).minute(0).format(format),
      getTimezone(),
      first,
      'Our new guide is out. Five ideas to plan a month of posts in one afternoon.',
      '',
      '',
      '',
    ],
    [
      newDayjs().add(2, 'day').hour(14).minute(30).format(format),
      '',
      both,
      'Behind the scenes of this week, line one.\nAnd a second line.',
      '',
      '',
      '',
    ],
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
};

export const errorMessage = async (response: Response, fallback: string) => {
  try {
    const body = await response.json();
    const message = Array.isArray(body?.message)
      ? body.message.join(' ')
      : body?.message;
    return typeof message === 'string' && message ? message : fallback;
  } catch (err) {
    return fallback;
  }
};

export const Avatar: FC<{ picture?: string | null; identifier: string; name: string }> = ({
  picture,
  identifier,
  name,
}) => (
  <div
    className="relative shrink-0 w-[22px] h-[22px]"
    data-tooltip-id="tooltip"
    data-tooltip-content={name}
  >
    <img
      className="w-full h-full rounded-full object-cover"
      src={picture || '/no-picture.jpg'}
      alt={name}
      onError={(e) => {
        e.currentTarget.src = '/no-picture.jpg';
      }}
    />
    <img
      className="absolute -bottom-[2px] -end-[3px] w-[12px] h-[12px] rounded-[3px] border border-newBgColorInner"
      src={
        identifier === 'youtube'
          ? '/icons/platforms/youtube.svg'
          : `/icons/platforms/${identifier}.png`
      }
      alt=""
    />
  </div>
);

export const StatusChip: FC<{ tone: 'ok' | 'warn' | 'error'; children: React.ReactNode }> = ({
  tone,
  children,
}) => (
  <span
    className={clsx(
      'shrink-0 inline-flex items-center px-[8px] h-[22px] rounded-full text-[12px] font-[600]',
      tone === 'ok' && 'bg-green-500/15 text-green-600 dark:text-green-400',
      tone === 'warn' && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
      tone === 'error' && 'bg-red-500/15 text-red-600 dark:text-red-400'
    )}
  >
    {children}
  </span>
);

const UploadStep: FC<{
  integrations: Integrations[];
  loading: boolean;
  error: string;
  onFile: (file: File) => void;
}> = ({ integrations, loading, error, onFile }) => {
  const t = useT();
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const channels = useMemo(
    () => integrations.filter((p) => !p.disabled).map((p) => p.name),
    [integrations]
  );

  const download = useCallback(() => {
    const blob = new Blob([templateCsv(channels)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'postdelegate-import-template.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [channels]);

  const columns: Array<[string, string]> = [
    [
      'date',
      t(
        'import_col_date',
        'When to post, like 2026-11-03 09:30 (year-month-day, 24-hour time). Required.'
      ),
    ],
    [
      'timezone',
      t(
        'import_col_timezone',
        'Optional, like Europe/London. Empty means your timezone ({{timezone}}).',
        { timezone: getTimezone() }
      ),
    ],
    [
      'channels',
      t(
        'import_col_channels',
        'One or more channel names, separated by |. Required.'
      ),
    ],
    [
      'text',
      t('import_col_text', 'The post text. Line breaks are kept.'),
    ],
    [
      'image_urls',
      t(
        'import_col_images',
        'Optional public image links, separated by |. We download them into your media library.'
      ),
    ],
    [
      'settings',
      t(
        'import_col_settings',
        'Optional channel settings as JSON, like {"title": "My video"}.'
      ),
    ],
    [
      'tags',
      t(
        'import_col_tags',
        'Optional tag or campaign names, separated by |.'
      ),
    ],
  ];

  return (
    <div className="flex flex-col gap-[20px]">
      <p className="text-[14px] text-newTextColor/70">
        {t(
          'import_intro',
          'Schedule many posts at once from a spreadsheet. Save it as a CSV file with one post per row, up to {{limit}} rows.',
          { limit: ROW_LIMIT }
        )}
      </p>

      <dl className="grid grid-cols-[110px_1fr] mobile:grid-cols-1 gap-x-[12px] gap-y-[8px] text-[13px]">
        {columns.map(([name, description]) => (
          <React.Fragment key={name}>
            <dt className="font-mono font-[600]">{name}</dt>
            <dd className="text-newTextColor/70 mobile:mb-[6px]">
              {description}
            </dd>
          </React.Fragment>
        ))}
      </dl>

      {!!channels.length && (
        <div className="flex flex-col gap-[8px]">
          <div className="text-[13px] font-[600]">
            {t('import_your_channels', 'Your channel names')}
          </div>
          <ul className="flex flex-wrap gap-[6px]">
            {channels.map((name) => (
              <li
                key={name}
                className="px-[10px] h-[28px] flex items-center rounded-full bg-newBgColor border border-newTableBorder text-[13px]"
              >
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={download}
          className="h-[40px] px-[16px] rounded-[8px] bg-btnSimple text-btnText text-[14px] font-[500] flex items-center gap-[8px]"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M10 3v10m0 0l-4-4m4 4l4-4M4 16h12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t('import_download_template', 'Download template')}
        </button>
      </div>

      <label
        htmlFor={`${id}-file`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) {
            onFile(file);
          }
        }}
        className={clsx(
          'flex flex-col items-center justify-center gap-[6px] min-h-[140px] p-[20px] rounded-[12px] border-2 border-dashed cursor-pointer text-center transition-colors focus-within:border-btnPrimary',
          dragging
            ? 'border-btnPrimary bg-boxFocused'
            : 'border-newTableBorder hover:border-btnPrimary',
          loading && 'opacity-60 pointer-events-none'
        )}
      >
        <input
          id={`${id}-file`}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          disabled={loading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) {
              onFile(file);
            }
          }}
        />
        <span className="text-[15px] font-[600]">
          {loading
            ? t('import_checking', 'Checking your file...')
            : t('import_choose_file', 'Choose a CSV file or drop it here')}
        </span>
        <span className="text-[12px] text-newTextColor/60">
          {t('import_file_limit', 'Up to 1 MB and {{limit}} posts', {
            limit: ROW_LIMIT,
          })}
        </span>
      </label>

      {!!error && (
        <div
          role="alert"
          className="rounded-[8px] bg-red-500/10 text-red-600 dark:text-red-400 p-[12px] text-[14px]"
        >
          {error}
        </div>
      )}
    </div>
  );
};

const PreviewRowItem: FC<{ row: PreviewRow }> = ({ row }) => {
  const t = useT();
  const date = row.date
    ? newDayjs(row.date).format(
        isUSCitizen() ? 'ddd, MMM D, YYYY hh:mm A' : 'ddd, D MMM YYYY, HH:mm'
      )
    : null;
  const tone = row.errors.length ? 'error' : row.warnings.length ? 'warn' : 'ok';
  return (
    <li
      className={clsx(
        'flex flex-col gap-[8px] p-[12px] rounded-[10px] border',
        row.errors.length
          ? 'border-red-500/40 bg-red-500/5'
          : 'border-newTableBorder bg-newBgColor'
      )}
    >
      <div className="flex items-center gap-[10px] flex-wrap">
        <span className="text-[12px] font-[600] text-newTextColor/60 tabular-nums">
          {t('import_row', 'Row')} {row.row}
        </span>
        {date && <span className="text-[13px] tabular-nums">{date}</span>}
        <div className="flex gap-[4px]">
          {row.channels.map((channel) => (
            <Avatar
              key={channel.id}
              picture={channel.picture}
              identifier={channel.identifier}
              name={channel.name}
            />
          ))}
        </div>
        <span className="ms-auto">
          <StatusChip tone={tone}>
            {tone === 'error'
              ? t('import_needs_fix', 'Needs a fix')
              : t('import_ready', 'Ready')}
          </StatusChip>
        </span>
      </div>
      {(!!row.text || !!row.images.length) && (
        <div className="text-[13px] line-clamp-2 break-words whitespace-pre-line">
          {row.text}
          {!!row.images.length && (
            <span className="text-newTextColor/60">
              {row.text ? ' · ' : ''}
              {row.images.length === 1
                ? t('import_one_image', '1 image')
                : t('import_images', '{{count}} images', {
                    count: row.images.length,
                  })}
            </span>
          )}
        </div>
      )}
      {!!row.errors.length && (
        <ul className="flex flex-col gap-[6px]">
          {row.errors.map((issue, index) => (
            <li key={index} className="text-[13px]">
              <span className="text-red-600 dark:text-red-400 font-[500]">
                {issue.message}
              </span>
              {issue.hint && (
                <span className="text-newTextColor/70"> {issue.hint}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!!row.warnings.length && (
        <ul className="flex flex-col gap-[4px]">
          {row.warnings.map((warning, index) => (
            <li
              key={index}
              className="text-[13px] text-amber-600 dark:text-amber-400"
            >
              {warning}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
};

export const ImportPostsModal: FC<{
  integrations: Integrations[];
  onImported: () => void;
  close: () => void;
}> = ({ integrations, onImported, close }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const csv = useRef('');
  const timezone = useMemo(() => getTimezone(), []);

  const onFile = useCallback(
    async (file: File) => {
      setError('');
      if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
        setError(
          t(
            'import_not_csv',
            'This is not a CSV file. In your spreadsheet app, use File > Download (or Save as) > CSV.'
          )
        );
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setError(
          t(
            'import_too_big',
            'This file is larger than 1 MB. Split it into smaller files.'
          )
        );
        return;
      }
      setLoading(true);
      try {
        csv.current = await file.text();
        const response = await fetch('/posts-import/preview', {
          method: 'POST',
          body: JSON.stringify({ csv: csv.current, timezone }),
        });
        if (!response.ok) {
          setError(
            await errorMessage(
              response,
              t('import_preview_failed', 'We could not read this file.')
            )
          );
          return;
        }
        const data: Preview = await response.json();
        setFileName(file.name);
        setPreview(data);
        setOnlyProblems(false);
        setStep('preview');
      } catch (err) {
        setError(t('import_preview_failed', 'We could not read this file.'));
      } finally {
        setLoading(false);
      }
    },
    [timezone]
  );

  const runImport = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/posts-import', {
        method: 'POST',
        body: JSON.stringify({ csv: csv.current, timezone }),
      });
      if (!response.ok) {
        // a 402 (plan limit) is handled by the app already
        if (response.status !== 402) {
          toaster.show(
            await errorMessage(
              response,
              response.status === 409
                ? t(
                    'import_in_progress',
                    'This file is already being imported. Give it a minute, then check the calendar.'
                  )
                : t('import_failed', 'The import did not go through.')
            ),
            'warning'
          );
        }
        return;
      }
      const data: ImportResult = await response.json();
      setResult(data);
      setStep('done');
      if (data.created) {
        onImported();
      }
    } catch (err) {
      toaster.show(t('import_failed', 'The import did not go through.'), 'warning');
    } finally {
      setLoading(false);
    }
  }, [timezone, onImported]);

  const rows = useMemo(
    () =>
      (preview?.rows || []).filter(
        (row) => !onlyProblems || row.errors.length || row.warnings.length
      ),
    [preview, onlyProblems]
  );

  return (
    <div className="flex flex-col gap-[20px] whitespace-normal w-[820px] max-w-full">
      {step === 'upload' && (
        <UploadStep
          integrations={integrations}
          loading={loading}
          error={error}
          onFile={onFile}
        />
      )}

      {step === 'preview' && preview && (
        <>
          <div className="flex flex-col gap-[4px]">
            <div className="text-[13px] text-newTextColor/60 break-all">
              {fileName}
            </div>
            {!preview.fileErrors.length && (
              <div className="text-[16px] font-[600]" aria-live="polite">
                {t('import_summary', '{{valid}} of {{total}} posts are ready', {
                  valid: preview.valid,
                  total: preview.total,
                })}
                {preview.invalid > 0 && (
                  <span className="text-red-600 dark:text-red-400">
                    {' · '}
                    {preview.invalid === 1
                      ? t('import_one_problem', '1 needs a fix')
                      : t('import_problems', '{{count}} need a fix', {
                          count: preview.invalid,
                        })}
                  </span>
                )}
              </div>
            )}
          </div>

          {!!preview.fileErrors.length && (
            <div
              role="alert"
              className="rounded-[8px] bg-red-500/10 text-red-600 dark:text-red-400 p-[12px] text-[14px] flex flex-col gap-[4px]"
            >
              {preview.fileErrors.map((message) => (
                <div key={message}>{message}</div>
              ))}
            </div>
          )}

          {!!preview.rows.length && (
            <>
              <label className="flex items-center gap-[8px] text-[14px] cursor-pointer self-start">
                <input
                  type="checkbox"
                  checked={onlyProblems}
                  onChange={(e) => setOnlyProblems(e.target.checked)}
                  className="w-[16px] h-[16px]"
                />
                {t('import_only_problems', 'Only show rows with problems')}
              </label>
              <TimezoneHint newTab={true} />
              <ul
                className="flex flex-col gap-[8px] max-h-[50vh] overflow-y-auto pe-[4px] scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor"
                aria-label={t('import_rows', 'Posts in the file')}
              >
                {rows.map((row) => (
                  <PreviewRowItem key={row.row} row={row} />
                ))}
                {!rows.length && (
                  <li className="text-[14px] text-newTextColor/60 p-[12px]">
                    {t('import_no_problems', 'No problems found.')}
                  </li>
                )}
              </ul>
            </>
          )}

          <div className="flex flex-wrap gap-[10px] items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setStep('upload');
                setPreview(null);
              }}
              disabled={loading}
              className="h-[40px] px-[16px] rounded-[8px] bg-btnSimple text-btnText text-[14px] font-[500] disabled:opacity-50"
            >
              {t('import_choose_another', 'Choose another file')}
            </button>
            <div className="flex items-center gap-[12px] ms-auto flex-wrap justify-end">
              {preview.invalid > 0 && preview.valid > 0 && (
                <span className="text-[13px] text-newTextColor/60">
                  {t(
                    'import_skip_note',
                    'Rows that need a fix are skipped.'
                  )}
                </span>
              )}
              <Button
                type="button"
                onClick={runImport}
                loading={loading}
                disabled={!preview.valid || !!preview.fileErrors.length}
                className="rounded-[8px]"
              >
                {preview.valid === 1
                  ? t('import_schedule_one', 'Schedule 1 post')
                  : t('import_schedule_n', 'Schedule {{count}} posts', {
                      count: preview.valid,
                    })}
              </Button>
            </div>
          </div>
        </>
      )}

      {step === 'done' && result && (
        <>
          <div className="flex flex-col gap-[8px]" aria-live="polite">
            <div className="text-[18px] font-[600]">
              {result.alreadyImported
                ? t(
                    'import_already_done',
                    'This file was already imported, nothing new was added.'
                  )
                : result.created === 1
                ? t('import_created_one', '1 post is scheduled')
                : t('import_created', '{{count}} posts are scheduled', {
                    count: result.created,
                  })}
            </div>
            {(result.skipped > 0 || result.failed > 0) && (
              <div className="text-[14px] text-newTextColor/70">
                {t(
                  'import_result_detail',
                  '{{skipped}} skipped because they need a fix, {{failed}} could not be created.',
                  { skipped: result.skipped, failed: result.failed }
                )}
              </div>
            )}
            {result.created > 0 && (
              <div className="text-[14px] text-newTextColor/70">
                {t(
                  'import_reupload_note',
                  'To add the skipped rows later, fix them and import a file with only those rows, so nothing is scheduled twice.'
                )}
              </div>
            )}
          </div>
          {result.rows.some((row) => row.status !== 'created') && (
            <ul className="flex flex-col gap-[6px] max-h-[40vh] overflow-y-auto text-[13px]">
              {result.rows
                .filter((row) => row.status !== 'created')
                .map((row) => (
                  <li key={row.row} className="flex gap-[8px]">
                    <span className="font-[600] tabular-nums shrink-0">
                      {t('import_row', 'Row')} {row.row}
                    </span>
                    <span className="text-red-600 dark:text-red-400">
                      {row.error}
                    </span>
                  </li>
                ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button type="button" onClick={close} className="rounded-[8px]">
              {t('done', 'Done')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
