'use client';

import { FC } from 'react';
import {
  useChannelAttentionText,
  useNeedsAttention,
} from '@gitroom/frontend/components/activation/activation.hooks';

// Amber warning on a channel whose access is about to run out, so it can be
// reconnected before a post fails. Disconnected and half connected channels
// already carry the red badge of the channel list.
export const ChannelHealthBadge: FC<{
  integrationId: string;
  onReconnect: () => void;
}> = ({ integrationId, onReconnect }) => {
  const { data } = useNeedsAttention();
  const channelText = useChannelAttentionText();
  const channel = data?.channels.find(
    (p) =>
      p.id === integrationId &&
      (p.reason === 'expiring' || p.reason === 'expired')
  );

  if (!channel) {
    return null;
  }

  const label = channelText(channel);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onReconnect();
      }}
      aria-label={label}
      data-tooltip-id="tooltip"
      data-tooltip-content={label}
      className="absolute -top-[10px] -start-[10px] z-[200] w-[24px] h-[24px] flex items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary"
    >
      <span
        aria-hidden="true"
        className="w-[16px] h-[16px] rounded-full bg-amber-400 text-black text-[10px] font-[700] flex items-center justify-center ring-2 ring-newBgColorInner"
      >
        !
      </span>
    </button>
  );
};
