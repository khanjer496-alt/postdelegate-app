jest.mock(
  '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator',
  () => ({
    isSafePublicHttpsUrl: jest.fn(async () => true),
  })
);

import 'reflect-metadata';
import { DiscordProvider } from '@gitroom/nestjs-libraries/integrations/social/discord.provider';
import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';

const GUILD = '900';

const comment = (message = 'Follow up') =>
  ({
    id: 'comment-1',
    message,
    settings: { __type: 'discord', channel: 'channel-1' },
    media: [],
  } as any);

// Only the Discord HTTP calls are replaced, the provider logic runs as is.
const provider = (
  fetchResponse: (url: string) => any = () => ({ id: 'thread' })
) => {
  const instance = new DiscordProvider();
  const fetched: string[] = [];
  const sent: { url: string; body: string }[] = [];
  instance.fetch = jest.fn(async (url: string) => {
    fetched.push(url);
    const response = fetchResponse(url);
    return { json: async () => response } as any;
  }) as any;
  (instance as any).getSsrfSafeAxios = () => ({
    post: jest.fn(async (url: string, form: any) => {
      sent.push({ url, body: form.getBuffer().toString() });
      return { data: { id: `message-${sent.length}` } };
    }),
  });
  return { instance, fetched, sent };
};

const threadStarts = (urls: string[]) =>
  urls.filter((url) => url.endsWith('/threads')).length;

describe('DiscordProvider mentions', () => {
  const roles = [
    { id: GUILD, name: '@everyone' },
    { id: '111', name: 'Moderators' },
    { id: '112', name: 'here' },
  ];
  const members = [
    { user: { id: '222', username: 'bob', global_name: 'Bob', avatar: 'a' } },
  ];
  const mentionsFor = (query: string) =>
    provider((url) =>
      url.endsWith('/roles') ? roles : members
    ).instance.mention('token', { query }, GUILD, {} as any);

  it('labels a role with its name and keeps the & prefix on its id', async () => {
    const list = await mentionsFor('mod');
    expect(list).toContainEqual(
      expect.objectContaining({ id: '&111', label: 'Moderators' })
    );
    expect(list.every((p: any) => p.label)).toBe(true);
  });

  it('never shares server members with other workspaces, and asks for up to 10', async () => {
    const { instance, fetched } = provider((url) =>
      url.endsWith('/roles') ? roles : members
    );
    const list = await instance.mention(
      'token',
      { query: 'bo b' },
      GUILD,
      {} as any
    );
    expect(list).toContainEqual(
      expect.objectContaining({ id: '222', label: 'Bob', doNotCache: true })
    );
    expect(fetched).toContain(
      `https://discord.com/api/guilds/${GUILD}/members/search?query=bo%20b&limit=10`
    );
  });

  it('offers @everyone once, not again as the guild role', async () => {
    const list = await mentionsFor('every');
    expect(list.filter((p: any) => p.label === 'everyone')).toEqual([
      expect.objectContaining({ id: 'everyone' }),
    ]);
    expect(list.find((p: any) => p.id === `&${GUILD}`)).toBeUndefined();
  });

  it('turns picked mentions into Discord syntax when the post is sent', async () => {
    const { instance, sent } = provider();
    const message = stripHtmlValidation(
      'markdown',
      '<p>Hi <span class="mention" data-mention-id="&amp;111" data-mention-label="Moderators">@Moderators</span> ' +
        '<span class="mention" data-mention-id="&amp;112" data-mention-label="here">@here</span> ' +
        '<span class="mention" data-mention-id="here" data-mention-label="here">@here</span> ' +
        '<span class="mention" data-mention-id="everyone" data-mention-label="everyone">@everyone</span> ' +
        '<span class="mention" data-mention-id="222" data-mention-label="Bob">@Bob</span></p>',
      true,
      false,
      false,
      instance.mentionFormat
    );

    await instance.post(GUILD, 'token', [
      { ...comment(message), id: 'post-1' },
    ]);

    expect(sent[0].body).toContain('Hi <@&111> <@&112> @here @everyone <@222>');
  });
});

describe('DiscordProvider comment threads', () => {
  it('starts the thread from the post on the first comment and sends into it', async () => {
    const { instance, fetched, sent } = provider();
    const [result] = await instance.comment(
      GUILD,
      'post-message',
      undefined,
      'token',
      [comment()],
      {} as any
    );

    expect(fetched).toEqual([
      'https://discord.com/api/channels/channel-1/messages/post-message/threads',
    ]);
    expect(sent[0].url).toBe(
      'https://discord.com/api/channels/post-message/messages'
    );
    expect(result).toEqual(
      expect.objectContaining({
        postId: 'message-1',
        releaseURL: `https://discord.com/channels/${GUILD}/post-message/message-1`,
      })
    );
  });

  it('sends every later comment into the same thread, without a new one', async () => {
    const { instance, fetched, sent } = provider();
    for (const lastCommentId of ['first-comment', 'second-comment']) {
      await instance.comment(
        GUILD,
        'post-message',
        lastCommentId,
        'token',
        [comment()],
        {} as any
      );
    }

    expect(threadStarts(fetched)).toBe(0);
    expect(sent.map((p) => p.url)).toEqual([
      'https://discord.com/api/channels/post-message/messages',
      'https://discord.com/api/channels/post-message/messages',
    ]);
  });

  it('carries on into the thread when a retry finds it already started', async () => {
    const { instance, sent } = provider();
    instance.fetch = jest.fn(async () => {
      throw new BadBody(
        'discord',
        '{"message": "A thread has already been created for this message", "code": 160004}',
        '{}'
      );
    }) as any;

    await instance.comment(
      GUILD,
      'post-message',
      undefined,
      'token',
      [comment()],
      {} as any
    );

    expect(sent[0].url).toBe(
      'https://discord.com/api/channels/post-message/messages'
    );
  });

  it('fails the comment when the thread cannot be started for another reason', async () => {
    const { instance, sent } = provider();
    instance.fetch = jest.fn(async () => {
      throw new BadBody(
        'discord',
        '{"message": "Missing Permissions", "code": 50013}',
        '{}'
      );
    }) as any;

    await expect(
      instance.comment(
        GUILD,
        'post-message',
        undefined,
        'token',
        [comment()],
        {} as any
      )
    ).rejects.toBeInstanceOf(BadBody);
    expect(sent).toEqual([]);
  });
});

describe('DiscordProvider bot invite', () => {
  it('asks for the permissions posting, files, threads and mentions need', async () => {
    const { url } = await new DiscordProvider().generateAuthUrl();
    const permissions = BigInt(new URL(url).searchParams.get('permissions')!);
    const bits = [
      10, // VIEW_CHANNEL
      11, // SEND_MESSAGES
      14, // EMBED_LINKS
      15, // ATTACH_FILES
      16, // READ_MESSAGE_HISTORY
      17, // MENTION_EVERYONE
      35, // CREATE_PUBLIC_THREADS
      36, // CREATE_PRIVATE_THREADS
      38, // SEND_MESSAGES_IN_THREADS
    ].reduce((all, bit) => all | (BigInt(1) << BigInt(bit)), BigInt(0));

    expect(permissions).toBe(bits);
    // still everything the previous invite asked for
    expect(permissions & BigInt('377957124096')).toBe(BigInt('377957124096'));
  });
});
