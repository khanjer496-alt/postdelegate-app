// the service pulls in heavy provider modules that are not under test
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
// a small read limit, so the cut-off history can be tested
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository',
  () => ({ AnalyticsRepository: class {}, HISTORY_READ_LIMIT: 7 })
);
const store = new Map<string, string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: jest.fn(async (key: string) => store.get(key)),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
  },
}));

import {
  AnalyticsService,
  dailyGains,
} from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.service';

const asObject = (gains: Map<string, number>) => Object.fromEntries(gains);

describe('dailyGains', () => {
  it('is each reading minus the one before it, the first being the base', () => {
    expect(
      asObject(
        dailyGains([
          { date: '2026-10-01', value: 100 },
          { date: '2026-10-02', value: 130 },
          { date: '2026-10-03', value: 135 },
        ])
      )
    ).toEqual({ '2026-10-02': 30, '2026-10-03': 5 });
  });

  it('reads the readings in date order', () => {
    expect(
      asObject(
        dailyGains([
          { date: '2026-10-03', value: 135 },
          { date: '2026-10-01', value: 100 },
          { date: '2026-10-02', value: 130 },
        ])
      )
    ).toEqual({ '2026-10-02': 30, '2026-10-03': 5 });
  });

  it('spreads the gain of missed days evenly, the remainder on the last day', () => {
    expect(
      asObject(
        dailyGains([
          { date: '2026-10-01', value: 100 },
          { date: '2026-10-04', value: 110 },
        ])
      )
    ).toEqual({ '2026-10-02': 3, '2026-10-03': 3, '2026-10-04': 4 });
  });

  it('never goes below 0 when a count drops', () => {
    expect(
      asObject(
        dailyGains([
          { date: '2026-10-01', value: 500 },
          // a platform recount
          { date: '2026-10-02', value: 420 },
          { date: '2026-10-03', value: 450 },
          { date: '2026-10-04', value: 530 },
        ])
      )
    ).toEqual({
      '2026-10-02': 0,
      // the lower count held a second reading: a lasting recount, gains
      // count from it again
      '2026-10-03': 30,
      '2026-10-04': 80,
    });
  });

  it('does not freeze after a lasting downward recount', () => {
    expect(
      asObject(
        dailyGains([
          { date: '2026-10-01', value: 10000 },
          { date: '2026-10-02', value: 6000 },
          { date: '2026-10-03', value: 6000 },
          { date: '2026-10-04', value: 6100 },
          { date: '2026-10-05', value: 6250 },
        ])
      )
    ).toEqual({
      '2026-10-02': 0,
      '2026-10-03': 0,
      '2026-10-04': 100,
      '2026-10-05': 150,
    });
  });

  it('never counts a reading that dips and comes back twice', () => {
    expect(
      asObject(
        dailyGains([
          { date: '2026-10-01', value: 1000 },
          // the platform briefly answers 0
          { date: '2026-10-02', value: 0 },
          { date: '2026-10-03', value: 1010 },
        ])
      )
    ).toEqual({ '2026-10-02': 0, '2026-10-03': 10 });
  });

  it('counts a two-reading dip that comes back as a recount (known limit)', () => {
    // two low readings in a row can't be told from a lasting recount, so the
    // recovery counts again: 1000 views are counted twice here
    expect(
      asObject(
        dailyGains([
          { date: '2026-10-01', value: 1000 },
          { date: '2026-10-02', value: 0 },
          { date: '2026-10-03', value: 0 },
          { date: '2026-10-04', value: 1000 },
        ])
      )
    ).toEqual({ '2026-10-02': 0, '2026-10-03': 0, '2026-10-04': 1000 });
  });

  it('gives missed days 0 when the count dropped across them', () => {
    expect(
      asObject(
        dailyGains([
          { date: '2026-10-01', value: 50 },
          { date: '2026-10-03', value: 40 },
          { date: '2026-10-04', value: 58 },
        ])
      )
    ).toEqual({ '2026-10-02': 0, '2026-10-03': 0, '2026-10-04': 8 });
  });

  it('counts a new post from the day it went out', () => {
    expect(
      asObject(
        dailyGains(
          [
            { date: '2026-10-02', value: 300 },
            { date: '2026-10-03', value: 340 },
          ],
          '2026-10-01'
        )
      )
    ).toEqual({ '2026-10-01': 150, '2026-10-02': 150, '2026-10-03': 40 });
    // published the day it was first read
    expect(
      asObject(dailyGains([{ date: '2026-10-02', value: 12 }], '2026-10-02'))
    ).toEqual({ '2026-10-02': 12 });
  });

  it('takes the first reading of an older post as its base', () => {
    expect(
      asObject(
        dailyGains(
          [
            { date: '2026-10-10', value: 9000 },
            { date: '2026-10-11', value: 9010 },
          ],
          '2026-09-01'
        )
      )
    ).toEqual({ '2026-10-11': 10 });
  });

  it('is empty without readings', () => {
    expect(dailyGains([]).size).toBe(0);
  });
});

const channel = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Channel ${id}`,
  customName: null as string | null,
  picture: null as string | null,
  providerIdentifier: 'history-network',
  type: 'social',
  disabled: false,
  refreshNeeded: false,
  inBetweenSteps: false,
  tokenExpiration: null as Date | null,
  ...overrides,
});

const reading = (
  integrationId: string,
  externalId: string,
  date: string,
  views: number
) => ({
  integrationId,
  externalId,
  date: new Date(`${date}T00:00:00Z`),
  views,
});

const analyticsPost = (
  integrationId: string,
  externalId: string,
  overrides: Record<string, unknown> = {}
) => ({
  id: `ap-${externalId}`,
  integrationId,
  externalId,
  postId: null as string | null,
  publishedAt: new Date('2026-09-01T10:00:00Z'),
  title: `Post ${externalId}`,
  url: null as string | null,
  views: null as number | null,
  likes: null as number | null,
  comments: null as number | null,
  shares: null as number | null,
  clicks: null as number | null,
  ...overrides,
});

// Fake networks described only by what the provider interface declares: the
// service must not know any network by name
const providers: Record<string, any> = {
  // daily views in analytics(), posts read live
  'live-network': {
    viewsMetric: { channel: 'Plays per day', post: ['Plays'] },
    analytics: jest.fn(),
    topViewedPosts: jest.fn(),
    authorizationPolicy: { bypassAnalyticsCache: true },
  },
  // lifetime post views kept in the daily history
  'history-network': {
    viewsMetric: { post: ['Views'] },
    postAnalytics: jest.fn(),
    accountStats: jest.fn(),
  },
  // daily series dated by the end of each day
  'offset-network': {
    viewsMetric: { channel: 'Media views', channelDateOffset: -1 },
    analytics: jest.fn(),
  },
  // shares analytics, but does not say which metric counts views
  'silent-network': { analytics: jest.fn(), postAnalytics: jest.fn() },
};

const org = { id: 'org-A' } as any;
const NOW = new Date('2026-10-07T15:00:00Z');

const makeService = () => {
  store.clear();
  const repository = {
    getOverviewChannels: jest.fn().mockResolvedValue([]),
    getPostViewSnapshots: jest.fn().mockResolvedValue([]),
    getAnalyticsPostsOf: jest.fn().mockResolvedValue([]),
  };
  const integrationService = {
    checkAnalytics: jest.fn().mockResolvedValue([]),
    topViewedPosts: jest.fn().mockResolvedValue({ supported: true, posts: [] }),
  };
  const integrationManager = {
    getSocialIntegration: jest.fn((identifier: string) => providers[identifier]),
  };
  return {
    service: new AnalyticsService(
      repository as any,
      integrationService as any,
      integrationManager as any
    ),
    repository,
    integrationService,
  };
};

describe('AnalyticsService.viewsSourceOf', () => {
  const { service } = makeService();

  it('follows what each provider declares', () => {
    expect(service.viewsSourceOf('live-network', 'channel')).toBe('live');
    expect(service.viewsSourceOf('live-network', 'posts')).toBe('live');
    expect(service.viewsSourceOf('history-network', 'channel')).toBe('history');
    expect(service.viewsSourceOf('history-network', 'posts')).toBe('history');
    expect(service.viewsSourceOf('silent-network', 'channel')).toBeNull();
    expect(service.viewsSourceOf('unknown-network', 'posts')).toBeNull();
  });

  it('has no history source while the history is switched off', () => {
    process.env.ANALYTICS_HISTORY_DISABLED = 'true';
    try {
      expect(service.viewsSourceOf('history-network', 'channel')).toBeNull();
      expect(service.viewsSourceOf('live-network', 'channel')).toBe('live');
    } finally {
      delete process.env.ANALYTICS_HISTORY_DISABLED;
    }
  });
});

describe('AnalyticsService.getViewGains', () => {
  it('reads only the caller organization and its own channels', async () => {
    const { service, repository, integrationService } = makeService();
    repository.getOverviewChannels.mockResolvedValue([
      channel('h1'),
      channel('l1', { providerIdentifier: 'live-network' }),
      channel('s1', { providerIdentifier: 'silent-network' }),
      channel('off', { disabled: true }),
    ]);

    await service.getViewGains(org, 7, NOW);

    expect(repository.getOverviewChannels).toHaveBeenCalledWith('org-A');
    expect(repository.getPostViewSnapshots).toHaveBeenCalledWith(
      'org-A',
      ['h1'],
      // a week before the range, for the base of its first days
      new Date('2026-09-24T00:00:00Z'),
      NOW
    );
    expect(repository.getAnalyticsPostsOf.mock.calls[0][0]).toBe('org-A');
    expect(integrationService.checkAnalytics).toHaveBeenCalledTimes(1);
    // a soft refresh, so the page never flags a channel
    expect(integrationService.checkAnalytics).toHaveBeenCalledWith(
      org,
      'l1',
      '7',
      false,
      'soft'
    );
  });

  it('charts daily gains per channel, their total and best day', async () => {
    const { service, repository, integrationService } = makeService();
    repository.getOverviewChannels.mockResolvedValue([
      channel('h1'),
      channel('h2'),
      channel('l1', { providerIdentifier: 'live-network' }),
      channel('l2', { providerIdentifier: 'live-network', refreshNeeded: true }),
      channel('s1', { providerIdentifier: 'silent-network' }),
    ]);
    repository.getPostViewSnapshots.mockResolvedValue([
      reading('h1', 'p1', '2026-10-04', 100),
      reading('h1', 'p1', '2026-10-05', 150),
      reading('h1', 'p1', '2026-10-07', 170),
      reading('h1', 'p2', '2026-10-06', 40),
      reading('h1', 'p2', '2026-10-07', 45),
      // only one day so far
      reading('h2', 'p3', '2026-10-07', 900),
    ]);
    repository.getAnalyticsPostsOf.mockResolvedValue([
      analyticsPost('h1', 'p1'),
      // went out the day before its first reading
      analyticsPost('h1', 'p2', { publishedAt: new Date('2026-10-05T20:00:00Z') }),
      analyticsPost('h2', 'p3'),
    ]);
    integrationService.checkAnalytics.mockResolvedValue([
      { label: 'Likes', data: [{ total: 9, date: '2026-10-02' }] },
      {
        label: 'Plays per day',
        data: [
          { total: 12, date: '2026-10-01' },
          { total: 7, date: '2026-10-02' },
          { total: '30', date: '2026-10-05' },
        ],
      },
    ]);

    const result = await service.getViewGains(org, 7, NOW);

    expect(result.dates).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
    ]);
    const byId = Object.fromEntries(result.channels.map((c) => [c.id, c]));
    expect(byId.h1).toMatchObject({
      status: 'ok',
      source: 'history',
      // p1: +50 on the 5th, +20 over the 6th and 7th; p2: new on the 5th
      points: [null, null, null, null, 70, 30, 15],
      total: 115,
      bestDay: { date: '2026-10-05', views: 70 },
    });
    expect(byId.h2).toMatchObject({ status: 'collecting', total: null });
    expect(byId.l1).toMatchObject({
      status: 'ok',
      source: 'live',
      points: [12, 7, null, null, 30, null, null],
      total: 49,
      bestDay: { date: '2026-10-05', views: 30 },
    });
    expect(byId.l2).toMatchObject({ status: 'unavailable', total: null });
    expect(byId.s1).toMatchObject({ status: 'unsupported', source: null });

    expect(result.total).toEqual([12, 7, null, null, 100, 30, 15]);
    expect(result.totalViews).toBe(164);
    expect(result.bestDay).toEqual({ date: '2026-10-05', views: 100 });
    // channels with data first, the most views first
    expect(result.channels.map((c) => c.id)).toEqual([
      'h1',
      'l1',
      'h2',
      'l2',
      's1',
    ]);
  });

  it('reports a live channel that does not answer as unavailable', async () => {
    const { service, repository, integrationService } = makeService();
    repository.getOverviewChannels.mockResolvedValue([
      channel('l1', { providerIdentifier: 'live-network' }),
    ]);
    integrationService.checkAnalytics.mockRejectedValue(new Error('down'));

    const result = await service.getViewGains(org, 7, NOW);

    expect(result.channels[0]).toMatchObject({ status: 'unavailable' });
    expect(result.totalViews).toBeNull();
    expect(result.bestDay).toBeNull();
  });
});

describe('AnalyticsService.getViewGainPosts', () => {
  it('only asks for channels of the caller organization', async () => {
    const { service, repository, integrationService } = makeService();
    repository.getOverviewChannels.mockResolvedValue([
      channel('h1'),
      channel('l1', { providerIdentifier: 'live-network' }),
    ]);

    await service.getViewGainPosts(
      org,
      30,
      { integrations: ['h1', 'l1', 'other-org-channel'] },
      NOW
    );

    expect(repository.getOverviewChannels).toHaveBeenCalledWith('org-A');
    expect(repository.getPostViewSnapshots.mock.calls[0][0]).toBe('org-A');
    expect(repository.getPostViewSnapshots.mock.calls[0][1]).toEqual(['h1']);
    expect(integrationService.topViewedPosts).toHaveBeenCalledTimes(1);
    expect(integrationService.topViewedPosts).toHaveBeenCalledWith(
      org,
      'l1',
      30,
      10
    );
  });

  it('asks for nothing when no requested channel is the organization’s', async () => {
    const { service, repository, integrationService } = makeService();
    repository.getOverviewChannels.mockResolvedValue([channel('h1')]);

    const result = await service.getViewGainPosts(
      org,
      30,
      { integrations: ['other-org-channel'] },
      NOW
    );

    expect(result.posts).toEqual([]);
    expect(repository.getPostViewSnapshots.mock.calls[0][0]).toBe('org-A');
    expect(integrationService.topViewedPosts).not.toHaveBeenCalled();
  });

  it('ranks posts of every source by views gained in the range', async () => {
    const { service, repository, integrationService } = makeService();
    repository.getOverviewChannels.mockResolvedValue([
      channel('h1'),
      channel('l1', { providerIdentifier: 'live-network' }),
      channel('l2', { providerIdentifier: 'live-network' }),
    ]);
    repository.getPostViewSnapshots.mockResolvedValue([
      // before the 7-day range: only the base
      reading('h1', 'p1', '2026-09-29', 1000),
      reading('h1', 'p1', '2026-10-01', 1100),
      reading('h1', 'p1', '2026-10-07', 1400),
      reading('h1', 'p2', '2026-10-06', 5),
      reading('h1', 'p2', '2026-10-07', 5),
    ]);
    repository.getAnalyticsPostsOf.mockResolvedValue([
      analyticsPost('h1', 'p1', { postId: 'pd-1', url: 'https://example.com/p1' }),
      analyticsPost('h1', 'p2'),
    ]);
    integrationService.topViewedPosts.mockImplementation(
      async (_org: unknown, id: string) =>
        id === 'l1'
          ? {
              supported: true,
              posts: [
                { id: 'v1', views: 250, title: 'Video', url: 'javascript:alert(1)' },
                { id: 'v2', views: 0 },
              ],
            }
          : { supported: true, unavailable: true, posts: [] }
    );

    const result = await service.getViewGainPosts(org, 7, {}, NOW);

    expect(result.unavailable).toBe(1);
    expect(result.posts).toEqual([
      {
        id: 'ap-p1',
        externalId: 'p1',
        postId: 'pd-1',
        channel: {
          id: 'h1',
          name: 'Channel h1',
          picture: null,
          identifier: 'history-network',
        },
        title: 'Post p1',
        url: 'https://example.com/p1',
        publishedAt: '2026-09-01T10:00:00.000Z',
        // 50 of the 100 gained over the 30th and the 1st, then 300
        gained: 350,
        views: 1400,
      },
      {
        id: 'l1:v1',
        externalId: 'v1',
        postId: null,
        channel: {
          id: 'l1',
          name: 'Channel l1',
          picture: null,
          identifier: 'live-network',
        },
        title: 'Video',
        // only web links are passed on
        url: null,
        publishedAt: null,
        gained: 250,
        views: null,
      },
    ]);
  });

  it('keeps the limit per channel, so a smaller channel keeps its posts', async () => {
    const { service, repository, integrationService } = makeService();
    repository.getOverviewChannels.mockResolvedValue([
      channel('big', { providerIdentifier: 'live-network' }),
      channel('small', { providerIdentifier: 'live-network' }),
    ]);
    integrationService.topViewedPosts.mockImplementation(
      async (_org: unknown, id: string) => ({
        supported: true,
        posts:
          id === 'big'
            ? [
                { id: 'a', views: 3000 },
                { id: 'b', views: 9000 },
                { id: 'c', views: 5000 },
              ]
            : [
                { id: 'd', views: 4 },
                { id: 'e', views: 7 },
                { id: 'f', views: 1 },
              ],
      })
    );

    const result = await service.getViewGainPosts(org, 7, { limit: 2 }, NOW);

    expect(result.posts.map((post) => post.externalId)).toEqual([
      'b',
      'c',
      'e',
      'd',
    ]);
  });
});

describe('AnalyticsService view gains, history sharing and limits', () => {
  it('reads the history once for both Views calls of a page', async () => {
    const { service, repository } = makeService();
    repository.getOverviewChannels.mockResolvedValue([channel('h1')]);
    repository.getPostViewSnapshots.mockResolvedValue([
      reading('h1', 'p1', '2026-10-05', 10),
      reading('h1', 'p1', '2026-10-06', 25),
    ]);

    const gains = await service.getViewGains(org, 7, NOW);
    const posts = await service.getViewGainPosts(org, 7, {}, NOW);

    expect(repository.getPostViewSnapshots).toHaveBeenCalledTimes(1);
    expect(gains.channels[0]).toMatchObject({ id: 'h1', total: 15 });
    expect(posts.posts.map((post) => post.gained)).toEqual([15]);
  });

  it('leaves out the oldest day when the read limit cuts it, and says so', async () => {
    const { service, repository } = makeService();
    repository.getOverviewChannels.mockResolvedValue([channel('h1')]);
    // newest first, as the repository reads them; 7 rows hit the limit
    repository.getPostViewSnapshots.mockResolvedValue([
      reading('h1', 'p1', '2026-10-07', 40),
      reading('h1', 'p2', '2026-10-07', 9),
      reading('h1', 'p1', '2026-10-06', 30),
      reading('h1', 'p2', '2026-10-06', 4),
      // the oldest day read, maybe without all its posts
      reading('h1', 'p1', '2026-10-05', 0),
      reading('h1', 'p3', '2026-10-05', 99),
      reading('h1', 'p2', '2026-10-05', 1),
    ]);

    const result = await service.getViewGains(org, 7, NOW);

    expect(result.partial).toBe(true);
    // the 5th is a base no more: gains start on the 7th
    expect(result.channels[0].points.slice(4)).toEqual([null, null, 15]);
  });

  it('is not partial under the limit', async () => {
    const { service, repository } = makeService();
    repository.getOverviewChannels.mockResolvedValue([channel('h1')]);
    expect((await service.getViewGains(org, 7, NOW)).partial).toBe(false);
  });

  it('moves a daily series dated by the end of each day back one day', async () => {
    const { service, repository, integrationService } = makeService();
    repository.getOverviewChannels.mockResolvedValue([
      channel('o1', { providerIdentifier: 'offset-network' }),
    ]);
    integrationService.checkAnalytics.mockResolvedValue([
      {
        label: 'Media views',
        data: [
          { total: 35, date: '2026-10-02' },
          { total: 12, date: '2026-10-03' },
        ],
      },
    ]);

    const result = await service.getViewGains(org, 7, NOW);

    expect(result.channels[0].points.slice(0, 3)).toEqual([35, 12, null]);
  });
});
