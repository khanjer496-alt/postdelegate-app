import { WebsiteStatsService } from '@gitroom/nestjs-libraries/services/website.stats.service';

const redisGet = jest.fn();
const redisSet = jest.fn();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: (...args: unknown[]) => redisGet(...args),
    set: (...args: unknown[]) => redisSet(...args),
  },
}));

jest.mock('google-auth-library', () => ({
  JWT: jest.fn().mockImplementation(() => ({
    getAccessToken: async () => ({ token: 'gsc-access-token' }),
  })),
}));

const ENV = [
  'CLOUDFLARE_ANALYTICS_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_WEB_ANALYTICS_SITE_TAG',
  'GOOGLE_SEARCH_CONSOLE_SITE',
  'GOOGLE_SEARCH_CONSOLE_CREDENTIALS',
  'FRONTEND_URL',
];

const connectAll = () => {
  process.env.CLOUDFLARE_ANALYTICS_TOKEN = 'cf-secret-token';
  process.env.CLOUDFLARE_ACCOUNT_ID = 'account_1';
  process.env.CLOUDFLARE_WEB_ANALYTICS_SITE_TAG = 'site_1';
  process.env.FRONTEND_URL = 'https://app.postdelegate.com';
  process.env.GOOGLE_SEARCH_CONSOLE_SITE = 'sc-domain:postdelegate.com';
  process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS = Buffer.from(
    JSON.stringify({
      client_email: 'stats@project.iam.gserviceaccount.com',
      private_key: 'private-key',
    })
  ).toString('base64');
};

// the dates of the range are recent, so the 6 months of Cloudflare keep them
const day = (offset: number) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - offset);
  return date;
};
const iso = (offset: number) => {
  const date = day(offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(date.getDate()).padStart(2, '0')}`;
};
const range = { from: day(2), to: day(0) };

// the shape Cloudflare answers the RUM query with
const rumFixture = () => ({
  data: {
    viewer: {
      accounts: [
        {
          totals: [{ count: 120, sum: { visits: 45 } }],
          perDay: [
            { count: 70, sum: { visits: 30 }, dimensions: { date: iso(2) } },
            { count: 50, sum: { visits: 15 }, dimensions: { date: iso(0) } },
          ],
          pages: [
            { count: 80, sum: { visits: 40 }, dimensions: { name: '/' } },
            { count: 40, sum: { visits: 5 }, dimensions: { name: '/pricing' } },
          ],
          countries: [
            { count: 100, sum: { visits: 40 }, dimensions: { name: 'US' } },
          ],
          referrers: [
            {
              count: 30,
              sum: { visits: 30 },
              dimensions: { name: 'www.google.com' },
            },
            {
              count: 60,
              sum: { visits: 0 },
              dimensions: { name: 'postdelegate.com' },
            },
          ],
        },
      ],
    },
  },
  errors: null,
});

// the shape Search Console answers each searchAnalytics query with
const searchFixture = (body: { dimensions?: string[] }) => {
  switch (body.dimensions?.[0]) {
    case 'date':
      return {
        rows: [
          {
            keys: [iso(2)],
            clicks: 3,
            impressions: 100,
            ctr: 0.03,
            position: 9.5,
          },
        ],
      };
    case 'query':
      return {
        rows: [
          {
            keys: ['social scheduler'],
            clicks: 3,
            impressions: 50,
            ctr: 0.06,
            position: 7.1,
          },
          {
            keys: ['postdelegate'],
            clicks: 1,
            impressions: 400,
            ctr: 0.0025,
            position: 1.2,
          },
        ],
      };
    case 'page':
      return {
        rows: [
          {
            keys: ['https://postdelegate.com/'],
            clicks: 4,
            impressions: 450,
            ctr: 0.0089,
            position: 3.3,
          },
        ],
      };
    default:
      // the totals: no dimensions, so the row has no keys
      return {
        rows: [{ clicks: 4, impressions: 450, ctr: 0.0089, position: 3.3 }],
      };
  }
};

describe('WebsiteStatsService', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    ENV.forEach((name) => delete process.env[name]);
    redisGet.mockReset().mockResolvedValue(null);
    redisSet.mockReset().mockResolvedValue('OK');
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = realFetch;
    ENV.forEach((name) => delete process.env[name]);
    jest.restoreAllMocks();
  });

  it('says a source without its env vars is not connected', async () => {
    const service = new WebsiteStatsService();

    expect(await service.getVisitors(range)).toEqual({ connected: false });
    expect(await service.getSearch(range)).toEqual({ connected: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says a source that fails, without the token, and caches nothing', async () => {
    connectAll();
    fetchMock.mockImplementation(
      async () =>
        new Response('{"error":"bad token cf-secret-token"}', { status: 403 })
    );
    const service = new WebsiteStatsService();

    const visitors = await service.getVisitors(range);
    const search = await service.getSearch(range);

    expect(visitors).toEqual({
      connected: true,
      error: 'Cloudflare could not be reached',
    });
    expect(search).toEqual({
      connected: true,
      error: 'Search Console could not be reached',
    });
    const answer = JSON.stringify([visitors, search]);
    expect(answer).not.toContain('cf-secret-token');
    expect(answer).not.toContain('gsc-access-token');
    expect(redisSet).not.toHaveBeenCalled();
  });

  it('says a Cloudflare query error even when it answers 200', async () => {
    connectAll();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ data: null, errors: [{ message: 'not authorized' }] })
      )
    );

    expect(await new WebsiteStatsService().getVisitors(range)).toEqual({
      connected: true,
      error: 'Cloudflare could not be reached',
    });
  });

  it('maps the Cloudflare answer, every day of the range included', async () => {
    connectAll();
    fetchMock.mockResolvedValue(new Response(JSON.stringify(rumFixture())));

    const visitors = await new WebsiteStatsService().getVisitors(range);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.cloudflare.com/client/v4/graphql');
    expect(init.headers.Authorization).toBe('Bearer cf-secret-token');
    expect(JSON.parse(init.body).variables).toEqual({
      accountTag: 'account_1',
      filter: {
        siteTag: 'site_1',
        bot: 0,
        date_geq: iso(2),
        date_leq: iso(0),
        requestHost_notin: ['app.postdelegate.com', 'localhost', '127.0.0.1'],
      },
      referrerFilter: {
        siteTag: 'site_1',
        bot: 0,
        date_geq: iso(2),
        date_leq: iso(0),
        requestHost_notin: ['app.postdelegate.com', 'localhost', '127.0.0.1'],
        refererHost_neq: '',
      },
      days: 3,
    });
    expect(visitors).toEqual({
      connected: true,
      from: iso(2),
      to: iso(0),
      totals: { pageViews: 120, visits: 45 },
      perDay: [
        { date: iso(2), pageViews: 70, visits: 30 },
        { date: iso(1), pageViews: 0, visits: 0 },
        { date: iso(0), pageViews: 50, visits: 15 },
      ],
      pages: [
        { name: '/', pageViews: 80, visits: 40 },
        { name: '/pricing', pageViews: 40, visits: 5 },
      ],
      countries: [{ name: 'US', pageViews: 100, visits: 40 }],
      // our own host sends no visits
      referrers: [{ name: 'www.google.com', pageViews: 30, visits: 30 }],
    });
    expect(redisSet).toHaveBeenCalledWith(
      `admin:website:visitors:${iso(2)}:${iso(0)}`,
      JSON.stringify(visitors),
      'EX',
      expect.any(Number)
    );
  });

  it('moves a from older than Cloudflare allows in one query up', async () => {
    connectAll();
    fetchMock.mockResolvedValue(new Response(JSON.stringify(rumFixture())));

    const visitors = await new WebsiteStatsService().getVisitors({
      from: day(400),
      to: day(0),
    });

    expect(visitors).toMatchObject({ from: iso(92), to: iso(0) });
    expect(
      JSON.parse(fetchMock.mock.calls[0][1].body).variables.filter
    ).toEqual(expect.objectContaining({ date_geq: iso(92) }));
  });

  it('never asks Cloudflare for days older than it keeps', async () => {
    connectAll();
    fetchMock.mockResolvedValue(new Response(JSON.stringify(rumFixture())));

    const visitors = await new WebsiteStatsService().getVisitors({
      from: day(250),
      to: day(170),
    });

    expect(visitors).toMatchObject({ from: iso(183), to: iso(170) });
  });

  it('answers from the cache without asking Cloudflare', async () => {
    connectAll();
    redisGet.mockResolvedValue(
      JSON.stringify({ connected: true, from: iso(2), to: iso(0) })
    );

    expect(await new WebsiteStatsService().getVisitors(range)).toEqual({
      connected: true,
      from: iso(2),
      to: iso(0),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps the Search Console answers, top by impressions', async () => {
    connectAll();
    fetchMock.mockImplementation(
      async (_url: string, init: { body: string }) =>
        new Response(JSON.stringify(searchFixture(JSON.parse(init.body))))
    );

    const search = await new WebsiteStatsService().getSearch(range);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Apostdelegate.com/searchAnalytics/query'
    );
    expect(init.headers.Authorization).toBe('Bearer gsc-access-token');
    expect(JSON.parse(init.body)).toEqual({
      startDate: iso(2),
      endDate: iso(0),
      rowLimit: 1,
    });
    expect(search).toEqual({
      connected: true,
      totals: { clicks: 4, impressions: 450, ctr: 0.0089, position: 3.3 },
      perDay: [
        { date: iso(2), clicks: 3, impressions: 100 },
        { date: iso(1), clicks: 0, impressions: 0 },
        { date: iso(0), clicks: 0, impressions: 0 },
      ],
      queries: [
        {
          name: 'postdelegate',
          clicks: 1,
          impressions: 400,
          ctr: 0.0025,
          position: 1.2,
        },
        {
          name: 'social scheduler',
          clicks: 3,
          impressions: 50,
          ctr: 0.06,
          position: 7.1,
        },
      ],
      pages: [
        {
          name: 'https://postdelegate.com/',
          clicks: 4,
          impressions: 450,
          ctr: 0.0089,
          position: 3.3,
        },
      ],
    });
  });

  it('says credentials that are not a service account JSON', async () => {
    connectAll();
    process.env.GOOGLE_SEARCH_CONSOLE_CREDENTIALS = 'not-base64-json';

    expect(await new WebsiteStatsService().getSearch(range)).toEqual({
      connected: true,
      error: 'Search Console could not be reached',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
