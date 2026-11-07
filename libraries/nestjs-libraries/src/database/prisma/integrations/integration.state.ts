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
  disabledReason?: string | null;
  inBetweenSteps?: boolean | null;
  refreshNeeded?: boolean | null;
};

// Why a channel is 'off', stored next to `disabled` in disabledReason. It
// never changes what 'off' means (the channel is off either way), only who
// can turn it back on: the customer turned it off themselves (USER), or a
// downgrade turned it off because the plan has no room for it (PLAN_LIMIT),
// and only those an upgrade turns back on. Null is a channel turned off
// before the reason was recorded: it is never turned back on by itself, the
// customer does that from the channel's menu. A removed channel (and the
// disconnected tombstone) keeps the reason it had: nothing reads it there,
// and every write that brings the row back (a reconnect, a page pick) clears
// it along with `disabled`.
export const DISABLED_BY_USER = 'USER';
export const DISABLED_BY_PLAN = 'PLAN_LIMIT';

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

// Off because the plan has no room for it: the customer upgrades, or turns
// off another channel and turns this one on. The same channels as
// CHANNEL_LOCKED_BY_PLAN, the ones an upgrade turns back on
export const isChannelLockedByPlan = (channel: ChannelFlags) =>
  channelState(channel) === 'off' &&
  !channel.inBetweenSteps &&
  channel.disabledReason === DISABLED_BY_PLAN;

// The channels a plan's channel limit counts: the connected ones. Every limit
// check - connecting, picking a page, enabling, a downgrade turning channels
// off - counts with this, so a channel turned off (by the customer or by a
// downgrade) frees its slot, a channel waiting for a reconnect keeps it, and
// the temporary row of a connect that still has a page to pick never takes
// one (the page pick checks the limit itself)
export const countPlanChannels = (channels: ChannelFlags[]) =>
  channels.filter(isChannelConnected).length;

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

// The channels a downgrade locked (isChannelLockedByPlan), the only ones an
// upgrade turns back on
export const CHANNEL_LOCKED_BY_PLAN: Prisma.IntegrationWhereInput = {
  deletedAt: null,
  disabled: true,
  disabledReason: DISABLED_BY_PLAN,
  inBetweenSteps: false,
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
