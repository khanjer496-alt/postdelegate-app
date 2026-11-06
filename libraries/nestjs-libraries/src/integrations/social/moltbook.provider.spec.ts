jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: jest.fn(async () => undefined) }));

import { MoltbookProvider } from '@gitroom/nestjs-libraries/integrations/social/moltbook.provider';
import {
  BadBody,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

const answer = (status: number, body: unknown) => {
  const calls: { url: string; init: any }[] = [];
  global.fetch = jest.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      status,
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  }) as any;
  return calls;
};

const post = [
  { id: 'p-1', message: 'Hello agents', settings: { submolt: 'general' }, media: [] },
] as any;

describe('MoltbookProvider', () => {
  it('refuses media, Moltbook would drop it', async () => {
    const provider = new MoltbookProvider();
    expect(await provider.checkValidity([[{ path: 'a.png' }]])).toBe(
      'Moltbook posts are text only, remove the media'
    );
    expect(await provider.checkValidity([[], [{ path: 'b.png' }]])).toMatch(
      /text only/
    );
    expect(await provider.checkValidity([[], []])).toBe(true);
  });

  it('reconnects the channel when the API key is refused', async () => {
    answer(401, { success: false, error: 'Invalid API key' });
    await expect(
      new MoltbookProvider().post('agent', 'bad-key', post, {} as any)
    ).rejects.toBeInstanceOf(RefreshToken);
  });

  it('words other refusals', async () => {
    answer(400, { success: false, error: 'Submolt not found' });
    const sent = new MoltbookProvider().post('agent', 'key', post, {} as any);
    await expect(sent).rejects.toBeInstanceOf(BadBody);
    await expect(sent).rejects.toMatchObject({
      message: 'Moltbook rejected the post: Submolt not found',
    });
  });

  it('publishes with the key in the Authorization header', async () => {
    const calls = answer(201, { success: true, post: { id: 'm-1' } });
    await expect(
      new MoltbookProvider().post('agent', 'key', post, {} as any)
    ).resolves.toMatchObject([{ postId: 'm-1' }]);
    expect(calls[0].url).toBe('https://www.moltbook.com/api/v1/posts');
    expect(calls[0].init.headers.Authorization).toBe('Bearer key');
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ submolt: 'general' });
  });

  it('explains a taken agent name', async () => {
    const provider = new MoltbookProvider();
    (provider as any).getSsrfSafeAxios = () => ({
      post: jest.fn(async () =>
        Promise.reject({ response: { status: 409, data: { error: 'Conflict' } } })
      ),
    });
    await expect(provider.registerAgent('taken', 'desc')).rejects.toThrow(
      'That agent name is already taken on Moltbook, please choose another one'
    );
  });
});

describe('MoltbookProvider on a server error', () => {
  // a create may have gone through before the 5xx: no retry, no duplicate
  it.each([500, 502, 503])('fails without retrying on %s', async (status) => {
    answer(status, {});
    await expect(new MoltbookProvider().post('agent', 'key', post, {} as any)).rejects.toBeInstanceOf(BadBody);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('still retries a 429, nothing was created', async () => {
    answer(429, {});
    await expect(new MoltbookProvider().post('agent', 'key', post, {} as any)).rejects.toBeInstanceOf(BadBody);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });
});
