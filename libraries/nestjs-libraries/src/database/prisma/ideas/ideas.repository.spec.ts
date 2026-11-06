import { IdeasRepository } from '@gitroom/nestjs-libraries/database/prisma/ideas/ideas.repository';

const make = () => {
  const idea = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const tags = { findFirst: jest.fn().mockResolvedValue(null) };
  const repo = new IdeasRepository(
    { model: { idea } } as any,
    { model: { tags } } as any
  );
  return { repo, idea, tags };
};

describe('IdeasRepository organization binding', () => {
  it('scopes every read and write to the organization', async () => {
    const { repo, idea, tags } = make();
    await repo.getIdeas('org-A');
    await repo.getIdea('org-A', 'i-1');
    await repo.tagOfOrg('org-A', 't-1');
    await repo.updateIdea('org-A', 'i-1', { title: 'x' });
    await repo.deleteIdea('org-A', 'i-1');

    expect(idea.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-A',
      deletedAt: null,
    });
    expect(idea.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'i-1',
      organizationId: 'org-A',
    });
    expect(tags.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 't-1',
      orgId: 'org-A',
      deletedAt: null,
    });
    for (const [args] of idea.updateMany.mock.calls) {
      expect(args.where).toMatchObject({ id: 'i-1', organizationId: 'org-A' });
    }
  });
});
