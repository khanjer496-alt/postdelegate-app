// nostr-tools ships ESM jest can't load; signing gives each note its id
jest.mock('nostr-tools', () => {
  let notes = 0;
  return {
    getPublicKey: jest.fn(() => 'pub'),
    finalizeEvent: jest.fn((template: any) => ({
      ...template,
      id: `new-note-${++notes}`,
    })),
    Relay: { connect: jest.fn() },
    SimplePool: jest.fn(() => ({ get: jest.fn() })),
  };
});

import { Relay } from 'nostr-tools';
import { NostrProvider } from '@gitroom/nestjs-libraries/integrations/social/nostr.provider';
import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

const connect = Relay.connect as jest.Mock;

const relay = (publish: () => Promise<string>) => ({
  publish: jest.fn(publish),
  close: jest.fn(),
  // a relay feed answering with the author's previous note
  subscribe: jest.fn((_: any, { onevent }: any) =>
    onevent({ id: 'previous-note' })
  ),
});

const token = () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  return AuthService.signJWT({ password: 'ab'.repeat(32) });
};

const post = [{ id: 'post-1', message: 'gm', settings: {}, media: [] }] as any;

describe('NostrProvider publishing', () => {
  beforeEach(() => connect.mockReset());

  it('links the note it published, not the previous one', async () => {
    connect.mockImplementation(async () => relay(async () => 'ok'));
    const [result] = await new NostrProvider().post('pub', token(), post);

    const published = (await connect.mock.results[0].value).publish.mock
      .calls[0][0];
    expect(result.postId).toBe(published.id);
    expect(result.postId).not.toBe('previous-note');
    expect(result.releaseURL).toBe(`https://primal.net/e/${published.id}`);
  });

  it('replies to the note it is given', async () => {
    connect.mockImplementation(async () => relay(async () => 'ok'));
    const [result] = await new NostrProvider().comment(
      'pub',
      'root-note',
      undefined,
      token(),
      post,
      {} as any
    );
    const published = (await connect.mock.results[0].value).publish.mock
      .calls[0][0];
    expect(published.tags).toContainEqual(['e', 'root-note', '', 'reply']);
    expect(result.postId).toBe(published.id);
  });

  it('is published when one relay acknowledges it', async () => {
    let call = 0;
    connect.mockImplementation(async () => {
      const current = ++call;
      if (current === 1) throw new Error('connection failed');
      return relay(async () =>
        current === 2 ? 'ok' : Promise.reject(new Error('blocked'))
      );
    });
    await expect(new NostrProvider().post('pub', token(), post)).resolves.toHaveLength(1);
  });

  it('fails when no relay acknowledges the note', async () => {
    connect.mockImplementation(async () =>
      relay(async () => Promise.reject(new Error('rate-limited')))
    );
    await expect(
      new NostrProvider().post('pub', token(), post)
    ).rejects.toBeInstanceOf(BadBody);
  });
});
