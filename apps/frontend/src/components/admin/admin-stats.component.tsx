'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/react/form/button';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { capitalize } from 'lodash';

interface PerSocial {
  provider: string;
  count: number;
}

interface StatsBlock {
  total: number;
  perSocial: PerSocial[];
}

interface StatsResponse {
  from: string;
  to: string;
  errors: StatsBlock;
  posts: StatsBlock;
  connected: StatsBlock;
  publishingAccounts?: StatsBlock;
  scheduledAccounts?: StatsBlock;
  publishingChannels?: StatsBlock;
  scheduledChannels?: StatsBlock;
  activeOrgsBySource?: StatsBlock;
  connectedClients?: StatsBlock;
}

interface GrowthPlan {
  tier: string;
  period: 'MONTHLY' | 'YEARLY';
  count: number;
  mrr: number;
}

interface GrowthResponse {
  from: string;
  to: string;
  signUps: {
    total: number;
    activated: number;
    perMethod: StatsBlock;
    perDay: { date: string; count: number }[];
  };
  comped: { lifetime: number; setByAdmin: number };
  billing: {
    supported: boolean;
    currency: string | null;
    trialsStarted: number;
    trialsRunning: number;
    trialsRunningWithCard: number;
    trialsConverted: number;
    trialsExpired: number;
    paying: number;
    payingByPlan: GrowthPlan[];
    mrr: number;
    cancellations: number;
    cancelling: number;
    paymentFailing: number;
  };
}

// A source without its env vars is not connected, one that failed says so
type WebsiteSource<T> =
  | { connected: false }
  | { connected: true; error: string }
  | ({ connected: true; error?: undefined } & T);

interface WebsiteRow {
  name: string;
  pageViews: number;
  visits: number;
}

interface SearchRow {
  name: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface WebsiteResponse {
  from: string;
  to: string;
  visitors: WebsiteSource<{
    from: string;
    to: string;
    totals: { pageViews: number; visits: number };
    perDay: { date: string; pageViews: number; visits: number }[];
    pages: WebsiteRow[];
    countries: WebsiteRow[];
    referrers: WebsiteRow[];
  }>;
  search: WebsiteSource<{
    totals: {
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
    };
    perDay: { date: string; clicks: number; impressions: number }[];
    queries: SearchRow[];
    pages: SearchRow[];
  }>;
}

const isoDaysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

const today = () => new Date().toISOString().slice(0, 10);

const startOfWeek = () => {
  const d = new Date();
  // ISO week: Monday = 0
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
};

const startOfMonth = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};

const PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  { label: 'Today', range: () => ({ from: today(), to: today() }) },
  { label: 'This week', range: () => ({ from: startOfWeek(), to: today() }) },
  { label: 'This month', range: () => ({ from: startOfMonth(), to: today() }) },
  { label: 'Last 7 days', range: () => ({ from: isoDaysAgo(7), to: today() }) },
  { label: 'Last 30 days', range: () => ({ from: isoDaysAgo(30), to: today() }) },
  { label: 'Last 90 days', range: () => ({ from: isoDaysAgo(90), to: today() }) },
];

const useStats = (params: {
  from: string;
  to: string;
  unknownOnly: boolean;
}) => {
  const fetch = useFetch();
  const query = new URLSearchParams({
    from: params.from,
    to: params.to,
    ...(params.unknownOnly ? { unknownOnly: 'true' } : {}),
  });
  const key = `/admin/stats?${query.toString()}`;
  return useSWR<StatsResponse>(
    key,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error('Failed to load stats');
      }
      return res.json();
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};

const useGrowthStats = (params: { from: string; to: string }) => {
  const fetch = useFetch();
  const query = new URLSearchParams({ from: params.from, to: params.to });
  const key = `/admin/stats/growth?${query.toString()}`;
  return useSWR<GrowthResponse>(
    key,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error('Failed to load growth stats');
      }
      return res.json();
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};

const useWebsiteStats = (params: { from: string; to: string }) => {
  const fetch = useFetch();
  const query = new URLSearchParams({ from: params.from, to: params.to });
  const key = `/admin/stats/website?${query.toString()}`;
  return useSWR<WebsiteResponse>(
    key,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error('Failed to load website stats');
      }
      return res.json();
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};

const SummaryCard: FC<{
  label: string;
  value: number | string;
  title?: string;
}> = ({ label, value, title }) => (
  <div
    className="border border-newTableBorder rounded-[8px] p-[16px] bg-newBgColorInner"
    title={title}
  >
    <div className="text-[12px] opacity-70">{label}</div>
    <div className="text-[28px] font-[600]">
      {typeof value === 'number' ? value.toLocaleString() : value}
    </div>
  </div>
);

const PerSocialTable: FC<{ title: string; block: StatsBlock }> = ({
  title,
  block,
}) => (
  <div className="border border-newTableBorder rounded-[8px] overflow-hidden">
    <div className="grid grid-cols-[1fr_120px] gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder">
      <div>{title}</div>
      <div className="text-right">Count</div>
    </div>
    {block.perSocial.length === 0 ? (
      <div className="px-[12px] py-[10px] text-[13px] opacity-70">
        No data for this timeframe.
      </div>
    ) : (
      block.perSocial.map((row) => (
        <div
          key={row.provider}
          className="grid grid-cols-[1fr_120px] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0"
        >
          <div className="capitalize">{row.provider}</div>
          <div className="text-right">{row.count.toLocaleString()}</div>
        </div>
      ))
    )}
  </div>
);

// "–" instead of dividing by zero
const percentOf = (part: number, whole: number) =>
  whole ? `${Math.round((part / whole) * 100)}%` : '–';

const formatMoney = (cents: number, currency: string | null) =>
  (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  });

const SIGN_UP_METHODS: Record<string, string> = { LOCAL: 'email' };

const PerDayChart: FC<{
  title: string;
  perDay: { date: string; count: number }[];
}> = ({ title, perDay }) => {
  const busiest = Math.max(0, ...perDay.map((day) => day.count));
  // the bars of a range without any count stay flat
  const max = Math.max(1, busiest);
  return (
    <div className="border border-newTableBorder rounded-[8px] p-[12px] flex flex-col gap-[8px] min-w-0">
      <div className="text-[12px] uppercase opacity-70">{title}</div>
      {/* bars shrink below a pixel rather than scroll a long range sideways */}
      <div className="flex items-end gap-px h-[120px] min-w-0 overflow-hidden">
        {perDay.map((day) => (
          <div
            key={day.date}
            title={`${new Date(`${day.date}T00:00:00`).toLocaleDateString()}: ${
              day.count
            }`}
            className="flex-1 min-w-0 h-full flex items-end"
          >
            <div
              className="w-full bg-forth rounded-t-[2px]"
              style={{ height: `${(day.count / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      {perDay.length > 0 && (
        <div className="flex flex-wrap justify-between gap-[8px] text-[12px] opacity-70">
          <div>
            {new Date(`${perDay[0].date}T00:00:00`).toLocaleDateString()}
          </div>
          <div>Busiest day: {busiest.toLocaleString()}</div>
          <div>
            {new Date(
              `${perDay[perDay.length - 1].date}T00:00:00`
            ).toLocaleDateString()}
          </div>
        </div>
      )}
    </div>
  );
};

const GrowthSection: FC<{ range: { from: string; to: string } }> = ({
  range,
}) => {
  const { data, isLoading, error } = useGrowthStats(range);

  if (isLoading) {
    return <LoadingComponent />;
  }

  if (error || !data) {
    return <div className="text-red-400">Failed to load growth stats.</div>;
  }

  const { signUps, billing, comped } = data;

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="text-[16px] font-[600]">Growth</div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-[12px]">
        <SummaryCard label="New sign-ups" value={signUps.total} />
        <SummaryCard label="Confirmed their email" value={signUps.activated} />
        {billing.supported && (
          <>
            <SummaryCard label="Trials started" value={billing.trialsStarted} />
            <SummaryCard
              label="Trials running (right now)"
              value={billing.trialsRunning}
            />
            <SummaryCard
              label="Card added (trials running)"
              value={billing.trialsRunningWithCard}
            />
            <SummaryCard
              label="Became paying"
              value={billing.trialsConverted}
            />
            <SummaryCard label="Trials expired" value={billing.trialsExpired} />
            <SummaryCard
              label="Paying customers (right now)"
              value={billing.paying}
              title="Paid subscriptions only. A plan with a 100% coupon counts as paying at $0"
            />
            <SummaryCard
              label="Monthly revenue (MRR)"
              value={formatMoney(billing.mrr, billing.currency)}
              title="After discounts, yearly plans divided by 12. A plan with a 100% coupon adds $0"
            />
            <SummaryCard
              label="Payment failing (right now)"
              value={billing.paymentFailing}
              title="The card was declined, Stripe is retrying. Not counted as paying or in MRR"
            />
            <SummaryCard label="Cancellations" value={billing.cancellations} />
            <SummaryCard
              label="Cancelling at period end"
              value={billing.cancelling}
              title="Still paying now, set to stop at the end of the period they paid for"
            />
          </>
        )}
        <SummaryCard label="Lifetime deals" value={comped.lifetime} />
        <SummaryCard
          label="Set by admin"
          value={comped.setByAdmin}
          title="Plans given from the admin billing tools, nobody pays for them"
        />
      </div>

      {billing.supported ? (
        <div
          className="border border-newTableBorder rounded-[8px] p-[12px] text-[14px] flex flex-wrap items-center gap-[8px]"
          title="Counted in the selected dates, so they are not always the same people. Became paying is out of the trials that ended in these dates"
        >
          <div>
            New sign-ups <strong>{signUps.total.toLocaleString()}</strong>
          </div>
          <div className="opacity-70">→</div>
          <div>
            Trials started{' '}
            <strong>{billing.trialsStarted.toLocaleString()}</strong> (
            {percentOf(billing.trialsStarted, signUps.total)})
          </div>
          <div className="opacity-70">→</div>
          <div>
            Became paying{' '}
            <strong>{billing.trialsConverted.toLocaleString()}</strong> (
            {percentOf(
              billing.trialsConverted,
              billing.trialsConverted + billing.trialsExpired
            )}{' '}
            of trials that ended)
          </div>
        </div>
      ) : (
        <div className="text-[13px] opacity-70">
          Trial and revenue numbers are not available right now (no billing
          provider could be reached).
        </div>
      )}

      <PerDayChart title="New sign-ups per day" perDay={signUps.perDay} />

      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[12px] items-start">
        <PerSocialTable
          title="New sign-ups per method"
          block={{
            total: signUps.perMethod.total,
            perSocial: signUps.perMethod.perSocial.map((row) => ({
              provider:
                SIGN_UP_METHODS[row.provider] || row.provider.toLowerCase(),
              count: row.count,
            })),
          }}
        />
        {billing.supported && (
          <div className="border border-newTableBorder rounded-[8px] overflow-hidden">
            <div className="grid grid-cols-[1fr_80px_100px] gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder">
              <div>Paying customers per plan</div>
              <div className="text-right">Count</div>
              <div className="text-right">MRR</div>
            </div>
            {billing.payingByPlan.length === 0 ? (
              <div className="px-[12px] py-[10px] text-[13px] opacity-70">
                No paying customers yet.
              </div>
            ) : (
              billing.payingByPlan.map((plan) => (
                <div
                  key={`${plan.tier}_${plan.period}`}
                  className="grid grid-cols-[1fr_80px_100px] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0"
                >
                  <div>
                    {pricing[plan.tier]?.label || capitalize(plan.tier)}{' '}
                    <span className="opacity-70">
                      ({plan.period === 'YEARLY' ? 'yearly' : 'monthly'})
                    </span>
                  </div>
                  <div className="text-right">
                    {plan.count.toLocaleString()}
                  </div>
                  <div className="text-right">
                    {formatMoney(plan.mrr, billing.currency)}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// one count column, or the four columns of a search table
const ONE_COLUMN = 'grid-cols-[minmax(0,1fr)_80px]';
const SEARCH_COLUMNS = 'grid-cols-[minmax(0,1fr)_repeat(4,64px)]';

const WebsiteTable: FC<{
  title: string;
  columns: string[];
  rows: { name: string; title?: string; values: (number | string)[] }[];
}> = ({ title, columns, rows }) => {
  const grid = columns.length === 1 ? ONE_COLUMN : SEARCH_COLUMNS;
  return (
    <div className="border border-newTableBorder rounded-[8px] overflow-hidden">
      <div
        className={`grid ${grid} gap-[12px] px-[12px] py-[10px] bg-newBgColorInner text-[12px] uppercase opacity-70 border-b border-newTableBorder`}
      >
        <div>{title}</div>
        {columns.map((column) => (
          <div key={column} className="text-right">
            {column}
          </div>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="px-[12px] py-[10px] text-[13px] opacity-70">
          No data for this timeframe.
        </div>
      ) : (
        rows.map((row) => (
          <div
            key={row.title || row.name}
            className={`grid ${grid} gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0`}
          >
            <div className="truncate" title={row.title || row.name}>
              {row.name}
            </div>
            {row.values.map((value, index) => (
              <div key={columns[index]} className="text-right">
                {typeof value === 'number' ? value.toLocaleString() : value}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
};

// Cloudflare sends the ISO code of the country
const countryName = (code: string) => {
  try {
    return (
      new Intl.DisplayNames(undefined, { type: 'region' }).of(code) || code
    );
  } catch (err) {
    return code;
  }
};

const formatCtr = (ctr: number) => `${(ctr * 100).toFixed(1)}%`;

// an average position without impressions means nothing
const formatPosition = (position: number, impressions: number) =>
  impressions ? position.toFixed(1) : '–';

const searchTableRows = (rows: SearchRow[]) =>
  rows.map((row) => ({
    name: row.name.replace(/^https?:\/\//, ''),
    title: row.name,
    values: [
      row.clicks,
      row.impressions,
      formatCtr(row.ctr),
      formatPosition(row.position, row.impressions),
    ],
  }));

const SourceNote: FC<{
  label: string;
  source: { connected: boolean; error?: string };
}> = ({ label, source }) => (
  <div className="text-[13px] opacity-70">
    {label}: {source.error || 'Not connected'}.
  </div>
);

const WebsiteSection: FC<{ range: { from: string; to: string } }> = ({
  range,
}) => {
  const { data, isLoading, error } = useWebsiteStats(range);

  if (isLoading) {
    return <LoadingComponent />;
  }

  if (error || !data) {
    return <div className="text-red-400">Failed to load website stats.</div>;
  }

  const visitors = 'totals' in data.visitors ? data.visitors : null;
  const search = 'totals' in data.search ? data.search : null;

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="text-[16px] font-[600]">Website</div>

      {(visitors || search) && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-[12px]">
          {visitors && (
            <>
              <SummaryCard
                label="Visits"
                value={visitors.totals.visits}
                title="Page views that started a visit (from another site or opened directly)"
              />
              <SummaryCard
                label="Page views"
                value={visitors.totals.pageViews}
              />
            </>
          )}
          {search && (
            <>
              <SummaryCard
                label="Search impressions"
                value={search.totals.impressions}
              />
              <SummaryCard label="Search clicks" value={search.totals.clicks} />
              <SummaryCard label="CTR" value={formatCtr(search.totals.ctr)} />
              <SummaryCard
                label="Avg position"
                value={formatPosition(
                  search.totals.position,
                  search.totals.impressions
                )}
              />
            </>
          )}
        </div>
      )}

      {visitors ? (
        visitors.from > range.from && (
          <div className="text-[13px] opacity-70">
            Visitors from{' '}
            {new Date(`${visitors.from}T00:00:00`).toLocaleDateString()},
            Cloudflare keeps about 6 months.
          </div>
        )
      ) : (
        <SourceNote label="Visitors" source={data.visitors} />
      )}
      {search ? (
        <div className="text-[13px] opacity-70">
          Search Console data runs about 2 to 3 days behind.
        </div>
      ) : (
        <SourceNote label="Search" source={data.search} />
      )}

      {visitors && (
        <PerDayChart
          title="Visits per day"
          perDay={visitors.perDay.map((day) => ({
            date: day.date,
            count: day.visits,
          }))}
        />
      )}
      {search && (
        <PerDayChart
          title="Search impressions per day"
          perDay={search.perDay.map((day) => ({
            date: day.date,
            count: day.impressions,
          }))}
        />
      )}

      {visitors && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[12px] items-start">
          <WebsiteTable
            title="Top pages"
            columns={['Views']}
            rows={visitors.pages.map((row) => ({
              name: row.name,
              values: [row.pageViews],
            }))}
          />
          <WebsiteTable
            title="Countries"
            columns={['Views']}
            rows={visitors.countries.map((row) => ({
              name: countryName(row.name),
              values: [row.pageViews],
            }))}
          />
          <WebsiteTable
            title="Referrers"
            columns={['Visits']}
            rows={visitors.referrers.map((row) => ({
              name: row.name,
              values: [row.visits],
            }))}
          />
        </div>
      )}

      {search && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(480px,100%),1fr))] gap-[12px] items-start">
          <WebsiteTable
            title="Top search queries"
            columns={['Clicks', 'Impr.', 'CTR', 'Pos.']}
            rows={searchTableRows(search.queries)}
          />
          <WebsiteTable
            title="Top search pages"
            columns={['Clicks', 'Impr.', 'CTR', 'Pos.']}
            rows={searchTableRows(search.pages)}
          />
        </div>
      )}
    </div>
  );
};

export const AdminStatsComponent: FC = () => {
  const user = useUser();

  const [fromInput, setFromInput] = useState(today());
  const [toInput, setToInput] = useState(today());
  const [range, setRange] = useState({ from: today(), to: today() });
  const [unknownOnly, setUnknownOnly] = useState(false);

  const { data, isLoading, error } = useStats({ ...range, unknownOnly });

  const applyRange = useCallback((next: { from: string; to: string }) => {
    setFromInput(next.from);
    setToInput(next.to);
    setRange(next);
  }, []);

  if (!user?.isSuperAdmin) {
    return (
      <div className="text-textColor p-[20px]">
        You do not have access to this page.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px] text-textColor">
      <div className="flex items-center justify-between">
        <div className="text-[20px] font-[600]">Admin Stats</div>
        {data && (
          <div className="text-[13px] opacity-70">
            {new Date(data.from).toLocaleDateString()} —{' '}
            {new Date(data.to).toLocaleDateString()}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-[8px]">
        {PRESETS.map((preset) => {
          const next = preset.range();
          const active = range.from === next.from && range.to === next.to;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyRange(next)}
              className={`h-[32px] px-[12px] rounded-[8px] text-[13px] border cursor-pointer whitespace-nowrap ${
                active
                  ? 'bg-forth text-white border-forth'
                  : 'bg-newBgColorInner text-textColor border-newTableBorder hover:bg-tableBorder'
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-[12px] items-end bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px]">
        <div className="flex flex-col gap-[6px]">
          <div className="text-[12px] opacity-70">From</div>
          <input
            type="date"
            value={fromInput}
            max={toInput}
            onChange={(e) => setFromInput(e.target.value)}
            className="bg-newBgColorInner h-[38px] border border-newTableBorder rounded-[8px] px-[10px] text-[14px] text-textColor"
          />
        </div>
        <div className="flex flex-col gap-[6px]">
          <div className="text-[12px] opacity-70">To</div>
          <input
            type="date"
            value={toInput}
            min={fromInput}
            max={today()}
            onChange={(e) => setToInput(e.target.value)}
            className="bg-newBgColorInner h-[38px] border border-newTableBorder rounded-[8px] px-[10px] text-[14px] text-textColor"
          />
        </div>
        <Button
          onClick={() => setRange({ from: fromInput, to: toInput })}
          disabled={!fromInput || !toInput || fromInput > toInput}
        >
          Apply
        </Button>

        <label
          className="flex items-center gap-[6px] text-[13px] cursor-pointer h-[38px]"
          title='Only count errors whose message matches "message":"Unknown Error" (affects the error stats only)'
        >
          <input
            type="checkbox"
            checked={unknownOnly}
            onChange={(e) => setUnknownOnly(e.target.checked)}
          />
          Unknown errors only
        </label>
      </div>

      <GrowthSection range={range} />

      <WebsiteSection range={range} />

      {isLoading ? (
        <LoadingComponent />
      ) : error || !data ? (
        <div className="text-red-400">Failed to load stats.</div>
      ) : (
        <div className="overflow-x-auto pb-[8px] scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor flex flex-col gap-[16px]">
          <div className="flex gap-[12px]">
            <div className="flex-1 min-w-[220px] shrink-0">
              <SummaryCard
                label="Total posts published"
                value={data.posts.total}
              />
            </div>
            <div className="flex-1 min-w-[220px] shrink-0">
              <SummaryCard
                label="Total connected accounts"
                value={data.connected.total}
              />
            </div>
            <div className="flex-1 min-w-[220px] shrink-0">
              <SummaryCard
                label={unknownOnly ? 'Total unknown errors' : 'Total errors'}
                value={data.errors.total}
              />
            </div>
            {data.publishingChannels && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <SummaryCard
                  label="Unique channels - published (all platforms combined)"
                  value={data.publishingChannels.total}
                />
              </div>
            )}
            {data.scheduledChannels && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <SummaryCard
                  label="Unique channels - scheduled (all platforms combined)"
                  value={data.scheduledChannels.total}
                />
              </div>
            )}
            {data.publishingAccounts && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <SummaryCard
                  label="Unique users - published (all platforms combined)"
                  value={data.publishingAccounts.total}
                />
              </div>
            )}
            {data.scheduledAccounts && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <SummaryCard
                  label="Unique users - scheduled (all platforms combined)"
                  value={data.scheduledAccounts.total}
                />
              </div>
            )}
            {data.activeOrgsBySource && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <SummaryCard
                  label="Unique users - active (all sources combined)"
                  value={data.activeOrgsBySource.total}
                />
              </div>
            )}
            {data.connectedClients && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <SummaryCard
                  label="Connected clients (all clients combined)"
                  value={data.connectedClients.total}
                />
              </div>
            )}
          </div>

          <div className="flex gap-[12px] items-start">
            <div className="flex-1 min-w-[220px] shrink-0">
              <PerSocialTable
                title="Posts published per social"
                block={data.posts}
              />
            </div>
            <div className="flex-1 min-w-[220px] shrink-0">
              <PerSocialTable
                title="Connected accounts per social"
                block={data.connected}
              />
            </div>
            <div className="flex-1 min-w-[220px] shrink-0">
              <PerSocialTable
                title={
                  unknownOnly
                    ? 'Unknown errors per social'
                    : 'Errors per social'
                }
                block={data.errors}
              />
            </div>
            {data.publishingChannels && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <PerSocialTable
                  title="Unique channels - published"
                  block={data.publishingChannels}
                />
              </div>
            )}
            {data.scheduledChannels && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <PerSocialTable
                  title="Unique channels - scheduled"
                  block={data.scheduledChannels}
                />
              </div>
            )}
            {data.publishingAccounts && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <PerSocialTable
                  title="Unique users - published"
                  block={data.publishingAccounts}
                />
              </div>
            )}
            {data.scheduledAccounts && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <PerSocialTable
                  title="Unique users - scheduled"
                  block={data.scheduledAccounts}
                />
              </div>
            )}
            {data.activeOrgsBySource && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <PerSocialTable
                  title="Active users per source"
                  block={data.activeOrgsBySource}
                />
              </div>
            )}
            {data.connectedClients && (
              <div className="flex-1 min-w-[220px] shrink-0">
                <PerSocialTable
                  title="Connected clients per name"
                  block={data.connectedClients}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
