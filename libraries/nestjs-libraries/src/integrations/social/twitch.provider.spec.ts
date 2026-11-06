jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: jest.fn(async () => undefined) }));

import { TwitchProvider } from '@gitroom/nestjs-libraries/integrations/social/twitch.provider';
import { KickProvider } from '@gitroom/nestjs-libraries/integrations/social/kick.provider';
import {
  BadBody,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';

const post = (settings: Record<string, unknown> = {}) =>
  [{ id: 'post-1', message: 'Live now', settings, media: [] }] as any;
const integration = { profile: 'streamer', providerIdentifier: 'twitch' } as any;

const answer = (data: unknown) => ({ json: async () => data }) as any;

describe('TwitchProvider chat messages', () => {
  it('fails when Twitch drops the message instead of marking it published', async () => {
    const provider = new TwitchProvider();
    provider.fetch = jest.fn(async () =>
      answer({
        data: [
          {
            message_id: '',
            is_sent: false,
            drop_reason: { code: 'automod', message: 'Held by AutoMod' },
          },
        ],
      })
    ) as any;

    const sent = provider.post('42', 'token', post(), integration);
    await expect(sent).rejects.toBeInstanceOf(BadBody);
    await expect(sent).rejects.toMatchObject({
      message: 'Twitch did not send the message: Held by AutoMod',
    });
  });

  it('returns the message id when Twitch sent it', async () => {
    const provider = new TwitchProvider();
    provider.fetch = jest.fn(async () =>
      answer({ data: [{ message_id: 'm-1', is_sent: true }] })
    ) as any;

    await expect(
      provider.post('42', 'token', post(), integration)
    ).resolves.toMatchObject([
      {
        postId: 'm-1',
        status: 'posted',
        releaseURL: 'https://twitch.tv/streamer',
      },
    ]);
  });
});

describe('TwitchProvider announcements', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const announce = (status: number, body = '') => {
    global.fetch = jest.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => body,
    })) as any;
    return new TwitchProvider().post(
      '42',
      'token',
      post({ messageType: 'announcement' }),
      integration
    );
  };

  it('accepts the 204 Twitch answers on success', async () => {
    await expect(announce(204)).resolves.toMatchObject([
      { status: 'posted', releaseURL: 'https://twitch.tv/streamer' },
    ]);
  });

  it('fails with Twitch reason when the announcement is refused', async () => {
    await expect(
      announce(403, '{"message":"The sender must be a moderator"}')
    ).rejects.toMatchObject({
      message: 'Twitch did not send the announcement: The sender must be a moderator',
    });
  });

  it('asks for a reconnect on 401', async () => {
    await expect(announce(401, '{}')).rejects.toBeInstanceOf(RefreshToken);
  });
});

describe('KickProvider chat messages', () => {
  it('fails when Kick does not send the message', async () => {
    const provider = new KickProvider();
    provider.fetch = jest.fn(async () =>
      answer({ data: { is_sent: false }, message: 'Slow mode' })
    ) as any;

    await expect(
      provider.post('42', 'token', post(), integration)
    ).rejects.toMatchObject({ message: 'Kick did not send the message: Slow mode' });
  });

  it('fails a reply Kick does not send', async () => {
    const provider = new KickProvider();
    provider.fetch = jest.fn(async () => answer({ data: {} })) as any;

    await expect(
      provider.comment('42', 'p-1', undefined, 'token', post(), integration)
    ).rejects.toBeInstanceOf(BadBody);
  });

  it('keeps a sent message', async () => {
    const provider = new KickProvider();
    provider.fetch = jest.fn(async () =>
      answer({ data: { is_sent: true, message_id: 'k-1' } })
    ) as any;

    await expect(
      provider.post('42', 'token', post(), integration)
    ).resolves.toMatchObject([{ postId: 'k-1', status: 'posted' }]);
  });
});

describe('Twitch and Kick channel links', () => {
  // chat has no per-message permalink, so the release URL is the channel -
  // and a channel we cannot name is no URL at all, never someone else's page
  const twitch = (profile: any) => {
    const provider = new TwitchProvider();
    provider.fetch = jest.fn(async () =>
      answer({ data: [{ message_id: 'm-1', is_sent: true }] })
    ) as any;
    return provider.post('42', 'token', post(), {
      profile,
      providerIdentifier: 'twitch',
    } as any);
  };

  const kick = (profile: any) => {
    const provider = new KickProvider();
    provider.fetch = jest.fn(async () =>
      answer({ data: { message_id: 'k-1', is_sent: true } })
    ) as any;
    return provider.post('42', 'token', post(), {
      profile,
      providerIdentifier: 'kick',
    } as any);
  };

  it('links the channel the post went out on', async () => {
    await expect(twitch('streamer')).resolves.toMatchObject([
      { releaseURL: 'https://twitch.tv/streamer' },
    ]);
    await expect(kick('streamer')).resolves.toMatchObject([
      { releaseURL: 'https://kick.com/streamer' },
    ]);
  });

  it('links nothing rather than an unrelated channel', async () => {
    // the old fallbacks were twitch.tv/twitch and kick.com/channel, both of
    // which are real pages belonging to someone else
    for (const profile of ['', null, undefined]) {
      await expect(twitch(profile)).resolves.toMatchObject([
        { releaseURL: '' },
      ]);
      await expect(kick(profile)).resolves.toMatchObject([{ releaseURL: '' }]);
    }
  });
});
