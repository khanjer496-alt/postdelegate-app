import { BadRequestException } from '@nestjs/common';
import { UsersRepository } from '@gitroom/nestjs-libraries/database/prisma/users/users.repository';

describe('UsersRepository.changePersonal', () => {
  const makeRepo = () => {
    const user = {
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue({ pictureId: 'current-media' }),
    };
    const media = { findFirst: jest.fn() };
    const repo = new UsersRepository(
      { model: { user } } as any,
      { model: { media } } as any,
      {} as any
    );
    return { repo, user, media };
  };
  const dto = (picture?: { id: string }) =>
    ({ fullname: 'John Doe', bio: '', picture } as any);

  it('rejects a picture that is not a media of one of the user organizations', async () => {
    const { repo, user, media } = makeRepo();
    media.findFirst.mockResolvedValue(null);

    await expect(
      repo.changePersonal('user-1', dto({ id: 'foreign-media' }))
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(media.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'foreign-media',
      deletedAt: null,
      organization: { users: { some: { userId: 'user-1', disabled: false } } },
    });
    expect(user.update).not.toHaveBeenCalled();
  });

  it('connects a picture owned through one of the user organizations', async () => {
    const { repo, user, media } = makeRepo();
    media.findFirst.mockResolvedValue({ id: 'media-1' });

    await repo.changePersonal('user-1', dto({ id: 'media-1' }));

    expect(user.update.mock.calls[0][0].data.picture).toEqual({
      connect: { id: 'media-1' },
    });
  });

  it('keeps the current picture without re-validating it', async () => {
    const { repo, user, media } = makeRepo();

    await repo.changePersonal('user-1', dto({ id: 'current-media' }));

    expect(media.findFirst).not.toHaveBeenCalled();
    expect(user.update.mock.calls[0][0].data.picture).toEqual({
      connect: { id: 'current-media' },
    });
  });

  it('disconnects without a media lookup when no picture is sent', async () => {
    const { repo, user, media } = makeRepo();

    await repo.changePersonal('user-1', dto());

    expect(media.findFirst).not.toHaveBeenCalled();
    expect(user.update.mock.calls[0][0].data.picture).toEqual({
      disconnect: true,
    });
  });
});
