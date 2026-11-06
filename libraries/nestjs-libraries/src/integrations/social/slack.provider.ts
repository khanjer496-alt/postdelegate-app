import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import {
  BadBody,
  RefreshToken,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { SlackDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/slack.dto';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';

// Slack cuts a message at 40,000 characters and recommends at most 4,000,
// the limit the composer and the site use too. A section block holds at most
// 3,000 of them.
const SLACK_MAX_LENGTH = 4000;
const SLACK_SECTION_LENGTH = 3000;

// what the user is told for the errors a post can get from chat.postMessage
const SLACK_ERRORS: Record<string, string> = {
  channel_not_found:
    'Slack could not find the channel, pick the channel again in the settings',
  not_in_channel:
    'The app is not in this Slack channel, invite it to the channel and try again',
  is_archived: 'The Slack channel is archived, pick another channel',
  msg_too_long: 'The message is too long for Slack',
  no_text: 'The post is empty, add a text or a picture',
  invalid_blocks:
    'Slack could not show the post, check that the pictures are public PNG, JPG or GIF files',
  invalid_blocks_format:
    'Slack could not show the post, check that the pictures are public PNG, JPG or GIF files',
  restricted_action:
    'The Slack workspace does not allow the app to post in this channel',
  thread_not_found:
    'The Slack message to reply to no longer exists, so the reply was not sent',
};

export class SlackProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 10; // Slack limits are per workspace
  identifier = 'slack';
  name = 'Slack';
  isBetweenSteps = false;
  editor = 'normal' as const;
  scopes = [
    'channels:read',
    'chat:write',
    'users:read',
    'groups:read',
    'channels:join',
    'chat:write.customize',
  ];
  dto = SlackDto;

  // Media goes out as Block Kit image blocks, which Slack only accepts for
  // png / jpg / gif; an mp4 makes chat.postMessage reject the whole message.
  override async checkValidity(
    posts: Array<ValidityMedia[]>
  ): Promise<string | true> {
    const hasVideo = posts?.some((post) =>
      post?.some((item) => (item?.path?.indexOf?.('mp4') ?? -1) > -1)
    );
    if (hasVideo) {
      return 'No video support for Slack, only images';
    }
    return true;
  }

  maxLength() {
    return SLACK_MAX_LENGTH;
  }

  // the text in sections of at most 3,000 characters (cut at a line break or
  // a space when there is one), no section when there is no text, then the
  // pictures
  blocks(message: string, media: PostDetails['media']) {
    const sections: string[] = [];
    let rest = (message || '').trim();
    while (rest.length) {
      if (rest.length <= SLACK_SECTION_LENGTH) {
        sections.push(rest);
        break;
      }

      const window = rest.slice(0, SLACK_SECTION_LENGTH);
      const breakAt = Math.max(window.lastIndexOf('\n'), window.lastIndexOf(' '));
      let end = breakAt > SLACK_SECTION_LENGTH / 2 ? breakAt : SLACK_SECTION_LENGTH;
      // never split an emoji (a surrogate pair) in two
      const code = rest.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) {
        end -= 1;
      }
      sections.push(rest.slice(0, end).trim());
      rest = rest.slice(end).trim();
    }

    return [
      ...sections
        .filter((text) => text.length)
        .map((text) => ({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text,
          },
        })),
      ...(media || []).map((m) => ({
        type: 'image',
        image_url: m.path,
        alt_text: (m.alt || '').slice(0, 2000),
      })),
    ];
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 1000000,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }
  async generateAuthUrl() {
    const state = makeSecureId(6);

    return {
      url: `https://slack.com/oauth/v2/authorize?client_id=${
        process.env.SLACK_ID
      }&redirect_uri=${encodeURIComponent(
        `${
          process?.env?.FRONTEND_URL?.indexOf('https') === -1
            ? 'https://redirectmeto.com/'
            : ''
        }${process?.env?.FRONTEND_URL}/integrations/social/slack`
      )}&scope=channels:read,chat:write,users:read,groups:read,channels:join,chat:write.customize&state=${state}`,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const { access_token, team, bot_user_id, scope } = await (
      await this.fetch(`https://slack.com/api/oauth.v2.access`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: process.env.SLACK_ID!,
          client_secret: process.env.SLACK_SECRET!,
          code: params.code,
          redirect_uri: `${
            process?.env?.FRONTEND_URL?.indexOf('https') === -1
              ? 'https://redirectmeto.com/'
              : ''
          }${process?.env?.FRONTEND_URL}/integrations/social/slack${
            params.refresh ? `?refresh=${params.refresh}` : ''
          }`,
        }),
      })
    ).json();

    this.checkScopes(this.scopes, scope.split(','));

    const { user } = await (
      await fetch(`https://slack.com/api/users.info?user=${bot_user_id}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    return {
      id: team.id,
      name: user.real_name,
      accessToken: access_token,
      refreshToken: 'null',
      expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
      picture: user?.profile?.image_original || '',
      username: user.name,
    };
  }

  @Tool({
    description: 'Get list of channels',
    dataSchema: [],
  })
  async channels(accessToken: string, params: any, id: string) {
    // conversations.list pages its answer (100 by default): read every page,
    // archived channels can't be posted to. A rate limit part way keeps the
    // channels read so far.
    const channels: { id: string; name: string }[] = [];
    let cursor = '';
    do {
      const list = await (
        await fetch(
          `https://slack.com/api/conversations.list?types=public_channel,private_channel&exclude_archived=true&limit=1000${
            cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
          }`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        )
      ).json();
      if (list?.error === 'ratelimited' && channels.length) {
        break;
      }
      this.checkApiError(list);

      channels.push(
        ...(list.channels || [])
          .filter((p: any) => !p.is_archived)
          .map((p: any) => ({
            id: p.id,
            name: p.name,
          }))
      );
      cursor = list.response_metadata?.next_cursor || '';
    } while (cursor);

    return channels;
  }

  // Slack answers HTTP 200 with { ok: false, error } on failures, so the post
  // used to be marked completed with no message in the channel.
  private checkApiError(all: any) {
    if (all?.ok !== false) {
      return;
    }
    const json = JSON.stringify(all);
    const message =
      SLACK_ERRORS[all.error] ||
      `Slack rejected the post: ${
        [all.error, ...(all.errors || [])].filter(Boolean).join(': ') ||
        'unknown error'
      }`;
    if (
      [
        'invalid_auth',
        'token_revoked',
        'token_expired',
        'account_inactive',
      ].includes(all.error)
    ) {
      throw new RefreshToken(this.identifier, json, Buffer.from('{}'), message);
    }
    if (all.error === 'ratelimited') {
      throw new Error(message);
    }
    throw new BadBody(this.identifier, json, Buffer.from('{}'), message);
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const channel = firstPost.settings.channel;

    // Join the channel first
    await fetch(`https://slack.com/api/conversations.join`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
      }),
    });

    // Post the main message
    const posted = await (
      await fetch(`https://slack.com/api/chat.postMessage`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel,
          username: integration.name,
          icon_url: integration.picture,
          blocks: this.blocks(firstPost.message, firstPost.media),
        }),
      })
    ).json();
    this.checkApiError(posted);
    const { ts, channel: responseChannel } = posted;

    // Get permalink for the message
    const { permalink } = await (
      await fetch(
        `https://slack.com/api/chat.getPermalink?channel=${responseChannel}&message_ts=${ts}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )
    ).json();

    return [
      {
        id: firstPost.id,
        postId: ts,
        releaseURL: permalink || '',
        status: 'posted',
      },
    ];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    const channel = commentPost.settings.channel;
    const threadTs = lastCommentId || postId;

    // Post the threaded reply
    const posted = await (
      await fetch(`https://slack.com/api/chat.postMessage`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel,
          username: integration.name,
          icon_url: integration.picture,
          thread_ts: threadTs,
          blocks: this.blocks(commentPost.message, commentPost.media),
        }),
      })
    ).json();
    this.checkApiError(posted);
    const { ts, channel: responseChannel } = posted;

    // Get permalink for the comment
    const { permalink } = await (
      await fetch(
        `https://slack.com/api/chat.getPermalink?channel=${responseChannel}&message_ts=${ts}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )
    ).json();

    return [
      {
        id: commentPost.id,
        postId: ts,
        releaseURL: permalink || '',
        status: 'posted',
      },
    ];
  }

  async changeProfilePicture(id: string, accessToken: string, url: string) {
    return {
      url,
    };
  }

  async changeNickname(id: string, accessToken: string, name: string) {
    return {
      name,
    };
  }
}
