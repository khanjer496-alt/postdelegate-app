jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: jest.fn(async () => undefined) }));

import { PinterestProvider } from '@gitroom/nestjs-libraries/integrations/social/pinterest.provider';
import {
  BadBody,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';

const realFetch = global.fetch;
const realSandbox = process.env.PINTEREST_SANDBOX;
afterEach(() => {
  global.fetch = realFetch;
  if (realSandbox === undefined) {
    delete process.env.PINTEREST_SANDBOX;
  } else {
    process.env.PINTEREST_SANDBOX = realSandbox;
  }
});

type Call = { url: string; method: string; body: any };

// answers each call with the next reply (the last one repeats)
const replies = (...list: Array<{ status: number; body: unknown }>) => {
  const calls: Call[] = [];
  global.fetch = jest.fn(async (url: string, init: any = {}) => {
    calls.push({
      url,
      method: init.method || 'GET',
      body: init.body ? JSON.parse(init.body) : undefined,
    });
    const { status, body } = list[Math.min(calls.length - 1, list.length - 1)];
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  }) as any;
  return calls;
};

const armed = (overrides: Record<string, unknown> = {}) => ({
  mediaId: '',
  message: 'Fresh pin',
  settings: {
    board: '1146658823816942431',
    title: 'PostDelegate social scheduler',
    link: 'https://postdelegate.com',
  },
  imagePaths: ['https://media.postdelegate.com/FvMsBYnMslZfVNhcZefA.png'],
  coverPath: 'https://media.postdelegate.com/FvMsBYnMslZfVNhcZefA.png',
  attempting: true,
  confirmed: true,
  ...overrides,
});

const createPin = (pendingData = armed()) =>
  new PinterestProvider().finalizePost('token', pendingData as any, {} as any);

describe('PinterestProvider error messages', () => {
  it('explains the Trial access refusal instead of Unknown Error', async () => {
    replies({
      status: 403,
      body: {
        code: 29,
        message:
          'Apps with Trial access may not create Pins in production https://api.pinterest.com - use API Sandbox https://api-sandbox.pinterest.com instead.',
      },
    });
    const sent = createPin();
    await expect(sent).rejects.toBeInstanceOf(BadBody);
    await expect(sent).rejects.toMatchObject({
      message: expect.stringContaining('Trial access'),
    });
  });

  it('does not refresh the token when the app consumer type is not supported', async () => {
    replies({
      status: 401,
      body: {
        code: 3,
        message:
          'Your application consumer type is not supported, please contact support.',
      },
    });
    const sent = createPin();
    await expect(sent).rejects.toBeInstanceOf(BadBody);
    await expect(sent).rejects.toMatchObject({
      message: expect.stringContaining('not approved API access'),
    });
  });

  it('still refreshes an expired token', async () => {
    replies({
      status: 401,
      body: { code: 2, message: 'Authentication failed.' },
    });
    await expect(createPin()).rejects.toBeInstanceOf(RefreshToken);
  });

  it('keeps the board not found message', async () => {
    replies({ status: 404, body: { code: 2, message: 'Board not found.' } });
    await expect(createPin()).rejects.toMatchObject({
      message: 'The specified board was not found. Please check the board ID.',
    });
  });

  it('retries an unreachable image, then says so', async () => {
    const calls = replies({
      status: 400,
      body: { code: 1, message: 'Unable to reach the URL provided.' },
    });
    await expect(createPin()).rejects.toMatchObject({
      message: expect.stringContaining('unable to reach the URL'),
    });
    expect(calls.length).toBe(4);
  });

  it("shows Pinterest's own message for anything unmapped, without credentials", async () => {
    replies({
      status: 400,
      body: {
        code: 1,
        message:
          'Invalid parameters for token pina_ABCDEF123.xyz and Bearer secret-value',
      },
    });
    const sent = createPin();
    await expect(sent).rejects.toBeInstanceOf(BadBody);
    const err: any = await sent.catch((e) => e);
    expect(err.message).toBe(
      'Pinterest rejected the request: Invalid parameters for token [redacted] and Bearer [redacted]'
    );
  });

  it('keeps Unknown Error for bodies that are not Pinterest errors', async () => {
    replies({ status: 400, body: { unexpected: true } });
    await expect(createPin()).rejects.toMatchObject({
      message: 'Unknown Error',
    });
  });

  it('recognises the Trial access refusal by its message alone', () => {
    expect(
      new PinterestProvider().handleErrors(
        JSON.stringify({
          message: 'Apps with Trial access may not create Pins in production',
        }),
        403
      )?.value
    ).toContain('Trial access');
  });

  it('does not treat code 29 on a 401 or 500 as the Trial refusal', () => {
    const provider = new PinterestProvider();
    expect(
      provider.handleErrors(JSON.stringify({ code: 29, message: 'x' }), 500)
    ).toBeUndefined();
    expect(
      provider.handleErrors(JSON.stringify({ code: 29, message: 'x' }), 401)
    ).toBeUndefined();
  });

  it('explains PINNER_DATA_ACCESS_DENIED', async () => {
    replies({
      status: 403,
      body: { code: 403, message: 'PINNER_DATA_ACCESS_DENIED' },
    });
    await expect(createPin()).rejects.toMatchObject({
      message: expect.stringContaining('PINNER_DATA_ACCESS_DENIED'),
    });
  });

  it("shows Pinterest's message for an unmapped 403", async () => {
    replies({
      status: 403,
      body: { code: 50, message: 'Pin creation is temporarily blocked.' },
    });
    await expect(createPin()).rejects.toMatchObject({
      message: 'Pinterest rejected the request: Pin creation is temporarily blocked.',
    });
  });

  it.each([
    ['a refresh token', 'Refresh pinr.ABC123def456 failed', 'Refresh [redacted] failed'],
    [
      'JSON access and refresh tokens',
      'Bad payload {"access_token":"abc","refresh_token": "def"}',
      'Bad payload {"access_token":"[redacted]","refresh_token":"[redacted]"}',
    ],
    ['Basic credentials', 'Header Basic Y2xpZW50OnNlY3JldA== refused', 'Header Basic [redacted] refused'],
    ['query parameters', 'Sent refresh_token=xyz&client_secret=abc', 'Sent refresh_token=[redacted]&client_secret=[redacted]'],
  ])('redacts %s from Pinterest messages', (_, message, expected) => {
    expect(
      new PinterestProvider().handleErrors(JSON.stringify({ code: 1, message }), 400)
        ?.value
    ).toBe(`Pinterest rejected the request: ${expected}`);
  });

  it('leaves rate limits to the generic retry', () => {
    expect(
      new PinterestProvider().handleErrors(
        JSON.stringify({ code: 8, message: 'Too many requests' }),
        429
      )
    ).toBeUndefined();
  });
});

describe('PinterestProvider sandbox mode', () => {
  it('uses the production API when PINTEREST_SANDBOX is unset', async () => {
    delete process.env.PINTEREST_SANDBOX;
    const calls = replies({ status: 201, body: { id: 'pin-1' } });
    await createPin();
    expect(calls[0].url).toBe('https://api.pinterest.com/v5/pins');
  });

  it('creates pins in the API sandbox when PINTEREST_SANDBOX=true', async () => {
    process.env.PINTEREST_SANDBOX = 'true';
    const calls = replies({ status: 201, body: { id: 'pin-1' } });
    await createPin();
    expect(calls[0].url).toBe('https://api-sandbox.pinterest.com/v5/pins');
  });

  it('probes the token on the same API it creates the pin on', async () => {
    process.env.PINTEREST_SANDBOX = 'true';
    const calls = replies({ status: 200, body: { username: 'me' } });
    await createPin(armed({ attempting: false, confirmed: false }));
    expect(calls[0].url).toBe('https://api-sandbox.pinterest.com/v5/user_account');
  });

  it('exchanges the OAuth code for a sandbox token in sandbox mode', async () => {
    process.env.PINTEREST_SANDBOX = 'true';
    const provider = new PinterestProvider();
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      calls.push(url);
      return {
        status: 200,
        json: async () =>
          url.endsWith('/oauth/token')
            ? {
                access_token: 'a',
                refresh_token: 'r',
                expires_in: 100,
                scope: provider.scopes.join(','),
              }
            : { id: 'u1', username: 'me', profile_image: '' },
      };
    }) as any;

    await provider.authenticate({ code: 'c', codeVerifier: '', refresh: '' });
    expect(calls).toEqual([
      'https://api-sandbox.pinterest.com/v5/oauth/token',
      'https://api-sandbox.pinterest.com/v5/user_account',
    ]);
    // the authorization page is the same for both
    expect((await provider.generateAuthUrl()).url).toMatch(
      /^https:\/\/www\.pinterest\.com\/oauth\//
    );
  });

  it('refreshes the sandbox token on the sandbox', async () => {
    process.env.PINTEREST_SANDBOX = 'true';
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      calls.push(url);
      return {
        status: 200,
        json: async () =>
          url.endsWith('/oauth/token')
            ? { access_token: 'a', expires_in: 100 }
            : { id: 'u1', username: 'me' },
      };
    }) as any;

    await new PinterestProvider().refreshToken('r');
    expect(calls).toEqual([
      'https://api-sandbox.pinterest.com/v5/oauth/token',
      'https://api-sandbox.pinterest.com/v5/user_account',
    ]);
  });

  it('asks for a token refresh instead of listing no boards', async () => {
    replies({ status: 401, body: { code: 2, message: 'Authentication failed.' } });
    await expect(new PinterestProvider().boards('token')).rejects.toBeInstanceOf(
      RefreshToken
    );
  });

  it('lists sandbox boards and follows the bookmark past empty pages', async () => {
    process.env.PINTEREST_SANDBOX = 'true';
    const calls = replies(
      { status: 200, body: { items: [], bookmark: 'next-page' } },
      { status: 200, body: { items: [{ id: '42', name: 'Demo', privacy: 'PUBLIC' }], bookmark: null } }
    );
    await expect(new PinterestProvider().boards('token')).resolves.toEqual([
      { id: '42', name: 'Demo' },
    ]);
    expect(calls.map((c) => c.url)).toEqual([
      'https://api-sandbox.pinterest.com/v5/boards?page_size=250',
      'https://api-sandbox.pinterest.com/v5/boards?page_size=250&bookmark=next-page',
    ]);
  });

  it('creates a board on the API it posts to', async () => {
    process.env.PINTEREST_SANDBOX = 'true';
    const calls = replies({ status: 201, body: { id: '77', name: 'Demo board' } });
    await expect(
      new PinterestProvider().createBoard('token', { name: '  Demo board ' })
    ).resolves.toEqual({ id: '77', name: 'Demo board' });
    expect(calls).toEqual([
      {
        url: 'https://api-sandbox.pinterest.com/v5/boards',
        method: 'POST',
        body: { name: 'Demo board' },
      },
    ]);
  });

  it('refuses a board without a name or over 100 characters', async () => {
    const calls = replies({ status: 201, body: {} });
    const provider = new PinterestProvider();
    await expect(provider.createBoard('token', { name: '  ' })).resolves.toEqual({
      error: 'Board name is required',
    });
    await expect(
      provider.createBoard('token', { name: 'a'.repeat(101) })
    ).resolves.toEqual({ error: 'Board name can be at most 100 characters' });
    expect(calls).toHaveLength(0);
  });

  it('accepts a 100 character board name once trimmed', async () => {
    const calls = replies({ status: 201, body: { id: '1', name: 'x' } });
    await new PinterestProvider().createBoard('token', {
      name: ` ${'a'.repeat(100)} `,
    });
    expect(calls[0].body).toEqual({ name: 'a'.repeat(100) });
  });

  it("returns Pinterest's reason when it refuses the board", async () => {
    replies({
      status: 400,
      body: { code: 58, message: 'You already have a board with this name.' },
    });
    await expect(
      new PinterestProvider().createBoard('token', { name: 'Demo' })
    ).resolves.toEqual({
      error:
        'Pinterest rejected the request: You already have a board with this name.',
    });
  });

  it('leaves an unexplained board refusal to the generic message', async () => {
    replies({ status: 400, body: { unexpected: true } });
    await expect(
      new PinterestProvider().createBoard('token', { name: 'Demo' })
    ).resolves.toEqual({ error: '' });
  });

  it('still refreshes an expired token when creating a board', async () => {
    replies({ status: 401, body: { code: 2, message: 'Authentication failed.' } });
    await expect(
      new PinterestProvider().createBoard('token', { name: 'Demo' })
    ).rejects.toBeInstanceOf(RefreshToken);
  });

  it('gives sandbox pins no public link', async () => {
    process.env.PINTEREST_SANDBOX = 'true';
    replies({ status: 201, body: { id: 'pin-1' } });
    await expect(createPin()).resolves.toEqual({
      status: 'completed',
      postId: 'pin-1',
      releaseURL: '',
    });
  });

  it('refuses video pins in sandbox mode, the sandbox has none', async () => {
    process.env.PINTEREST_SANDBOX = 'true';
    await expect(
      new PinterestProvider().checkValidity(
        [
          [
            { path: 'https://media.postdelegate.com/a.mp4' },
            { path: 'https://media.postdelegate.com/a.png' },
          ],
        ],
        {},
        []
      )
    ).resolves.toContain('sandbox');
  });

  it('skips analytics in sandbox mode', async () => {
    process.env.PINTEREST_SANDBOX = 'true';
    const calls = replies({ status: 200, body: {} });
    const provider = new PinterestProvider();
    await expect(provider.analytics('id', 'token', 30)).resolves.toEqual([]);
    await expect(
      provider.postAnalytics('id', 'token', 'pin', 30)
    ).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('PinterestProvider pin payload', () => {
  it('sends a single image pin as documented', async () => {
    const calls = replies({ status: 201, body: { id: 'pin-1' } });
    await expect(createPin(armed({ altText: 'A purple calendar' }))).resolves.toEqual({
      status: 'completed',
      postId: 'pin-1',
      releaseURL: 'https://www.pinterest.com/pin/pin-1',
    });
    expect(calls[0]).toEqual({
      url: 'https://api.pinterest.com/v5/pins',
      method: 'POST',
      body: {
        link: 'https://postdelegate.com',
        title: 'PostDelegate social scheduler',
        description: 'Fresh pin',
        alt_text: 'A purple calendar',
        board_id: '1146658823816942431',
        media_source: {
          source_type: 'image_url',
          url: 'https://media.postdelegate.com/FvMsBYnMslZfVNhcZefA.png',
        },
      },
    });
  });

  it('sends no alt_text for pending data created before it existed', async () => {
    const calls = replies({ status: 201, body: { id: 'pin-1' } });
    await createPin();
    expect(calls[0].body).not.toHaveProperty('alt_text');
  });

  it('carries the image alt text from the post to the pin', async () => {
    const [pending] = await new PinterestProvider().postPending('id', 'token', [
      {
        id: 'p-1',
        message: 'Fresh pin',
        settings: { board: '42' },
        media: [
          { type: 'image', path: 'https://media.postdelegate.com/a.png', alt: 'Alt' },
        ],
      },
    ] as any);
    expect(pending.pendingData).toMatchObject({
      altText: 'Alt',
      imagePaths: ['https://media.postdelegate.com/a.png'],
    });
  });

  it('sends several images as multiple_image_urls', async () => {
    const calls = replies({ status: 201, body: { id: 'pin-1' } });
    await createPin(
      armed({
        imagePaths: [
          'https://media.postdelegate.com/a.png',
          'https://media.postdelegate.com/b.png',
        ],
      })
    );
    expect(calls[0].body.media_source).toEqual({
      source_type: 'multiple_image_urls',
      items: [
        { url: 'https://media.postdelegate.com/a.png' },
        { url: 'https://media.postdelegate.com/b.png' },
      ],
    });
  });

  it('refuses media Pinterest cannot download and alt text over 500 characters', async () => {
    const provider = new PinterestProvider();
    await expect(
      provider.checkValidity([[{ path: '/uploads/a.png' }]], {}, [])
    ).resolves.toBe('Pinterest needs a public URL for every media item');
    await expect(
      provider.checkValidity(
        [[{ path: 'https://media.postdelegate.com/a.png', alt: 'a'.repeat(501) }]],
        {},
        []
      )
    ).resolves.toBe('Pinterest alt text can be at most 500 characters');
    await expect(
      provider.checkValidity(
        [[{ path: 'https://media.postdelegate.com/a.png', alt: 'a'.repeat(500) }]],
        {},
        []
      )
    ).resolves.toBe(true);
  });

  it('only checks the alt text of the first image, the one Pinterest gets', async () => {
    const provider = new PinterestProvider();
    (provider as any).getImageDimensions = jest.fn(async () => ({ width: 1, height: 1 }));
    await expect(
      provider.checkValidity(
        [
          [
            { path: 'https://media.postdelegate.com/a.png', alt: 'ok' },
            { path: 'https://media.postdelegate.com/b.png', alt: 'a'.repeat(501) },
          ],
        ],
        {},
        []
      )
    ).resolves.toBe(true);
  });
});
