import { StudioRepository } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.repository';

// The media row and the render's link to it are written together, and only
// for a render that is still live and has no media yet
describe('StudioRepository.saveRenderMedia', () => {
  const media = {
    name: 'abc.mp4',
    path: 'https://media.example/abc.mp4',
    originalName: 'My video.mp4',
    thumbnail: 'https://media.example/abc.jpg',
    alt: 'My video',
  };

  const make = (claimed: number) => {
    const tx = {
      media: { create: jest.fn().mockResolvedValue({ id: 'media-9' }) },
      studioRender: {
        updateMany: jest.fn().mockResolvedValue({ count: claimed }),
      },
    };
    const rolledBack = { value: false };
    const transaction = {
      model: {
        $transaction: async (run: (db: typeof tx) => Promise<unknown>) => {
          try {
            return await run(tx);
          } catch (err) {
            rolledBack.value = true;
            throw err;
          }
        },
      },
    };
    return {
      tx,
      rolledBack,
      repository: new StudioRepository(
        {} as any,
        {} as any,
        transaction as any
      ),
    };
  };

  it('links the media to a live render without one', async () => {
    const { tx, rolledBack, repository } = make(1);
    await expect(
      repository.saveRenderMedia('render-1', 'org-1', media)
    ).resolves.toEqual({ id: 'media-9' });
    expect(rolledBack.value).toBe(false);
    expect(tx.studioRender.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'render-1',
        mediaId: null,
        status: { notIn: ['completed', 'failed', 'cancelled'] },
        project: { deletedAt: null },
      },
      data: {
        mediaId: 'media-9',
        path: media.path,
        thumbnail: media.thumbnail,
      },
    });
  });

  it('rolls the media back when another attempt, a cancel or a delete got there first', async () => {
    const { rolledBack, repository } = make(0);
    await expect(
      repository.saveRenderMedia('render-1', 'org-1', media)
    ).resolves.toBeNull();
    expect(rolledBack.value).toBe(true);
  });
});

// Projects of assistants and the public API never push the workspace's own
// projects off the list, and one whose start failed leaves no row
describe('StudioRepository projects of assistants and the API', () => {
  const make = () => {
    const studioProject = {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'project-1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    return {
      studioProject,
      repository: new StudioRepository(
        { model: { studioProject } } as any,
        {} as any,
        {} as any,
        {} as any
      ),
    };
  };

  it('lists only the projects made in the app by default', async () => {
    const { studioProject, repository } = make();
    await repository.getProjects('org-1');
    expect(studioProject.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1',
      deletedAt: null,
      source: null,
    });
    expect(studioProject.findMany.mock.calls[0][0].select.source).toBe(true);
  });

  it('lists every project when asked', async () => {
    const { studioProject, repository } = make();
    await repository.getProjects('org-1', true);
    expect(studioProject.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1',
      deletedAt: null,
    });
  });

  it('marks the source of a project only when there is one', async () => {
    const { studioProject, repository } = make();
    await repository.createProject('org-1', 'A', 'hook-over-clip', '{}', 'api');
    await repository.createProject('org-1', 'B', 'hook-over-clip', '{}');
    expect(studioProject.create.mock.calls[0][0].data.source).toBe('api');
    expect(studioProject.create.mock.calls[1][0].data).not.toHaveProperty(
      'source'
    );
  });

  it('deletes a project for good only while it has no renders', async () => {
    const { studioProject, repository } = make();
    await expect(
      repository.removeUnrenderedProject('org-1', 'project-1')
    ).resolves.toBe(true);
    expect(studioProject.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'project-1',
        organizationId: 'org-1',
        renders: { none: {} },
      },
    });

    studioProject.deleteMany.mockResolvedValue({ count: 0 });
    await expect(
      repository.removeUnrenderedProject('org-1', 'project-1')
    ).resolves.toBe(false);
  });
});
