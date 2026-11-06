import { AnalyticsRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository';

const makeRepo = () => {
  const post = { findMany: jest.fn().mockResolvedValue([]) };
  const integration = { findMany: jest.fn().mockResolvedValue([]) };
  const repo = new AnalyticsRepository(
    { model: { post } } as any,
    { model: { integration } } as any
  );
  return { repo, post, integration };
};

describe('AnalyticsRepository tenant scoping', () => {
  it('reads only live top-level posts of the organization on live channels', async () => {
    const { repo, post } = makeRepo();
    const from = new Date('2026-10-01T00:00:00Z');
    const now = new Date('2026-10-08T00:00:00Z');
    const until = new Date('2026-10-15T00:00:00Z');

    await repo.getOverviewPosts('org-A', from, now, until);

    const { where, select } = post.findMany.mock.calls[0][0];
    expect(where).toMatchObject({
      organizationId: 'org-A',
      deletedAt: null,
      parentPostId: null,
      integration: { organizationId: 'org-A', deletedAt: null },
    });
    expect(where.OR).toEqual([
      {
        state: { in: ['PUBLISHED', 'ERROR'] },
        publishDate: { gte: from, lte: now },
      },
      { state: 'QUEUE', publishDate: { gt: now, lte: until } },
    ]);
    expect(select).toEqual({
      integrationId: true,
      state: true,
      publishDate: true,
    });
  });

  it('lists only live channels of the organization, without tokens', async () => {
    const { repo, integration } = makeRepo();

    await repo.getOverviewChannels('org-A');

    const { where, select } = integration.findMany.mock.calls[0][0];
    expect(where).toEqual({ organizationId: 'org-A', deletedAt: null });
    expect(select.token).toBeUndefined();
    expect(select.refreshToken).toBeUndefined();
  });
});

const makeHistoryRepo = () => {
  const model = {
    post: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    integration: { findMany: jest.fn().mockResolvedValue([]) },
    analyticsAccountSnapshot: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    analyticsPost: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
    analyticsPostSnapshot: {
      groupBy: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
    },
    analyticsReportSettings: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userOrganization: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const wrap = { model } as any;
  const repo = new AnalyticsRepository(
    wrap,
    wrap,
    wrap,
    wrap,
    wrap,
    wrap,
    wrap,
    wrap
  );
  return { repo, model };
};

describe('AnalyticsRepository history', () => {
  const from = new Date('2026-10-01T00:00:00Z');
  const to = new Date('2026-10-31T00:00:00Z');

  it('scopes every history read to the organization', async () => {
    const { repo, model } = makeHistoryRepo();

    await repo.getAccountSnapshots('org-A', from, to);
    await repo.getAnalyticsPosts('org-A', from, to);
    await repo.getDailyPostTotals('org-A', from, to);
    await repo.getPostsContent('org-A', ['p1']);
    await repo.countPublished('org-A', from, to, 'int-1');

    expect(model.analyticsAccountSnapshot.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-A',
      date: { gte: from, lte: to },
    });
    expect(model.analyticsPost.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-A',
      publishedAt: { gte: from, lt: to },
    });
    expect(model.analyticsPostSnapshot.groupBy.mock.calls[0][0].where).toEqual({
      organizationId: 'org-A',
      date: { gte: from, lte: to },
    });
    expect(model.post.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-A',
      id: { in: ['p1'] },
    });
    expect(model.post.count.mock.calls[0][0].where).toMatchObject({
      organizationId: 'org-A',
      integrationId: 'int-1',
      state: 'PUBLISHED',
      parentPostId: null,
      deletedAt: null,
      integration: { organizationId: 'org-A', deletedAt: null },
    });
  });

  it('pages live social channels without reading tokens', async () => {
    const { repo, model } = makeHistoryRepo();

    await repo.getSnapshotChannelsPage(['x', 'tiktok'], 10, 'c9');

    const args = model.integration.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      type: 'social',
      deletedAt: null,
      disabled: false,
      refreshNeeded: false,
      inBetweenSteps: false,
      providerIdentifier: { in: ['x', 'tiktok'] },
      organization: { deletedAt: null },
      id: { gt: 'c9' },
    });
    expect(args).toMatchObject({ take: 10, orderBy: { id: 'asc' } });
    expect(args.select.token).toBeUndefined();

    await repo.getSnapshotChannelsPage(['x'], 10, undefined, true);
    expect(model.integration.findMany.mock.calls[1][0].where.organization).toEqual({
      deletedAt: null,
      subscription: { is: { deletedAt: null } },
    });
  });

  it('upserts by channel and day so a re-run overwrites the same rows', async () => {
    const { repo, model } = makeHistoryRepo();
    const day = new Date('2026-10-31T00:00:00Z');
    const now = new Date('2026-10-31T10:00:00Z');

    await repo.upsertAccountSnapshot('org-A', 'int-1', day, { followers: 3 });
    await repo.upsertPostMetrics('org-A', 'int-1', day, now, {
      externalId: 'ext-1',
      publishedAt: day,
      likes: 2,
    });

    expect(model.analyticsAccountSnapshot.upsert.mock.calls[0][0]).toMatchObject({
      where: { integrationId_date: { integrationId: 'int-1', date: day } },
      create: { organizationId: 'org-A', followers: 3, following: null, posts: null },
      update: { followers: 3, following: null, posts: null },
    });
    const latest = model.analyticsPost.upsert.mock.calls[0][0];
    expect(latest.where).toEqual({
      integrationId_externalId: { integrationId: 'int-1', externalId: 'ext-1' },
    });
    // a post read back from the platform never unlinks a PostDelegate post
    expect(latest.update).not.toHaveProperty('postId');
    expect(model.analyticsPostSnapshot.upsert.mock.calls[0][0].where).toEqual({
      integrationId_externalId_date: { integrationId: 'int-1', externalId: 'ext-1', date: day },
    });
  });

  it('purges rows before the cutoffs from every history table', async () => {
    const { repo, model } = makeHistoryRepo();
    const cutoff = new Date('2025-09-26T00:00:00Z');
    const postCutoff = new Date('2026-08-02T00:00:00Z');

    expect(await repo.purgeHistoryBefore(cutoff, postCutoff)).toBe(6);
    expect(model.analyticsAccountSnapshot.deleteMany).toHaveBeenCalledWith({
      where: { date: { lt: cutoff } },
    });
    expect(model.analyticsPost.deleteMany).toHaveBeenCalledWith({
      where: { publishedAt: { lt: cutoff } },
    });
    expect(model.analyticsPostSnapshot.deleteMany).toHaveBeenCalledWith({
      where: { date: { lt: postCutoff } },
    });
  });

  it('purges the history of recently deleted channels in batches', async () => {
    const { repo, model } = makeHistoryRepo();
    const since = new Date('2026-10-24T00:00:00Z');
    model.integration.findMany
      .mockResolvedValueOnce([{ id: 'd1' }, { id: 'd2' }])
      .mockResolvedValueOnce([]);

    expect(await repo.purgeDeletedChannelsHistory(since)).toBe(6);
    expect(model.integration.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: { gte: since },
    });
    expect(model.integration.findMany.mock.calls[1][0].where).toEqual({
      deletedAt: { gte: since },
      id: { gt: 'd2' },
    });
    expect(model.analyticsPostSnapshot.deleteMany).toHaveBeenCalledWith({
      where: { integrationId: { in: ['d1', 'd2'] } },
    });
  });

  it('claims a report send only if nobody sent it since it was read', async () => {
    const { repo, model } = makeHistoryRepo();
    const previous = new Date('2026-10-20T00:00:00Z');
    const now = new Date('2026-10-26T01:00:00Z');

    expect(await repo.claimReportSend('set-1', previous, now)).toBe(true);
    expect(model.analyticsReportSettings.updateMany).toHaveBeenCalledWith({
      where: { id: 'set-1', lastSentAt: previous },
      data: { lastSentAt: now },
    });
    model.analyticsReportSettings.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.claimReportSend('set-1', previous, now)).toBe(false);
  });

  it('lists only active members of the organization as report recipients', async () => {
    const { repo, model } = makeHistoryRepo();

    await repo.getReportMembers('org-A', ['u1']);

    expect(model.userOrganization.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-A',
      disabled: false,
      userId: { in: ['u1'] },
      user: { deletedAt: null, activated: true },
    });
  });
});
