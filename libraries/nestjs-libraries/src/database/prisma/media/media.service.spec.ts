import { BadRequestException } from '@nestjs/common';

jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: jest.fn(),
    processorEnabled: () => false,
  },
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock('file-type', () => ({}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';

describe('MediaService.saveBucketObject', () => {
  const makeService = () => {
    const repository = {
      getMediaOfOtherOrg: jest.fn(),
      saveFile: jest.fn().mockResolvedValue({ id: 'media-1' }),
    };
    const service = Object.create(MediaService.prototype);
    service._mediaRepository = repository;
    return { service: service as MediaService, repository };
  };

  it('refuses a name another organization already owns', async () => {
    const { service, repository } = makeService();
    repository.getMediaOfOtherOrg.mockResolvedValue({ id: 'victim-media' });

    await expect(
      service.saveBucketObject('org-A', 'victim.png', 'https://cdn/victim.png')
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.saveFile).not.toHaveBeenCalled();
  });

  it('saves a name nobody else owns', async () => {
    const { service, repository } = makeService();
    repository.getMediaOfOtherOrg.mockResolvedValue(null);

    await service.saveBucketObject('org-A', 'new.png', 'https://cdn/new.png', 'n.png');

    expect(repository.getMediaOfOtherOrg).toHaveBeenCalledWith('org-A', 'new.png');
    expect(repository.saveFile).toHaveBeenCalledWith(
      'org-A',
      'new.png',
      'https://cdn/new.png',
      'n.png'
    );
  });
});
