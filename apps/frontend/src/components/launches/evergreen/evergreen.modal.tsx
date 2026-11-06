'use client';

import React, { FC, useCallback, useId, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { Button } from '@gitroom/react/form/button';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';

const MAX_VARIANTS = 10;

export type EvergreenSettings = {
  group: string;
  enabled: boolean;
  // the shares are over (or the post failed), nothing more goes out
  finished: boolean;
  intervalInDays: number | null;
  maxShares: number | null;
  until: string | null;
  variants: string[];
  published: boolean;
  sharesDone: number;
  upcoming: string[];
  channels: Array<{
    id: string;
    name: string;
    identifier: string;
    state: string;
  }>;
};

const useEvergreen = (group: string) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const response = await fetch(`/evergreen/${group}`);
    if (!response.ok) {
      throw new Error('Could not load the evergreen settings');
    }
    return (await response.json()) as EvergreenSettings;
  }, [group]);

  return useSWR(`evergreen-${group}`, load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
};

const fieldClass =
  'h-[42px] bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] text-[14px] text-textColor outline-none focus-visible:border-btnPrimary disabled:opacity-50';

const errorMessage = async (response: Response, fallback: string) => {
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

type StopMode = 'never' | 'count' | 'date';

const EvergreenForm: FC<{
  data: EvergreenSettings;
  onChange: () => void;
  close: () => void;
}> = ({ data, onChange, close }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const id = useId();

  const initialDays = data.intervalInDays || 7;
  const [every, setEvery] = useState(
    initialDays % 7 === 0 ? initialDays / 7 : initialDays
  );
  const [unit, setUnit] = useState<'days' | 'weeks'>(
    initialDays % 7 === 0 ? 'weeks' : 'days'
  );
  const [stop, setStop] = useState<StopMode>(
    data.maxShares ? 'count' : data.until ? 'date' : 'never'
  );
  const [maxShares, setMaxShares] = useState(data.maxShares || 5);
  const [until, setUntil] = useState(
    data.until
      ? newDayjs(data.until).format('YYYY-MM-DD')
      : newDayjs().add(3, 'month').format('YYYY-MM-DD')
  );
  const [variants, setVariants] = useState<string[]>(data.variants || []);
  const [saving, setSaving] = useState(false);

  const intervalLocked = data.published && data.enabled;
  const intervalInDays = unit === 'weeks' ? every * 7 : every;
  const intervalValid =
    Number.isInteger(intervalInDays) &&
    intervalInDays >= 1 &&
    intervalInDays <= 365;
  const countValid =
    stop !== 'count' ||
    (Number.isInteger(maxShares) && maxShares >= 1 && maxShares <= 100);
  const untilDate = newDayjs(until).endOf('day');
  const dateValid =
    stop !== 'date' || (untilDate.isValid() && untilDate.isAfter(newDayjs()));

  const formatShare = (date: string) =>
    newDayjs(date).format(
      isUSCitizen() ? 'ddd, MMM D, hh:mm A' : 'ddd, D MMM, HH:mm'
    );

  const save = useCallback(async () => {
    if (!intervalValid || !countValid || !dateValid) {
      return;
    }
    setSaving(true);
    const response = await fetch(`/evergreen/${data.group}`, {
      method: 'PUT',
      body: JSON.stringify({
        intervalInDays,
        maxShares: stop === 'count' ? maxShares : null,
        until: stop === 'date' ? untilDate.toISOString() : null,
        variants: variants.map((v) => v.trim()).filter(Boolean),
      }),
    });
    setSaving(false);
    if (!response.ok) {
      toaster.show(
        await errorMessage(
          response,
          t('evergreen_save_failed', 'Could not save the evergreen settings')
        ),
        'warning'
      );
      return;
    }
    toaster.show(t('evergreen_saved', 'Evergreen settings saved'), 'success');
    onChange();
    close();
  }, [
    intervalValid,
    countValid,
    dateValid,
    intervalInDays,
    stop,
    maxShares,
    untilDate,
    variants,
    data.group,
  ]);

  const stopEvergreen = useCallback(async () => {
    if (
      !(await deleteDialog(
        t(
          'evergreen_stop_confirm',
          'This post will not be shared again. Shares that already went out stay on the calendar.'
        ),
        t('evergreen_stop', 'Stop evergreen'),
        t('evergreen_stop_title', 'Stop re-sharing this post?'),
        undefined,
        true
      ))
    ) {
      return;
    }
    setSaving(true);
    const response = await fetch(`/evergreen/${data.group}`, {
      method: 'DELETE',
    });
    setSaving(false);
    if (!response.ok) {
      toaster.show(
        await errorMessage(
          response,
          t('evergreen_stop_failed', 'Could not stop evergreen')
        ),
        'warning'
      );
      return;
    }
    toaster.show(t('evergreen_stopped', 'Evergreen stopped'), 'success');
    onChange();
    close();
  }, [data.group]);

  return (
    <form
      className="flex flex-col gap-[24px] whitespace-normal w-[560px] max-w-full"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <p className="text-[14px] text-newTextColor/70">
        {t(
          'evergreen_intro',
          'Evergreen posts are shared again on a schedule, so good content keeps working. Each share can use a different wording.'
        )}
      </p>

      <fieldset className="flex flex-col gap-[8px]">
        <legend className="text-[14px] font-[600] mb-[8px]">
          {t('evergreen_repeat_every', 'Share again every')}
        </legend>
        <div className="flex gap-[8px]">
          <label htmlFor={`${id}-every`} className="sr-only">
            {t('evergreen_interval_number', 'Number')}
          </label>
          <input
            id={`${id}-every`}
            type="number"
            min={1}
            max={unit === 'weeks' ? 52 : 365}
            value={every}
            disabled={intervalLocked}
            onChange={(e) => setEvery(Math.floor(Number(e.target.value)))}
            className={clsx(fieldClass, 'w-[100px]')}
            aria-invalid={!intervalValid || undefined}
            aria-describedby={intervalLocked ? `${id}-locked` : undefined}
          />
          <label htmlFor={`${id}-unit`} className="sr-only">
            {t('evergreen_interval_unit', 'Unit')}
          </label>
          <select
            id={`${id}-unit`}
            value={unit}
            disabled={intervalLocked}
            onChange={(e) => setUnit(e.target.value as 'days' | 'weeks')}
            className={clsx(fieldClass, 'flex-1')}
          >
            <option value="days">{t('days', 'Days')}</option>
            <option value="weeks">{t('weeks', 'Weeks')}</option>
          </select>
        </div>
        {intervalLocked && (
          <div id={`${id}-locked`} className="text-[12px] text-newTextColor/60">
            {t(
              'evergreen_interval_locked',
              'The interval is fixed once the post went out. To change it, stop evergreen and duplicate the post.'
            )}
          </div>
        )}
        {!intervalValid && (
          <div className="text-[12px] text-red-400" role="alert">
            {t('evergreen_interval_invalid', 'Pick between 1 day and 1 year.')}
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-[10px]">
        <legend className="text-[14px] font-[600] mb-[8px]">
          {t('evergreen_stop_when', 'Stop sharing')}
        </legend>
        {(
          [
            ['never', t('evergreen_stop_never', 'Never, keep sharing')],
            ['count', t('evergreen_stop_count', 'After a number of shares')],
            ['date', t('evergreen_stop_date', 'On a date')],
          ] as Array<[StopMode, string]>
        ).map(([value, label]) => (
          <div key={value} className="flex flex-col gap-[8px]">
            <label className="flex items-center gap-[10px] min-h-[32px] cursor-pointer text-[14px]">
              <input
                type="radio"
                name={`${id}-stop`}
                value={value}
                checked={stop === value}
                onChange={() => setStop(value)}
                className="w-[16px] h-[16px] accent-[var(--new-btn-primary)]"
              />
              {label}
            </label>
            {stop === 'count' && value === 'count' && (
              <div className="flex items-center gap-[8px] ps-[26px]">
                <label htmlFor={`${id}-count`} className="text-[14px]">
                  {t('evergreen_shares_label', 'Re-shares')}
                </label>
                <input
                  id={`${id}-count`}
                  type="number"
                  min={1}
                  max={100}
                  value={maxShares}
                  onChange={(e) =>
                    setMaxShares(Math.floor(Number(e.target.value)))
                  }
                  className={clsx(fieldClass, 'w-[100px]')}
                  aria-invalid={!countValid || undefined}
                />
                {!countValid && (
                  <span className="text-[12px] text-red-400" role="alert">
                    {t('evergreen_count_invalid', 'Between 1 and 100')}
                  </span>
                )}
              </div>
            )}
            {stop === 'date' && value === 'date' && (
              <div className="flex items-center gap-[8px] ps-[26px]">
                <label htmlFor={`${id}-until`} className="text-[14px]">
                  {t('evergreen_until_label', 'Last day')}
                </label>
                <input
                  id={`${id}-until`}
                  type="date"
                  value={until}
                  min={newDayjs().format('YYYY-MM-DD')}
                  onChange={(e) => setUntil(e.target.value)}
                  className={clsx(fieldClass, 'w-[180px]')}
                  aria-invalid={!dateValid || undefined}
                />
                {!dateValid && (
                  <span className="text-[12px] text-red-400" role="alert">
                    {t('evergreen_date_invalid', 'Pick a future date')}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-[10px]">
        <legend className="text-[14px] font-[600] mb-[4px]">
          {t('evergreen_variants', 'Other wordings (optional)')}
        </legend>
        <p className="text-[12px] text-newTextColor/60">
          {t(
            'evergreen_variants_help',
            'Shares rotate through the original text and these versions, in order. Plain text only.'
          )}
        </p>
        {variants.map((variant, index) => (
          <div key={index} className="flex gap-[8px] items-start">
            <label htmlFor={`${id}-variant-${index}`} className="sr-only">
              {t('evergreen_variant_label', 'Wording')} {index + 2}
            </label>
            <textarea
              id={`${id}-variant-${index}`}
              value={variant}
              maxLength={5000}
              rows={3}
              placeholder={`${t('evergreen_variant_label', 'Wording')} ${
                index + 2
              }`}
              onChange={(e) =>
                setVariants((list) =>
                  list.map((v, i) => (i === index ? e.target.value : v))
                )
              }
              className="flex-1 bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px] text-[14px] text-textColor outline-none focus-visible:border-btnPrimary resize-y"
            />
            <button
              type="button"
              onClick={() =>
                setVariants((list) => list.filter((_, i) => i !== index))
              }
              aria-label={`${t('evergreen_remove_variant', 'Remove wording')} ${
                index + 2
              }`}
              className="w-[36px] h-[36px] flex items-center justify-center rounded-[8px] text-newTextColor/60 hover:text-red-500 hover:bg-boxHover"
            >
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                <path
                  d="M1 1L11 11M11 1L1 11"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        ))}
        {variants.length < MAX_VARIANTS && (
          <button
            type="button"
            onClick={() => setVariants((list) => [...list, ''])}
            className="self-start text-[14px] font-[500] text-btnPrimary hover:underline rounded-[4px]"
          >
            + {t('evergreen_add_variant', 'Add a wording')}
          </button>
        )}
      </fieldset>

      {data.enabled && (
        <div className="rounded-[12px] border border-newTableBorder bg-newBgColor p-[16px] flex flex-col gap-[8px] text-[14px]">
          <div className="font-[600]">
            {data.sharesDone === 1
              ? t('evergreen_shared_once', 'Shared again once so far')
              : t('evergreen_shared_times', 'Shared again {{count}} times so far', {
                  count: data.sharesDone,
                })}
          </div>
          {data.upcoming.length ? (
            <>
              <div className="text-newTextColor/70">
                {t('evergreen_next_shares', 'Next shares')}
              </div>
              <ul className="flex flex-col gap-[4px] tabular-nums">
                {data.upcoming.map((date) => (
                  <li key={date}>{formatShare(date)}</li>
                ))}
              </ul>
            </>
          ) : (
            <div className="text-newTextColor/70">
              {t('evergreen_no_more_shares', 'No more shares are planned.')}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-[10px] justify-between items-center">
        {data.enabled ? (
          <button
            type="button"
            onClick={stopEvergreen}
            disabled={saving}
            className="h-[40px] px-[16px] rounded-[8px] text-[14px] font-[500] text-red-500 hover:bg-red-500/10 disabled:opacity-50"
          >
            {t('evergreen_stop', 'Stop evergreen')}
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-[10px] ms-auto">
          <button
            type="button"
            onClick={close}
            className="h-[40px] px-[16px] rounded-[8px] text-[14px] font-[500] bg-btnSimple text-btnText"
          >
            {t('cancel', 'Cancel')}
          </button>
          <Button
            type="submit"
            loading={saving}
            disabled={!intervalValid || !countValid || !dateValid}
            className="rounded-[8px]"
          >
            {data.enabled
              ? t('save', 'Save')
              : t('evergreen_turn_on', 'Make evergreen')}
          </Button>
        </div>
      </div>
    </form>
  );
};

export const EvergreenModal: FC<{
  group: string;
  onChange: () => void;
  close: () => void;
}> = ({ group, onChange, close }) => {
  const t = useT();
  const { data, error, isLoading, mutate } = useEvergreen(group);
  const changed = useCallback(() => {
    mutate();
    onChange();
  }, [mutate, onChange]);

  if (isLoading) {
    return (
      <div className="w-[560px] max-w-full animate-pulse text-[14px]">
        {t('loading', 'Loading...')}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="w-[560px] max-w-full text-[14px]" role="alert">
        {t(
          'evergreen_load_failed',
          'We could not load this post. Refresh the calendar and try again.'
        )}
      </div>
    );
  }

  if (data.finished) {
    return (
      <div className="w-[560px] max-w-full flex flex-col gap-[16px] text-[14px]">
        <p>
          {t(
            'evergreen_finished',
            'This post finished re-sharing, so nothing more goes out. Duplicate it to share it on a new schedule.'
          )}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={close}
            className="h-[40px] px-[16px] rounded-[8px] text-[14px] font-[500] bg-btnSimple text-btnText"
          >
            {t('close', 'Close')}
          </button>
        </div>
      </div>
    );
  }

  // a refetch after a save starts the form again from the saved values
  return (
    <EvergreenForm
      key={JSON.stringify(data)}
      data={data}
      onChange={changed}
      close={close}
    />
  );
};
