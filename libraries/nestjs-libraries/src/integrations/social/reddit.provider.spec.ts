import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RedditProvider } from '@gitroom/nestjs-libraries/integrations/social/reddit.provider';
import { RedditSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/reddit.dto';
import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const DEFAULT_UA = 'web:com.postdelegate.app:v1.0.0 (by /u/ConsciousYam1737)';

const answer = (data: unknown) => ({ json: async () => data }) as any;

const subreddit = (overrides: Record<string, unknown> = {}) => ({
  value: {
    subreddit: '/r/selfhosted',
    title: 'My title',
    type: 'self',
    url: '',
    is_flair_required: false,
    ...overrides,
  },
});

const integration = { profile: 'poster', providerIdentifier: 'reddit' } as any;

// Every Reddit call goes through this.fetch, except the token revocation
// (global fetch, it answers 204) and the media upload to Reddit's S3 form
// (axios). All three are recorded with the headers they sent.
const recordingProvider = () => {
  const provider = new RedditProvider();
  const calls: { url: string; headers: Record<string, string> }[] = [];

  provider.fetch = jest.fn(async (url: string, options: any = {}) => {
    calls.push({ url, headers: options.headers || {} });
    if (url.includes('/api/v1/access_token')) {
      return answer({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
        scope: 'read identity submit flair',
      });
    }
    if (url.includes('/api/v1/me')) {
      return answer({ name: 'poster', id: 'u1', icon_img: '' });
    }
    if (url.includes('/api/media/asset')) {
      return answer({
        args: { action: '//reddit-uploaded-media.s3.amazonaws.com', fields: [] },
      });
    }
    if (url.includes('/new?')) {
      return answer({ data: { children: [] } });
    }
    if (url.includes('/api/submit')) {
      return answer({ json: { errors: [], data: { websocket_url: 'wss://x' } } });
    }
    if (url.includes('/subreddits/search')) {
      return answer({ data: { children: [] } });
    }
    if (url.endsWith('/about')) {
      return answer({
        kind: 't5',
        data: {
          subreddit_type: 'public',
          submission_type: 'any',
          allow_images: true,
          title: 'Self hosted',
          url: '/r/selfhosted/',
          id: 's1',
        },
      });
    }
    if (url.includes('/post_requirements')) {
      return answer({ is_flair_required: false });
    }
    if (url.includes('/link_flair_v2')) {
      return answer([]);
    }
    throw new Error(`unexpected ${url}`);
  }) as any;

  (provider as any).mediaSize = jest.fn(async () => 10);
  (provider as any).mediaStream = jest.fn(async () => Buffer.from('x'));
  (provider as any).getSsrfSafeAxios = () => ({
    post: jest.fn(async (url: string, _body: any, options: any) => {
      calls.push({ url, headers: options.headers });
      return { data: '<Location>https://i.redd.it/a.png</Location>' };
    }),
  });

  return { provider, calls };
};

const runEveryRequest = async (provider: RedditProvider) => {
  await provider.refreshToken('rt');
  await provider.authenticate({ code: 'c', codeVerifier: 'v' });
  await provider.subreddits('at', { word: 'r/selfhosted' });
  await provider.restrictions('at', { subreddit: '/r/selfhosted' });

  // media submit: asset upload, S3 upload, submit
  const [pending] = await provider.postPending('1', 'at', [
    {
      id: 'p1',
      message: 'Body',
      settings: { subreddit: [subreddit({ type: 'media' })] },
      media: [{ type: 'image', path: 'https://cdn.example/a.png' }],
    },
  ]);
  const ready = await provider.checkPostStatus(
    'at',
    pending.pendingData,
    integration
  );
  const submitted = await provider.finalizePost(
    'at',
    (ready as any).pendingData,
    integration
  );

  // recovery lookup of the accepted media submit
  await provider.checkPostStatus(
    'at',
    (submitted as any).pendingData,
    integration
  );
};

describe('RedditProvider User-Agent', () => {
  const realFetch = global.fetch;
  const realUa = process.env.REDDIT_USER_AGENT;

  afterEach(() => {
    global.fetch = realFetch;
    if (realUa === undefined) delete process.env.REDDIT_USER_AGENT;
    else process.env.REDDIT_USER_AGENT = realUa;
  });

  it('sends the descriptive User-Agent on every Reddit request', async () => {
    delete process.env.REDDIT_USER_AGENT;
    const { provider, calls } = recordingProvider();
    const revokes: any[] = [];
    global.fetch = jest.fn(async (url: string, options: any) => {
      revokes.push({ url, headers: options.headers });
      return { status: 204 } as any;
    }) as any;

    await runEveryRequest(provider);
    await provider.revokeAuthorization({
      accessToken: 'at',
      refreshToken: 'rt',
      internalId: 'u1',
    });

    const all = [...calls, ...revokes];
    const urls = all.map((call) => call.url).join('\n');
    for (const endpoint of [
      'https://www.reddit.com/api/v1/access_token',
      'https://oauth.reddit.com/api/v1/me',
      'https://oauth.reddit.com/subreddits/search',
      'https://oauth.reddit.com/r/selfhosted/about',
      'https://oauth.reddit.com/api/v1/selfhosted/post_requirements',
      'https://oauth.reddit.com//r/selfhosted/api/link_flair_v2',
      'https://oauth.reddit.com/api/media/asset',
      'https://reddit-uploaded-media.s3.amazonaws.com',
      'https://oauth.reddit.com/api/submit',
      'https://oauth.reddit.com/r/selfhosted/new',
      'https://www.reddit.com/api/v1/revoke_token',
    ]) {
      expect(urls).toContain(endpoint);
    }
    for (const call of all) {
      expect({ url: call.url, ua: call.headers['User-Agent'] }).toEqual({
        url: call.url,
        ua: DEFAULT_UA,
      });
    }
  });

  it('takes the whole string from REDDIT_USER_AGENT', async () => {
    process.env.REDDIT_USER_AGENT = 'web:com.postdelegate.app:v1.0.0 (by /u/older)';
    const { provider, calls } = recordingProvider();

    await runEveryRequest(provider);

    expect(calls.length).toBeGreaterThan(5);
    for (const call of calls) {
      expect(call.headers['User-Agent']).toBe(
        'web:com.postdelegate.app:v1.0.0 (by /u/older)'
      );
    }
  });
});

describe('RedditProvider one subreddit per post', () => {
  const errors = async (subreddits: unknown[]) =>
    (
      await validate(
        plainToInstance(RedditSettingsDto, { subreddit: subreddits })
      )
    ).flatMap((e) => Object.values(e.constraints || {}));

  it('accepts one subreddit', async () => {
    expect(await errors([subreddit()])).toEqual([]);
  });

  it('refuses several subreddits in the settings', async () => {
    expect(await errors([subreddit(), subreddit({ subreddit: '/r/other' })]))
      .toEqual([
        'A Reddit post can go to one subreddit only. Reddit asks that the same content isn’t posted to several communities.',
      ]);
  });

  it('fails a stored post with several subreddits clearly, submitting nothing', async () => {
    const { provider, calls } = recordingProvider();
    const queued = provider.postPending('1', 'at', [
      {
        id: 'p1',
        message: 'Body',
        settings: {
          subreddit: [subreddit(), subreddit({ subreddit: '/r/other' })],
        },
      },
    ]);

    await expect(queued).rejects.toBeInstanceOf(BadBody);
    await expect(queued).rejects.toMatchObject({
      message:
        'A Reddit post can go to one subreddit only. Edit the post, keep one subreddit and schedule it again.',
    });
    expect(calls).toEqual([]);
  });
});

describe('RedditProvider comments', () => {
  it('does not support comments, so the workflow skips them', () => {
    const provider = new RedditProvider();
    // isCommentable() in the post activity is !!provider.comment
    expect((provider as any).comment).toBeUndefined();
  });
});

describe('RedditProvider scopes', () => {
  it('asks only for read, identity, submit and flair (no history)', async () => {
    const provider = new RedditProvider();
    expect(provider.scopes).toEqual(['read', 'identity', 'submit', 'flair']);
    const { url } = await provider.generateAuthUrl();
    expect(decodeURIComponent(url)).toContain(
      'scope=read identity submit flair'
    );
  });

  it('recovers a submission from the subreddit listing, never /user/{name}/submitted', async () => {
    const provider = new RedditProvider();
    const urls: string[] = [];
    const now = Date.now();
    provider.fetch = jest.fn(async (url: string) => {
      urls.push(url);
      return answer({
        data: {
          children: [
            // someone else's post with the same title is never taken
            {
              data: {
                id: 'other',
                author: 'someone',
                subreddit: 'selfhosted',
                title: 'My title',
                created_utc: now / 1000,
                permalink: '/r/selfhosted/comments/other/',
              },
            },
            {
              data: {
                id: 'mine',
                author: 'Poster',
                subreddit: 'SelfHosted',
                title: 'My title',
                created_utc: now / 1000,
                permalink: '/r/selfhosted/comments/mine/',
              },
            },
          ],
        },
      });
    }) as any;

    const result = await provider.checkPostStatus(
      'at',
      {
        subreddits: [subreddit()],
        message: 'Body',
        cursor: 0,
        results: [],
        armed: {
          sr: 'selfhosted',
          title: 'My title',
          armedAt: now,
          media: true,
          submitted: true,
          lookups: 0,
        },
      } as any,
      integration
    );

    expect(urls).toEqual(['https://oauth.reddit.com/r/selfhosted/new?limit=100']);
    expect(result).toEqual({
      status: 'completed',
      postId: 'mine',
      releaseURL: 'https://www.reddit.com/r/selfhosted/comments/mine/',
    });
  });
});

describe('RedditProvider revokeAuthorization', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const revoke = async (status: number | Error) => {
    const requests: { url: string; options: any }[] = [];
    global.fetch = jest.fn(async (url: string, options: any) => {
      requests.push({ url, options });
      if (status instanceof Error) throw status;
      return { status } as any;
    }) as any;
    const result = await new RedditProvider().revokeAuthorization({
      accessToken: 'at',
      refreshToken: 'rt',
      internalId: 'u1',
    });
    return { result, requests };
  };

  it('revokes the refresh and the access token with basic auth', async () => {
    process.env.REDDIT_CLIENT_ID = 'id';
    process.env.REDDIT_CLIENT_SECRET = 'secret';
    const { result, requests } = await revoke(204);

    expect(result).toEqual({ status: 'revoked' });
    expect(requests.map((r) => r.url)).toEqual([
      'https://www.reddit.com/api/v1/revoke_token',
      'https://www.reddit.com/api/v1/revoke_token',
    ]);
    expect(requests.map((r) => String(r.options.body))).toEqual([
      'token=rt&token_type_hint=refresh_token',
      'token=at&token_type_hint=access_token',
    ]);
    expect(requests[0].options.method).toBe('POST');
    expect(requests[0].options.headers.Authorization).toBe(
      `Basic ${Buffer.from('id:secret').toString('base64')}`
    );
  });

  it('reports unknown when Reddit refuses or cannot be reached', async () => {
    expect((await revoke(401)).result).toEqual({ status: 'unknown' });
    expect((await revoke(new Error('down'))).result).toEqual({
      status: 'unknown',
    });
  });
});

describe('RedditProvider unconfirmed submit', () => {
  const armedData = (armed: Record<string, unknown>) =>
    ({
      subreddits: [subreddit()],
      message: 'Body',
      cursor: 0,
      results: [],
      armed: {
        sr: 'selfhosted',
        title: 'My title',
        armedAt: Date.now() - 60 * 1000,
        media: false,
        submitted: false,
        lookups: 0,
        ...armed,
      },
    }) as any;

  const emptyListing = () => {
    const provider = new RedditProvider();
    provider.fetch = jest.fn(async () =>
      answer({ data: { children: [] } })
    ) as any;
    return provider;
  };

  it('gives the listing one more look before deciding', async () => {
    await expect(
      emptyListing().checkPostStatus('at', armedData({}), integration)
    ).resolves.toMatchObject({
      status: 'pending',
      pendingData: { armed: { lookups: 1 } },
    });
  });

  it('fails the post instead of submitting again when Reddit never shows it', async () => {
    const provider = emptyListing();
    const check = provider.checkPostStatus(
      'at',
      armedData({ lookups: 1 }),
      integration
    );

    await expect(check).rejects.toBeInstanceOf(BadBody);
    await expect(check).rejects.toMatchObject({
      message:
        "Couldn't confirm whether Reddit published this post. Check r/selfhosted before posting again.",
    });
    // only the read-only listing, never /api/submit
    expect(
      (provider.fetch as jest.Mock).mock.calls.map(([url]) => url)
    ).not.toContainEqual(expect.stringContaining('/api/submit'));
  });

  it('fails a media post the same way once its in-flight window is over', async () => {
    await expect(
      emptyListing().checkPostStatus(
        'at',
        armedData({
          media: true,
          armedAt: Date.now() - 11 * 60 * 1000,
          lookups: 9,
        }),
        integration
      )
    ).rejects.toBeInstanceOf(BadBody);
  });
});

describe('RedditProvider completed response', () => {
  // postId and releaseURL are comma-joined lists read against each other by
  // index, one entry per subreddit
  const completed = (results: any[]) =>
    (new RedditProvider() as any).completedResponse(results);

  it('keeps the two lists in step when a result has no post id', () => {
    // the middle submission never surfaced in the listing: Reddit accepted it,
    // so it has its subreddit URL, but we never learned its id
    expect(
      completed([
        { postId: 'a1', releaseURL: 'https://www.reddit.com/r/one/comments/a1/' },
        { postId: '', releaseURL: 'https://www.reddit.com/r/two' },
        { postId: 'c3', releaseURL: 'https://www.reddit.com/r/three/comments/c3/' },
      ])
    ).toEqual({
      status: 'completed',
      // index 2 is still c3's, which the old two-filter version got wrong
      postId: 'a1,,c3',
      releaseURL:
        'https://www.reddit.com/r/one/comments/a1/,https://www.reddit.com/r/two,https://www.reddit.com/r/three/comments/c3/',
    });
  });

  it('keeps the link of a lone submission that never surfaced', () => {
    // the common shape of the case above: one subreddit, post is live, no id.
    // Dropping it here would take the user's only link away
    expect(
      completed([{ postId: '', releaseURL: 'https://www.reddit.com/r/one' }])
    ).toEqual({
      status: 'completed',
      postId: '',
      releaseURL: 'https://www.reddit.com/r/one',
    });
  });
});
