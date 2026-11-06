import { BadRequestException, HttpException } from '@nestjs/common';
import { generationError } from '@gitroom/nestjs-libraries/openai/generation.error';

const KEY = 'sk-proj-xxxxxxxxxxxxxxxxxxxxa9F2';

// the shape the openai SDK (and LangChain, which keeps status and code) throws
const openAiError = (
  status: number,
  code: string | null,
  message: string
) =>
  Object.assign(new Error(`${status} ${message}`), {
    status,
    code,
    error: { message, code },
  });

describe('generationError', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('tells the customer to replace a key OpenAI refuses', () => {
    const err = generationError(
      openAiError(401, 'invalid_api_key', `Incorrect API key provided: ${KEY}`)
    );

    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(400);
    expect(err.message).toBe(
      'OpenAI rejected your key. Replace it in Settings → AI.'
    );
    expect(JSON.stringify(err.getResponse())).not.toContain(KEY);
  });

  it('tells the customer to add billing when the account has no API credit', () => {
    const err = generationError(
      openAiError(429, 'insufficient_quota', 'You exceeded your current quota')
    );

    expect(err.getStatus()).toBe(400);
    expect(err.message).toBe(
      'Your OpenAI account has no API credit. Add billing at platform.openai.com.'
    );
  });

  it('reads the quota code from the error body as well', () => {
    const err = generationError(
      Object.assign(new Error('429 You exceeded your current quota'), {
        status: 429,
        error: { code: 'insufficient_quota' },
      })
    );

    expect(err.message).toBe(
      'Your OpenAI account has no API credit. Add billing at platform.openai.com.'
    );
  });

  it('keeps a plain rate limit generic', () => {
    const err = generationError(
      openAiError(429, 'rate_limit_exceeded', 'Rate limit reached')
    );

    expect(err.getStatus()).toBe(500);
    expect(err.message).toBe('AI generation failed, please try again later.');
  });

  it('keeps any other error generic', () => {
    const err = generationError(new Error('socket hang up'));

    expect(err.getStatus()).toBe(500);
    expect(err.message).toBe('AI generation failed, please try again later.');
  });

  it('still reports a safety rejection', () => {
    const err = generationError(
      openAiError(
        400,
        null,
        'Your request was rejected by the safety system, safety_violations=[sexual]'
      )
    );

    expect(err.getStatus()).toBe(422);
    expect(err.message).toContain('Flagged categories: sexual.');
  });

  it('passes an HttpException through unchanged', () => {
    const original = new BadRequestException(
      'Add your OpenAI key in Settings → AI'
    );

    expect(generationError(original)).toBe(original);
  });
});
