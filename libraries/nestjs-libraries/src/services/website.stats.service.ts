import { Injectable } from '@nestjs/common';
import { JWT } from 'google-auth-library';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import dayjs from 'dayjs';

export interface WebsiteStatsParams {
  from: Date;
  to: Date;
}

// A source without its env vars is not connected. A source that can't be
// reached says so in a short message, the details stay in the server logs
export type WebsiteSource<T> =
  | { connected: false }
  | { connected: true; error: string }
  | ({ connected: true } & T);

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

export interface WebsiteVisitors {
  // Cloudflare keeps about 6 months, an older from is moved up to it
  from: string;
  to: string;
  totals: { pageViews: number; visits: number };
  perDay: { date: string; pageViews: number; visits: number }[];
  pages: WebsiteRow[];
  countries: WebsiteRow[];
  referrers: WebsiteRow[];
}

export interface WebsiteSearch {
  totals: {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  };
  perDay: { date: string; clicks: number; impressions: number }[];
  queries: SearchRow[];
  pages: SearchRow[];
}

const TOP = 10;
// Cloudflare's own limits for this dataset: 184 days of history, 93 days
// in one query
const RUM_RETENTION_DAYS = 184;
const RUM_MAX_RANGE_DAYS = 93;
const UPSTREAM_TIMEOUT_MS = 15000;
const SEARCH_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

const cacheSeconds = () =>
  !process.env.NODE_ENV || process.env.NODE_ENV === 'development' ? 1 : 900;

const appHost = () => {
  try {
    return new URL(process.env.FRONTEND_URL || '').hostname;
  } catch {
    return '';
  }
};

// every day of the range, days without data included
const eachDay = (from: string, to: string) => {
  const days: string[] = [];
  const last = dayjs(to);
  if (!last.isValid() || !dayjs(from).isValid()) {
    return days;
  }
  for (let day = dayjs(from); !day.isAfter(last); day = day.add(1, 'day')) {
    days.push(day.format('YYYY-MM-DD'));
  }
  return days;
};

const RUM_QUERY = `query WebsiteStats($accountTag: string!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!, $referrerFilter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!, $days: uint64!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      totals: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 1) {
        count
        sum { visits }
      }
      perDay: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: $days, orderBy: [date_ASC]) {
        count
        sum { visits }
        dimensions { date }
      }
      pages: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: ${TOP}, orderBy: [count_DESC]) {
        count
        sum { visits }
        dimensions { name: requestPath }
      }
      countries: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: ${TOP}, orderBy: [count_DESC]) {
        count
        sum { visits }
        dimensions { name: countryName }
      }
      referrers: rumPageloadEventsAdaptiveGroups(filter: $referrerFilter, limit: ${TOP}, orderBy: [sum_visits_DESC]) {
        count
        sum { visits }
        dimensions { name: refererHost }
      }
    }
  }
}`;

interface RumGroup {
  count: number;
  sum: { visits: number };
  dimensions?: { date?: string; name?: string };
}

const rumRows = (groups: RumGroup[] = []): WebsiteRow[] =>
  groups.map((group) => ({
    name: group.dimensions?.name || '',
    pageViews: group.count,
    visits: group.sum.visits,
  }));

interface SearchApiRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

const searchRows = (rows: SearchApiRow[] = []): SearchRow[] =>
  rows
    .map((row) => ({
      name: row.keys?.[0] || '',
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position,
    }))
    .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
    .slice(0, TOP);

@Injectable()
export class WebsiteStatsService {
  // Cached briefly per source and range, like the provider analytics. Only
  // answers are cached, a failed source is asked again next time
  private async cached<T>(
    key: string,
    load: () => Promise<WebsiteSource<T>>
  ): Promise<WebsiteSource<T>> {
    const found = await ioRedis.get(key);
    if (found) {
      return JSON.parse(found);
    }

    const value = await load();
    if (value.connected && !('error' in value)) {
      await ioRedis.set(key, JSON.stringify(value), 'EX', cacheSeconds());
    }
    return value;
  }

  // Page views and visits of the marketing site from Cloudflare Web
  // Analytics. Visits are page views that came from another website
  async getVisitors(
    params: WebsiteStatsParams
  ): Promise<WebsiteSource<WebsiteVisitors>> {
    const token = process.env.CLOUDFLARE_ANALYTICS_TOKEN;
    const accountTag = process.env.CLOUDFLARE_ACCOUNT_ID;
    const siteTag = process.env.CLOUDFLARE_WEB_ANALYTICS_SITE_TAG;
    if (!token || !accountTag || !siteTag) {
      return { connected: false };
    }

    const to = dayjs(params.to).format('YYYY-MM-DD');
    const retained = dayjs()
      .subtract(RUM_RETENTION_DAYS - 1, 'day')
      .format('YYYY-MM-DD');
    const longest = dayjs(params.to)
      .subtract(RUM_MAX_RANGE_DAYS - 1, 'day')
      .format('YYYY-MM-DD');
    const oldest = retained > longest ? retained : longest;
    const requested = dayjs(params.from).format('YYYY-MM-DD');
    const from = requested < oldest ? oldest : requested;

    return this.cached<WebsiteVisitors>(
      `admin:website:visitors:${from}:${to}`,
      async () => {
        const days = eachDay(from, to);
        if (!days.length) {
          return {
            connected: true,
            from,
            to,
            totals: { pageViews: 0, visits: 0 },
            perDay: [],
            pages: [],
            countries: [],
            referrers: [],
          };
        }

        // bots are left out, like the Web Analytics dashboard does, and so
        // are the app itself and local test runs: the site tag covers every
        // host of the zone
        const filter = {
          siteTag,
          bot: 0,
          date_geq: from,
          date_leq: to,
          requestHost_notin: [appHost(), 'localhost', '127.0.0.1'].filter(
            Boolean
          ),
        };
        let accounts: Record<string, RumGroup[]>[];
        try {
          const res = await fetch(
            'https://api.cloudflare.com/client/v4/graphql',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                query: RUM_QUERY,
                variables: {
                  accountTag,
                  filter,
                  referrerFilter: { ...filter, refererHost_neq: '' },
                  days: days.length,
                },
              }),
              signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
            }
          );
          const body = res.ok ? await res.json() : undefined;
          if (!body || body.errors?.length || !body.data?.viewer?.accounts) {
            console.error('website_visitors_failed', {
              status: res.status,
              err: body?.errors?.[0]?.message,
            });
            return {
              connected: true,
              error: 'Cloudflare could not be reached',
            };
          }
          accounts = body.data.viewer.accounts;
        } catch (err) {
          console.error('website_visitors_failed', {
            err: (err as Error)?.message,
          });
          return { connected: true, error: 'Cloudflare could not be reached' };
        }

        const account = accounts[0] || {};
        const byDay = new Map(
          (account.perDay || []).map((group) => [group.dimensions?.date, group])
        );

        return {
          connected: true,
          from,
          to,
          totals: {
            pageViews: account.totals?.[0]?.count || 0,
            visits: account.totals?.[0]?.sum.visits || 0,
          },
          perDay: days.map((date) => ({
            date,
            pageViews: byDay.get(date)?.count || 0,
            visits: byDay.get(date)?.sum.visits || 0,
          })),
          pages: rumRows(account.pages),
          countries: rumRows(account.countries),
          // a referrer without visits is our own site
          referrers: rumRows(account.referrers).filter((row) => row.visits > 0),
        };
      }
    );
  }

  // Clicks and impressions of the site in Google search, from Search
  // Console. Its data runs about 2 to 3 days behind
  async getSearch(
    params: WebsiteStatsParams
  ): Promise<WebsiteSource<WebsiteSearch>> {
    const site = process.env.GOOGLE_SEARCH_CONSOLE_SITE;
    const credentials = process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS;
    if (!site || !credentials) {
      return { connected: false };
    }

    const from = dayjs(params.from).format('YYYY-MM-DD');
    const to = dayjs(params.to).format('YYYY-MM-DD');

    return this.cached<WebsiteSearch>(
      `admin:website:search:${from}:${to}`,
      async () => {
        let account: { client_email?: string; private_key?: string };
        try {
          account = JSON.parse(
            Buffer.from(credentials, 'base64').toString('utf8')
          );
        } catch {
          // the parse error quotes the input, which is the private key
          console.error('website_search_failed', {
            err: 'credentials are not base64 service-account JSON',
          });
          return {
            connected: true,
            error: 'Search Console could not be reached',
          };
        }

        let rows: SearchApiRow[][];
        try {
          const auth = new JWT({
            email: account.client_email,
            key: account.private_key,
            scopes: [SEARCH_SCOPE],
          });
          const { token } = await auth.getAccessToken();

          const query = async (dimensions: string[], rowLimit: number) => {
            const res = await fetch(
              `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
                site
              )}/searchAnalytics/query`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  startDate: from,
                  endDate: to,
                  ...(dimensions.length ? { dimensions } : {}),
                  rowLimit,
                }),
                signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
              }
            );
            if (!res.ok) {
              throw new Error(`Search Console answered ${res.status}`);
            }
            return ((await res.json()).rows || []) as SearchApiRow[];
          };

          // Search Console sorts by clicks, the top by impressions is picked
          // from a longer list
          rows = await Promise.all([
            query([], 1),
            query(['date'], eachDay(from, to).length),
            query(['query'], 1000),
            query(['page'], 1000),
          ]);
        } catch (err) {
          console.error('website_search_failed', {
            err: (err as Error)?.message,
          });
          return {
            connected: true,
            error: 'Search Console could not be reached',
          };
        }

        const [totals, perDay, queries, pages] = rows;
        const byDay = new Map(perDay.map((row) => [row.keys?.[0], row]));

        return {
          connected: true,
          totals: {
            clicks: totals[0]?.clicks || 0,
            impressions: totals[0]?.impressions || 0,
            ctr: totals[0]?.ctr || 0,
            position: totals[0]?.position || 0,
          },
          perDay: eachDay(from, to).map((date) => ({
            date,
            clicks: byDay.get(date)?.clicks || 0,
            impressions: byDay.get(date)?.impressions || 0,
          })),
          queries: searchRows(queries),
          pages: searchRows(pages),
        };
      }
    );
  }
}
