jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: jest.fn(async () => undefined) }));

import { MediumProvider } from '@gitroom/nestjs-libraries/integrations/social/medium.provider';
import {
  BadBody,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

const answer = (status: number, body: unknown) => {
  const calls: any[] = [];
  global.fetch = jest.fn(async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { status, text: async () => JSON.stringify(body), json: async () => body };
  }) as any;
  return calls;
};

const post = [
  {
    id: 'p-1',
    message: '# Hello',
    settings: { title: 'Hello', subtitle: 'ignored' },
    media: [],
  },
] as any;

describe('MediumProvider.post', () => {
  it('reconnects the channel when Medium refuses the token', async () => {
    answer(401, { errors: [{ message: 'Token was invalid.', code: 6003 }] });
    await expect(
      new MediumProvider().post('user', 'key', post, {} as any)
    ).rejects.toBeInstanceOf(RefreshToken);
  });

  it("shows Medium's reason instead of crashing on .id", async () => {
    answer(400, { errors: [{ message: 'Tags must be strings', code: 2004 }] });
    const sent = new MediumProvider().post('user', 'key', post, {} as any);
    await expect(sent).rejects.toBeInstanceOf(BadBody);
    await expect(sent).rejects.toMatchObject({
      message: 'Medium rejected the post: Tags must be strings',
    });
  });

  it('fails when Medium answers without a post', async () => {
    answer(201, {});
    await expect(
      new MediumProvider().post('user', 'key', post, {} as any)
    ).rejects.toBeInstanceOf(BadBody);
  });

  it('publishes and sends no subtitle, Medium has none', async () => {
    const calls = answer(201, { data: { id: 'm-1', url: 'https://medium.com/p/m-1' } });
    await expect(
      new MediumProvider().post('user', 'key', post, {} as any)
    ).resolves.toMatchObject([{ postId: 'm-1', releaseURL: 'https://medium.com/p/m-1' }]);
    expect(calls[0].body).not.toHaveProperty('subtitle');
  });
});

describe('MediumProvider on a server error', () => {
  // a create may have gone through before the 5xx: no retry, no duplicate
  it.each([500, 502, 503])('fails without retrying on %s', async (status) => {
    answer(status, {});
    await expect(new MediumProvider().post('user', 'key', post, {} as any)).rejects.toBeInstanceOf(BadBody);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('still retries a 429, nothing was created', async () => {
    answer(429, {});
    await expect(new MediumProvider().post('user', 'key', post, {} as any)).rejects.toBeInstanceOf(BadBody);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });
});
