import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

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

export interface ChannelAttention {
  id: string;
  name: string;
  picture: string | null;
  identifier: string;
  reason: ChannelAttentionReason;
  expiresAt: string | null;
}

export interface FailedPost {
  id: string;
  group: string;
  publishDate: string;
  excerpt: string;
  error: string | null;
  integration: {
    id: string;
    name: string;
    picture: string | null;
    identifier: string;
  };
}

export interface NeedsAttention {
  failedPosts: FailedPost[];
  failedPostsTotal: number;
  channels: ChannelAttention[];
}

export const useChecklist = () => {
  const fetch = useFetch();
  return useSWR<ChecklistState>(
    '/activation/checklist',
    async () => {
      const response = await fetch('/activation/checklist');
      if (!response.ok) {
        throw new Error('Failed to load the checklist');
      }
      return response.json();
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};

// Shared by the calendar banner and the channel list, one request for both.
// It revalidates on focus: a post may have failed while the tab was away.
export const useNeedsAttention = () => {
  const fetch = useFetch();
  return useSWR<NeedsAttention>(
    '/activation/attention',
    async () => {
      const response = await fetch('/activation/attention');
      if (!response.ok) {
        throw new Error('Failed to load what needs attention');
      }
      return response.json();
    },
    {
      revalidateOnReconnect: false,
    }
  );
};

const DAY = 24 * 60 * 60 * 1000;

// Whole days left before a token expires, 0 when it expires today
export const daysUntil = (date: string | null) =>
  date ? Math.max(Math.floor((new Date(date).getTime() - Date.now()) / DAY), 0) : 0;

export const useChannelAttentionText = () => {
  const t = useT();
  return (channel: Pick<ChannelAttention, 'reason' | 'expiresAt'>) => {
    switch (channel.reason) {
      case 'reconnect':
        return t(
          'attention_channel_disconnected',
          'Disconnected. Posts to it won’t go out until you reconnect.'
        );
      case 'finish_setup':
        return t(
          'attention_channel_setup',
          'Not fully connected yet. Finish setting it up to post.'
        );
      case 'expired':
        return t(
          'attention_channel_expired',
          'Access has expired. Reconnect so posts keep going out.'
        );
      default: {
        const days = daysUntil(channel.expiresAt);
        return days === 0
          ? t(
              'attention_channel_expires_today',
              'Access expires today. Reconnect so posts keep going out.'
            )
          : days === 1
          ? t(
              'attention_channel_expires_tomorrow',
              'Access expires tomorrow. Reconnect so posts keep going out.'
            )
          : t(
              'attention_channel_expires_days',
              'Access expires in {{days}} days. Reconnect so posts keep going out.',
              { days }
            );
      }
    }
  };
};
