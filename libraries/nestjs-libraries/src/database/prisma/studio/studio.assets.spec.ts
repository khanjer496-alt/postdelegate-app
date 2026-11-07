// Music uploads, the music a project keeps, picture inputs of a render and
// the daily cleanup. The service builds its storage at construction and
// pulls in the media and AI stacks at import time
const storage = {
  signDownloadUrl: jest.fn().mockResolvedValue('https://r2.example/signed'),
  removeFile: jest.fn().mockResolvedValue(undefined),
  uploadStream: jest.fn(),
};
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => storage },
}));
const redisSet = jest.fn();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: (...args: unknown[]) => redisSet(...args),
    del: jest.fn(),
    get: jest.fn(),
  },
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service',
  () => ({ AiCredentialService: class {}, MISSING_AI_KEY: '' })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));

import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  StudioService,
  jpegOrientation,
} from '@gitroom/nestjs-libraries/database/prisma/studio/studio.service';
import { StudioTemplateManager } from '@gitroom/nestjs-libraries/studio/studio.manager';
import { HookOverClipTemplate } from '@gitroom/nestjs-libraries/studio/templates/hook.over.clip.template';
import { ImageSlideshowTemplate } from '@gitroom/nestjs-libraries/studio/templates/image.slideshow.template';

const mediaId = '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f';
const assetId = '9b2f4c1d-3e5a-4b6c-8d7e-0f1a2b3c4d5e';

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    return err instanceof HttpException ? err.getStatus() : err;
  }
  return 'resolved';
};

const slideshow = (music = false) => ({
  slides: [
    { mediaId, seconds: 2 },
    { mediaId, seconds: 2 },
  ],
  ...(music ? { music: { assetId } } : {}),
});

describe('StudioService music, pictures and cleanup', () => {
  let repository: Record<string, jest.Mock>;
  let mediaService: { getOrgMediaById: jest.Mock };
  let organizationService: { getOrgByIdWithSubscription: jest.Mock };
  let service: StudioService;
  let dir: string;

  beforeEach(() => {
    jest.clearAllMocks();
    redisSet.mockResolvedValue('OK');
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
    dir = mkdtempSync(join(tmpdir(), 'studio-assets-'));
    process.env.STUDIO_TMP_DIR = dir;
    organizationService = {
      getOrgByIdWithSubscription: jest.fn().mockResolvedValue({
        id: 'org-1',
        isTrailing: false,
        subscription: { subscriptionTier: 'STANDARD' },
      }),
    };
    repository = {
      getProject: jest.fn().mockResolvedValue({
        id: 'project-1',
        name: 'Slides',
        template: 'image-slideshow',
        spec: JSON.stringify(slideshow()),
        renders: [],
      }),
      updateProject: jest.fn().mockResolvedValue(undefined),
      deleteProject: jest.fn().mockResolvedValue(undefined),
      getActiveRenders: jest.fn().mockResolvedValue([]),
      countAssets: jest.fn().mockResolvedValue(0),
      createAsset: jest.fn().mockResolvedValue({
        id: assetId,
        originalName: 'song.mp3',
        path: 'https://media.example/abc.mp3',
      }),
      getAsset: jest.fn().mockResolvedValue({
        id: assetId,
        name: 'abc.mp3',
        path: 'https://media.example/abc.mp3',
        originalName: 'song.mp3',
        projectId: null,
      }),
      attachAsset: jest.fn().mockResolvedValue(true),
      detachAssets: jest.fn().mockResolvedValue({ count: 0 }),
      getProjectAssets: jest.fn().mockResolvedValue([]),
      deleteRemovableAsset: jest.fn().mockResolvedValue({ count: 1 }),
      getAssetsToRemove: jest.fn().mockResolvedValue([]),
      pruneRenders: jest.fn().mockResolvedValue({ count: 0 }),
      getRenderById: jest.fn(),
      updateRender: jest.fn().mockResolvedValue(undefined),
    };
    mediaService = {
      getOrgMediaById: jest.fn().mockResolvedValue({
        id: mediaId,
        name: 'abc.png',
        path: 'https://media.example/abc.png',
        status: 'ready',
        deletedAt: null,
      }),
    };
    const templates = new Map<any, any>([
      [HookOverClipTemplate, new HookOverClipTemplate()],
      [ImageSlideshowTemplate, new ImageSlideshowTemplate()],
    ]);
    service = new StudioService(
      repository as any,
      new StudioTemplateManager({
        get: (target: any) => templates.get(target),
      } as any),
      mediaService as any,
      {} as any,
      {
        client: {
          getRawClient: () => ({ workflow: { start: jest.fn() } }),
        },
      } as any,
      organizationService as any
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    delete process.env.STUDIO_TMP_DIR;
  });

  describe('uploads', () => {
    const file = {
      filename: 'abc.mp3',
      path: 'https://media.example/abc.mp3',
      originalname: 'song.mp3',
    };

    it('keeps an upload as a Studio asset, not a media', async () => {
      expect(await service.saveAsset('org-1', file)).toEqual({
        id: assetId,
        name: 'song.mp3',
        path: 'https://media.example/abc.mp3',
      });
      expect(repository.createAsset).toHaveBeenCalledWith('org-1', {
        kind: 'music',
        name: 'abc.mp3',
        path: 'https://media.example/abc.mp3',
        originalName: 'song.mp3',
      });
      expect(storage.removeFile).not.toHaveBeenCalled();
    });

    it('needs an active plan and removes the stored file when refused', async () => {
      organizationService.getOrgByIdWithSubscription.mockResolvedValue({
        id: 'org-1',
      });
      expect(await status(service.saveAsset('org-1', file))).toBe(406);
      expect(storage.removeFile).toHaveBeenCalledWith(file.path);
      expect(repository.createAsset).not.toHaveBeenCalled();
    });

    it('caps the music a workspace keeps', async () => {
      repository.countAssets.mockResolvedValue(50);
      expect(await status(service.saveAsset('org-1', file))).toBe(400);
      expect(storage.removeFile).toHaveBeenCalledWith(file.path);
    });

    it('counts and saves under one lock per workspace', async () => {
      await service.saveAsset('org-1', file);
      expect(redisSet).toHaveBeenCalledWith(
        'studioAsset:org-1',
        expect.any(String),
        'EX',
        15,
        'NX'
      );
      redisSet.mockResolvedValue(null);
      expect(await status(service.saveAsset('org-1', file))).toBe(429);
      expect(repository.createAsset).toHaveBeenCalledTimes(1);
      expect(storage.removeFile).toHaveBeenCalledWith(file.path);
    });

    it('checks the plan and the room left before an upload is stored', async () => {
      await expect(service.checkAssetAllowed('org-1')).resolves.toBeUndefined();
      repository.countAssets.mockResolvedValue(50);
      expect(await status(service.checkAssetAllowed('org-1'))).toBe(400);
      organizationService.getOrgByIdWithSubscription.mockResolvedValue({
        id: 'org-1',
      });
      expect(await status(service.checkAssetAllowed('org-1'))).toBe(406);
      expect(storage.removeFile).not.toHaveBeenCalled();
    });
  });

  describe('the music of a project', () => {
    it('takes the picked music and lets go of the rest', async () => {
      await service.updateProject('org-1', 'project-1', {
        spec: {
          ...slideshow(true),
          music: {
            assetId,
            name: 'not mine',
            path: 'https://evil.example/x.mp3',
          },
        },
      });
      // the name and address come from the asset, never from the client
      const saved = JSON.parse(repository.updateProject.mock.calls[0][2].spec);
      expect(saved.music).toEqual({
        assetId,
        name: 'song.mp3',
        path: 'https://media.example/abc.mp3',
      });
      expect(repository.attachAsset).toHaveBeenCalledWith(
        'org-1',
        assetId,
        'project-1'
      );
      expect(repository.detachAssets).toHaveBeenCalledWith(
        'org-1',
        'project-1',
        assetId
      );
    });

    it('refuses music of another workspace or project', async () => {
      repository.getAsset.mockResolvedValueOnce(null);
      expect(
        await status(
          service.updateProject('org-1', 'project-1', { spec: slideshow(true) })
        )
      ).toBe(400);
      repository.getAsset.mockResolvedValueOnce({
        id: assetId,
        name: 'abc.mp3',
        path: 'https://media.example/abc.mp3',
        originalName: 'song.mp3',
        projectId: 'project-2',
      });
      expect(
        await status(
          service.updateProject('org-1', 'project-1', { spec: slideshow(true) })
        )
      ).toBe(400);
      expect(repository.updateProject).not.toHaveBeenCalled();
      expect(repository.attachAsset).not.toHaveBeenCalled();
    });

    it('takes the music only once the settings are saved', async () => {
      repository.updateProject.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.updateProject('org-1', 'project-1', { spec: slideshow(true) })
      ).rejects.toThrow('db down');
      expect(repository.attachAsset).not.toHaveBeenCalled();
    });

    it('lets go of the music when it is taken out', async () => {
      repository.getProject.mockResolvedValue({
        id: 'project-1',
        template: 'image-slideshow',
        spec: JSON.stringify(slideshow(true)),
      });
      await service.updateProject('org-1', 'project-1', { spec: slideshow() });
      expect(repository.attachAsset).not.toHaveBeenCalled();
      expect(repository.detachAssets).toHaveBeenCalledWith(
        'org-1',
        'project-1',
        undefined
      );
    });

    it('does no music bookkeeping on a save that keeps it, and keeps the saved name', async () => {
      repository.getProject.mockResolvedValue({
        id: 'project-1',
        template: 'image-slideshow',
        spec: JSON.stringify({
          ...slideshow(),
          music: { assetId, name: 'song.mp3', path: 'https://media.example/abc.mp3' },
        }),
      });
      await service.updateProject('org-1', 'project-1', {
        spec: {
          ...slideshow(),
          transition: 'none',
          music: { assetId, name: 'renamed', path: 'https://evil.example/x.mp3', volume: 0.5 },
        },
      });
      expect(repository.getAsset).not.toHaveBeenCalled();
      expect(repository.attachAsset).not.toHaveBeenCalled();
      expect(repository.detachAssets).not.toHaveBeenCalled();
      const saved = JSON.parse(repository.updateProject.mock.calls[0][2].spec);
      expect(saved.music).toEqual({
        assetId,
        name: 'song.mp3',
        path: 'https://media.example/abc.mp3',
        volume: 0.5,
      });
    });

    it('removes the stored music with the project', async () => {
      repository.getProjectAssets.mockResolvedValue([
        { id: assetId, path: 'https://media.example/abc.mp3' },
      ]);
      await service.deleteProject('org-1', 'project-1');
      expect(repository.deleteRemovableAsset).toHaveBeenCalledWith(
        assetId,
        expect.any(Date)
      );
      expect(storage.removeFile).toHaveBeenCalledWith(
        'https://media.example/abc.mp3'
      );
    });

    it('treats a file already gone as removed', async () => {
      repository.getProjectAssets.mockResolvedValue([
        { id: assetId, path: 'https://media.example/abc.mp3' },
      ]);
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      storage.removeFile.mockRejectedValueOnce(
        Object.assign(new Error('gone'), { code: 'ENOENT' })
      );
      await expect(
        service.deleteProject('org-1', 'project-1')
      ).resolves.toEqual({ success: true });
      expect(error).not.toHaveBeenCalled();
    });
  });

  describe('starting a render', () => {
    it('refuses a video where the template takes pictures, before anything starts', async () => {
      mediaService.getOrgMediaById.mockResolvedValue({
        id: mediaId,
        name: 'abc.mp4',
        path: 'https://media.example/abc.mp4',
        status: 'ready',
        deletedAt: null,
      });
      const error = await service
        .startRender({ id: 'org-1' } as any, 'project-1')
        .catch((err) => err);
      expect(error.getStatus()).toBe(400);
      expect(error.message).toBe('This template takes pictures, not videos');
    });

    it('refuses a picture type Studio does not read', async () => {
      mediaService.getOrgMediaById.mockResolvedValue({
        id: mediaId,
        name: 'abc.gif',
        path: 'https://media.example/abc.gif',
        status: 'ready',
        deletedAt: null,
      });
      const error = await service
        .startRender({ id: 'org-1' } as any, 'project-1')
        .catch((err) => err);
      expect(error.message).toBe('Pictures in PNG, JPG or WebP are supported');
    });

    it('refuses a picture where the template needs a video', async () => {
      repository.getProject.mockResolvedValue({
        id: 'project-1',
        template: 'hook-over-clip',
        spec: JSON.stringify({
          input: { mediaId },
          trim: { start: 0, end: 5 },
          hook: { text: 'x' },
        }),
      });
      const error = await service
        .startRender({ id: 'org-1' } as any, 'project-1')
        .catch((err) => err);
      expect(error.message).toBe('This template needs a video, not a picture');
    });

    it('checks the spec with its own template', async () => {
      repository.getProject.mockResolvedValue({
        id: 'project-1',
        template: 'image-slideshow',
        spec: JSON.stringify({ slides: [{ mediaId, seconds: 2 }] }),
      });
      // one slide passes as a draft but not for a render
      expect(await status(service.startRender({ id: 'org-1' } as any, 'project-1'))).toBe(400);
    });

    it('refuses music that is gone', async () => {
      repository.getProject.mockResolvedValue({
        id: 'project-1',
        template: 'image-slideshow',
        spec: JSON.stringify(slideshow(true)),
      });
      repository.getAsset.mockResolvedValue(null);
      expect(await status(service.startRender({ id: 'org-1' } as any, 'project-1'))).toBe(400);
      expect(repository.getAsset).toHaveBeenCalledWith('org-1', assetId);
    });
  });

  describe('render inputs', () => {
    const renderOf = (template: string, spec: unknown) =>
      repository.getRenderById.mockResolvedValue({
        id: 'render-1',
        organizationId: 'org-1',
        status: 'queued',
        mediaId: null,
        specSnapshot: JSON.stringify(spec),
        project: { name: 'P', template },
      });
    let download: jest.SpyInstance;
    let probeImage: jest.SpyInstance;
    let plan: jest.SpyInstance;

    beforeEach(() => {
      // the free space of the machine running the tests is not the point
      jest
        .spyOn(service as any, 'checkFreeDisk')
        .mockResolvedValue(undefined);
      download = jest
        .spyOn(service as any, 'download')
        .mockResolvedValue(undefined);
      probeImage = jest
        .spyOn(service, 'probeImage')
        .mockResolvedValue(undefined);
      jest
        .spyOn(service, 'prescaleImage')
        .mockImplementation(async (_dir, _file, index) => `picture-${index}.jpg`);
      jest.spyOn(service, 'probeAudio').mockResolvedValue(undefined);
      jest
        .spyOn(service as any, 'probe')
        .mockResolvedValue({ duration: 10, hasAudio: true });
      // stop right after planning: what reaches ffmpeg is all this checks
      plan = jest
        .spyOn(ImageSlideshowTemplate.prototype, 'plan')
        .mockImplementation(() => {
          throw new Error('planned');
        });
    });

    afterEach(() => {
      plan.mockRestore();
    });

    it('reads pictures with the picture cap and probe, and the music with its own', async () => {
      renderOf('image-slideshow', slideshow(true));
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      await expect(service.render('render-1')).rejects.toThrow('planned');

      expect(download).toHaveBeenCalledTimes(3);
      expect(download.mock.calls[0][1]).toMatch(/source-0\.png$/);
      expect(download.mock.calls[0][3]).toEqual({
        bytes: 20 * 1024 * 1024,
        message: 'This picture is larger than 20 MB.',
      });
      expect(download.mock.calls[2][1]).toMatch(/music\.mp3$/);
      expect(download.mock.calls[2][3].bytes).toBe(30 * 1024 * 1024);
      expect(probeImage).toHaveBeenCalledTimes(2);
      expect(plan.mock.calls[0][1]).toMatchObject({
        // the render reads the scaled down copies
        inputs: [
          { file: 'picture-0.jpg', image: true, hasAudio: false },
          { file: 'picture-1.jpg', image: true, hasAudio: false },
        ],
        music: { file: 'music.mp3' },
      });
    });

    it('refuses a picture where the template needs a video', async () => {
      renderOf('hook-over-clip', {
        input: { mediaId },
        trim: { start: 0, end: 5 },
        hook: { text: 'x' },
      });
      await expect(service.render('render-1')).rejects.toMatchObject({
        type: 'studio_stop',
        message: 'This template needs a video, not a picture.',
      });
      expect(download).not.toHaveBeenCalled();
    });

    it('refuses a video in a slideshow before downloading it', async () => {
      mediaService.getOrgMediaById.mockResolvedValue({
        id: mediaId,
        name: 'abc.mp4',
        path: 'https://media.example/abc.mp4',
        status: 'ready',
        deletedAt: null,
      });
      renderOf('image-slideshow', slideshow());
      await expect(service.render('render-1')).rejects.toMatchObject({
        type: 'studio_stop',
        message: 'This template takes pictures, not videos.',
      });
      expect(download).not.toHaveBeenCalled();
    });

    it('refuses music of another workspace', async () => {
      repository.getAsset.mockResolvedValue(null);
      renderOf('image-slideshow', slideshow(true));
      await expect(service.render('render-1')).rejects.toMatchObject({
        type: 'studio_stop',
      });
      expect(repository.getAsset).toHaveBeenCalledWith('org-1', assetId);
    });
  });

  describe('daily cleanup', () => {
    it('removes unused and orphaned music page by page, then old renders', async () => {
      const page = Array.from({ length: 100 }, (_, i) => ({
        id: `a-${i}`,
        path: `https://media.example/${i}.mp3`,
      }));
      repository.getAssetsToRemove
        .mockResolvedValueOnce(page)
        .mockResolvedValueOnce([{ id: 'a-100', path: 'https://media.example/100.mp3' }]);
      repository.pruneRenders.mockResolvedValue({ count: 7 });
      const heartbeat = jest.fn();

      expect(await service.cleanup(heartbeat)).toEqual({
        assets: 101,
        renders: 7,
      });
      expect(storage.removeFile).toHaveBeenCalledTimes(101);
      expect(repository.deleteRemovableAsset).toHaveBeenCalledTimes(101);
      expect(heartbeat).toHaveBeenCalled();

      // unused for 7 days, and renders older than 90 days
      const unusedSince: Date = repository.getAssetsToRemove.mock.calls[0][0];
      const days = (Date.now() - unusedSince.getTime()) / 86400000;
      expect(Math.round(days)).toBe(7);
      const before: Date = repository.pruneRenders.mock.calls[0][0];
      expect(Math.round((Date.now() - before.getTime()) / 86400000)).toBe(90);
    });

    it('leaves an asset a project took in the meantime, file and all', async () => {
      repository.getAssetsToRemove.mockResolvedValueOnce([
        { id: 'a-1', path: 'https://media.example/1.mp3' },
        { id: 'a-2', path: 'https://media.example/2.mp3' },
      ]);
      repository.deleteRemovableAsset.mockImplementation(async (id: string) => ({
        count: id === 'a-1' ? 0 : 1,
      }));
      expect(await service.cleanup()).toEqual({ assets: 1, renders: 0 });
      expect(storage.removeFile).toHaveBeenCalledTimes(1);
      expect(storage.removeFile).toHaveBeenCalledWith('https://media.example/2.mp3');
      // the row is deleted only while still unused at the same cutoff
      const cutoff = repository.getAssetsToRemove.mock.calls[0][0];
      expect(repository.deleteRemovableAsset).toHaveBeenCalledWith('a-1', cutoff);
    });

    it('counts an asset whose file is already gone as removed', async () => {
      storage.removeFile.mockRejectedValueOnce(
        Object.assign(new Error('gone'), { code: 'ENOENT' })
      );
      repository.getAssetsToRemove.mockResolvedValueOnce([
        { id: 'a-1', path: 'https://media.example/1.mp3' },
      ]);
      expect(await service.cleanup()).toEqual({ assets: 1, renders: 0 });
    });
  });
});

describe('jpegOrientation', () => {
  // a JPEG start with an APP1 Exif segment holding only the Orientation tag
  const exif = (orientation: number, little: boolean) => {
    const tiff = Buffer.alloc(26);
    tiff.write(little ? 'II' : 'MM', 0, 'latin1');
    const u16 = (value: number, at: number) =>
      little ? tiff.writeUInt16LE(value, at) : tiff.writeUInt16BE(value, at);
    const u32 = (value: number, at: number) =>
      little ? tiff.writeUInt32LE(value, at) : tiff.writeUInt32BE(value, at);
    u16(42, 2);
    u32(8, 4);
    u16(1, 8);
    u16(0x0112, 10);
    u16(3, 12);
    u32(1, 14);
    u16(orientation, 18);
    const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(body.length + 2);
    return Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
      length,
      body,
      Buffer.from([0xff, 0xda, 0, 2]),
    ]);
  };

  it.each([1, 3, 6, 8])('reads orientation %s in either byte order', (value) => {
    expect(jpegOrientation(exif(value, true))).toBe(value);
    expect(jpegOrientation(exif(value, false))).toBe(value);
  });

  it('reads 1 from anything else', () => {
    expect(jpegOrientation(Buffer.from('not a jpeg'))).toBe(1);
    expect(jpegOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1);
    expect(jpegOrientation(exif(42, true))).toBe(1);
    expect(jpegOrientation(exif(6, true).subarray(0, 20))).toBe(1);
  });
});
