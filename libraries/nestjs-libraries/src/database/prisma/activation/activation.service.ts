import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { ActivationRepository } from '@gitroom/nestjs-libraries/database/prisma/activation/activation.repository';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { curatedPostError } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.curated.error';

// Failed posts older than this are not raised any more
export const ATTENTION_FAILED_POSTS_DAYS = 30;
export const ATTENTION_FAILED_POSTS_LIMIT = 5;
// A token that can't be refreshed is flagged this long before it expires
export const ATTENTION_TOKEN_WARNING_DAYS = 7;
const EXCERPT_LENGTH = 120;

export interface ChecklistState {
  dismissed: boolean;
  steps: {
    channel: boolean;
    post: boolean;
    scheduled: boolean;
    teammate: boolean;
  };
}

export type ChannelAttentionReason =
  | 'reconnect'
  | 'finish_setup'
  | 'expired'
  | 'expiring';

export interface NeedsAttention {
  failedPosts: Array<{
    id: string;
    group: string;
    publishDate: Date;
    excerpt: string;
    error: string | null;
    integration: {
      id: string;
      name: string;
      picture: string | null;
      identifier: string;
    };
  }>;
  failedPostsTotal: number;
  channels: Array<{
    id: string;
    name: string;
    picture: string | null;
    identifier: string;
    reason: ChannelAttentionReason;
    expiresAt: Date | null;
  }>;
}

const shorten = (value: string, length: number) => {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > length ? flat.slice(0, length - 1).trimEnd() + '…' : flat;
};

export const channelAttentionReason = (
  channel: {
    refreshNeeded: boolean;
    inBetweenSteps: boolean;
    tokenExpiration: Date | null;
  },
  now: Date
): ChannelAttentionReason => {
  if (channel.refreshNeeded) {
    return 'reconnect';
  }
  if (channel.inBetweenSteps) {
    return 'finish_setup';
  }
  return channel.tokenExpiration && channel.tokenExpiration <= now
    ? 'expired'
    : 'expiring';
};

@Injectable()
export class ActivationService {
  constructor(private _activationRepository: ActivationRepository) {}

  // Completion comes from the workspace's own data, nothing is tracked
  async getChecklist(
    userId: string,
    organizationId: string
  ): Promise<ChecklistState> {
    const dismissedAt = await this._activationRepository.getChecklistDismissedAt(
      userId,
      organizationId
    );
    if (dismissedAt) {
      return {
        dismissed: true,
        steps: { channel: false, post: false, scheduled: false, teammate: false },
      };
    }

    const [channel, post, scheduled, teammate] = await Promise.all([
      this._activationRepository.hasChannel(organizationId),
      this._activationRepository.hasPost(organizationId),
      this._activationRepository.hasScheduledPost(organizationId),
      this._activationRepository.hasTeammate(organizationId),
    ]);

    return {
      dismissed: false,
      // a scheduled post is also a created post
      steps: { channel, post: post || scheduled, scheduled, teammate },
    };
  }

  async dismissChecklist(userId: string, organizationId: string) {
    await this._activationRepository.dismissChecklist(
      userId,
      organizationId,
      new Date()
    );
    return { dismissed: true };
  }

  async getNeedsAttention(organizationId: string): Promise<NeedsAttention> {
    const now = new Date();
    const since = dayjs(now)
      .subtract(ATTENTION_FAILED_POSTS_DAYS, 'day')
      .toDate();
    const expiresBefore = dayjs(now)
      .add(ATTENTION_TOKEN_WARNING_DAYS, 'day')
      .toDate();

    const [failedPosts, failedPostsTotal, channels] = await Promise.all([
      this._activationRepository.getFailedPosts(
        organizationId,
        since,
        ATTENTION_FAILED_POSTS_LIMIT
      ),
      this._activationRepository.countFailedPosts(organizationId, since),
      this._activationRepository.getChannelsNeedingAttention(
        organizationId,
        expiresBefore
      ),
    ]);

    return {
      failedPosts: failedPosts.map((post) => {
        const curated = curatedPostError(post.error);
        return {
          id: post.id,
          group: post.group,
          publishDate: post.publishDate,
          excerpt: shorten(
            stripHtmlValidation('none', post.content || ''),
            EXCERPT_LENGTH
          ),
          // the raw column holds the serialized workflow failure, which can
          // carry a stack trace or decrypted channel credentials: only the
          // curated provider message is shown, as on the calendar
          error: curated ? shorten(curated, EXCERPT_LENGTH) : null,
          integration: {
            id: post.integration.id,
            name: post.integration.customName || post.integration.name,
            picture: post.integration.picture,
            identifier: post.integration.providerIdentifier,
          },
        };
      }),
      failedPostsTotal,
      channels: channels.map((channel) => ({
        id: channel.id,
        name: channel.customName || channel.name,
        picture: channel.picture,
        identifier: channel.providerIdentifier,
        reason: channelAttentionReason(channel, now),
        expiresAt: channel.tokenExpiration,
      })),
    };
  }
}
