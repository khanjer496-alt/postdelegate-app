import type { Prisma } from '@prisma/client';

// A channel's state is spread over five columns - deletedAt, disabled,
// inBetweenSteps, refreshNeeded and the tombstone the three of them form - and
// every caller used to spell out its own combination. They did not agree: the
// Studio picker hid a channel needing a reconnect while its own list kept one,
// and the bulk-video list dropped a disabled channel while the composer kept
// it. This is the one place that says what each combination means.
//
// The two questions worth asking are different, and both are asked in the
// codebase, so both are named here:
//
//   connected - the customer has this channel and has not turned it off, so it
//               can be listed, edited, scheduled to and counted. A channel
//               needing a reconnect is still connected: a post scheduled for
//               next week is fine once they reconnect before then.
//   ready     - it can be published to or polled right now, which also needs
//               its token to be good.

export type ChannelState =
  // publishable now
  | 'ready'
  // connected, but its token expired or was revoked: the customer reconnects
  | 'reconnect'
  // the connect flow was never finished (an extra page or board to pick)
  | 'incomplete'
  // the customer turned it off
  | 'off'
  // deleted, or the disconnected tombstone a revoked channel leaves behind
  | 'removed';

export type ChannelFlags = {
  deletedAt?: Date | string | null;
  disabled?: boolean | null;
  inBetweenSteps?: boolean | null;
  refreshNeeded?: boolean | null;
};

// Ordered by what the customer has to do about it, most final first: a deleted
// channel is gone whatever its other flags say, one they turned off is theirs
// to turn back on, one that never finished connecting cannot be reconnected
// until it does, and only then does a stale token matter.
export const channelState = (channel: ChannelFlags): ChannelState => {
  if (channel.deletedAt) {
    return 'removed';
  }
  if (channel.disabled) {
    return 'off';
  }
  if (channel.inBetweenSteps) {
    return 'incomplete';
  }
  if (channel.refreshNeeded) {
    return 'reconnect';
  }
  return 'ready';
};

export const isChannelConnected = (channel: ChannelFlags) =>
  ['ready', 'reconnect'].includes(channelState(channel));

export const isChannelReady = (channel: ChannelFlags) =>
  channelState(channel) === 'ready';

// Needs something from the customer before it will publish again. A channel
// they turned off themselves is not in here: they know, and nothing is wrong
// with it.
export const channelNeedsAttention = (channel: ChannelFlags) =>
  ['reconnect', 'incomplete'].includes(channelState(channel));

// The same two questions as a Prisma `where` on Integration. Spread them into
// a where clause (`{ ...CHANNEL_READY, organizationId: org }`) or nest them
// under a relation (`{ integration: { ...CHANNEL_READY } }`).
//
// Each one is annotated IntegrationWhereInput, which is what these objects
// are: a bare `deletedAt: null` in a standalone literal is an implicit `any`
// under this repo's compiler settings (the inline ones are fine only because
// Prisma types them from the call), and the annotation also keeps a typo in a
// caller's own clause a compile error rather than a runtime one. The import is
// type-only, so nothing from the client reaches the frontend bundle.
export const CHANNEL_CONNECTED: Prisma.IntegrationWhereInput = {
  deletedAt: null,
  disabled: false,
  inBetweenSteps: false,
};

export const CHANNEL_READY: Prisma.IntegrationWhereInput = {
  ...CHANNEL_CONNECTED,
  refreshNeeded: false,
};

// A channel they turned off themselves is not in here: they know, and nothing
// is wrong with it. `alsoBecause` takes the extra reasons a caller has of its
// own - the activation panel adds a token that expires with no refresh token
// to renew it - so the two reasons every caller shares stay written once.
export const channelNeedsAttentionWhere = (
  alsoBecause: Prisma.IntegrationWhereInput[] = []
): Prisma.IntegrationWhereInput => ({
  deletedAt: null,
  disabled: false,
  OR: [{ refreshNeeded: true }, { inBetweenSteps: true }, ...alsoBecause],
});

// A revoked or deleted channel keeps its row so the customer can reconnect it
// in place, and that tombstone is written as all three of deletedAt, disabled
// and refreshNeeded together. It is NOT 'removed' plus two spare flags: the
// lifecycle code matches on exactly this shape, so it has a name of its own.
export const CHANNEL_DISCONNECTED: Prisma.IntegrationWhereInput = {
  deletedAt: { not: null },
  disabled: true,
  refreshNeeded: true,
};

export const isChannelDisconnected = (channel: ChannelFlags) =>
  !!channel.deletedAt && !!channel.disabled && !!channel.refreshNeeded;
