import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BadBody,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { MediumSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/medium.settings.dto';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';

export class MediumProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3; // Medium has lenient publishing limits
  identifier = 'medium';
  name = 'Medium';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'markdown' as const;
  dto = MediumSettingsDto;

  // a story on medium.com is public, but one submitted to a publication is
  // created as a draft for that publication's editors to publish
  isPublicReleaseURL(releaseURL: string, settings: Partial<MediumSettingsDto>) {
    return (
      !settings?.publication &&
      /^https:\/\/medium\.com\/(p\/[0-9a-f]+|@[A-Za-z0-9._-]+\/[A-Za-z0-9-]+)$/.test(
        releaseURL
      )
    );
  }

  maxLength() {
    return 100000;
  }

  // Medium answers { errors: [{ message, code }] }, codes 6000-6003 are a
  // missing, invalid or revoked token
  override handleErrors(
    body: string,
    status: number
  ):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    let error: { message?: string; code?: number } = {};
    try {
      error = JSON.parse(body)?.errors?.[0] || {};
    } catch (err) {
      error = {};
    }

    if (status === 401 || (error.code! >= 6000 && error.code! <= 6003)) {
      return {
        type: 'refresh-token',
        value: 'Medium no longer accepts the API key, please reconnect the channel',
      };
    }

    if (status === 403) {
      return {
        type: 'bad-body',
        value: `Medium did not allow the post${
          error.message ? `: ${error.message}` : ''
        }`,
      };
    }

    if (status >= 400 && status < 500) {
      return {
        type: 'bad-body',
        value: `Medium rejected the post${
          error.message ? `: ${error.message}` : ''
        }`,
      };
    }

    // creating a post is not idempotent: Medium may have published it before
    // failing, a retry could publish it twice (a 429 is still retried)
    if (status >= 500) {
      return {
        type: 'bad-body',
        value: 'Medium had a problem with the post, check your Medium account before trying again',
      };
    }

    return undefined;
  }

  async generateAuthUrl() {
    const state = makeSecureId(6);
    return {
      url: state,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async customFields() {
    return [
      {
        key: 'apiKey',
        label: 'API key',
        validation: `/^.{3,}$/`,
        type: 'password' as const,
      },
    ];
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const body = JSON.parse(Buffer.from(params.code, 'base64').toString());
    try {
      const {
        data: { name, id, imageUrl, username },
      } = await (
        await fetch('https://api.medium.com/v1/me', {
          headers: {
            Authorization: `Bearer ${body.apiKey}`,
          },
        })
      ).json();

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: body.apiKey,
        id,
        name,
        picture: imageUrl || '',
        username,
      };
    } catch (err) {
      return 'Invalid credentials';
    }
  }

  @Tool({ description: 'List of publications', dataSchema: [] })
  async publications(accessToken: string, _: any, id: string) {
    const { data } = await (
      await fetch(`https://api.medium.com/v1/users/${id}/publications`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
    ).json();

    return data;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const { settings } = postDetails?.[0] || { settings: {} };
    const { data } = await (
      await this.fetch(
        settings?.publication
          ? `https://api.medium.com/v1/publications/${settings?.publication}/posts`
          : `https://api.medium.com/v1/users/${id}/posts`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: settings.title,
            contentFormat: 'markdown',
            content: postDetails?.[0].message,
            ...(settings.canonical ? { canonicalUrl: settings.canonical } : {}),
            ...(settings?.tags?.length
              ? { tags: settings?.tags?.map((p: any) => p.value) }
              : {}),
            publishStatus: settings?.publication ? 'draft' : 'public',
          }),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        },
        'medium'
      )
    ).json();

    if (!data?.id) {
      throw new BadBody(
        'medium',
        JSON.stringify(data || {}),
        Buffer.from('{}'),
        'Medium did not return the published post, please check your Medium account'
      );
    }

    return [
      {
        id: postDetails?.[0].id,
        status: 'completed',
        postId: data.id,
        releaseURL: data.url,
      },
    ];
  }
}
