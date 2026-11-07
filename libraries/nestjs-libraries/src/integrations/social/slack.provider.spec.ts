import { SlackProvider } from '@gitroom/nestjs-libraries/integrations/social/slack.provider';
import {
  BadBody,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

// every Slack Web API call answers 200 with a JSON body
const slack = (answer: (url: string, body: any) => any) => {
  const calls: { url: string; body: any }[] = [];
  global.fetch = jest.fn(async (url: string, init: any = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    return { json: async () => answer(url, body) } as any;
  }) as any;
  return calls;
};

const posted = (calls: { url: string; body: any }[]) =>
  calls.find((c) => c.url.endsWith('chat.postMessage'))!.body;

const integration = { name: 'PostDelegate', picture: '' } as any;
const post = (message: string, media: any[] = []) =>
  [{ id: 'p-1', message, settings: { channel: 'C1' }, media }] as any;

const ok = (url: string) =>
  url.includes('getPermalink')
    ? { ok: true, permalink: 'https://slack.com/p' }
    : { ok: true, ts: '1.0', channel: 'C1' };

describe('SlackProvider blocks', () => {
  const provider = new SlackProvider();

  it('splits a long text into sections Slack accepts', () => {
    const text = ('word '.repeat(700) + '\n').repeat(2); // ~7,000 chars
    const blocks = provider.blocks(text, []);
    expect(blocks.length).toBeGreaterThan(2);
    expect(
      blocks.every((b: any) => b.type === 'section' && b.text.text.length <= 3000)
    ).toBe(true);
    expect(blocks.map((b: any) => b.text.text).join(' ').replace(/\s+/g, ' ')).toBe(
      text.trim().replace(/\s+/g, ' ')
    );
  });

  it('never splits an emoji in two', () => {
    const text = 'a'.repeat(2999) + '🎉' + 'b'.repeat(10);
    const [first, second] = provider.blocks(text, []) as any[];
    expect(first.text.text).toBe('a'.repeat(2999));
    expect(second.text.text.startsWith('🎉')).toBe(true);
  });

  it('sends only the pictures of a post without text', () => {
    expect(provider.blocks('', [{ type: 'image', path: 'https://x/a.png' }])).toEqual([
      { type: 'image', image_url: 'https://x/a.png', alt_text: '' },
    ]);
  });

  it('posts an image-only message without an empty section', async () => {
    const calls = slack(ok);
    await provider.post(
      'T1',
      'token',
      post('', [{ type: 'image', path: 'https://x/a.png', alt: 'cat' }]),
      integration
    );
    expect(posted(calls).blocks).toEqual([
      { type: 'image', image_url: 'https://x/a.png', alt_text: 'cat' },
    ]);
  });

  it('keeps the composer, the backend and the site on 4,000 characters', () => {
    expect(provider.maxLength()).toBe(4000);
  });
});

describe('SlackProvider errors', () => {
  const provider = new SlackProvider();

  it('explains a refused message in plain words', async () => {
    slack((url) =>
      url.endsWith('chat.postMessage') ? { ok: false, error: 'not_in_channel' } : ok(url)
    );
    const sent = provider.post('T1', 'token', post('hi'), integration);
    await expect(sent).rejects.toBeInstanceOf(BadBody);
    await expect(sent).rejects.toMatchObject({
      message: 'The app is not in this Slack channel, invite it to the channel and try again',
    });
  });

  it('keeps Slack code for an error it has no words for', async () => {
    slack((url) =>
      url.endsWith('chat.postMessage') ? { ok: false, error: 'weird_error' } : ok(url)
    );
    await expect(
      provider.post('T1', 'token', post('hi'), integration)
    ).rejects.toMatchObject({ message: 'Slack rejected the post: weird_error' });
  });

  it('asks for a reconnect on a revoked token', async () => {
    slack((url) =>
      url.endsWith('chat.postMessage') ? { ok: false, error: 'token_revoked' } : ok(url)
    );
    await expect(
      provider.post('T1', 'token', post('hi'), integration)
    ).rejects.toBeInstanceOf(RefreshToken);
  });
});

describe('SlackProvider channels', () => {
  it('reads every page and leaves out archived channels', async () => {
    const calls = slack((url) =>
      url.includes('cursor=next')
        ? { ok: true, channels: [{ id: 'C3', name: 'three' }], response_metadata: { next_cursor: '' } }
        : {
            ok: true,
            channels: [
              { id: 'C1', name: 'one' },
              { id: 'C2', name: 'old', is_archived: true },
            ],
            response_metadata: { next_cursor: 'next' },
          }
    );
    await expect(new SlackProvider().channels('token', {}, 'T1')).resolves.toEqual([
      { id: 'C1', name: 'one' },
      { id: 'C3', name: 'three' },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('exclude_archived=true');
    expect(calls[0].url).toContain('limit=1000');
  });
});

describe('SlackProvider channels rate limit', () => {
  it('keeps the channels read before Slack rate-limits', async () => {
    slack((url) =>
      url.includes('cursor=next')
        ? { ok: false, error: 'ratelimited' }
        : {
            ok: true,
            channels: [{ id: 'C1', name: 'one' }],
            response_metadata: { next_cursor: 'next' },
          }
    );
    await expect(new SlackProvider().channels('token', {}, 'T1')).resolves.toEqual([
      { id: 'C1', name: 'one' },
    ]);
  });
});
