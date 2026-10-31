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
