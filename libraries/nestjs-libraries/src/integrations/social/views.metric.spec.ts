// Each provider's viewsMetric must name labels its own analytics code returns,
// otherwise the Views charts silently stay empty. Only the network calls are
// replaced, the provider code runs as is.
const reportsQuery = jest.fn();
const videosList = jest.fn();
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials() {
          return undefined;
        }
      },
    },
    youtube: () => ({ videos: { list: videosList } }),
    youtubeAnalytics: () => ({ reports: { query: reportsQuery } }),
    oauth2: () => ({}),
  },
}));

import 'reflect-metadata';
import { YoutubeProvider } from '@gitroom/nestjs-libraries/integrations/social/youtube.provider';
import { TiktokProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';
import { TiktokBusinessProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.business.provider';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { InstagramStandaloneProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.standalone.provider';
import { FacebookProvider } from '@gitroom/nestjs-libraries/integrations/social/facebook.provider';
import { XProvider } from '@gitroom/nestjs-libraries/integrations/social/x.provider';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { AnalyticsData } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

const json = (body: unknown) => ({ json: async () => body } as any);
const labels = (data: AnalyticsData[]) => data.map((metric) => metric.label);
const metricOf = (data: AnalyticsData[], label?: string) =>
  data.find((metric) => metric.label === label);

let fetchMock: jest.SpyInstance;
beforeEach(() => {
  fetchMock = jest.spyOn(global, 'fetch' as any);
  reportsQuery.mockReset();
  videosList.mockReset();
});
afterEach(() => {
  fetchMock.mockRestore();
});

describe('YouTube viewsMetric', () => {
  const provider = new YoutubeProvider();

  it('names the daily views series of analytics()', async () => {
    reportsQuery.mockResolvedValue({
      data: {
        columnHeaders: [
          { name: 'day' },
          { name: 'views' },
          { name: 'estimatedMinutesWatched' },
          { name: 'averageViewDuration' },
          { name: 'averageViewPercentage' },
          { name: 'subscribersGained' },
          { name: 'likes' },
          { name: 'subscribersLost' },
        ],
        rows: [
          ['2026-10-01', 120, 300, 40, 51, 3, 9, 1],
          ['2026-10-02', 80, 210, 38, 49, 1, 4, 0],
        ],
      },
    });

    const data = await provider.analytics('channel', 'token', 7);

    expect(provider.viewsMetric.channel).toBe('Views');
    expect(metricOf(data, provider.viewsMetric.channel)?.data).toEqual([
      { total: 120, date: '2026-10-01' },
      { total: 80, date: '2026-10-02' },
    ]);
    expect(reportsQuery.mock.calls[0][0]).toMatchObject({ dimensions: 'day' });
  });

  it('names the views label of postAnalytics()', async () => {
    videosList.mockResolvedValue({
      data: {
        items: [{ statistics: { viewCount: '900', likeCount: '12' } }],
      },
    });

    const data = await provider.postAnalytics('channel', 'token', 'vid', 7);

    expect(labels(data)).toContain(provider.viewsMetric.post![0]);
  });

  it('reads the top videos by views of the range live, with their titles', async () => {
    reportsQuery.mockResolvedValue({
      data: {
        columnHeaders: [{ name: 'video' }, { name: 'views' }],
        rows: [
          ['v2', 500],
          ['v1', 40],
        ],
      },
    });
    videosList.mockResolvedValue({
      data: {
        items: [
          { id: 'v1', snippet: { title: 'First', publishedAt: '2026-09-01T00:00:00Z' } },
          { id: 'v2', snippet: { title: 'Second', publishedAt: '2026-10-01T00:00:00Z' } },
        ],
      },
    });

    const posts = await provider.topViewedPosts('channel', 'token', 30, 10);

    expect(reportsQuery.mock.calls[0][0]).toMatchObject({
      ids: 'channel==MINE',
      metrics: 'views',
      dimensions: 'video',
      sort: '-views',
      maxResults: 10,
    });
    expect(videosList.mock.calls[0][0]).toMatchObject({ id: ['v2', 'v1'] });
    expect(posts).toEqual([
      {
        id: 'v2',
        views: 500,
        title: 'Second',
        url: 'https://www.youtube.com/watch?v=v2',
        publishedAt: '2026-10-01T00:00:00Z',
      },
      {
        id: 'v1',
        views: 40,
        title: 'First',
        url: 'https://www.youtube.com/watch?v=v1',
        publishedAt: '2026-09-01T00:00:00Z',
      },
    ]);
  });

  it('makes no title call without videos, and reports a dead token', async () => {
    reportsQuery.mockResolvedValueOnce({ data: { columnHeaders: [], rows: [] } });
    expect(await provider.topViewedPosts('channel', 'token', 7, 10)).toEqual([]);
    expect(videosList).not.toHaveBeenCalled();

    reportsQuery.mockRejectedValueOnce({ response: { status: 401, data: {} } });
    await expect(
      provider.topViewedPosts('channel', 'token', 7, 10)
    ).rejects.toBeInstanceOf(RefreshToken);
  });
});

describe('TikTok viewsMetric', () => {
  it('names the views label of postAnalytics(), no daily channel series', async () => {
    const provider = new TiktokProvider();
    fetchMock.mockResolvedValue(
      json({ data: { videos: [{ id: 'v', view_count: 77, like_count: 3 }] } })
    );

    const data = await provider.postAnalytics('id', 'token', 'v', 7);

    expect(provider.viewsMetric.channel).toBeUndefined();
    expect(labels(data)).toContain(provider.viewsMetric.post![0]);
    expect(metricOf(data, provider.viewsMetric.post![0])?.data[0].total).toBe('77');
  });

  it('does the same for TikTok Business', async () => {
    const provider = new TiktokBusinessProvider();
    provider.fetch = jest.fn(async () =>
      json({ code: 0, data: { videos: [{ item_id: 'v', video_views: 41 }] } })
    ) as any;

    const data = await provider.postAnalytics('id', 'token', 'v', 7);

    expect(provider.viewsMetric.channel).toBeUndefined();
    expect(metricOf(data, provider.viewsMetric.post![0])?.data[0].total).toBe('41');
  });
});

describe('Instagram viewsMetric', () => {
  it.each([
    ['Instagram', new InstagramProvider()],
    ['Instagram standalone', new InstagramStandaloneProvider()],
  ])('%s names the views label of postAnalytics()', async (_, provider) => {
    fetchMock.mockResolvedValue(
      json({
        data: [
          { name: 'views', values: [{ value: 640 }] },
          { name: 'reach', values: [{ value: 300 }] },
        ],
      })
    );

    const data = await provider.postAnalytics('id', 'token', 'media', 7);

    expect(provider.viewsMetric.channel).toBeUndefined();
    expect(metricOf(data, provider.viewsMetric.post![0])?.data[0].total).toBe('640');
  });
});

describe('Facebook viewsMetric', () => {
  const provider = new FacebookProvider();

  it('names the daily media views series of analytics()', async () => {
    fetchMock.mockResolvedValue(
      json({
        data: [
          {
            name: 'page_media_view',
            values: [
              { value: { organic: 30, paid: 5 }, end_time: '2026-10-02T07:00:00+0000' },
              { value: { organic: 12 }, end_time: '2026-10-03T07:00:00+0000' },
            ],
          },
          {
            name: 'page_daily_follows',
            values: [{ value: 2, end_time: '2026-10-02T07:00:00+0000' }],
          },
        ],
      })
    );

    const data = await provider.analytics('page', 'token', 7);

    const series = metricOf(data, provider.viewsMetric.channel)?.data;
    expect(series?.map((p) => p.total)).toEqual([35, 12]);
    // dated by end_time, the end of each day: the view gains move them back
    expect(series?.[0].date).toBe('2026-10-02');
    expect(provider.viewsMetric.channelDateOffset).toBe(-1);
  });

  it('names the views labels of feed, video and reel posts', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ data: [{ name: 'post_total_media_view_unique', values: [{ value: 90 }] }] })
    );
    const feed = await provider.postAnalytics('page', 'token', 'page_post', 7);

    fetchMock.mockResolvedValueOnce(
      json({ data: [{ name: 'total_video_views', values: [{ value: 25 }] }] })
    );
    const video = await provider.postAnalytics('page', 'token', '123', 7);

    fetchMock.mockResolvedValueOnce(
      json({ data: [{ name: 'fb_reels_total_plays', values: [{ value: 60 }] }] })
    );
    const reel = await provider.postAnalytics('page', 'token', '456', 7);

    for (const data of [feed, video, reel]) {
      expect(
        labels(data).some((label) => provider.viewsMetric.post!.includes(label))
      ).toBe(true);
    }
  });
});

describe('networks that do not declare views', () => {
  it('leave viewsMetric undefined', () => {
    expect((new XProvider() as any).viewsMetric).toBeUndefined();
  });
});
