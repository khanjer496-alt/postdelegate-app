// the service pulls in heavy provider modules that are not under test
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);

import {
  AnalyticsService,
  csvCell,
  periodChange,
  toCsv,
} from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.service';

const channel = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Channel ${id}`,
  customName: null as string | null,
  picture: null as string | null,
  providerIdentifier: 'x',
  type: 'social',
  disabled: false,
  refreshNeeded: false,
  inBetweenSteps: false,
  tokenExpiration: null as Date | null,
  ...overrides,
});

const snapshot = (integrationId: string, date: string, followers: number | null) => ({
  integrationId,
  date: new Date(`${date}T00:00:00Z`),
  followers,
  following: null as number | null,
  posts: null as number | null,
});

let seq = 0;
const post = (overrides: Record<string, any> = {}) => ({
  id: `ap-${++seq}`,
  integrationId: 'a',
  externalId: `ext-${seq}`,
  postId: null as string | null,
  publishedAt: new Date('2026-10-30T12:00:00Z'),
  title: 'A post',
  url: null as string | null,
  views: null as number | null,
  likes: null as number | null,
  comments: null as number | null,
  shares: null as number | null,
  clicks: null as number | null,
  ...overrides,
});

const makeService = () => {
  const repository = {
    getOverviewChannels: jest.fn().mockResolvedValue([]),
    getAccountSnapshots: jest.fn().mockResolvedValue([]),
    getAnalyticsPosts: jest.fn().mockResolvedValue([]),
    countPublished: jest.fn().mockResolvedValue(0),
    getPostsContent: jest.fn().mockResolvedValue([]),
    getDailyPostTotals: jest.fn().mockResolvedValue([]),
  };
  const integrationManager = {
    getSocialIntegration: jest.fn(() => ({ accountStats: jest.fn() })),
  };
  return {
    service: new AnalyticsService(
      repository as any,
      {} as any,
      integrationManager as any
    ),
    repository,
    integrationManager,
  };
};

describe('periodChange', () => {
  it('is the percent change, null without a base to compare with', () => {
    expect(periodChange(150, 100)).toBe(50);
    expect(periodChange(50, 100)).toBe(-50);
    expect(periodChange(-10, 20)).toBe(-150);
    expect(periodChange(1, 3)).toBe(-66.7);
    expect(periodChange(10, 0)).toBeNull();
    expect(periodChange(null, 10)).toBeNull();
    expect(periodChange(10, null)).toBeNull();
  });
});

describe('AnalyticsService history range', () => {
  it('covers the last N UTC days, today included', () => {
    const { service } = makeService();
    const { from, to } = service.historyRange(
      7,
      new Date('2026-10-31T15:00:00Z')
    );
    expect(from).toEqual(new Date('2026-10-25T00:00:00Z'));
    expect(service.daysBetween(from, to)).toEqual([
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ]);
  });
});

describe('AnalyticsService.aggregateTrends', () => {
  const from = new Date('2026-10-25T00:00:00Z');
  const to = new Date('2026-10-31T15:00:00Z');

  it('computes follower growth per channel and the period-over-period comparison', () => {
    const { service } = makeService();
    const result = service.aggregateTrends({
      from,
      to,
      channels: [channel('a'), channel('b'), channel('c')] as any,
      snapshots: [
        // previous period: Oct 18 - Oct 24
        snapshot('a', '2026-10-17', 100),
        snapshot('a', '2026-10-24', 110),
        snapshot('a', '2026-10-27', 125),
        snapshot('a', '2026-10-31', 130),
        // b is tracked since the middle of the current period
        snapshot('b', '2026-10-28', 50),
        snapshot('b', '2026-10-30', 45),
        // c never reports followers
        snapshot('c', '2026-10-26', null),
        // a deleted channel is ignored
        snapshot('gone', '2026-10-01', 9999),
      ],
      posts: [
        post({ integrationId: 'a', likes: 10, comments: 2, shares: 1, views: 400 }),
        post({
          integrationId: 'b',
          likes: 5,
          views: 100,
          publishedAt: new Date('2026-10-20T10:00:00Z'),
        }),
        post({
          integrationId: 'gone',
          likes: 1000,
          publishedAt: new Date('2026-10-29T10:00:00Z'),
        }),
      ] as any,
      published: 8,
      previousPublished: 4,
    });

    expect(result.from).toBe('2026-10-25');
    expect(result.to).toBe('2026-10-31');
    expect(result.firstSnapshot).toBe('2026-10-17');
    expect(result.comparison).toEqual([
      // a: 130 - 110 = 20, b: 45 - 50 = -5
      { key: 'followers', current: 15, previous: 10, change: 50 },
      { key: 'published', current: 8, previous: 4, change: 100 },
      { key: 'engagement', current: 13, previous: 5, change: 160 },
      { key: 'views', current: 400, previous: 100, change: 300 },
    ]);
    expect(result.followers.channels.map((c) => [c.id, c.current, c.gained])).toEqual([
      ['a', 130, 20],
      ['b', 45, -5],
    ]);
    // carried forward between snapshots, null before a channel is tracked
    const a = result.followers.channels[0].points;
    expect(a).toEqual([110, 110, 125, 125, 125, 125, 130]);
    expect(result.followers.total).toEqual([110, 110, 125, 175, 175, 170, 175]);
  });

  it('has no comparison before there is history', () => {
    const { service } = makeService();
    const result = service.aggregateTrends({
      from,
      to,
      channels: [channel('a')] as any,
      snapshots: [snapshot('a', '2026-10-31', 10)],
      posts: [],
      published: 0,
      previousPublished: 0,
    });

    expect(result.comparison).toEqual([
      { key: 'followers', current: null, previous: null, change: null },
      { key: 'published', current: 0, previous: 0, change: null },
      { key: 'engagement', current: null, previous: null, change: null },
      { key: 'views', current: null, previous: null, change: null },
    ]);
    expect(result.followers.channels[0].gained).toBeNull();
  });

  it('reads only the caller organization and narrows to one channel', async () => {
    const { service, repository } = makeService();
    repository.getOverviewChannels.mockResolvedValue([channel('a'), channel('b')]);
    repository.getAccountSnapshots.mockResolvedValue([
      snapshot('a', '2026-10-30', 1),
      snapshot('a', '2026-10-31', 2),
      snapshot('b', '2026-10-31', 5),
    ]);

    const result = await service.getTrends(
      'org-A',
      7,
      'a',
      new Date('2026-10-31T15:00:00Z')
    );

    expect(repository.getOverviewChannels).toHaveBeenCalledWith('org-A');
    expect(repository.getAccountSnapshots.mock.calls[0][0]).toBe('org-A');
    expect(repository.getAccountSnapshots.mock.calls[0][3]).toBe('a');
    expect(repository.getAnalyticsPosts.mock.calls[0][0]).toBe('org-A');
    expect(repository.getAnalyticsPosts.mock.calls[0][3]).toBe('a');
    expect(result.collecting).toBe(true);
    expect(repository.countPublished).toHaveBeenCalledWith(
      'org-A',
      new Date('2026-10-25T00:00:00Z'),
      new Date('2026-10-31T15:00:00Z'),
      'a'
    );
    expect(result.followers.channels.map((c) => c.id)).toEqual(['a']);
  });
});

describe('AnalyticsService trends availability', () => {
  it('reports a channel whose platform forbids keeping analytics as not collected', async () => {
    const { service, repository, integrationManager } = makeService();
    repository.getOverviewChannels.mockResolvedValue([
      channel('yt', { providerIdentifier: 'youtube' }),
    ]);
    integrationManager.getSocialIntegration.mockReturnValue({
      postAnalytics: jest.fn(),
      authorizationPolicy: { bypassAnalyticsCache: true },
    } as any);

    const result = await service.getTrends('org-A', 7, 'yt');

    expect(result.collecting).toBe(false);
  });
});

describe('AnalyticsService.buildTopPosts', () => {
  const channels = [channel('a'), channel('b', { customName: 'Brand B' })] as any;
  const posts = [
    post({ id: 'p1', integrationId: 'a', likes: 10, comments: 0, shares: 0, views: 100 }),
    post({ id: 'p2', integrationId: 'b', likes: 50, comments: 5, shares: 5, views: 1000 }),
    post({ id: 'p3', integrationId: 'a', views: 5000 }),
    post({ id: 'p4', integrationId: 'gone', likes: 999 }),
  ] as any;

  it('sorts by engagement with posts lacking the metric last, and leaves deleted channels out', () => {
    const { service } = makeService();
    const rows = service.buildTopPosts(channels, posts, {});
    expect(rows.map((r) => r.id)).toEqual(['p2', 'p1', 'p3']);
    expect(rows[0]).toMatchObject({
      engagement: 60,
      engagementRate: 6,
      channel: { id: 'b', name: 'Brand B', identifier: 'x' },
    });
    expect(rows[2].engagement).toBeNull();
  });

  it('sorts ascending, by views, and filters channels', () => {
    const { service } = makeService();
    expect(
      service.buildTopPosts(channels, posts, { sort: 'views', order: 'asc' }).map((r) => r.id)
    ).toEqual(['p1', 'p2', 'p3']);
    expect(
      service.buildTopPosts(channels, posts, { integrations: ['a'] }).map((r) => r.id)
    ).toEqual(['p1', 'p3']);
  });

  it('sorts by date', () => {
    const { service } = makeService();
    const dated = [
      post({ id: 'old', publishedAt: new Date('2026-10-01T00:00:00Z') }),
      post({ id: 'new', publishedAt: new Date('2026-10-20T00:00:00Z') }),
    ] as any;
    expect(
      service.buildTopPosts([channel('a')] as any, dated, { sort: 'date' }).map((r) => r.id)
    ).toEqual(['new', 'old']);
  });
});

describe('AnalyticsService.aggregateBestTimes', () => {
  // Monday 2026-10-26, Wednesday 2026-10-28
  const at = (iso: string, likes: number, integrationId = 'a') =>
    post({ integrationId, likes, comments: 0, shares: 0, publishedAt: new Date(iso) });

  it('falls back to publish counts when fewer than 10 posts have engagement', () => {
    const { service } = makeService();
    const result = service.aggregateBestTimes('UTC', [
      at('2026-10-26T09:00:00Z', 5),
      at('2026-10-26T09:30:00Z', 7),
      post({ publishedAt: new Date('2026-10-27T09:00:00Z') }),
    ] as any);
    expect(result.basis).toBe('publish_count');
    expect(result.posts).toBe(2);
    expect(result.required).toBe(10);
  });

  it('recommends days and hours from engagement relative to each channel', () => {
    const { service } = makeService();
    const posts = [
      // channel a: typical post 10 likes, Monday 09:00 posts do 3x
      at('2026-10-26T09:00:00Z', 30),
      at('2026-10-26T09:10:00Z', 30),
      at('2026-10-28T15:00:00Z', 10),
      at('2026-10-28T15:30:00Z', 10),
      at('2026-10-29T15:00:00Z', 10),
      at('2026-10-30T20:00:00Z', 10),
      // channel b is 100x bigger but its Wednesday posts are only typical
      at('2026-10-28T15:00:00Z', 1000, 'b'),
      at('2026-10-28T15:20:00Z', 1000, 'b'),
      at('2026-10-29T15:00:00Z', 1000, 'b'),
      at('2026-10-30T20:00:00Z', 1000, 'b'),
      // one great Sunday post is not enough to recommend Sunday
      at('2026-10-25T06:00:00Z', 100),
    ] as any;

    const result = service.aggregateBestTimes('UTC', posts);

    expect(result.basis).toBe('engagement');
    expect(result.posts).toBe(11);
    expect(result.bestDays[0]).toEqual({ weekday: 1, score: 3, posts: 2 });
    expect(result.bestHours[0]).toEqual({ hour: 9, score: 3, posts: 2 });
    expect(result.bestDays.map((d) => d.weekday)).not.toContain(0);
    expect(result.counts[1][9]).toBe(2);
    expect(result.heatmap[1][9]).toBe(3);
  });

  it('buckets in the requested timezone', () => {
    const { service } = makeService();
    const result = service.aggregateBestTimes('Asia/Dubai', [
      at('2026-10-26T22:00:00Z', 5),
    ] as any);
    expect(result.timezone).toBe('Asia/Dubai');
    // 22:00 UTC Monday is 02:00 Tuesday in Dubai
    expect(result.counts[2][2]).toBe(1);
  });
});

describe('AnalyticsService.aggregateInsights', () => {
  it('groups engagement by content type, length, hashtags and tags', () => {
    const { service } = makeService();
    const posts = [
      post({ id: 'm1', postId: 'p-video', likes: 30, comments: 0, shares: 0, views: 300 }),
      post({ id: 'm2', postId: 'p-carousel', likes: 10, comments: 0, shares: 0 }),
      post({ id: 'm3', postId: 'p-text', likes: 10, comments: 0, shares: 0 }),
      // read back from the platform only: scored, but no content to group
      post({ id: 'm4', postId: null, likes: 10, comments: 0, shares: 0 }),
    ] as any;
    const contents = [
      {
        id: 'p-video',
        content: '<p>Launch day #Launch #news</p>',
        image: JSON.stringify([{ path: 'https://cdn/x/clip.mp4' }]),
        tags: [
          { tag: { id: 't1', name: 'Q4 campaign', color: '#ff0000', deletedAt: null } },
          { tag: { id: 't2', name: 'Old', color: '#000', deletedAt: new Date() } },
        ],
      },
      {
        id: 'p-carousel',
        content: `<p>${'a'.repeat(300)} #launch</p>`,
        image: JSON.stringify([{ path: 'https://cdn/1.png' }, { path: 'https://cdn/2.jpg' }]),
        tags: [],
      },
      { id: 'p-text', content: 'Just words &amp; no tags', image: null, tags: [] },
    ] as any;

    const result = service.aggregateInsights(posts, contents);

    expect(result.posts).toBe(3);
    expect(result.contentTypes.map((g) => [g.key, g.posts, g.avgEngagement, g.score])).toEqual([
      ['video', 1, 30, 3],
      ['carousel', 1, 10, 1],
      ['text', 1, 10, 1],
    ]);
    expect(result.contentTypes[0].avgViews).toBe(300);
    expect(result.contentTypes[1].avgViews).toBeNull();
    expect(result.lengths.map((g) => [g.key, g.posts])).toEqual([
      ['short', 2],
      ['long', 1],
    ]);
    expect(result.hashtags.map((g) => [g.label, g.posts])).toEqual([
      ['#launch', 2],
      ['#news', 1],
    ]);
    expect(result.tags).toEqual([
      expect.objectContaining({ key: 't1', label: 'Q4 campaign', color: '#ff0000', posts: 1 }),
    ]);
  });

  it('reads the content of the caller organization only', async () => {
    const { service, repository } = makeService();
    repository.getOverviewChannels.mockResolvedValue([channel('a')]);
    repository.getAnalyticsPosts.mockResolvedValue([
      post({ postId: 'p1', likes: 1 }),
      post({ postId: 'p1', likes: 2, integrationId: 'gone' }),
      post({ postId: 'p2' }),
    ]);

    await service.getInsights('org-A', 30, new Date('2026-10-31T12:00:00Z'));

    expect(repository.getPostsContent).toHaveBeenCalledWith('org-A', ['p1']);
  });

  it('detects the content type from the post media', () => {
    const { service } = makeService();
    expect(service.contentTypeOf(null)).toBe('text');
    expect(service.contentTypeOf('not json')).toBe('text');
    expect(service.contentTypeOf('[{"path":"a.MOV"}]')).toBe('video');
    expect(service.contentTypeOf('[{"path":"a.png"}]')).toBe('image');
    expect(service.contentTypeOf('[{"path":"a.png"},{"path":"b.mp4"}]')).toBe('video');
    expect(service.hashtagsOf('#ok and #2026 and mail@x.com#no and #a')).toEqual(['ok']);
  });
});

describe('CSV output', () => {
  it('quotes, escapes and defuses formulas', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@me')).toBe("'@me");
  });

  it('starts with a BOM and uses CRLF rows', () => {
    expect(toCsv(['A', 'B'], [[1, 'x'], [null, 'y,z']])).toBe(
      '﻿A,B\r\n1,x\r\n,"y,z"\r\n'
    );
  });

  it('exports the top posts table', () => {
    const { service } = makeService();
    const rows = service.buildTopPosts(
      [channel('a')] as any,
      [
        post({
          id: 'p1',
          title: '=cmd, "quoted"',
          url: 'https://x.com/1',
          views: 200,
          likes: 8,
          comments: 1,
          shares: 1,
          publishedAt: new Date('2026-10-30T12:00:00Z'),
        }),
      ] as any,
      {}
    );
    const csv = service.topPostsCsv(rows);
    const [header, line] = csv.replace('﻿', '').trim().split('\r\n');
    expect(header).toBe(
      'Published (UTC),Channel,Platform,Post,URL,Views,Likes,Comments,Shares,Clicks,Engagement,Engagement rate (%)'
    );
    expect(line).toBe(
      `2026-10-30T12:00:00.000Z,Channel a,x,"'=cmd, ""quoted""",https://x.com/1,200,8,1,1,,10,5`
    );
  });

  it('exports one daily row per channel and day from snapshots and post totals', () => {
    const { service } = makeService();
    const csv = service.dailyCsv(
      [channel('a'), channel('b')] as any,
      [snapshot('a', '2026-10-30', 100), snapshot('b', '2026-10-30', 7), snapshot('gone', '2026-10-30', 1)],
      [
        {
          integrationId: 'a',
          date: new Date('2026-10-30T00:00:00Z'),
          _count: { _all: 3 },
          _sum: { views: 900, likes: 20, comments: 4, shares: 2, clicks: null },
        },
        {
          integrationId: 'a',
          date: new Date('2026-10-31T00:00:00Z'),
          _count: { _all: 1 },
          _sum: { views: 10, likes: 1, comments: 0, shares: 0, clicks: null },
        },
      ]
    );
    expect(csv.replace('﻿', '').trim().split('\r\n')).toEqual([
      'Date,Channel,Platform,Followers,Following,Total posts,Posts tracked,Views,Likes,Comments,Shares,Clicks',
      '2026-10-30,Channel a,x,100,,,3,900,20,4,2,',
      '2026-10-30,Channel b,x,7,,,,,,,,',
      '2026-10-31,Channel a,x,,,,1,10,1,0,0,',
    ]);
  });
});
