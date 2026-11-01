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
