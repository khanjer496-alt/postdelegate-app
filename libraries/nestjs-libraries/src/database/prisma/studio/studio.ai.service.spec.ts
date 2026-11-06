// the service builds its storage at construction and pulls in the media and
// AI stacks at import time
const storage = {
  uploadStream: jest.fn(),
  removeFile: jest.fn().mockResolvedValue(undefined),
};
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => storage },
}));
const redisSet = jest.fn();
const redisDel = jest.fn();
const redisGet = jest.fn();
const redisEval = jest.fn();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    eval: (...args: unknown[]) => redisEval(...args),
    set: (...args: unknown[]) => redisSet(...args),
    del: (...args: unknown[]) => redisDel(...args),
    get: (...args: unknown[]) => redisGet(...args),
  },
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service',
  () => ({
    AiCredentialService: class {},
    MISSING_AI_KEY: 'Add your OpenAI key in Settings → AI',
  })
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
  StudioAiRetry,
  StudioAiService,
} from '@gitroom/nestjs-libraries/database/prisma/studio/studio.ai.service';
import { StudioStop } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.service';
import { StudioTemplateManager } from '@gitroom/nestjs-libraries/studio/studio.manager';
import { AiUgcTemplate } from '@gitroom/nestjs-libraries/studio/templates/ai.ugc.template';
import { HookOverClipTemplate } from '@gitroom/nestjs-libraries/studio/templates/hook.over.clip.template';
import {
  StudioAiError,
  studioAiAssetKey,
} from '@gitroom/nestjs-libraries/studio/ai/studio.ai.interface';

const MISSING = 'Add your OpenAI key in Settings → AI';

const spec = {
  topic: 'A standing desk',
  tone: 'calm',
  seconds: 20,
  voice: 'cedar',
  stills: 1,
  footage: [{ mediaId: '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f' }],
  script: {
    hook: 'My back stopped hurting',
    lines: ['This desk folds flat'],
    cta: 'Link in bio',
  },
};

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    return err instanceof HttpException ? err.getStatus() : err;
  }
  return 'resolved';
};

const template = new AiUgcTemplate();
const [voiceRequest, stillRequest] = template.aiAssets(spec as any);
const voiceKey = studioAiAssetKey(voiceRequest);
const stillKey = studioAiAssetKey(stillRequest);

describe('StudioAiService', () => {
  let dir: string;
  let provider: Record<string, any>;
  let studioService: Record<string, jest.Mock>;
  let repository: Record<string, jest.Mock>;
  let aiManager: { forOrganization: jest.Mock };
  let service: StudioAiService;
  let uploads: number;
  // the StudioAsset rows of the project
  let rows: any[];
  // what is kept, by the key of what it was made from
  const stored = (): Record<string, any> =>
    Object.fromEntries(
      rows.map((row) => {
        const data = JSON.parse(row.data);
        return [
          data.key,
          { id: row.id, kind: row.kind, path: row.path, ...data },
        ];
      })
    );
  const seed = (assets: Record<string, any>) => {
    rows = Object.entries(assets).map(([key, asset], index) => ({
      id: `seed-${index}`,
      kind: asset.kind,
      name: asset.name,
      path: asset.path,
      data: JSON.stringify({
        key,
        ...(asset.seconds ? { seconds: asset.seconds } : {}),
        ...(asset.words ? { words: asset.words } : {}),
      }),
    }));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'studio-ai-'));
    redisSet.mockResolvedValue('OK');
    redisGet.mockImplementation(async () => redisSet.mock.calls.at(-1)?.[1]);
    uploads = 0;
    storage.uploadStream.mockImplementation(
      async (stream: any, mime: string, ext: string) => {
        stream.destroy();
        uploads++;
        return {
          filename: `file-${uploads}.${ext}`,
          path: `https://media.example/file-${uploads}.${ext}`,
          mimetype: mime,
        };
      }
    );
    rows = [];

    // a mocked AI: script, voice, word times and stills
    provider = {
      voices: ['marin', 'cedar'],
      script: jest.fn().mockResolvedValue({
        hook: 'New hook',
        lines: ['One', 'Two'],
        cta: 'Follow',
        postText: 'Post',
      }),
      tts: jest.fn().mockResolvedValue(Buffer.from('mp3')),
      transcribe: jest.fn().mockResolvedValue([
        { text: 'My', start: 0, end: 0.3 },
        { text: 'back', start: 0.3, end: 0.7 },
      ]),
      image: jest.fn().mockResolvedValue(Buffer.from('jpg')),
    };
    aiManager = {
      forOrganization: jest
        .fn()
        .mockResolvedValue({ identifier: 'openai', instance: provider }),
    };
    studioService = {
      getProject: jest.fn().mockResolvedValue({
        id: 'project-1',
        template: 'ai-ugc',
        spec,
      }),
      updateProject: jest.fn(async (_org, _id, body) => ({ spec: body.spec })),
      billing: jest.fn().mockResolvedValue({ subscribed: true, trial: false }),
      tmpRoot: jest.fn(() => dir),
      run: jest.fn().mockResolvedValue('12.5\n'),
      downloadStored: jest.fn().mockResolvedValue(undefined),
    };
    repository = {
      getActiveRenders: jest.fn().mockResolvedValue([]),
      getAiAssets: jest.fn(async () => rows.map((row) => ({ ...row }))),
      createAiAsset: jest.fn(async (_org, _projectId, data) => {
        const row = { id: `row-${rows.length + 1}`, ...data };
        rows.push(row);
        return { id: row.id };
      }),
      updateAiAssetData: jest.fn(async (id, data) => {
        rows = rows.map((row) => (row.id === id ? { ...row, data } : row));
      }),
      deleteAiAsset: jest.fn(async (id) => {
        const before = rows.length;
        rows = rows.filter((row) => row.id !== id);
        return rows.length < before;
      }),
      getRenderById: jest.fn().mockResolvedValue({
        id: 'render-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        status: 'queued',
        specSnapshot: JSON.stringify(spec),
        project: { template: 'ai-ugc', name: 'Desk' },
      }),
      updateRender: jest.fn().mockResolvedValue(undefined),
    };
    const templates = new Map<any, any>([
      [AiUgcTemplate, template],
      [HookOverClipTemplate, new HookOverClipTemplate()],
    ]);
    service = new StudioAiService(
      studioService as any,
      repository as any,
      new StudioTemplateManager({
        get: (target: any) => templates.get(target),
      } as any),
      aiManager as any
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('capabilities', () => {
    it('shows the voices of the workspace key and no video', async () => {
      await expect(service.getCapabilities('org-1')).resolves.toEqual({
        connected: true,
        provider: 'openai',
        voices: ['marin', 'cedar'],
        video: false,
      });
    });

    it('says when there is no key', async () => {
      aiManager.forOrganization.mockResolvedValue(undefined);
      await expect(service.getCapabilities('org-1')).resolves.toMatchObject({
        connected: false,
      });
    });
  });

  describe('script', () => {
    it('writes the script with the workspace AI and saves it for editing', async () => {
      const result = await service.writeScript('org-1', 'project-1');
      expect(provider.script).toHaveBeenCalledWith(
        'org-1',
        { topic: 'A standing desk', tone: 'calm', seconds: 20 },
        { signal: expect.any(AbortSignal) }
      );
      expect(result.script).toEqual({
        hook: 'New hook',
        lines: ['One', 'Two'],
        cta: 'Follow',
        postText: 'Post',
      });
      expect(studioService.updateProject).toHaveBeenCalledWith(
        'org-1',
        'project-1',
        { spec: expect.objectContaining({ topic: 'A standing desk' }) }
      );
      // the project lock is taken and given back
      expect(redisSet).toHaveBeenCalledWith(
        'studioAi:project-1',
        expect.any(String),
        'EX',
        expect.any(Number),
        'NX'
      );
      expect(redisDel).toHaveBeenCalledWith('studioAi:project-1');
    });

    it('asks for the key when the workspace has none', async () => {
      aiManager.forOrganization.mockResolvedValue(undefined);
      await expect(service.writeScript('org-1', 'project-1')).rejects.toThrow(
        MISSING
      );
      expect(provider.script).not.toHaveBeenCalled();
    });

    it('needs an active plan while billing is on', async () => {
      studioService.billing.mockResolvedValue({ subscribed: false });
      expect(await status(service.writeScript('org-1', 'project-1'))).toBe(406);
      expect(await status(service.voiceover('org-1', 'project-1'))).toBe(406);
      expect(provider.script).not.toHaveBeenCalled();
      expect(provider.tts).not.toHaveBeenCalled();
    });

    it('needs a topic, and a template that uses AI', async () => {
      studioService.getProject.mockResolvedValue({
        id: 'project-1',
        template: 'ai-ugc',
        spec: { ...spec, topic: '' },
      });
      expect(await status(service.writeScript('org-1', 'project-1'))).toBe(400);
      studioService.getProject.mockResolvedValue({
        id: 'project-1',
        template: 'hook-over-clip',
        spec: {},
      });
      expect(await status(service.writeScript('org-1', 'project-1'))).toBe(400);
    });

    it('refuses a second AI step on the same project at once', async () => {
      redisSet.mockResolvedValue(null);
      expect(await status(service.writeScript('org-1', 'project-1'))).toBe(429);
      expect(provider.script).not.toHaveBeenCalled();
    });

    it('answers with the message of the AI failure', async () => {
      provider.script.mockRejectedValue(
        new StudioAiError('OpenAI refused to write this script: no', 422)
      );
      await expect(
        service.writeScript('org-1', 'project-1')
      ).rejects.toMatchObject({
        message: 'OpenAI refused to write this script: no',
      });
      expect(await status(service.writeScript('org-1', 'project-1'))).toBe(422);
    });
  });

  describe('voice preview', () => {
    it('voices the script, stores the mp3 and keeps it for the render', async () => {
      await expect(service.voiceover('org-1', 'project-1')).resolves.toEqual({
        path: 'https://media.example/file-1.mp3',
        seconds: 12.5,
      });
      expect(provider.tts).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ voice: 'cedar' }),
        expect.anything()
      );
      // no word times for a preview, no stills either
      expect(provider.transcribe).not.toHaveBeenCalled();
      expect(provider.image).not.toHaveBeenCalled();
      // kept as a StudioAsset of the project, like its music
      expect(repository.createAiAsset).toHaveBeenCalledWith(
        'org-1',
        'project-1',
        expect.objectContaining({ kind: 'voice', name: 'file-1.mp3' })
      );
      expect(stored()).toEqual({
        [voiceKey]: {
          id: 'row-1',
          kind: 'voice',
          key: voiceKey,
          path: 'https://media.example/file-1.mp3',
          seconds: 12.5,
        },
      });
    });

    it('reuses a voice already made for the same script', async () => {
      await service.voiceover('org-1', 'project-1');
      await service.voiceover('org-1', 'project-1');
      expect(provider.tts).toHaveBeenCalledTimes(1);
    });

    it('replaces the voice of an older script and removes its file', async () => {
      seed({
        old: {
          kind: 'voice',
          name: 'old.mp3',
          path: 'https://media.example/old.mp3',
        },
        still: {
          kind: 'image',
          name: 's.jpg',
          path: 'https://media.example/s.jpg',
        },
      });
      await service.voiceover('org-1', 'project-1');
      expect(storage.removeFile).toHaveBeenCalledWith(
        'https://media.example/old.mp3'
      );
      expect(storage.removeFile).toHaveBeenCalledTimes(1);
      // a preview only replaces voices
      expect(Object.keys(stored()).sort()).toEqual(['still', voiceKey].sort());
    });

    it('never replaces the voice while the project renders', async () => {
      repository.getActiveRenders.mockResolvedValue([
        {
          id: 'r-1',
          projectId: 'project-1',
          status: 'rendering',
          updatedAt: new Date(),
        },
      ]);
      expect(await status(service.voiceover('org-1', 'project-1'))).toBe(409);
      expect(provider.tts).not.toHaveBeenCalled();
    });

    it('ignores a render whose workflow died long ago', async () => {
      repository.getActiveRenders.mockResolvedValue([
        {
          id: 'r-1',
          projectId: 'project-1',
          status: 'rendering',
          updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        },
      ]);
      expect(await status(service.voiceover('org-1', 'project-1'))).toBe(
        'resolved'
      );
    });

    it('refuses a voice longer than a video may be', async () => {
      studioService.run.mockResolvedValue('95.2');
      expect(await status(service.voiceover('org-1', 'project-1'))).toBe(400);
      expect(storage.uploadStream).not.toHaveBeenCalled();
    });

    it('asks for the key when the workspace has none', async () => {
      aiManager.forOrganization.mockResolvedValue(undefined);
      await expect(service.voiceover('org-1', 'project-1')).rejects.toThrow(
        MISSING
      );
    });
  });

  describe('before the render', () => {
    it('makes the voice, its word times and the stills, then keeps only them', async () => {
      seed({
        stale: {
          kind: 'image',
          name: 'x.jpg',
          path: 'https://media.example/x.jpg',
        },
      });
      await service.generateForRender('render-1');

      expect(repository.updateRender).toHaveBeenCalledWith('render-1', {
        status: 'generating',
        progress: 0,
      });
      expect(provider.tts).toHaveBeenCalledTimes(1);
      expect(provider.transcribe).toHaveBeenCalledTimes(1);
      expect(provider.image).toHaveBeenCalledWith(
        'org-1',
        stillRequest,
        expect.anything()
      );
      const kept = stored();
      expect(Object.keys(kept).sort()).toEqual([stillKey, voiceKey].sort());
      expect(kept[voiceKey].words).toHaveLength(2);
      // the stale still went, row first
      expect(repository.deleteAiAsset).toHaveBeenCalledWith('seed-0');
      expect(storage.removeFile).toHaveBeenCalledWith(
        'https://media.example/x.jpg'
      );
    });

    it('reuses the previewed voice and only adds its word times', async () => {
      seed({
        [voiceKey]: {
          kind: 'voice',
          name: 'v.mp3',
          path: 'https://media.example/v.mp3',
          seconds: 4,
        },
      });
      await service.generateForRender('render-1');
      expect(provider.tts).not.toHaveBeenCalled();
      expect(studioService.downloadStored).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'v.mp3' }),
        expect.any(String),
        expect.any(AbortSignal)
      );
      expect(stored()[voiceKey]).toMatchObject({
        path: 'https://media.example/v.mp3',
        words: expect.any(Array),
      });
    });

    it('does nothing when everything is already made', async () => {
      seed({
        [voiceKey]: {
          kind: 'voice',
          name: 'v.mp3',
          path: 'p',
          seconds: 4,
          words: [],
        },
        [stillKey]: { kind: 'image', name: 's.jpg', path: 's' },
      });
      await service.generateForRender('render-1');
      expect(provider.tts).not.toHaveBeenCalled();
      expect(provider.image).not.toHaveBeenCalled();
      expect(repository.createAiAsset).not.toHaveBeenCalled();
      expect(repository.updateAiAssetData).not.toHaveBeenCalled();
      expect(repository.deleteAiAsset).not.toHaveBeenCalled();
    });

    it('lets the render spread the script when the timing fails for a passing reason, without saving it', async () => {
      const log = jest.spyOn(console, 'error').mockImplementation(() => null);
      provider.transcribe.mockRejectedValue(
        new StudioAiError('OpenAI is rate limiting your key', 429, true)
      );
      await service.generateForRender('render-1');
      // the voice is kept, its words are not: the template spreads the
      // script over it, and the next render times it for real
      const voice = stored()[voiceKey];
      expect(voice).toMatchObject({ kind: 'voice', seconds: 12.5 });
      expect(voice.words).toBeUndefined();
      expect(provider.transcribe).toHaveBeenCalledTimes(1);
      expect(provider.tts).toHaveBeenCalledTimes(1);
      log.mockRestore();
    });

    it('keeps every still that was made when another one fails', async () => {
      repository.getRenderById.mockResolvedValue({
        id: 'render-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        status: 'queued',
        specSnapshot: JSON.stringify({ ...spec, stills: 2 }),
        project: { template: 'ai-ugc', name: 'Desk' },
      });
      provider.image
        .mockRejectedValueOnce(
          new StudioAiError('OpenAI is not answering', 502, true)
        )
        .mockResolvedValueOnce(Buffer.from('jpg'));
      const err = await service.generateForRender('render-1').catch((e) => e);
      expect(err).toBeInstanceOf(StudioAiRetry);
      const kinds = Object.values(stored()).map((p: any) => p.kind);
      expect(kinds.sort()).toEqual(['image', 'voice']);
    });

    it('keeps every file as a StudioAsset of the project as soon as it is made', async () => {
      provider.image.mockRejectedValue(
        new StudioAiError('OpenAI is not answering', 502, true)
      );
      await service.generateForRender('render-1').catch(() => undefined);
      // the voice was kept before the still failed
      expect(repository.createAiAsset).toHaveBeenCalledTimes(1);
      expect(repository.createAiAsset).toHaveBeenCalledWith(
        'org-1',
        'project-1',
        expect.objectContaining({ kind: 'voice' })
      );
      expect(storage.removeFile).not.toHaveBeenCalled();
    });

    it('takes back the lock of an attempt of the same render that crashed', async () => {
      redisSet.mockResolvedValue(null);
      redisEval.mockResolvedValue('OK');
      redisGet.mockResolvedValue('render:render-1');
      await service.generateForRender('render-1');
      // refreshed only while it is still ours, in one step
      expect(redisEval).toHaveBeenCalledWith(
        expect.stringContaining("redis.call('get', KEYS[1]) == ARGV[1]"),
        1,
        'studioAi:project-1',
        'render:render-1',
        expect.any(String)
      );
      expect(provider.tts).toHaveBeenCalledTimes(1);
    });

    it('falls back to spread timings when the key has no whisper-1', async () => {
      const log = jest.spyOn(console, 'error').mockImplementation(() => null);
      provider.transcribe.mockRejectedValue(
        new StudioAiError('Your OpenAI key cannot use a model', 400)
      );
      await expect(
        service.generateForRender('render-1')
      ).resolves.toBeUndefined();
      expect(stored()[voiceKey].words).toBeUndefined();
      log.mockRestore();
    });

    it('stops when the timing finds the key rejected', async () => {
      provider.transcribe.mockRejectedValue(
        new StudioAiError('OpenAI rejected your key.', 400, false, true)
      );
      const err = await service.generateForRender('render-1').catch((e) => e);
      expect(err).toBeInstanceOf(StudioStop);
    });

    it('removes a voice previewed before the voice was turned off', async () => {
      seed({
        [voiceKey]: {
          kind: 'voice',
          name: 'v.mp3',
          path: 'https://media.example/v.mp3',
        },
      });
      repository.getRenderById.mockResolvedValue({
        id: 'render-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        status: 'queued',
        specSnapshot: JSON.stringify({ ...spec, voiceover: false }),
        project: { template: 'ai-ugc', name: 'Desk' },
      });
      await service.generateForRender('render-1');
      expect(storage.removeFile).toHaveBeenCalledWith(
        'https://media.example/v.mp3'
      );
      expect(stored()).toEqual({});
      expect(provider.tts).not.toHaveBeenCalled();
    });

    it('stops when the key was removed while the render waited', async () => {
      provider.tts.mockRejectedValue(new HttpException(MISSING, 400));
      const err = await service.generateForRender('render-1').catch((e) => e);
      expect(err).toBeInstanceOf(StudioStop);
      expect(err.message).toBe(MISSING);
    });

    it('stops the render, keeping what was made, when the key is rejected', async () => {
      provider.image.mockRejectedValue(
        new StudioAiError(
          'OpenAI rejected your key. Replace it in Settings → AI.',
          400
        )
      );
      const err = await service.generateForRender('render-1').catch((e) => e);
      expect(err).toBeInstanceOf(StudioStop);
      expect(err.message).toBe(
        'OpenAI rejected your key. Replace it in Settings → AI.'
      );
      // the voice made before the failure is kept, a retry never pays twice
      expect(Object.keys(stored())).toEqual([voiceKey]);
    });

    it('lets the workflow retry a rate limit with a readable message', async () => {
      provider.tts.mockRejectedValue(
        new StudioAiError(
          'OpenAI is rate limiting your key right now.',
          429,
          true
        )
      );
      const err = await service.generateForRender('render-1').catch((e) => e);
      expect(err).toBeInstanceOf(StudioAiRetry);
      expect(err.type).toBe('studio_ai_retry');
      expect(err.nonRetryable).toBe(false);
    });

    it('stops with the key message when the workspace has no key', async () => {
      aiManager.forOrganization.mockResolvedValue(undefined);
      const err = await service.generateForRender('render-1').catch((e) => e);
      expect(err).toBeInstanceOf(StudioStop);
      expect(err.message).toBe(MISSING);
    });

    it('needs no key for a typed script without a voice', async () => {
      aiManager.forOrganization.mockResolvedValue(undefined);
      repository.getRenderById.mockResolvedValue({
        id: 'render-1',
        organizationId: 'org-1',
        projectId: 'project-1',
        status: 'queued',
        specSnapshot: JSON.stringify({ ...spec, voiceover: false, stills: 0 }),
        project: { template: 'ai-ugc', name: 'Desk' },
      });
      await expect(
        service.generateForRender('render-1')
      ).resolves.toBeUndefined();
      expect(repository.updateRender).not.toHaveBeenCalled();
    });

    it('waits for a preview of the same project to finish', async () => {
      redisSet.mockResolvedValue(null);
      redisEval.mockResolvedValue(null);
      redisGet.mockResolvedValue('a-preview-token');
      const err = await service.generateForRender('render-1').catch((e) => e);
      expect(err).toBeInstanceOf(StudioAiRetry);
      expect(provider.tts).not.toHaveBeenCalled();
    });

    it('skips a render that was cancelled while it waited', async () => {
      repository.getRenderById.mockResolvedValue({
        id: 'render-1',
        status: 'cancelled',
      });
      await service.generateForRender('render-1');
      expect(aiManager.forOrganization).not.toHaveBeenCalled();
    });
  });
});
