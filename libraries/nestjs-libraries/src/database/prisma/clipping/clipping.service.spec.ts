// the service builds its storage and media processors at construction and
// pulls in the posts, media and AI stacks at import time
const storage = {
  signDownloadUrl: jest.fn(),
  signUploadUrl: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
  removeFile: jest.fn(),
};
const ingest = { submit: jest.fn(), status: jest.fn() };
const clipper = { submit: jest.fn(), status: jest.fn() };
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: () => storage,
    createIngestProcessor: () => ingest,
    createClipProcessor: () => clipper,
  },
}));
const redisSet = jest.fn();
const workflowStart = jest.fn();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: (...args: unknown[]) => redisSet(...args), del: jest.fn() },
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/clipping/clipping.repository',
  () => ({
    ClippingRepository: class {},
  })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({
    SubscriptionService: class {},
  })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({
    OrganizationService: class {},
  })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({
    IntegrationService: class {},
  })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service',
  () => ({
    PostsService: class {},
  })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({
    MediaService: class {},
  })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service',
  () => ({
    AiCredentialService: class {},
    MISSING_AI_KEY: 'Add your OpenAI key in Settings → AI',
  })
);
jest.mock('@gitroom/nestjs-libraries/openai/openai.service', () => ({
  OpenaiService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/deepgram/deepgram.service', () => ({
  DeepgramService: class {},
}));
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));
jest.mock('@gitroom/nestjs-libraries/dtos/clipping/clipping.dto', () => ({
  ClippingDto: class {},
}));

import { BadRequestException } from '@nestjs/common';
import {
  ClippingService,
  ClippingStop,
} from '@gitroom/nestjs-libraries/database/prisma/clipping/clipping.service';

const MISSING = 'Add your OpenAI key in Settings → AI';

describe('ClippingService workspace key', () => {
  let clippingRepository: {
    getRunningClippings: jest.Mock;
    countClippingsSince: jest.Mock;
    createClipping: jest.Mock;
    getClippingById: jest.Mock;
    updateClipping: jest.Mock;
    createClips: jest.Mock;
  };
  let integrationService: { getIntegrationById: jest.Mock };
  let openAi: { pickClips: jest.Mock };
  let deepgram: { transcribeUrl: jest.Mock };
  let temporalService: { client: { getRawClient: jest.Mock } };
  let aiCredentialService: { hasCredential: jest.Mock };
  let service: ClippingService;

  const org = { id: 'org-1', isTrailing: false } as any;
  const body = {
    url: 'https://www.youtube.com/watch?v=abc',
    fit: 'blur',
  } as any;
  const segments = [
    { start: 0, end: 20, text: 'one' },
    { start: 20, end: 40, text: 'two' },
  ];

  beforeEach(() => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    jest.clearAllMocks();
    redisSet.mockResolvedValue('OK');
    clippingRepository = {
      getRunningClippings: jest.fn().mockResolvedValue([]),
      countClippingsSince: jest.fn().mockResolvedValue(0),
      createClipping: jest.fn().mockResolvedValue({ id: 'clipping-1' }),
      getClippingById: jest.fn().mockResolvedValue({
        id: 'clipping-1',
        organizationId: 'org-9',
        title: 'A talk',
        maxClips: 2,
        clips: [],
      }),
      updateClipping: jest.fn().mockResolvedValue(undefined),
      createClips: jest.fn(async (_: string, clips: unknown[]) =>
        clips.map((_clip, i) => ({ id: `clip-${i}` }))
      ),
    };
    integrationService = { getIntegrationById: jest.fn() };
    openAi = {
      pickClips: jest
        .fn()
        .mockResolvedValue([
          { from: 0, to: 0, title: 'First', content: 'first clip' },
        ]),
    };
    deepgram = { transcribeUrl: jest.fn() };
    temporalService = {
      client: {
        getRawClient: jest
          .fn()
          .mockReturnValue({ workflow: { start: workflowStart } }),
      },
    };
    aiCredentialService = { hasCredential: jest.fn() };
    storage.readFile.mockResolvedValue(
      JSON.stringify({ segments, language: 'en' })
    );
    service = new ClippingService(
      clippingRepository as any,
      {} as any,
      {} as any,
      integrationService as any,
      {} as any,
      {} as any,
      openAi as any,
      deepgram as any,
      temporalService as any,
      aiCredentialService as any
    );
  });

  it('clipping creation refuses without a key', async () => {
    aiCredentialService.hasCredential.mockResolvedValue(false);

    const started = service.startClipping(org, body);

    await expect(started).rejects.toBeInstanceOf(BadRequestException);
    await expect(started).rejects.toThrow(MISSING);
    expect(aiCredentialService.hasCredential).toHaveBeenCalledWith('org-1');
    expect(clippingRepository.createClipping).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
    expect(workflowStart).not.toHaveBeenCalled();
    expect(ingest.submit).not.toHaveBeenCalled();
    expect(clipper.submit).not.toHaveBeenCalled();
    expect(deepgram.transcribeUrl).not.toHaveBeenCalled();
  });

  it('clipping creation goes on with a key', async () => {
    aiCredentialService.hasCredential.mockResolvedValue(true);

    expect(await service.startClipping(org, body)).toEqual({
      id: 'clipping-1',
    });
    expect(aiCredentialService.hasCredential).toHaveBeenCalledWith('org-1');
    expect(clippingRepository.createClipping).toHaveBeenCalled();
  });

  it("pickClips uses the clipping's organization key", async () => {
    aiCredentialService.hasCredential.mockResolvedValue(true);

    expect(await service.pickClips('clipping-1')).toEqual(['clip-0']);
    expect(aiCredentialService.hasCredential).toHaveBeenCalledWith('org-9');
    expect(openAi.pickClips).toHaveBeenCalledWith(
      'org-9',
      'A talk',
      'en',
      segments,
      2
    );
  });

  it('pickClips stops the clipping without a retry when the key is gone', async () => {
    aiCredentialService.hasCredential.mockResolvedValue(false);

    const picked = service.pickClips('clipping-1');

    await expect(picked).rejects.toBeInstanceOf(ClippingStop);
    await expect(picked).rejects.toMatchObject({
      message: MISSING,
      type: 'clipping_stop',
      nonRetryable: true,
    });
    expect(openAi.pickClips).not.toHaveBeenCalled();
    expect(clippingRepository.updateClipping).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a refused key',
      Object.assign(new Error('401 Incorrect API key provided'), {
        status: 401,
      }),
      'OpenAI rejected your key. Replace it in Settings → AI.',
    ],
    [
      'an account with no API credit',
      Object.assign(new Error('429 You exceeded your current quota'), {
        status: 429,
        code: 'insufficient_quota',
      }),
      'Your OpenAI account has no API credit. Add billing at platform.openai.com.',
    ],
  ])(
    'pickClips stops the clipping without a retry on %s',
    async (_, error, message) => {
      aiCredentialService.hasCredential.mockResolvedValue(true);
      openAi.pickClips.mockRejectedValue(error);

      const picked = service.pickClips('clipping-1');

      await expect(picked).rejects.toBeInstanceOf(ClippingStop);
      await expect(picked).rejects.toMatchObject({
        message,
        type: 'clipping_stop',
        nonRetryable: true,
      });
      expect(clippingRepository.createClips).not.toHaveBeenCalled();
    }
  );

  it('pickClips lets any other OpenAI error retry', async () => {
    aiCredentialService.hasCredential.mockResolvedValue(true);
    const error = Object.assign(new Error('429 Rate limit reached'), {
      status: 429,
      code: 'rate_limit_exceeded',
    });
    openAi.pickClips.mockRejectedValue(error);

    const picked = service.pickClips('clipping-1');

    await expect(picked).rejects.toBe(error);
    await expect(picked).rejects.not.toBeInstanceOf(ClippingStop);
  });
});
