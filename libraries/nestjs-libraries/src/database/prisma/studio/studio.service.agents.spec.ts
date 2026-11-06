// the service builds its storage at construction and pulls in the media and
// AI stacks at import time
const storage = {
  signDownloadUrl: jest.fn().mockResolvedValue('https://r2.example/signed'),
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
const timer = jest.fn().mockResolvedValue(undefined);
jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: (ms: number) => timer(ms),
}));

import 'reflect-metadata';
import { BadRequestException, HttpException } from '@nestjs/common';
import {
  IsArray,
  IsDefined,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  STUDIO_LIMITS,
  StudioService,
} from '@gitroom/nestjs-libraries/database/prisma/studio/studio.service';
import { StudioTemplateManager } from '@gitroom/nestjs-libraries/studio/studio.manager';
import {
  StudioTemplate,
  StudioTemplateAbstract,
} from '@gitroom/nestjs-libraries/studio/studio.interface';
import { StudioClipDto } from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';
import * as schemasHelper from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import { HookOverClipTemplate } from '@gitroom/nestjs-libraries/studio/templates/hook.over.clip.template';
import { TalkingHeadCaptionsTemplate } from '@gitroom/nestjs-libraries/studio/templates/talking.head.captions.template';
import { ImageSlideshowTemplate } from '@gitroom/nestjs-libraries/studio/templates/image.slideshow.template';
import { BeforeAfterTemplate } from '@gitroom/nestjs-libraries/studio/templates/before.after.template';
import { TopNListTemplate } from '@gitroom/nestjs-libraries/studio/templates/top.n.list.template';
import { QuoteCardTemplate } from '@gitroom/nestjs-libraries/studio/templates/quote.card.template';
import { AiUgcTemplate } from '@gitroom/nestjs-libraries/studio/templates/ai.ugc.template';

// A template registered only here: the schemas must pick it up by
// themselves, the way phase 2 templates will. Its second media is not a
// "mediaId" key, only its mediaIds() names it
class FramedInputDto {
  @IsDefined()
  @IsUUID()
  mediaId: string;

  @IsDefined()
  @IsString()
  path: string;
}

class SideBySideDto extends StudioClipDto {
  @IsDefined()
  @IsUUID()
  backgroundMediaId: string;

  @IsOptional()
  @IsArray()
  @Type(() => FramedInputDto)
  @ValidateNested({ each: true })
  frames?: FramedInputDto[];
}

@StudioTemplate({
  identifier: 'test-side-by-side',
  title: 'Side by side',
  description: 'Two videos next to each other',
  dto: SideBySideDto,
  captions: false,
})
class SideBySideTemplate extends StudioTemplateAbstract<any> {
  mediaIds(spec: any) {
    return [spec.input.mediaId, spec.backgroundMediaId];
  }

  plan(): any {
    return {};
  }
}

const MEDIA_ID = '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f';
const OTHER_ORG_MEDIA_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const MUSIC_ID = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const OTHER_MUSIC_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const USED_MUSIC_ID = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';

// AI UGC as an assistant sends it: its own script over the footage
const ugcSpec = {
  footage: [{ mediaId: MEDIA_ID }],
  script: { hook: 'Stop scrolling', lines: ['We shipped exports'], cta: 'Try it' },
  seconds: 20,
};

const hookSpec = {
  input: { mediaId: MEDIA_ID },
  trim: { start: 0, end: 20 },
  hook: { text: 'Watch this' },
};

const errorOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
};

describe('StudioService for assistants and the public API', () => {
  let projects: Map<string, any>;
  let repository: Record<string, jest.Mock>;
  let mediaService: { getOrgMediaById: jest.Mock };
  let aiCredentialService: { hasCredential: jest.Mock };
  let organizationService: { getOrgByIdWithSubscription: jest.Mock };
  let workflowStart: jest.Mock;
  let service: StudioService;
  const org = { id: 'org-1' } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
    redisSet.mockResolvedValue('OK');
    projects = new Map();
    organizationService = {
      getOrgByIdWithSubscription: jest.fn().mockResolvedValue({
        id: 'org-1',
        isTrailing: false,
        subscription: { subscriptionTier: 'STANDARD' },
      }),
    };
    // projects are kept per workspace, like the real repository
    repository = {
      createProject: jest.fn(async (o, name, template, spec, source) => {
        const id = `project-${projects.size + 1}`;
        projects.set(id, {
          id,
          org: o,
          name,
          template,
          spec,
          source,
          renders: [],
        });
        return { id };
      }),
      getProject: jest.fn(async (o, id) => {
        const project = projects.get(id);
        return project && project.org === o && !project.deletedAt
          ? project
          : null;
      }),
      updateProject: jest.fn(async (o, id, data) => {
        Object.assign(projects.get(id), data);
        return { id };
      }),
      deleteProject: jest.fn(async (o, id) => {
        projects.get(id).deletedAt = new Date();
        return { id };
      }),
      attachAsset: jest.fn().mockResolvedValue(undefined),
      detachAssets: jest.fn().mockResolvedValue(undefined),
      removeUnrenderedProject: jest.fn(async (o, id) => {
        if (projects.get(id).renders.length) {
          return false;
        }
        projects.delete(id);
        return true;
      }),
      getActiveRenders: jest.fn().mockResolvedValue([]),
      countRendersSince: jest.fn().mockResolvedValue(0),
      countQueuedRenders: jest.fn().mockResolvedValue(0),
      createRender: jest.fn().mockResolvedValue({ id: 'render-1' }),
      updateRender: jest.fn().mockResolvedValue(undefined),
      getRender: jest.fn(),
      getRenderById: jest.fn(),
      // MUSIC_ID is a Studio music of org-1
      // USED_MUSIC_ID is one already used by another project
      getAsset: jest.fn(async (o: string, id: string) =>
        o === 'org-1' && id === MUSIC_ID
          ? { id: MUSIC_ID, path: 'https://media.example/song.mp3', projectId: null }
          : o === 'org-1' && id === USED_MUSIC_ID
          ? { id, path: 'https://media.example/used.mp3', projectId: 'project-9' }
          : null
      ),
    };
    // MEDIA_ID belongs to org-1, OTHER_ORG_MEDIA_ID to another workspace
    mediaService = {
      getOrgMediaById: jest.fn(async (o: string, id: string) =>
        o === 'org-1' && id === MEDIA_ID
          ? {
              id: MEDIA_ID,
              name: 'abc.mp4',
              path: 'https://media.example/abc.mp4',
              status: 'ready',
              deletedAt: null,
            }
          : null
      ),
    };
    // no AI key connected
    aiCredentialService = { hasCredential: jest.fn().mockResolvedValue(false) };
    workflowStart = jest.fn().mockResolvedValue(undefined);
    const templates = new Map<any, any>([
      [HookOverClipTemplate, new HookOverClipTemplate()],
      [TalkingHeadCaptionsTemplate, new TalkingHeadCaptionsTemplate()],
      [ImageSlideshowTemplate, new ImageSlideshowTemplate()],
      [BeforeAfterTemplate, new BeforeAfterTemplate()],
      [TopNListTemplate, new TopNListTemplate()],
      [QuoteCardTemplate, new QuoteCardTemplate()],
      [AiUgcTemplate, new AiUgcTemplate()],
      [SideBySideTemplate, new SideBySideTemplate()],
    ]);
    service = new StudioService(
      repository as any,
      new StudioTemplateManager({
        get: (target: any) => templates.get(target),
      } as any),
      mediaService as any,
      aiCredentialService as any,
      {
        client: {
          getRawClient: () => ({
            workflow: {
              start: workflowStart,
              getHandle: () => ({ cancel: jest.fn() }),
            },
          }),
        },
      } as any,
      organizationService as any
    );
  });

  afterEach(() => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
  });

  describe('getTemplateSchemas', () => {
    it('lists every registered template with a schema from its DTO', () => {
      const templates = service.getTemplateSchemas();

      expect(templates.map((p) => p.identifier).sort()).toEqual([
        'ai-ugc',
        'before-after',
        'hook-over-clip',
        'image-slideshow',
        'quote-card',
        'talking-head-captions',
        'test-side-by-side',
        'top-n-list',
      ]);
      for (const template of templates) {
        expect(template.schema.type).toBe('object');
        expect(template.description).toEqual(expect.any(String));
      }
      const hook = templates.find((p) => p.identifier === 'hook-over-clip')!;
      expect(hook.title).toBe('Hook over clip');
      expect(hook.description).toEqual(expect.any(String));
      expect(hook.captions).toBe(false);
      expect(hook.schema.type).toBe('object');
      expect(hook.schema.required).toEqual(
        expect.arrayContaining(['input', 'trim', 'hook'])
      );
      // inherited from StudioClipDto, nested DTOs inlined
      expect(hook.schema.properties.trim.properties.end).toMatchObject({
        type: 'number',
        maximum: 600,
      });
      expect(hook.schema.properties.hook.properties.text).toMatchObject({
        maxLength: 120,
      });
      expect(hook.schema.properties.speed.enum).toEqual([0.5, 1, 1.5, 2]);
    });

    it('describes media as ids only and leaves the path out', () => {
      const templates = service.getTemplateSchemas();
      const hook = templates.find((p) => p.identifier === 'hook-over-clip')!;
      const side = templates.find((p) => p.identifier === 'test-side-by-side')!;

      expect(hook.schema.properties.input.properties.path).toBeUndefined();
      expect(hook.schema.properties.input.properties.mediaId).toMatchObject({
        format: 'uuid',
        description: expect.stringContaining('media library'),
      });
      // inside arrays too, and never required
      const frame = side.schema.properties.frames.items;
      expect(frame.properties.path).toBeUndefined();
      expect(frame.required).toEqual(['mediaId']);
      expect(frame.properties.mediaId.description).toContain(
        'Urls are not accepted'
      );
    });

    it('gives assistants the agent description when a template has one', () => {
      const talking = service
        .getTemplateSchemas()
        .find((p) => p.identifier === 'talking-head-captions')!;

      expect(talking.description).toContain('typed script');
      expect(talking.description).not.toContain('AI key');
    });

    it('gives AI UGC the path without a voice, which needs no key', () => {
      const ugc = service
        .getTemplateSchemas()
        .find((p) => p.identifier === 'ai-ugc')!;

      expect(ugc.ai).toBe(true);
      expect(ugc.schema.properties.voiceover.default).toBe(false);
      expect(ugc.description).toContain("workspace's own OpenAI key");
      // the footage are media ids of the library, never paths
      expect(
        ugc.schema.properties.footage.items.properties.path
      ).toBeUndefined();
    });

    it('builds the schemas once', () => {
      const spy = jest.spyOn(schemasHelper, 'getValidationSchemas');
      const first = service.getTemplateSchemas();
      expect(service.getTemplateSchemas()).toBe(first);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('lets a captions template take a script instead of words', () => {
      const talking = service
        .getTemplateSchemas()
        .find((p) => p.identifier === 'talking-head-captions')!;

      expect(talking.captions).toBe(true);
      expect(talking.schema.properties.captions.required || []).not.toContain(
        'words'
      );
      expect(
        talking.schema.properties.captions.properties.script.description
      ).toEqual(expect.any(String));
    });

    it('never changes the schemas the other tools read', () => {
      service.getTemplateSchemas();
      const again = service
        .getTemplateSchemas()
        .find((p) => p.identifier === 'talking-head-captions')!;
      expect(again.schema.properties.captions.properties.words).toBeDefined();
    });
  });

  describe('renderFromSpec', () => {
    it('makes a project and starts its render on the editor path', async () => {
      await expect(
        service.renderFromSpec(org, {
          template: 'hook-over-clip',
          spec: hookSpec,
        })
      ).resolves.toEqual({ id: 'render-1', projectId: 'project-1' });

      const project = projects.get('project-1');
      expect(project.org).toBe('org-1');
      expect(project.source).toBe('api');
      expect(project.name).toBe('Hook over clip');
      expect(project.template).toBe('hook-over-clip');
      expect(repository.createRender).toHaveBeenCalledWith(
        'org-1',
        'project-1',
        20,
        expect.any(String)
      );
      expect(workflowStart).toHaveBeenCalledWith(
        'studioRenderWorkflowV2',
        expect.objectContaining({ workflowId: 'studio_render-1' })
      );
    });

    it('replaces a path the caller sent with the stored one', async () => {
      await service.renderFromSpec(org, {
        template: 'hook-over-clip',
        name: 'Launch teaser',
        spec: {
          ...hookSpec,
          input: { mediaId: MEDIA_ID, path: 'http://169.254.169.254/latest' },
        },
      });

      const project = projects.get('project-1');
      expect(project.name).toBe('Launch teaser');
      expect(JSON.parse(project.spec).input).toEqual({
        mediaId: MEDIA_ID,
        path: 'https://media.example/abc.mp4',
      });
    });

    it('rejects the media of another workspace before making anything', async () => {
      const err = await errorOf(
        service.renderFromSpec(org, {
          template: 'hook-over-clip',
          spec: { ...hookSpec, input: { mediaId: OTHER_ORG_MEDIA_ID } },
        })
      );

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toContain(
        'is not in the media library of this workspace'
      );
      expect(mediaService.getOrgMediaById).toHaveBeenCalledWith(
        'org-1',
        OTHER_ORG_MEDIA_ID
      );
      expect(repository.createProject).not.toHaveBeenCalled();
      expect(workflowStart).not.toHaveBeenCalled();
    });

    it('checks every media the template reads, whatever its key', async () => {
      const err = await errorOf(
        service.renderFromSpec(org, {
          template: 'test-side-by-side',
          spec: { ...hookSpec, backgroundMediaId: OTHER_ORG_MEDIA_ID },
        })
      );

      expect((err as Error).message).toContain(
        `Media ${OTHER_ORG_MEDIA_ID} is not in the media library`
      );
      expect(repository.createProject).not.toHaveBeenCalled();
    });

    it('rejects a picture where the template takes a video', async () => {
      mediaService.getOrgMediaById.mockResolvedValueOnce({
        id: MEDIA_ID,
        name: 'abc.png',
        path: 'https://media.example/abc.png',
        status: 'ready',
        deletedAt: null,
      });

      const err = await errorOf(
        service.renderFromSpec(org, {
          template: 'hook-over-clip',
          spec: hookSpec,
        })
      );
      expect((err as Error).message).toContain('needs a video');
      expect(repository.createProject).not.toHaveBeenCalled();
    });

    it('takes only Studio music of the workspace', async () => {
      const err = await errorOf(
        service.renderFromSpec(org, {
          template: 'hook-over-clip',
          spec: { ...hookSpec, music: { assetId: OTHER_MUSIC_ID } },
        })
      );
      expect((err as Error).message).toContain(
        'is not a Studio music of this workspace'
      );
      expect(repository.getAsset).toHaveBeenCalledWith('org-1', OTHER_MUSIC_ID);
      expect(repository.createProject).not.toHaveBeenCalled();

      await expect(
        service.renderFromSpec(org, {
          template: 'hook-over-clip',
          spec: {
            ...hookSpec,
            music: { assetId: MUSIC_ID, path: 'https://tracker.example/x' },
          },
        })
      ).resolves.toMatchObject({ id: 'render-1' });
      expect(JSON.parse(projects.get('project-1').spec).music.path).toBe(
        'https://media.example/song.mp3'
      );
    });

    it('refuses music another project uses', async () => {
      const err = await errorOf(
        service.renderFromSpec(org, {
          template: 'hook-over-clip',
          spec: { ...hookSpec, music: { assetId: USED_MUSIC_ID } },
        })
      );

      expect((err as Error).message).toBe(
        'That music belongs to another Studio project; upload it again in Studio'
      );
      expect(repository.createProject).not.toHaveBeenCalled();
    });

    it('drops a path that is not the stored one of a media or music', async () => {
      await service.renderFromSpec(org, {
        template: 'quote-card',
        spec: {
          quote: 'Ship small, ship often',
          background: { color: '#112233', path: 'https://tracker.example/a.jpg' },
          seconds: 8,
        },
      });

      expect(JSON.parse(projects.get('project-1').spec).background).toEqual({
        color: '#112233',
      });
    });

    it('renders a template without trim or media by its own length', async () => {
      await expect(
        service.renderFromSpec(org, {
          template: 'quote-card',
          spec: {
            quote: 'Ship small, ship often',
            background: { color: '#112233' },
            seconds: 8,
          },
        })
      ).resolves.toMatchObject({ id: 'render-1' });
      expect(repository.createRender).toHaveBeenCalledWith(
        'org-1',
        'project-1',
        8,
        expect.any(String)
      );
    });

    it('renders AI UGC without a voice and without an AI key', async () => {
      await expect(
        service.renderFromSpec(org, { template: 'ai-ugc', spec: ugcSpec })
      ).resolves.toMatchObject({ id: 'render-1' });

      const spec = JSON.parse(projects.get('project-1').spec);
      expect(spec.voiceover).toBe(false);
      expect(spec.footage[0].path).toBe('https://media.example/abc.mp4');
    });

    it('reads a null as left out, so the voice stays off', async () => {
      await expect(
        service.renderFromSpec(org, {
          template: 'ai-ugc',
          spec: { ...ugcSpec, voiceover: null, topic: null, music: null },
        })
      ).resolves.toMatchObject({ id: 'render-1' });

      const spec = JSON.parse(projects.get('project-1').spec);
      expect(spec.voiceover).toBe(false);
      expect(spec).not.toHaveProperty('topic');
      expect(aiCredentialService.hasCredential).not.toHaveBeenCalled();
    });

    it('refuses AI stills without the AI voice', async () => {
      for (const voiceover of [false, undefined]) {
        const err = await errorOf(
          service.renderFromSpec(org, {
            template: 'ai-ugc',
            spec: { ...ugcSpec, voiceover, stills: 2 },
          })
        );
        expect(err).toBeInstanceOf(BadRequestException);
        expect((err as Error).message).toContain(
          'AI stills need the AI voice'
        );
      }
      expect(repository.createProject).not.toHaveBeenCalled();
    });

    it('needs the workspace key for an AI voice, before making anything', async () => {
      const err = await errorOf(
        service.renderFromSpec(org, {
          template: 'ai-ugc',
          spec: { ...ugcSpec, voiceover: true },
        })
      );

      expect((err as Error).message).toContain('Add your OpenAI key');
      expect(repository.createProject).not.toHaveBeenCalled();
    });

    it('takes only footage of the workspace for AI UGC', async () => {
      const err = await errorOf(
        service.renderFromSpec(org, {
          template: 'ai-ugc',
          spec: {
            ...ugcSpec,
            footage: [{ mediaId: MEDIA_ID }, { mediaId: OTHER_ORG_MEDIA_ID }],
          },
        })
      );

      expect((err as Error).message).toContain(
        `Media ${OTHER_ORG_MEDIA_ID} is not in the media library`
      );
      expect(repository.createProject).not.toHaveBeenCalled();
    });

    it('rejects a media that is still processing', async () => {
      mediaService.getOrgMediaById.mockResolvedValueOnce({
        id: MEDIA_ID,
        path: 'https://media.example/abc.mp4',
        status: 'processing',
        deletedAt: null,
      });

      const err = await errorOf(
        service.renderFromSpec(org, {
          template: 'hook-over-clip',
          spec: hookSpec,
        })
      );
      expect((err as Error).message).toContain('still processing');
      expect(repository.createProject).not.toHaveBeenCalled();
    });

    it('names the templates when the template is unknown', async () => {
      const err = await errorOf(
        service.renderFromSpec(org, { template: 'nope', spec: hookSpec })
      );

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toContain('hook-over-clip');
      expect(repository.createProject).not.toHaveBeenCalled();
    });

    it('rejects a spec that does not follow the template', async () => {
      const err = (await errorOf(
        service.renderFromSpec(org, {
          template: 'hook-over-clip',
          spec: { ...hookSpec, input: { mediaId: 'https://evil.example/a.mp4' } },
        })
      )) as BadRequestException;

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err.getResponse() as any).message.join(' ')).toContain(
        'Pick a video from your media library'
      );
      expect(repository.createProject).not.toHaveBeenCalled();
    });

    it('rejects a spec missing required parts before making anything', async () => {
      const err = (await errorOf(
        service.renderFromSpec(org, {
          template: 'hook-over-clip',
          spec: { input: { mediaId: MEDIA_ID }, trim: { start: 0, end: 20 } },
        })
      )) as BadRequestException;

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err.getResponse() as any).message.join(' ')).toContain('hook');
      expect(repository.createProject).not.toHaveBeenCalled();
    });

    it('needs words or a script for captions, never Whisper', async () => {
      const err = (await errorOf(
        service.renderFromSpec(org, {
          template: 'talking-head-captions',
          spec: {
            input: { mediaId: MEDIA_ID },
            trim: { start: 0, end: 10 },
            captions: { script: '   ' },
          },
        })
      )) as BadRequestException;

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err.getResponse() as any).message.join(' ')).toContain(
        'Make the captions first'
      );
      expect(repository.createProject).not.toHaveBeenCalled();
    });

    it('surfaces a missing plan and makes nothing', async () => {
      organizationService.getOrgByIdWithSubscription.mockResolvedValue({
        id: 'org-1',
        subscription: null,
      });

      const err = (await errorOf(
        service.renderFromSpec(org, {
          template: 'hook-over-clip',
          spec: hookSpec,
        })
      )) as HttpException;

      expect(err.getStatus()).toBe(406);
      expect(err.message).toContain('Studio needs an active plan');
      expect(repository.createProject).not.toHaveBeenCalled();
    });

    it('surfaces the daily limit', async () => {
      repository.countRendersSince.mockResolvedValue(STUDIO_LIMITS.maxPerDay);

      const err = (await errorOf(
        service.renderFromSpec(org, {
          template: 'hook-over-clip',
          spec: hookSpec,
        })
      )) as HttpException;

      expect(err.getStatus()).toBe(429);
      expect(err.message).toContain('fair use limit');
    });

    it('surfaces a busy Studio', async () => {
      repository.countQueuedRenders.mockResolvedValue(
        STUDIO_LIMITS.maxQueuedGlobal
      );

      const err = (await errorOf(
        service.renderFromSpec(org, {
          template: 'hook-over-clip',
          spec: hookSpec,
        })
      )) as HttpException;

      expect(err.getStatus()).toBe(429);
      expect(err.message).toContain('Studio is busy');
    });

    it('deletes the project for good when the render cannot start', async () => {
      // a second start at the same moment holds the start lock
      redisSet.mockResolvedValue(null);

      const err = (await errorOf(
        service.renderFromSpec(org, {
          template: 'hook-over-clip',
          spec: hookSpec,
        })
      )) as HttpException;

      expect(err.getStatus()).toBe(429);
      expect(repository.removeUnrenderedProject).toHaveBeenCalledWith(
        'org-1',
        'project-1'
      );
      expect(projects.has('project-1')).toBe(false);
      expect(repository.deleteProject).not.toHaveBeenCalled();
      expect(repository.createRender).not.toHaveBeenCalled();
    });

    it('keeps a project whose render row exists, soft deleted', async () => {
      // the render row is made, then Temporal refuses the workflow
      repository.createRender.mockImplementation(async (o, projectId) => {
        projects.get(projectId).renders.push({ id: 'render-1' });
        return { id: 'render-1' };
      });
      workflowStart.mockRejectedValue(new Error('temporal down'));

      const err = (await errorOf(
        service.renderFromSpec(org, {
          template: 'hook-over-clip',
          spec: hookSpec,
        })
      )) as HttpException;

      expect(err.getStatus()).toBe(503);
      expect(projects.get('project-1').deletedAt).toBeInstanceOf(Date);
    });

    it('rejects a video longer than 90 seconds before making anything', async () => {
      const err = await errorOf(
        service.renderFromSpec(org, {
          template: 'hook-over-clip',
          spec: { ...hookSpec, trim: { start: 0, end: 120 } },
        })
      );

      expect((err as Error).message).toContain('90 seconds at most');
      expect(repository.createProject).not.toHaveBeenCalled();
      expect(workflowStart).not.toHaveBeenCalled();
    });

    it('rejects a clip that ends before it starts before making anything', async () => {
      const err = await errorOf(
        service.renderFromSpec(org, {
          template: 'hook-over-clip',
          spec: { ...hookSpec, trim: { start: 12, end: 4 } },
        })
      );

      expect((err as Error).message).toContain('must be after its start');
      expect(repository.createProject).not.toHaveBeenCalled();
    });

    it('times a typed script over the clip of a captions template', async () => {
      await expect(
        service.renderFromSpec(org, {
          template: 'talking-head-captions',
          spec: {
            input: { mediaId: MEDIA_ID },
            trim: { start: 2, end: 12 },
            captions: { script: 'Three words here' },
          },
        })
      ).resolves.toEqual({ id: 'render-1', projectId: 'project-1' });

      const captions = JSON.parse(projects.get('project-1').spec).captions;
      expect(captions.source).toBe('script');
      expect(captions.words.map((p: any) => p.text)).toEqual([
        'Three',
        'words',
        'here',
      ]);
      expect(captions.words[0].start).toBeGreaterThanOrEqual(2);
      expect(captions.words[2].end).toBeLessThanOrEqual(12);
    });
  });

  describe('waitForRender', () => {
    it('polls until the render ends', async () => {
      repository.getRender
        .mockResolvedValueOnce({ id: 'render-1', status: 'queued', updatedAt: new Date() })
        .mockResolvedValueOnce({ id: 'render-1', status: 'rendering', updatedAt: new Date() })
        .mockResolvedValueOnce({
          id: 'render-1',
          status: 'completed',
          mediaId: 'media-9',
          path: 'https://media.example/out.mp4',
          updatedAt: new Date(),
        });

      await expect(service.waitForRender('org-1', 'render-1', 25)).resolves.toMatchObject({
        status: 'completed',
        mediaId: 'media-9',
      });
      expect(timer).toHaveBeenCalledTimes(2);
      expect(repository.getRender).toHaveBeenCalledWith('org-1', 'render-1');
    });

    it('answers within the wait even when the render is still running', async () => {
      repository.getRender.mockResolvedValue({
        id: 'render-1',
        status: 'rendering',
        updatedAt: new Date(),
      });

      await expect(service.waitForRender('org-1', 'render-1', 25)).resolves.toMatchObject({
        status: 'rendering',
      });
      // 3 second steps, so 25 seconds is 9 waits at most
      expect(timer).toHaveBeenCalledTimes(9);
    });

    it('does not find the render of another workspace', async () => {
      repository.getRender.mockResolvedValue(null);

      const err = (await errorOf(
        service.waitForRender('org-2', 'render-1', 25)
      )) as HttpException;
      expect(err.getStatus()).toBe(404);
      expect(timer).not.toHaveBeenCalled();
    });
  });
});
