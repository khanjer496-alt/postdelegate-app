import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IdeasService } from '@gitroom/nestjs-libraries/database/prisma/ideas/ideas.service';

const idea = {
  id: 'idea-1',
  title: 'Launch thread',
  notes: null,
  media: JSON.stringify([{ id: 'm-1', path: 'https://uploads.test/a.png' }]),
  status: 'IDEA',
  tag: null,
};

const make = () => {
  const repo = {
    getIdeas: jest.fn().mockResolvedValue([idea]),
    getIdea: jest.fn().mockResolvedValue(idea),
    tagOfOrg: jest.fn().mockResolvedValue({ id: 'tag-1' }),
    createIdea: jest.fn().mockResolvedValue(idea),
    updateIdea: jest.fn().mockResolvedValue(1),
    deleteIdea: jest.fn().mockResolvedValue(1),
  };
  return { repo, service: new IdeasService(repo as any) };
};

describe('IdeasService tenant scoping', () => {
  it('lists only the ideas of the organization, with parsed media', async () => {
    const { repo, service } = make();
    const list = await service.getIdeas('org-A');
    expect(repo.getIdeas).toHaveBeenCalledWith('org-A');
    expect(list[0].media).toEqual([{ id: 'm-1', path: 'https://uploads.test/a.png' }]);
  });

  it('creates an idea in the caller organization', async () => {
    const { repo, service } = make();
    await service.createIdea('org-A', 'user-1', {
      title: '  Launch thread ',
      notes: ' ',
      tagId: 'tag-1',
      media: [{ id: 'm-1', path: 'https://uploads.test/a.png', alt: 'x' } as any],
    });
    expect(repo.tagOfOrg).toHaveBeenCalledWith('org-A', 'tag-1');
    expect(repo.createIdea).toHaveBeenCalledWith('org-A', 'user-1', {
      title: 'Launch thread',
      notes: null,
      media: JSON.stringify([{ id: 'm-1', path: 'https://uploads.test/a.png' }]),
      tagId: 'tag-1',
      status: 'IDEA',
    });
  });

  it('refuses a campaign of another organization', async () => {
    const { repo, service } = make();
    repo.tagOfOrg.mockResolvedValue(null);
    await expect(
      service.createIdea('org-A', 'user-1', { title: 'x', tagId: 'tag-B' })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateIdea('org-A', 'idea-1', { tagId: 'tag-B' })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createIdea).not.toHaveBeenCalled();
    expect(repo.updateIdea).not.toHaveBeenCalled();
  });

  it('cannot update or delete an idea of another organization', async () => {
    const { repo, service } = make();
    repo.updateIdea.mockResolvedValue(0);
    repo.deleteIdea.mockResolvedValue(0);
    await expect(
      service.updateIdea('org-A', 'idea-of-B', { status: 'USED' })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteIdea('org-A', 'idea-of-B')).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(repo.updateIdea).toHaveBeenCalledWith('org-A', 'idea-of-B', {
      status: 'USED',
    });
    expect(repo.deleteIdea).toHaveBeenCalledWith('org-A', 'idea-of-B');
  });

  it('clears the campaign without a lookup and only sends changed fields', async () => {
    const { repo, service } = make();
    await service.updateIdea('org-A', 'idea-1', { tagId: null, title: 'New' });
    expect(repo.tagOfOrg).not.toHaveBeenCalled();
    expect(repo.updateIdea).toHaveBeenCalledWith('org-A', 'idea-1', {
      title: 'New',
      tagId: null,
    });
    expect(repo.getIdea).toHaveBeenCalledWith('org-A', 'idea-1');
  });
});

describe('IdeasService campaigns', () => {
  it('leaves out a campaign that was deleted', async () => {
    const { repo, service } = make();
    repo.getIdeas.mockResolvedValue([
      { ...idea, tag: { id: 't', name: 'Old', color: '#000', kind: 'CAMPAIGN', deletedAt: new Date() } },
      { ...idea, id: 'idea-2', tag: { id: 't2', name: 'Live', color: '#fff', kind: 'CAMPAIGN', deletedAt: null } },
    ]);
    const [first, second] = await service.getIdeas('org-A');
    expect(first.tag).toBeNull();
    expect(second.tag).toEqual({ id: 't2', name: 'Live', color: '#fff', kind: 'CAMPAIGN' });
  });
});
