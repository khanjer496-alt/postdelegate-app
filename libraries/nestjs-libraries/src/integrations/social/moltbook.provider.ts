import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import {
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { MoltbookDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/moltbook.dto';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';

const MOLTBOOK_API_BASE = 'https://www.moltbook.com/api/v1';

export class MoltbookProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 100; // Moltbook: 100 requests/minute
  identifier = 'moltbook';
  name = 'Moltbook';
  dto = MoltbookDto;
  isBetweenSteps = false;
  scopes = [] as string[];
  isWeb3 = true;
  editor = 'normal' as const;

  maxLength() {
    return 300;
  }

  // Moltbook posts and comments are text only, attached media would be
  // dropped without a word
  override async checkValidity(
    posts: Array<ValidityMedia[]>
  ): Promise<string | true> {
    if ((posts || []).some((media) => (media || []).length > 0)) {
      return 'Moltbook posts are text only, remove the media';
    }
    return true;
  }

  // Moltbook answers { success: false, error } with the HTTP status
  override handleErrors(
    body: string,
    status: number
  ):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    let error = '';
    try {
      error = JSON.parse(body)?.error || '';
    } catch (err) {
      error = '';
    }

    if (status === 401 || status === 403 || /api key/i.test(error)) {
      return {
        type: 'refresh-token',
        value: 'Moltbook no longer accepts the API key, please reconnect the channel',
      };
    }

    if (status === 429) {
      return {
        type: 'bad-body',
        value: `Moltbook limits how often an agent can post${
          error ? `: ${error}` : ''
        }`,
      };
    }

    if (status >= 400 && status < 500) {
      return {
        type: 'bad-body',
        value: `Moltbook rejected the post${error ? `: ${error}` : ''}`,
      };
    }

    // creating a post is not idempotent: Moltbook may have created it before
    // failing, a retry could post it twice (a 429 is still retried)
    if (status >= 500) {
      return {
        type: 'bad-body',
        value: 'Moltbook had a problem with the post, check the agent before trying again',
      };
    }

    return undefined;
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

  async generateAuthUrl() {
    const state = makeSecureId(6);
    return {
      url: state,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async registerAgent(name: string, description: string) {
    const response = await this.getSsrfSafeAxios()
      .post(
        `${MOLTBOOK_API_BASE}/agents/register`,
        { name, description },
        { headers: { 'Content-Type': 'application/json' } }
      )
      .catch((err) => {
        // 409: another agent already has the name
        if (err?.response?.status === 409) {
          throw new Error(
            'That agent name is already taken on Moltbook, please choose another one'
          );
        }
        throw new Error(
          err?.response?.data?.error || 'Moltbook could not register the agent'
        );
      });

    if (!response.data.success) {
      throw new Error(response.data.error || 'Registration failed');
    }

    return response.data.agent;
  }

  async checkAgentStatus(apiKey: string) {
    const response = await this.getSsrfSafeAxios().get(
      `${MOLTBOOK_API_BASE}/agents/status`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );

    return response.data;
  }

  async getAgentProfile(apiKey: string) {
    const response = await this.getSsrfSafeAxios().get(
      `${MOLTBOOK_API_BASE}/agents/me`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );

    if (!response.data.success) {
      throw new Error(response.data.error || 'Failed to get profile');
    }

    return response.data.agent;
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const apiKey = params.code;

    const profile = await this.getAgentProfile(apiKey);

    return {
      id: profile.name || profile.id,
      name: profile.display_name || profile.name,
      accessToken: apiKey,
      refreshToken: '',
      expiresIn: dayjs().add(200, 'year').unix() - dayjs().unix(),
      picture: '',
      username: profile.name,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    for (const post of postDetails) {
      const postData: {
        submolt: string;
        title: string;
        content?: string;
        url?: string;
      } = {
        submolt: post.settings?.submolt || 'general',
        title: post.message.slice(0, 100),
        content: post.message,
      };

      // this.fetch turns a refused API key into a reconnect of the channel
      const data = await (
        await this.fetch(
          `${MOLTBOOK_API_BASE}/posts`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(postData),
          },
          this.identifier
        )
      ).json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to create post');
      }

      const postId = data.post.id;
      results.push({
        id: post.id,
        postId: String(postId),
        releaseURL: `https://www.moltbook.com/post/${postId}`,
        status: 'completed',
      });
    }

    return results;
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const results: PostResponse[] = [];

    for (const post of postDetails) {
      const commentData: { content: string; parent_id?: string } = {
        content: post.message,
      };

      if (lastCommentId) {
        commentData.parent_id = lastCommentId;
      }

      const data = await (
        await this.fetch(
          `${MOLTBOOK_API_BASE}/posts/${postId}/comments`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(commentData),
          },
          this.identifier
        )
      ).json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to create comment');
      }

      const commentId = data.comment.id;
      results.push({
        id: post.id,
        postId: String(commentId),
        releaseURL: `https://www.moltbook.com/post/${postId}`,
        status: 'completed',
      });
    }

    return results;
  }
}
