import { createReadStream } from 'fs';
import { APIConnectionError, APIUserAbortError } from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import {
  StudioAiCall,
  StudioAiError,
  StudioAiImageRequest,
  StudioAiProvider,
  StudioAiProviderAbstract,
  StudioAiScript,
  StudioAiScriptRequest,
  StudioAiVoiceRequest,
} from '@gitroom/nestjs-libraries/studio/ai/studio.ai.interface';
import { AiCredentialService } from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service';
import {
  SAFETY_MESSAGE_REGEX,
  openAiKeyErrorMessage,
} from '@gitroom/nestjs-libraries/openai/generation.error';
import type { StudioWord } from '@gitroom/helpers/utils/studio.captions';

// The models, checked against developers.openai.com/api/docs on 1 Nov 2026:
// - gpt-6-luna replaces gpt-4.1 (shut down 14 Jan 2027) and supports Chat
//   Completions with Structured Outputs; a script needs little reasoning
// - gpt-4o-mini-tts is the only model left on /v1/audio/speech that takes
//   "instructions"; it shuts down 6 Jan 2027 and its successor
//   (gpt-realtime-2.1-mini) is Realtime only, so this needs a follow-up
// - whisper-1 is the only model with word timestamps; it shuts down 26 Feb
//   2027, until then a failed timing falls back to the script spread over
//   the voice
// - gpt-image-2.5-flare replaces gpt-image-1 (shut down 23 Oct 2026), the
//   fastest image model
// - Sora 2 and the Videos API shut down on 24 Sep 2026 with no replacement,
//   so this provider makes no video and Studio hides AI video
export const OPENAI_STUDIO_MODELS = {
  script: 'gpt-6-luna',
  voice: 'gpt-4o-mini-tts',
  words: 'whisper-1',
  image: 'gpt-image-2.5-flare',
};

// the voices of /v1/audio/speech, marin and cedar sound best
const VOICES = [
  'marin',
  'cedar',
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
] as const;

// the longest input /v1/audio/speech takes
const MAX_SPEECH_CHARS = 4096;

const Script = z.object({
  hook: z
    .string()
    .describe('The first spoken sentence, under 12 words, stops the scroll'),
  lines: z
    .array(z.string())
    .describe('The spoken sentences after the hook, one idea each'),
  cta: z
    .string()
    .describe('One closing sentence telling the viewer what to do'),
  postText: z
    .string()
    .describe('The caption to publish the video with, at most 3 hashtags'),
});

// OpenAI's own words in a refusal, short and without anything key-like
const clean = (message: string) =>
  String(message || '')
    .replace(/sk-[\w-]+/g, '[key]')
    .slice(0, 300);

@StudioAiProvider({ identifier: 'openai' })
export class OpenAiStudioProvider extends StudioAiProviderAbstract {
  voices = VOICES;

  constructor(private _aiCredentialService: AiCredentialService) {
    super();
  }

  // The SDK never retries by itself: a retry starts a fresh timeout and spends
  // the customer's credit again. Studio decides what is retried, and when
  private options(call?: StudioAiCall) {
    return { maxRetries: 0, signal: call?.signal };
  }

  // Every OpenAI failure as a message the customer can act on. The key is
  // never part of it, and only failures nobody can act on are logged
  private fail(err: any): never {
    if (err instanceof StudioAiError) {
      throw err;
    }

    if (err instanceof APIUserAbortError || err?.name === 'AbortError') {
      throw new StudioAiError(
        'OpenAI took too long to answer. Try again in a minute.',
        504,
        true
      );
    }

    const keyMessage = openAiKeyErrorMessage(err);
    if (keyMessage) {
      throw new StudioAiError(keyMessage, 400, false, true);
    }

    const status = err?.status;
    const message: string = err?.error?.message || err?.message || '';
    if (
      err?.code === 'moderation_blocked' ||
      err?.code === 'content_policy_violation' ||
      SAFETY_MESSAGE_REGEX.test(message)
    ) {
      throw new StudioAiError(`OpenAI refused this: ${clean(message)}`, 422);
    }

    if (status === 429) {
      throw new StudioAiError(
        'OpenAI is rate limiting your key right now. Wait a minute and try again.',
        429,
        true
      );
    }

    if (status === 403 || status === 404) {
      throw new StudioAiError(
        'Your OpenAI key cannot use a model Studio needs. Check the model access of its project at platform.openai.com.',
        400
      );
    }

    if (
      err instanceof APIConnectionError ||
      (typeof status === 'number' && status >= 500)
    ) {
      throw new StudioAiError(
        'OpenAI is not answering right now. Try again in a minute.',
        502,
        true
      );
    }

    console.error('Studio AI call failed:', status, clean(message));
    throw new StudioAiError('OpenAI could not do this, try again.', 502);
  }

  async script(
    org: string,
    request: StudioAiScriptRequest,
    call?: StudioAiCall
  ): Promise<StudioAiScript> {
    const client = await this._aiCredentialService.getOpenAiClient(org);
    // about 2.5 spoken words a second
    const words = Math.round(request.seconds * 2.5);
    try {
      const completion = await client.chat.completions.parse(
        {
          model: OPENAI_STUDIO_MODELS.script,
          reasoning_effort: 'low',
          max_completion_tokens: 4000,
          messages: [
            {
              role: 'system',
              content: `You write the script of a short vertical UGC video (TikTok, Reels, Shorts): one person talking to the camera in the first person, natural and conversational, like a real customer and not like an ad.
The whole script is about ${words} words, about ${
                request.seconds
              } seconds spoken, never more than ${Math.round(words * 1.2)}.
"hook" is the first sentence, under 12 words, and makes people stop scrolling.
"lines" are 3 to 7 short sentences after the hook, one idea each, under 20 words each.
"cta" is one closing sentence telling the viewer what to do next.
"postText" is the caption the video is published with: 1 to 3 sentences and at most 3 hashtags.
No emojis, no stage directions, no speaker names, no quotes around sentences. Tone: ${
                request.tone
              }. Write in the language the topic is written in.`,
            },
            {
              role: 'user',
              content: `Topic or product: ${request.topic}`,
            },
          ],
          response_format: zodResponseFormat(Script, 'studioScript'),
        },
        this.options(call)
      );

      const message = completion.choices[0]?.message;
      if (message?.refusal) {
        throw new StudioAiError(
          `OpenAI refused to write this script: ${clean(message.refusal)}`,
          422
        );
      }
      if (!message?.parsed) {
        throw new StudioAiError(
          'OpenAI did not return a script. Try again.',
          502,
          true
        );
      }

      return message.parsed as StudioAiScript;
    } catch (err: any) {
      // a script cut off by the token limit can't be parsed
      if (err?.constructor?.name === 'LengthFinishReasonError') {
        throw new StudioAiError(
          'OpenAI wrote a script that was too long. Try again or shorten the topic.',
          502,
          true
        );
      }
      this.fail(err);
    }
  }

  async tts(
    org: string,
    request: StudioAiVoiceRequest,
    call?: StudioAiCall
  ): Promise<Buffer> {
    const client = await this._aiCredentialService.getOpenAiClient(org);
    try {
      const response = await client.audio.speech.create(
        {
          model: OPENAI_STUDIO_MODELS.voice,
          voice: this.voice(request.voice),
          input: request.text.slice(0, MAX_SPEECH_CHARS),
          instructions: request.instructions.slice(0, MAX_SPEECH_CHARS),
          response_format: 'mp3',
        },
        this.options(call)
      );
      return Buffer.from(await response.arrayBuffer());
    } catch (err) {
      this.fail(err);
    }
  }

  async transcribe(
    org: string,
    file: string,
    call?: StudioAiCall
  ): Promise<StudioWord[]> {
    const client = await this._aiCredentialService.getOpenAiClient(org);
    try {
      const result = await client.audio.transcriptions.create(
        {
          file: createReadStream(file),
          model: OPENAI_STUDIO_MODELS.words,
          response_format: 'verbose_json',
          timestamp_granularities: ['word'],
        },
        this.options(call)
      );

      return (result.words || [])
        .filter((word) => word.word?.trim())
        .slice(0, 1500)
        .map((word) => ({
          text: word.word.trim().slice(0, 60),
          start: Number(word.start.toFixed(3)),
          end: Number(word.end.toFixed(3)),
        }));
    } catch (err) {
      this.fail(err);
    }
  }

  async image(
    org: string,
    request: StudioAiImageRequest,
    call?: StudioAiCall
  ): Promise<Buffer> {
    const client = await this._aiCredentialService.getOpenAiClient(org);
    try {
      // GPT Image models always answer in base64
      const result = await client.images.generate(
        {
          model: OPENAI_STUDIO_MODELS.image,
          prompt: request.prompt.slice(0, 4000),
          size: '1024x1536',
          quality: 'medium',
          output_format: 'jpeg',
          n: 1,
        },
        this.options(call)
      );
      const image = result.data?.[0]?.b64_json;
      if (!image) {
        throw new StudioAiError(
          'OpenAI did not return an image. Try again.',
          502,
          true
        );
      }
      return Buffer.from(image, 'base64');
    } catch (err) {
      this.fail(err);
    }
  }
}
