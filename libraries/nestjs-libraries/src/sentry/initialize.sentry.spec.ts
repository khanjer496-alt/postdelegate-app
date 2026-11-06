// the profiler is a native module, and init is not under test here
jest.mock('@sentry/profiling-node', () => ({
  nodeProfilingIntegration: jest.fn(),
}));
const init = jest.fn();
jest.mock('@sentry/nestjs', () => ({
  init: (options: unknown) => init(options),
  consoleLoggingIntegration: jest.fn(),
  openAIIntegration: jest.fn(),
}));

import {
  dropSecretRequestBody,
  initializeSentry,
} from '@gitroom/nestjs-libraries/sentry/initialize.sentry';

const KEY = 'sk-proj-xxxxxxxxxxxxxxxxxxxxa9F2';

describe('Sentry request body scrubbing', () => {
  it.each([
    'https://app.example.com/api/ai-credentials',
    'https://app.example.com/api/ai-credentials/',
    'https://app.example.com/ai-credentials?x=1',
    'https://app.example.com/ai-credentials#x',
  ])('drops the body of %s', (url) => {
    const event = dropSecretRequestBody({
      request: {
        url,
        method: 'POST',
        data: JSON.stringify({ provider: 'openai', apiKey: KEY }),
      },
    });

    expect(event.request).toEqual({ url, method: 'POST' });
    expect(JSON.stringify(event)).not.toContain(KEY);
  });

  it('keeps the body of a path that only starts like a secret one', () => {
    const event = dropSecretRequestBody({
      request: {
        url: 'https://app.example.com/api/ai-credentials-export',
        data: '{"type":"draft"}',
      },
    });

    expect(event.request?.data).toBe('{"type":"draft"}');
  });

  it('keeps the body of any other request', () => {
    const event = dropSecretRequestBody({
      request: {
        url: 'https://app.example.com/api/posts',
        data: '{"type":"draft"}',
      },
    });

    expect(event.request?.data).toBe('{"type":"draft"}');
  });

  it('leaves an event without a request alone', () => {
    expect(dropSecretRequestBody({ message: 'hello' })).toEqual({
      message: 'hello',
    });
  });

  it('runs on errors and traces', () => {
    const realDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@sentry.example.com/1';
    try {
      initializeSentry('backend');
    } finally {
      if (realDsn === undefined) {
        delete process.env.NEXT_PUBLIC_SENTRY_DSN;
      } else {
        process.env.NEXT_PUBLIC_SENTRY_DSN = realDsn;
      }
    }

    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        beforeSend: dropSecretRequestBody,
        beforeSendTransaction: dropSecretRequestBody,
      })
    );
  });
});
