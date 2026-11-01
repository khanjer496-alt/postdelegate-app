// the service pulls in heavy provider modules that are not under test
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {},
}));
jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: () => Promise.resolve(),
}));

import { AnalyticsSnapshotService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.snapshot.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const NOW = new Date('2026-10-31T15:30:00Z');
const TODAY = new Date('2026-10-31T00:00:00Z');

const integration = (overrides: Record<string, unknown> = {}) => ({
  id: 'int-1',
  organizationId: 'org-A',
  internalId: 'internal-1',
  token: 'token-1',
  providerIdentifier: 'x',
  type: 'social',
  deletedAt: null as Date | null,
  disabled: false,
  refreshNeeded: false,
  inBetweenSteps: false,
  tokenExpiration: new Date('2026-12-01T00:00:00Z') as Date | null,
  ...overrides,
});

const makeService = (provider: Record<string, any> = {}) => {
  const repository = {
    getSnapshotChannelsPage: jest.fn().mockResolvedValue([]),
    hasAccountSnapshot: jest.fn().mockResolvedValue(false),
    getPublishedPostsForSnapshot: jest.fn().mockResolvedValue([]),
    upsertAccountSnapshot: jest.fn().mockResolvedValue({}),
    upsertPostMetrics: jest.fn().mockResolvedValue(undefined),
    purgeHistoryBefore: jest.fn().mockResolvedValue(7),
    purgeDeletedChannelsHistory: jest.fn().mockResolvedValue(2),
  };
  const integrationService = {
    getIntegrationById: jest.fn().mockResolvedValue(integration()),
    // the job must never use these
    refreshNeeded: jest.fn(),
    disconnectChannel: jest.fn(),
  };
  const providers: Record<string, any> = {
    x: { identifier: 'x', ...provider },
  };
  const integrationManager = {
    getAllowedSocialsIntegrations: jest.fn(() => Object.keys(providers)),
    getSocialIntegration: jest.fn((id: string) => providers[id]),
  };
  const postsService = { resolveRelease: jest.fn() };
  const service = new AnalyticsSnapshotService(
    repository as any,
    integrationService as any,
    integrationManager as any,
    postsService as any
  );
  return {
    service,
    repository,
    integrationService,
    integrationManager,
    postsService,
    providers,
  };
};

afterEach(() => {
  delete process.env.ANALYTICS_HISTORY_DISABLED;
});

describe('AnalyticsSnapshotService.snapshotChannel', () => {
  it('stores account stats and post metrics under the UTC day, scoped to the organization', async () => {
    const accountStats = jest
      .fn()
      .mockResolvedValue({ followers: 120, following: 3, posts: 40 });
    const postsStats = jest.fn().mockResolvedValue({
      'rel-1': { views: 1000, likes: 10, comments: 2, shares: 1 },
    });
    const { service, repository, integrationService } = makeService({
      accountStats,
      postsStats,
    });
    repository.getPublishedPostsForSnapshot.mockResolvedValue([
      {
        id: 'post-1',
        content: '<p>Hello <b>world</b></p>',
        publishDate: new Date('2026-10-20T10:00:00Z'),
        releaseId: 'rel-1',
        releaseURL: 'https://x.com/p/rel-1',
        settings: '{}',
      },
    ]);

    const status = await service.snapshotChannel('org-A', 'int-1', NOW);

    expect(status).toBe('saved');
    expect(integrationService.getIntegrationById).toHaveBeenCalledWith(
      'org-A',
      'int-1'
    );
    expect(accountStats).toHaveBeenCalledWith('internal-1', 'token-1');
    expect(postsStats).toHaveBeenCalledWith('internal-1', 'token-1', ['rel-1']);
    expect(repository.getPublishedPostsForSnapshot).toHaveBeenCalledWith(
      'org-A',
      'int-1',
      new Date('2026-10-01T15:30:00Z'),
      25
    );
    expect(repository.upsertPostMetrics).toHaveBeenCalledWith(
      'org-A',
      'int-1',
      TODAY,
      NOW,
      {
        externalId: 'rel-1',
        postId: 'post-1',
        publishedAt: new Date('2026-10-20T10:00:00Z'),
        title: 'Hello world',
        url: 'https://x.com/p/rel-1',
        views: 1000,
        likes: 10,
        comments: 2,
        shares: 1,
      }
    );
    expect(repository.upsertAccountSnapshot).toHaveBeenCalledWith(
      'org-A',
      'int-1',
      TODAY,
      { followers: 120, following: 3, posts: 40 }
    );
  });

  it('is idempotent: two runs on the same day write the same keys', async () => {
    const { service, repository } = makeService({
      accountStats: jest.fn().mockResolvedValue({ followers: 5 }),
    });

    await service.snapshotChannel('org-A', 'int-1', NOW);
    await service.snapshotChannel(
      'org-A',
      'int-1',
      new Date('2026-10-31T23:59:00Z')
    );

    const days = repository.upsertAccountSnapshot.mock.calls.map((c) => c[2]);
    expect(days).toEqual([TODAY, TODAY]);
  });

  it('skips a channel of another organization', async () => {
    const accountStats = jest.fn();
    const { service, repository, integrationService } = makeService({
      accountStats,
    });
    integrationService.getIntegrationById.mockResolvedValue(
      integration({ organizationId: 'org-B' })
    );

    expect(await service.snapshotChannel('org-A', 'int-1', NOW)).toBe(
      'skipped'
    );
    expect(accountStats).not.toHaveBeenCalled();
    expect(repository.upsertAccountSnapshot).not.toHaveBeenCalled();
  });

  it('skips an expired token instead of refreshing it', async () => {
    const accountStats = jest.fn();
    const { service, repository, integrationService } = makeService({
      accountStats,
    });
    integrationService.getIntegrationById.mockResolvedValue(
      integration({ tokenExpiration: new Date('2026-10-31T15:00:00Z') })
    );

    expect(await service.snapshotChannel('org-A', 'int-1', NOW)).toBe(
      'skipped'
    );
    expect(accountStats).not.toHaveBeenCalled();
    expect(repository.upsertAccountSnapshot).not.toHaveBeenCalled();
    expect(integrationService.refreshNeeded).not.toHaveBeenCalled();
    expect(integrationService.disconnectChannel).not.toHaveBeenCalled();
  });

  it('never stores a provider whose policy forbids caching analytics', async () => {
    const accountStats = jest.fn();
    const { service, repository, providers } = makeService({ accountStats });
    providers.x.authorizationPolicy = { bypassAnalyticsCache: true };

    expect(service.historyProviders()).toEqual([]);
    expect(await service.snapshotChannel('org-A', 'int-1', NOW)).toBe(
      'skipped'
    );
    expect(accountStats).not.toHaveBeenCalled();
    expect(repository.upsertAccountSnapshot).not.toHaveBeenCalled();
  });

  it('keeps going when account stats fail, saving what it could read', async () => {
    const { service, repository } = makeService({
      accountStats: jest.fn().mockRejectedValue(new Error('500 from platform')),
      recentPosts: jest.fn().mockResolvedValue([
        {
          id: 'v1',
          title: 'A video',
          publishedAt: '2026-10-25T08:00:00Z',
          views: 50,
          likes: 4,
        },
      ]),
    });

    expect(await service.snapshotChannel('org-A', 'int-1', NOW)).toBe('saved');
    expect(repository.upsertPostMetrics).toHaveBeenCalledTimes(1);
    expect(repository.upsertAccountSnapshot).toHaveBeenCalledWith(
      'org-A',
      'int-1',
      TODAY,
      {}
    );
  });

  it('stops the channel on a token error without writing or touching the channel', async () => {
    const { service, repository, integrationService } = makeService({
      accountStats: jest
        .fn()
        .mockRejectedValue(new RefreshToken('x', '{}', Buffer.from('{}'))),
    });

    expect(await service.snapshotChannel('org-A', 'int-1', NOW)).toBe('failed');
    expect(repository.upsertAccountSnapshot).not.toHaveBeenCalled();
    expect(repository.upsertPostMetrics).not.toHaveBeenCalled();
    expect(integrationService.refreshNeeded).not.toHaveBeenCalled();
    expect(integrationService.disconnectChannel).not.toHaveBeenCalled();
  });

  it('stops per-post calls after a token error but keeps the posts already read', async () => {
    const postAnalytics = jest
      .fn()
      .mockResolvedValueOnce([
        { label: 'Impressions', data: [{ total: '90', date: '2026-10-31' }] },
      ])
      .mockRejectedValueOnce(new RefreshToken('x', '{}', Buffer.from('{}')));
    const { service, repository } = makeService({ postAnalytics });
    repository.getPublishedPostsForSnapshot.mockResolvedValue(
      ['a', 'b', 'c'].map((id) => ({
        id: `post-${id}`,
        content: id,
        publishDate: new Date('2026-10-20T10:00:00Z'),
        releaseId: `rel-${id}`,
        releaseURL: null,
        settings: null,
      }))
    );

    expect(await service.snapshotChannel('org-A', 'int-1', NOW)).toBe('saved');
    expect(postAnalytics).toHaveBeenCalledTimes(2);
    expect(repository.upsertPostMetrics).toHaveBeenCalledTimes(1);
    expect(repository.upsertPostMetrics.mock.calls[0][4]).toMatchObject({
      externalId: 'rel-a',
      views: 90,
    });
  });

  it('links a recent platform post to the PostDelegate post instead of reading it twice', async () => {
    const postAnalytics = jest.fn();
    const { service, repository } = makeService({
      postAnalytics,
      recentPosts: jest.fn().mockResolvedValue([
        {
          id: 'rel-1',
          title: 'From the platform',
          publishedAt: '2026-10-20T10:00:05Z',
          views: 300,
          likes: 30,
          comments: 3,
          shares: 0,
        },
      ]),
    });
    repository.getPublishedPostsForSnapshot.mockResolvedValue([
      {
        id: 'post-1',
        content: 'Our launch',
        publishDate: new Date('2026-10-20T10:00:00Z'),
        releaseId: 'rel-1',
        releaseURL: 'https://example.com/rel-1',
        settings: '{}',
      },
    ]);

    await service.snapshotChannel('org-A', 'int-1', NOW);

    expect(postAnalytics).not.toHaveBeenCalled();
    expect(repository.upsertPostMetrics).toHaveBeenCalledTimes(1);
    expect(repository.upsertPostMetrics.mock.calls[0][4]).toEqual({
      externalId: 'rel-1',
      postId: 'post-1',
      publishedAt: new Date('2026-10-20T10:00:00Z'),
      title: 'Our launch',
      url: 'https://example.com/rel-1',
      views: 300,
      likes: 30,
      comments: 3,
      shares: 0,
    });
  });

  it('skips posts whose platform id is still pending', async () => {
    const postAnalytics = jest.fn();
    const { service, repository, postsService } = makeService({
      postAnalytics,
      resolveReleaseId: jest.fn(),
    });
    postsService.resolveRelease.mockResolvedValue({
      releaseId: 'publish-1',
      pending: true,
    });
    repository.getPublishedPostsForSnapshot.mockResolvedValue([
      {
        id: 'post-1',
        content: 'x',
        publishDate: new Date('2026-10-20T10:00:00Z'),
        releaseId: 'publish-1',
        releaseURL: null,
        settings: null,
      },
    ]);

    await service.snapshotChannel('org-A', 'int-1', NOW);

    expect(postsService.resolveRelease).toHaveBeenCalledWith(
      'org-A',
      expect.objectContaining({ id: 'post-1', releaseId: 'publish-1' })
    );
    expect(postAnalytics).not.toHaveBeenCalled();
  });
});

describe('AnalyticsSnapshotService provider safety', () => {
  const published = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `post-${i}`,
      content: `post ${i}`,
      publishDate: new Date('2026-10-20T10:00:00Z'),
      releaseId: `rel-${i}`,
      releaseURL: i === 0 ? 'javascript:alert(1)' : null,
      settings: null,
    }));

  it('stops per-post reads after three failures in a row', async () => {
    const postAnalytics = jest.fn().mockRejectedValue(new Error('400'));
    const { service, repository } = makeService({ postAnalytics });
    repository.getPublishedPostsForSnapshot.mockResolvedValue(published(10));

    expect(await service.snapshotChannel('org-A', 'int-1', NOW)).toBe('saved');
    expect(postAnalytics).toHaveBeenCalledTimes(3);
  });

  it('never stores a link that is not a web address', async () => {
    const { service, repository } = makeService({
      postsStats: jest.fn().mockResolvedValue({ 'rel-0': { likes: 1 } }),
    });
    repository.getPublishedPostsForSnapshot.mockResolvedValue(published(1));

    await service.snapshotChannel('org-A', 'int-1', NOW);

    expect(repository.upsertPostMetrics.mock.calls[0][4].url).toBeUndefined();
  });
});

describe('AnalyticsSnapshotService.snapshotPage', () => {
  it('skips channels already saved today and tolerates a failing channel', async () => {
    const { service, repository, integrationService } = makeService({
      accountStats: jest.fn().mockResolvedValue({ followers: 1 }),
    });
    repository.getSnapshotChannelsPage.mockResolvedValue([
      { id: 'done', organizationId: 'org-A', providerIdentifier: 'x' },
      { id: 'boom', organizationId: 'org-B', providerIdentifier: 'x' },
      { id: 'ok', organizationId: 'org-C', providerIdentifier: 'x' },
    ]);
    repository.hasAccountSnapshot.mockImplementation(
      async (id: string) => id === 'done'
    );
    integrationService.getIntegrationById.mockImplementation(
      async (org: string, id: string) => {
        if (id === 'boom') {
          throw new Error('decrypt failed');
        }
        return integration({ id, organizationId: org });
      }
    );

    const page = await service.snapshotPage(undefined, NOW);

    expect(page).toEqual({ enabled: true, saved: 1, skipped: 1, failed: 1 });
    expect(repository.hasAccountSnapshot).toHaveBeenCalledWith('done', TODAY);
    expect(integrationService.getIntegrationById).not.toHaveBeenCalledWith(
      'org-A',
      'done'
    );
    expect(repository.upsertAccountSnapshot).toHaveBeenCalledWith(
      'org-C',
      'ok',
      TODAY,
      { followers: 1 }
    );
  });

  it('returns a cursor only when the page is full', async () => {
    const { service, repository } = makeService({
      accountStats: jest.fn().mockResolvedValue({}),
    });
    repository.hasAccountSnapshot.mockResolvedValue(true);
    repository.getSnapshotChannelsPage.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: `c${i}`,
        organizationId: 'org-A',
        providerIdentifier: 'x',
      }))
    );

    const page = await service.snapshotPage('c-prev', NOW);

    expect(repository.getSnapshotChannelsPage).toHaveBeenCalledWith(
      ['x'],
      10,
      'c-prev',
      false
    );
    expect(page.cursor).toBe('c9');
  });

  it('reads only paying workspaces when billing is on', async () => {
    const prior = process.env.STRIPE_PUBLISHABLE_KEY;
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
    const { service, repository } = makeService({ accountStats: jest.fn() });

    await service.snapshotPage(undefined, NOW);

    expect(repository.getSnapshotChannelsPage.mock.calls[0][3]).toBe(true);
    if (prior === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
    else process.env.STRIPE_PUBLISHABLE_KEY = prior;
  });

  it('does nothing when switched off', async () => {
    process.env.ANALYTICS_HISTORY_DISABLED = 'true';
    const { service, repository } = makeService({ accountStats: jest.fn() });

    expect(await service.snapshotPage(undefined, NOW)).toEqual({
      enabled: false,
      saved: 0,
      skipped: 0,
      failed: 0,
    });
    expect(repository.getSnapshotChannelsPage).not.toHaveBeenCalled();
  });
});

describe('AnalyticsSnapshotService retention', () => {
  it('deletes account rows after 400 days, daily post rows after 90, and deleted channels', async () => {
    const { service, repository } = makeService();

    expect(await service.purgeExpired(NOW)).toBe(9);
    expect(repository.purgeHistoryBefore).toHaveBeenCalledWith(
      new Date('2025-09-26T00:00:00Z'),
      new Date('2026-08-02T00:00:00Z')
    );
    expect(repository.purgeDeletedChannelsHistory).toHaveBeenCalledWith(
      new Date('2026-10-24T00:00:00Z')
    );
  });

  it('keeps everything when switched off', async () => {
    process.env.ANALYTICS_HISTORY_DISABLED = 'true';
    const { service, repository } = makeService();

    expect(await service.purgeExpired(NOW)).toBe(0);
    expect(repository.purgeHistoryBefore).not.toHaveBeenCalled();
  });
});

describe('AnalyticsSnapshotService.normalisePostAnalytics', () => {
  const { service } = makeService();

  it('maps platform labels onto the normalised counters by preference', () => {
    expect(
      service.normalisePostAnalytics([
        { label: 'Reach', data: [{ total: '40', date: '' }], percentageChange: 0 },
        { label: 'Views', data: [{ total: '100', date: '' }], percentageChange: 0 },
        { label: 'Reactions', data: [{ total: '7', date: '' }], percentageChange: 0 },
        { label: 'Replies', data: [{ total: '2', date: '' }], percentageChange: 0 },
        { label: 'Retweets', data: [{ total: '1', date: '' }], percentageChange: 0 },
        { label: 'Pin Clicks', data: [{ total: '5', date: '' }], percentageChange: 0 },
        { label: 'Saves', data: [{ total: '9', date: '' }], percentageChange: 0 },
      ])
    ).toEqual({ views: 100, likes: 7, comments: 2, shares: 1, clicks: 5 });
  });

  it('sums daily points and ignores what it cannot read', () => {
    expect(
      service.normalisePostAnalytics([
        {
          label: 'Impressions',
          data: [
            { total: '10', date: 'a' },
            { total: 'n/a', date: 'b' },
            { total: '5', date: 'c' },
          ],
          percentageChange: 0,
        },
      ])
    ).toEqual({ views: 15 });
    expect(service.normalisePostAnalytics([])).toBeUndefined();
    expect(service.normalisePostAnalytics(undefined)).toBeUndefined();
  });

  it('reads the views from the labels the provider declares', () => {
    const data = [
      { label: 'Impressions', data: [{ total: '90', date: '' }], percentageChange: 0 },
      { label: 'Plays', data: [{ total: '30', date: '' }], percentageChange: 0 },
      { label: 'Likes', data: [{ total: '4', date: '' }], percentageChange: 0 },
    ];
    // generic preference: impressions before plays
    expect(service.normalisePostAnalytics(data)).toEqual({ views: 90, likes: 4 });
    // declared: plays first, matched without regard to case
    expect(service.normalisePostAnalytics(data, ['views', 'PLAYS'])).toEqual({
      views: 30,
      likes: 4,
    });
    // a declared label the platform did not report falls back to the generic ones
    expect(service.normalisePostAnalytics(data, ['Views'])).toEqual({
      views: 90,
      likes: 4,
    });
  });
});
