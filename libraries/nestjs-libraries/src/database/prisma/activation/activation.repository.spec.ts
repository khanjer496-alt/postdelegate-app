import { ActivationRepository } from '@gitroom/nestjs-libraries/database/prisma/activation/activation.repository';

describe('ActivationRepository', () => {
  const makeRepo = () => {
    const integration = {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    };
    const post = {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const userOrganization = {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const repo = new ActivationRepository(
      { model: { integration } } as any,
      { model: { post } } as any,
      { model: { userOrganization } } as any
    );
    return { repo, integration, post, userOrganization };
  };

  it('reads the checklist facts of one organization only', async () => {
    const { repo, integration, post, userOrganization } = makeRepo();
    integration.findFirst.mockResolvedValue({ id: 'i1' });
    userOrganization.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

    expect(await repo.hasChannel('org-A')).toBe(true);
    expect(await repo.hasPost('org-A')).toBe(false);
    expect(await repo.hasScheduledPost('org-A')).toBe(false);
    expect(await repo.hasTeammate('org-A')).toBe(true);

    expect(integration.findFirst.mock.calls[0][0].where).toEqual({
      organizationId: 'org-A',
      deletedAt: null,
    });
    expect(post.findFirst.mock.calls[0][0].where).toEqual({
      organizationId: 'org-A',
      deletedAt: null,
    });
    expect(post.findFirst.mock.calls[1][0].where).toEqual({
      organizationId: 'org-A',
      deletedAt: null,
      state: { in: ['QUEUE', 'PUBLISHED', 'ERROR'] },
    });
    expect(userOrganization.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: 'org-A', disabled: false },
      take: 2,
    });
  });

  it('dismisses for the member of that organization', async () => {
    const { repo, userOrganization } = makeRepo();
    const at = new Date('2026-10-31T12:00:00Z');

    await repo.dismissChecklist('u1', 'org-A', at);

    expect(userOrganization.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', organizationId: 'org-A' },
      data: { onboardingDismissedAt: at },
    });
  });

  it('lists failed top level posts of the organization since a date', async () => {
    const { repo, post } = makeRepo();
    const since = new Date('2026-10-01T00:00:00Z');

    await repo.getFailedPosts('org-A', since, 5);
    await repo.countFailedPosts('org-A', since);

    const where = {
      organizationId: 'org-A',
      state: 'ERROR',
      deletedAt: null,
      parentPostId: null,
      publishDate: { gte: since },
      integration: { deletedAt: null },
    };
    expect(post.findMany.mock.calls[0][0]).toMatchObject({ where, take: 5 });
    expect(post.count.mock.calls[0][0]).toEqual({ where });
  });

  it('never reads channel credentials', async () => {
    const { repo, integration } = makeRepo();
    const expiresBefore = new Date('2026-11-07T00:00:00Z');

    await repo.getChannelsNeedingAttention('org-A', expiresBefore);

    const query = integration.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      organizationId: 'org-A',
      deletedAt: null,
      disabled: false,
    });
    expect(query.where.OR).toContainEqual({
      tokenExpiration: { lte: expiresBefore },
      OR: [{ refreshToken: null }, { refreshToken: '' }],
    });
    expect(query.select.token).toBeUndefined();
    expect(query.select.refreshToken).toBeUndefined();
  });
});
