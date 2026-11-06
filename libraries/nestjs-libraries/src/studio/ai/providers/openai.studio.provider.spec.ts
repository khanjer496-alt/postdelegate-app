// the real credential service pulls in prisma; the spec hands the provider a
// mocked OpenAI client instead
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service',
  () => ({
    AiCredentialService: class {},
    MISSING_AI_KEY: 'Add your OpenAI key in Settings → AI',
  })
);

import 'reflect-metadata';
import { APIUserAbortError } from 'openai';
import {
  OPENAI_STUDIO_MODELS,
  OpenAiStudioProvider,
} from '@gitroom/nestjs-libraries/studio/ai/providers/openai.studio.provider';
import { StudioAiError } from '@gitroom/nestjs-libraries/studio/ai/studio.ai.interface';

const script = {
  hook: 'My back stopped hurting',
  lines: ['This desk folds flat'],
  cta: 'Link in bio',
  postText: 'Small flat, big desk',
};

const apiError = (status: number, message: string, code?: string) =>
  Object.assign(new Error(message), {
    status,
    code,
    error: { message, code },
  });

describe('OpenAiStudioProvider', () => {
  let client: any;
  let provider: OpenAiStudioProvider;

  beforeEach(() => {
    client = {
      chat: {
        completions: {
          parse: jest.fn().mockResolvedValue({
            choices: [{ message: { parsed: script, refusal: null } }],
          }),
        },
      },
      audio: {
        speech: {
          create: jest.fn().mockResolvedValue({
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          }),
        },
        transcriptions: {
          create: jest.fn().mockResolvedValue({
            words: [
              { word: ' My ', start: 0.1234, end: 0.3 },
              { word: ' ', start: 0.3, end: 0.4 },
              { word: 'back', start: 0.4, end: 0.8 },
            ],
          }),
        },
      },
      images: {
        generate: jest.fn().mockResolvedValue({
          data: [{ b64_json: Buffer.from('jpeg').toString('base64') }],
        }),
      },
    };
    provider = new OpenAiStudioProvider({
      getOpenAiClient: jest.fn().mockResolvedValue(client),
    } as any);
  });

  it('writes a script with structured output, never retried by the SDK', async () => {
    const signal = new AbortController().signal;
    await expect(
      provider.script(
        'org-1',
        { topic: 'A desk', tone: 'excited', seconds: 20 },
        { signal }
      )
    ).resolves.toEqual(script);

    const [body, options] = client.chat.completions.parse.mock.calls[0];
    expect(body.model).toBe(OPENAI_STUDIO_MODELS.script);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.name).toBe('studioScript');
    // 20 seconds is about 50 words, the length is capped in the prompt
    expect(body.messages[0].content).toContain('about 50 words');
    expect(body.messages[0].content).toContain('never more than 60');
    expect(body.messages[1].content).toBe('Topic or product: A desk');
    expect(options).toEqual({ maxRetries: 0, signal });
  });

  it('shows the refusal of the model as it wrote it', async () => {
    client.chat.completions.parse.mockResolvedValue({
      choices: [
        { message: { parsed: null, refusal: "I can't help with that." } },
      ],
    });
    await expect(
      provider.script('org-1', { topic: 'x', tone: 'calm', seconds: 15 })
    ).rejects.toMatchObject({
      status: 422,
      retry: false,
      message: "OpenAI refused to write this script: I can't help with that.",
    });
  });

  it('voices the script with the picked voice, its default when unknown', async () => {
    const audio = await provider.tts('org-1', {
      text: 'Hello there',
      voice: 'cedar',
      instructions: 'Calm',
    });
    expect(audio).toEqual(Buffer.from([1, 2, 3]));
    expect(client.audio.speech.create).toHaveBeenCalledWith(
      {
        model: OPENAI_STUDIO_MODELS.voice,
        voice: 'cedar',
        input: 'Hello there',
        instructions: 'Calm',
        response_format: 'mp3',
      },
      { maxRetries: 0, signal: undefined }
    );

    await provider.tts('org-1', {
      text: 'x'.repeat(5000),
      voice: 'nobody',
      instructions: '',
    });
    const [body] = client.audio.speech.create.mock.calls[1];
    expect(body.voice).toBe('marin');
    expect(body.input).toHaveLength(4096);
  });

  it('times the words of the voice with whisper-1', async () => {
    const words = await provider.transcribe('org-1', __filename);
    expect(words).toEqual([
      { text: 'My', start: 0.123, end: 0.3 },
      { text: 'back', start: 0.4, end: 0.8 },
    ]);
    const [body] = client.audio.transcriptions.create.mock.calls[0];
    expect(body).toMatchObject({
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word'],
    });
    body.file.destroy();
  });

  it('makes a portrait still as a jpeg', async () => {
    await expect(
      provider.image('org-1', { prompt: 'A desk' })
    ).resolves.toEqual(Buffer.from('jpeg'));
    expect(client.images.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: OPENAI_STUDIO_MODELS.image,
        size: '1024x1536',
        output_format: 'jpeg',
        n: 1,
      }),
      { maxRetries: 0, signal: undefined }
    );
  });

  it('makes no video: the OpenAI Videos API is shut down', () => {
    expect(provider.video).toBeUndefined();
  });

  describe('errors', () => {
    const fails = (err: any) => {
      client.images.generate.mockRejectedValue(err);
      return provider.image('org-1', { prompt: 'A desk' }).catch((e) => e);
    };

    it('a rejected key: replace it, never retried', async () => {
      const err = await fails(
        apiError(401, 'Incorrect API key provided: sk-abc...wxyz')
      );
      expect(err).toBeInstanceOf(StudioAiError);
      expect(err).toMatchObject({ status: 400, retry: false, account: true });
      expect(err.message).toBe(
        'OpenAI rejected your key. Replace it in Settings → AI.'
      );
    });

    it('an empty account: add billing, never retried', async () => {
      const err = await fails(
        apiError(429, 'You exceeded your quota', 'insufficient_quota')
      );
      expect(err).toMatchObject({ status: 400, retry: false, account: true });
      expect(err.message).toContain('no API credit');
    });

    it('a rate limit: may pass, retried later', async () => {
      const err = await fails(apiError(429, 'Rate limit reached'));
      expect(err).toMatchObject({ status: 429, retry: true });
    });

    it('a refusal of the safety system: shows its message', async () => {
      const err = await fails(
        apiError(
          400,
          'Your request was rejected by the safety system. safety_violations=[violence]',
          'moderation_blocked'
        )
      );
      expect(err).toMatchObject({ status: 422, retry: false });
      expect(err.message).toBe(
        'OpenAI refused this: Your request was rejected by the safety system. safety_violations=[violence]'
      );
    });

    it('a call that ran out of time: may pass', async () => {
      const err = await fails(new APIUserAbortError());
      expect(err).toMatchObject({ status: 504, retry: true });
    });

    it('an outage: may pass', async () => {
      const err = await fails(apiError(503, 'Service unavailable'));
      expect(err).toMatchObject({ status: 502, retry: true });
    });

    it('a model the key has no access to', async () => {
      const err = await fails(apiError(403, 'Organization must be verified'));
      expect(err).toMatchObject({ status: 400, retry: false, account: false });
    });

    it('never logs or shows the key', async () => {
      const log = jest.spyOn(console, 'error').mockImplementation(() => null);
      const err = await fails(
        apiError(400, 'Bad thing near sk-live-123456789')
      );
      expect(err.message).not.toContain('sk-live');
      expect(JSON.stringify(log.mock.calls)).not.toContain('sk-live');
      log.mockRestore();
    });
  });
});
