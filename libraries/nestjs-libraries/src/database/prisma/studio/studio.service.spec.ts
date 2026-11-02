// the service builds its storage at construction and pulls in the media and
// AI stacks at import time
const storage = {
  signDownloadUrl: jest.fn().mockResolvedValue('https://r2.example/signed'),
  uploadStream: jest.fn(),
  removeFile: jest.fn().mockResolvedValue(undefined),
};
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => storage },
}));
const redisSet = jest.fn();
const redisDel = jest.fn();
const redisGet = jest.fn();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
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
import { BadRequestException, HttpException } from '@nestjs/common';
import dayjs from 'dayjs';
import {
  STUDIO_LIMITS,
  StudioService,
} from '@gitroom/nestjs-libraries/database/prisma/studio/studio.service';
import { StudioTemplateManager } from '@gitroom/nestjs-libraries/studio/studio.manager';
import { HookOverClipTemplate } from '@gitroom/nestjs-libraries/studio/templates/hook.over.clip.template';
import { TalkingHeadCaptionsTemplate } from '@gitroom/nestjs-libraries/studio/templates/talking.head.captions.template';
import { AiUgcTemplate } from '@gitroom/nestjs-libraries/studio/templates/ai.ugc.template';

const MISSING = 'Add your OpenAI key in Settings → AI';

const spec = {
  input: { mediaId: '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f' },
  trim: { start: 0, end: 20 },
  hook: { text: 'Watch this' },
};

const status = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (err) {
    return err instanceof HttpException ? err.getStatus() : err;
  }
  return 'resolved';
};

describe('StudioService fair use', () => {
  let repository: Record<string, jest.Mock>;
  let mediaService: { getOrgMediaById: jest.Mock };
  let aiCredentialService: { hasCredential: jest.Mock };
  let workflowStart: jest.Mock;
  let workflowCancel: jest.Mock;
  let organizationService: { getOrgByIdWithSubscription: jest.Mock };
  let service: StudioService;
  // the request organization: billing is always read again from the database
  const paid = { id: 'org-1', isTrailing: false } as any;
  const trial = paid;
  const subscription = { subscriptionTier: 'STANDARD' };
  const asTrial = () =>
    organizationService.getOrgByIdWithSubscription.mockResolvedValue({
      id: 'org-1',
      isTrailing: true,
      subscription,
    });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
    redisSet.mockResolvedValue('OK');
    organizationService = {
      getOrgByIdWithSubscription: jest.fn().mockResolvedValue({
        id: 'org-1',
        isTrailing: false,
        subscription,
      }),
    };
    repository = {
      getProject: jest.fn().mockResolvedValue({
        id: 'project-1',
        name: 'My video',
        template: 'hook-over-clip',
        spec: JSON.stringify(spec),
        renders: [],
      }),
      getActiveRenders: jest.fn().mockResolvedValue([]),
      countRendersSince: jest.fn().mockResolvedValue(0),
      countQueuedRenders: jest.fn().mockResolvedValue(0),
      createRender: jest.fn().mockResolvedValue({ id: 'render-1' }),
      updateRender: jest.fn().mockResolvedValue(undefined),
      updateProject: jest.fn().mockResolvedValue(undefined),
      getProjectAssets: jest.fn().mockResolvedValue([]),
      getRender: jest.fn(),
      getRenderById: jest.fn(),
      getAiAssets: jest.fn().mockResolvedValue([]),
      deleteRemovableAsset: jest.fn().mockResolvedValue({ count: 1 }),
    };
    mediaService = {
      getOrgMediaById: jest.fn().mockResolvedValue({
        id: '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f',
        name: 'abc.mp4',
        path: 'https://media.example/abc.mp4',
        status: 'ready',
        deletedAt: null,
      }),
    };
    aiCredentialService = { hasCredential: jest.fn().mockResolvedValue(false) };
    workflowStart = jest.fn().mockResolvedValue(undefined);
    workflowCancel = jest.fn().mockResolvedValue(undefined);
    const templates = new Map<any, any>([
      [HookOverClipTemplate, new HookOverClipTemplate()],
      [TalkingHeadCaptionsTemplate, new TalkingHeadCaptionsTemplate()],
      [AiUgcTemplate, new AiUgcTemplate()],
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
              getHandle: () => ({ cancel: workflowCancel }),
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

  it('starts a render on the main queue under a start lock', async () => {
    await expect(service.startRender(paid, 'project-1')).resolves.toEqual({
      id: 'render-1',
    });
    expect(redisSet).toHaveBeenCalledWith(
      'studioStart:org-1',
      '1',
      'EX',
      15,
      'NX'
    );
    expect(repository.createRender).toHaveBeenCalledWith(
      'org-1',
      'project-1',
      20,
      expect.any(String)
    );
    // V2 makes what the AI is asked for first, a no-op for this template
    expect(workflowStart).toHaveBeenCalledWith(
      'studioRenderWorkflowV2',
      expect.objectContaining({
        workflowId: 'studio_render-1',
        taskQueue: 'main',
        args: [{ renderId: 'render-1' }],
      })
    );
    expect(redisDel).toHaveBeenCalledWith('studioStart:org-1');
  });

  describe('AI UGC', () => {
    const aiSpec = {
      voiceover: true,
      footage: [{ mediaId: '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f' }],
      script: { hook: 'Stop scrolling', lines: ['It works'] },
    };
    const project = (value: any) =>
      repository.getProject.mockResolvedValue({
        id: 'project-1',
        name: 'Desk',
        template: 'ai-ugc',
        spec: JSON.stringify(value),
        renders: [],
      });

    it('asks for the key before a render with a voice waits', async () => {
      project(aiSpec);
      await expect(service.startRender(paid, 'project-1')).rejects.toThrow(
        MISSING
      );
      expect(repository.createRender).not.toHaveBeenCalled();
      expect(workflowStart).not.toHaveBeenCalled();
    });

    it('renders a typed script without a voice with no key at all', async () => {
      project({ ...aiSpec, voiceover: false, seconds: 20 });
      await expect(service.startRender(paid, 'project-1')).resolves.toEqual({
        id: 'render-1',
      });
      expect(repository.createRender).toHaveBeenCalledWith(
        'org-1',
        'project-1',
        20,
        expect.any(String)
      );
    });

    it('starts a render with a voice when the workspace has a key', async () => {
      project(aiSpec);
      aiCredentialService.hasCredential.mockResolvedValue(true);
      await expect(service.startRender(paid, 'project-1')).resolves.toEqual({
        id: 'render-1',
      });
    });
  });

  it('refuses a second start while the lock is held', async () => {
    redisSet.mockResolvedValue(null);
    expect(await status(service.startRender(paid, 'project-1'))).toBe(429);
    expect(repository.createRender).not.toHaveBeenCalled();
  });

  it(`refuses a trial workspace after ${STUDIO_LIMITS.trialRenders} renders`, async () => {
    repository.countRendersSince.mockImplementation(
      async (_org: string, since?: Date) =>
        since ? 0 : STUDIO_LIMITS.trialRenders
    );
    asTrial();
    expect(await status(service.startRender(trial, 'project-1'))).toBe(406);
    expect(repository.createRender).not.toHaveBeenCalled();
    // the lock is given back either way
    expect(redisDel).toHaveBeenCalledWith('studioStart:org-1');
  });

  it('lets a trial workspace render below the cap', async () => {
    repository.countRendersSince.mockResolvedValue(
      STUDIO_LIMITS.trialRenders - 1
    );
    asTrial();
    expect(await status(service.startRender(trial, 'project-1'))).toBe(
      'resolved'
    );
  });

  it('never applies the trial cap to a paid workspace or without billing', async () => {
    repository.countRendersSince.mockImplementation(
      async (_org: string, since?: Date) => (since ? 0 : 500)
    );
    expect(await status(service.startRender(paid, 'project-1'))).toBe(
      'resolved'
    );
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    asTrial();
    expect(await status(service.startRender(trial, 'project-1'))).toBe(
      'resolved'
    );
  });

  it('refuses a workspace that stopped paying while billing is on', async () => {
    organizationService.getOrgByIdWithSubscription.mockResolvedValue({
      id: 'org-1',
      isTrailing: false,
      subscription: null,
    });
    expect(await status(service.startRender(paid, 'project-1'))).toBe(406);
    expect(repository.createRender).not.toHaveBeenCalled();
    expect(redisDel).toHaveBeenCalledWith('studioStart:org-1');
  });

  it('never reads a trial flag left without a subscription as a trial', async () => {
    organizationService.getOrgByIdWithSubscription.mockResolvedValue({
      id: 'org-1',
      isTrailing: true,
      subscription: null,
    });
    expect(await status(service.startRender(paid, 'project-1'))).toBe(406);
    await expect(service.getUsage(paid)).resolves.toEqual(
      expect.objectContaining({ subscribed: false, trial: false })
    );
  });

  it('lets anyone render without billing (self-hosted)', async () => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    organizationService.getOrgByIdWithSubscription.mockResolvedValue(null);
    expect(await status(service.startRender(paid, 'project-1'))).toBe(
      'resolved'
    );
    expect(
      organizationService.getOrgByIdWithSubscription
    ).not.toHaveBeenCalled();
  });

  it(`refuses after ${STUDIO_LIMITS.maxPerDay} renders in 24 hours`, async () => {
    repository.countRendersSince.mockImplementation(
      async (_org: string, since?: Date) =>
        since ? STUDIO_LIMITS.maxPerDay : 0
    );
    expect(await status(service.startRender(paid, 'project-1'))).toBe(429);
    const since = repository.countRendersSince.mock.calls.find(
      (call) => call[1]
    )![1] as Date;
    expect(dayjs().diff(since, 'hour')).toBe(24);
  });

  it(`refuses when ${STUDIO_LIMITS.maxQueuedPerWorkspace} renders already wait`, async () => {
    repository.getActiveRenders.mockResolvedValue(
      [1, 2, 3].map((i) => ({
        id: `r-${i}`,
        status: 'queued',
        updatedAt: new Date(),
      }))
    );
    expect(await status(service.startRender(paid, 'project-1'))).toBe(429);
  });

  it('allows a render to wait behind the running one', async () => {
    repository.getActiveRenders.mockResolvedValue([
      { id: 'r-1', status: 'rendering', updatedAt: new Date() },
      { id: 'r-2', status: 'queued', updatedAt: new Date() },
    ]);
    expect(await status(service.startRender(paid, 'project-1'))).toBe(
      'resolved'
    );
  });

  it(`refuses when ${STUDIO_LIMITS.maxQueuedGlobal} renders wait on the server`, async () => {
    repository.countQueuedRenders.mockResolvedValue(
      STUDIO_LIMITS.maxQueuedGlobal
    );
    expect(await status(service.startRender(paid, 'project-1'))).toBe(429);
  });

  it('closes renders whose workflow died before counting the queue', async () => {
    const old = dayjs().subtract(3, 'hour').toDate();
    repository.getActiveRenders.mockResolvedValue(
      [1, 2, 3].map((i) => ({ id: `r-${i}`, status: 'queued', updatedAt: old }))
    );
    repository.getRenderById.mockResolvedValue({
      id: 'r-1',
      status: 'queued',
      mediaId: null,
    });
    expect(await status(service.startRender(paid, 'project-1'))).toBe(
      'resolved'
    );
    expect(repository.updateRender).toHaveBeenCalledWith(
      'r-1',
      expect.objectContaining({ status: 'failed' })
    );
  });

  it(`refuses an output longer than ${STUDIO_LIMITS.maxSeconds} seconds`, async () => {
    repository.getProject.mockResolvedValue({
      id: 'project-1',
      template: 'hook-over-clip',
      spec: JSON.stringify({ ...spec, trim: { start: 0, end: 200 }, speed: 2 }),
    });
    expect(await status(service.startRender(paid, 'project-1'))).toBe(400);

    // the same clip at double speed fits
    repository.getProject.mockResolvedValue({
      id: 'project-1',
      template: 'hook-over-clip',
      spec: JSON.stringify({ ...spec, trim: { start: 0, end: 180 }, speed: 2 }),
    });
    expect(await status(service.startRender(paid, 'project-1'))).toBe(
      'resolved'
    );
  });

  it('refuses media of another workspace', async () => {
    mediaService.getOrgMediaById.mockResolvedValue(null);
    expect(await status(service.startRender(paid, 'project-1'))).toBe(400);
    expect(mediaService.getOrgMediaById).toHaveBeenCalledWith(
      'org-1',
      '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f'
    );
  });

  it('marks a render failed when its workflow can not start', async () => {
    workflowStart.mockRejectedValue(new Error('down'));
    expect(await status(service.startRender(paid, 'project-1'))).toBe(503);
    expect(repository.updateRender).toHaveBeenCalledWith('render-1', {
      status: 'failed',
      error: 'Could not start the render',
    });
  });

  it('only counts queued renders touched lately against the server limit', async () => {
    await service.startRender(paid, 'project-1');
    const since = repository.countQueuedRenders.mock.calls[0][0] as Date;
    expect(dayjs().diff(since, 'hour')).toBe(2);
  });

  it('cancels through the workflow and keeps the render when Temporal is down', async () => {
    repository.getRender.mockResolvedValue({
      id: 'render-1',
      status: 'rendering',
      updatedAt: new Date(),
    });
    await service.cancelRender('org-1', 'render-1');
    expect(workflowCancel).toHaveBeenCalled();
    expect(repository.updateRender).not.toHaveBeenCalled();

    workflowCancel.mockRejectedValue(new Error('unavailable'));
    expect(await status(service.cancelRender('org-1', 'render-1'))).toBe(503);
    expect(repository.updateRender).not.toHaveBeenCalled();
  });

  it('closes a render whose workflow is gone when it is cancelled', async () => {
    repository.getRender.mockResolvedValue({
      id: 'render-1',
      status: 'queued',
      updatedAt: new Date(),
    });
    repository.getRenderById.mockResolvedValue({
      id: 'render-1',
      status: 'queued',
      mediaId: null,
    });
    workflowCancel.mockRejectedValue(
      Object.assign(new Error('gone'), { name: 'WorkflowNotFoundError' })
    );
    await service.cancelRender('org-1', 'render-1');
    expect(repository.updateRender).toHaveBeenCalledWith('render-1', {
      status: 'cancelled',
      error: null,
    });
  });

  it('cancels the waiting renders of a project it deletes', async () => {
    repository.deleteProject = jest.fn();
    repository.getActiveRenders.mockResolvedValue([
      {
        id: 'r-1',
        projectId: 'project-1',
        status: 'queued',
        updatedAt: new Date(),
      },
      {
        id: 'r-2',
        projectId: 'project-2',
        status: 'queued',
        updatedAt: new Date(),
      },
    ]);
    repository.getRender.mockResolvedValue({
      id: 'r-1',
      status: 'queued',
      updatedAt: new Date(),
    });
    await service.deleteProject('org-1', 'project-1');
    expect(workflowCancel).toHaveBeenCalledTimes(1);
    expect(repository.getRender).toHaveBeenCalledWith('org-1', 'r-1');
    expect(repository.deleteProject).toHaveBeenCalledWith('org-1', 'project-1');
  });

  it('removes what the AI made for a project it deletes, like its music', async () => {
    repository.deleteProject = jest.fn();
    repository.getProjectAssets.mockResolvedValue([
      { id: 'a-1', path: 'https://media.example/v.mp3' },
      { id: 'a-2', path: 'https://media.example/s.jpg' },
    ]);
    // a file that can't be removed never keeps the others
    storage.removeFile.mockRejectedValueOnce(new Error('gone'));
    await service.deleteProject('org-1', 'project-1');
    expect(repository.deleteRemovableAsset).toHaveBeenCalledTimes(2);
    expect(storage.removeFile).toHaveBeenCalledWith(
      'https://media.example/s.jpg'
    );
  });

  it('reports usage with the trial renders left', async () => {
    repository.countRendersSince.mockImplementation(
      async (_org: string, since?: Date) => (since ? 2 : 4)
    );
    asTrial();
    await expect(service.getUsage(trial)).resolves.toEqual(
      expect.objectContaining({
        trial: true,
        trialUsed: 4,
        usedToday: 2,
        trialRenders: 10,
        maxPerDay: 30,
        maxSeconds: 90,
      })
    );
  });
});

describe('StudioService render turn', () => {
  let repository: Record<string, jest.Mock>;
  let service: StudioService;

  beforeEach(() => {
    repository = {
      getRenderById: jest.fn(),
      getActiveRenders: jest.fn(),
      updateRender: jest.fn(),
    };
    service = new StudioService(
      repository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
  });

  it('lets only the oldest active render of a workspace go', async () => {
    repository.getRenderById.mockResolvedValue({
      id: 'r-2',
      organizationId: 'org-1',
      status: 'queued',
      updatedAt: new Date(),
    });
    repository.getActiveRenders.mockResolvedValue([
      { id: 'r-1', status: 'rendering', updatedAt: new Date() },
      { id: 'r-2', status: 'queued', updatedAt: new Date() },
    ]);
    await expect(service.prepareRender('r-2')).resolves.toBe('wait');

    repository.getActiveRenders.mockResolvedValue([
      { id: 'r-2', status: 'queued', updatedAt: new Date() },
    ]);
    await expect(service.prepareRender('r-2')).resolves.toBe('ready');
    // waiting touches the render so it never reads as stale
    expect(repository.updateRender).toHaveBeenCalledWith('r-2', {
      status: 'queued',
    });
  });

  it('stops a render that was cancelled while it waited', async () => {
    repository.getRenderById.mockResolvedValue({
      id: 'r-2',
      organizationId: 'org-1',
      status: 'cancelled',
    });
    await expect(service.prepareRender('r-2')).resolves.toBe('gone');
  });

  it('keeps a saved video when the render fails after it', async () => {
    repository.getRenderById.mockResolvedValue({
      id: 'r-1',
      status: 'uploading',
      mediaId: 'media-9',
    });
    await service.failRender('r-1', 'boom');
    expect(repository.updateRender).toHaveBeenCalledWith(
      'r-1',
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('records a cancel without an error', async () => {
    repository.getRenderById.mockResolvedValue({
      id: 'r-1',
      status: 'rendering',
      mediaId: null,
    });
    await service.failRender('r-1', 'Cancelled', true, true);
    expect(repository.updateRender).toHaveBeenCalledWith('r-1', {
      status: 'cancelled',
      error: null,
    });
  });
});

describe('StudioService transcribe', () => {
  let repository: Record<string, jest.Mock>;
  let aiCredentialService: { hasCredential: jest.Mock };
  let service: StudioService;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = {
      getProject: jest.fn().mockResolvedValue({
        id: 'project-1',
        template: 'talking-head-captions',
        spec: JSON.stringify({
          input: { mediaId: '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f' },
          trim: { start: 5, end: 9 },
        }),
      }),
      updateProject: jest.fn(),
    };
    aiCredentialService = { hasCredential: jest.fn().mockResolvedValue(false) };
    const templates = new Map<any, any>([
      [TalkingHeadCaptionsTemplate, new TalkingHeadCaptionsTemplate()],
      [HookOverClipTemplate, new HookOverClipTemplate()],
    ]);
    service = new StudioService(
      repository as any,
      new StudioTemplateManager({
        get: (target: any) => templates.get(target),
      } as any),
      {} as any,
      aiCredentialService as any,
      {} as any
    );
  });

  it('spreads a typed script without any AI key', async () => {
    const { words } = await service.transcribe('org-1', 'project-1', {
      script: 'one two',
    });
    expect(words[0].start).toBe(5);
    expect(words[1].end).toBe(9);
    expect(aiCredentialService.hasCredential).not.toHaveBeenCalled();
    expect(
      JSON.parse(repository.updateProject.mock.calls[0][2].spec).captions
    ).toEqual(expect.objectContaining({ source: 'script', words }));
  });

  it('runs one transcription at a time per workspace', async () => {
    redisSet.mockResolvedValue(null);
    expect(await status(service.transcribe('org-1', 'project-1', {}))).toBe(
      429
    );
    expect(aiCredentialService.hasCredential).not.toHaveBeenCalled();
  });

  it('needs an active plan for Whisper but not for a typed script', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
    const organizationService = {
      getOrgByIdWithSubscription: jest
        .fn()
        .mockResolvedValue({
          id: 'org-1',
          isTrailing: false,
          subscription: null,
        }),
    };
    (service as any)._organizationService = organizationService;
    try {
      expect(
        await service
          .transcribe('org-1', 'project-1', {})
          .catch((err: HttpException) => err.getStatus())
      ).toBe(406);
      expect(aiCredentialService.hasCredential).not.toHaveBeenCalled();
      await expect(
        service.transcribe('org-1', 'project-1', { script: 'one two' })
      ).resolves.toBeTruthy();
    } finally {
      delete process.env.STRIPE_PUBLISHABLE_KEY;
    }
  });

  it('releases only its own transcription lock', async () => {
    redisSet.mockResolvedValue('OK');
    redisGet.mockResolvedValue('someone-else');
    await expect(
      service.transcribe('org-1', 'project-1', {})
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(redisDel).not.toHaveBeenCalled();

    redisGet.mockImplementation(async () => redisSet.mock.calls.at(-1)[1]);
    await expect(
      service.transcribe('org-1', 'project-1', {})
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(redisDel).toHaveBeenCalledWith('studioTranscribe:org-1');
  });

  it('asks for a key when there is no script and no key', async () => {
    redisSet.mockResolvedValue('OK');
    const result = service.transcribe('org-1', 'project-1', {});
    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.transcribe('org-1', 'project-1', {})
    ).rejects.toMatchObject({ message: MISSING });
  });
});
