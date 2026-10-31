import { BadRequestException } from '@nestjs/common';

const storage: { objectSize?: jest.Mock } = {};
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => storage },
}));
jest.mock('@gitroom/nestjs-libraries/upload/r2.uploader', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@gitroom/nestjs-libraries/upload/multer.stream.engine', () => ({
  streamUploadOptions: () => ({}),
}));
jest.mock('@gitroom/nestjs-libraries/upload/custom.upload.validation', () => ({
  getMaxSize: () => 1024 * 1024 * 1024,
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({
  MediaService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/dtos/media/save.media.information.dto', () => ({
  SaveMediaInformationDto: class {},
}));
jest.mock('@gitroom/nestjs-libraries/dtos/videos/video.dto', () => ({
  VideoDto: class {},
}));
jest.mock('@gitroom/nestjs-libraries/dtos/videos/video.function.dto', () => ({
  VideoFunctionDto: class {},
}));

import { MediaController } from '@gitroom/backend/api/routes/media.controller';

describe('MediaController.saveMedia', () => {
  const org = { id: 'org-A' } as any;
  const mediaService = { saveBucketObject: jest.fn().mockResolvedValue({ id: 'm' }) };
  const controller = new MediaController(mediaService as any, {} as any);

  beforeEach(() => {
    process.env.CLOUDFLARE_BUCKET_URL = 'https://cdn.example.com';
    mediaService.saveBucketObject.mockClear();
    storage.objectSize = jest.fn();
  });

  it('refuses an object that does not exist in the bucket', async () => {
    storage.objectSize!.mockResolvedValue(null);

    await expect(
      controller.saveMedia(org, {} as any, 'missing.png', 'a.png')
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mediaService.saveBucketObject).not.toHaveBeenCalled();
  });

  it('refuses an object over the size cap', async () => {
    storage.objectSize!.mockResolvedValue(2 * 1024 * 1024 * 1024);

    await expect(
      controller.saveMedia(org, {} as any, 'huge.mp4', 'a.mp4')
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('registers an existing object for the organization', async () => {
    storage.objectSize!.mockResolvedValue(1234);

    await controller.saveMedia(org, {} as any, 'ok.png', 'a.png');

    expect(storage.objectSize).toHaveBeenCalledWith('ok.png');
    expect(mediaService.saveBucketObject).toHaveBeenCalledWith(
      'org-A',
      'ok.png',
      'https://cdn.example.com/ok.png',
      'a.png'
    );
  });
});
