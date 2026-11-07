import {
  CHANNEL_CONNECTED,
  CHANNEL_DISCONNECTED,
  CHANNEL_READY,
  channelNeedsAttention,
  channelNeedsAttentionWhere,
  channelState,
  isChannelConnected,
  isChannelDisconnected,
  isChannelReady,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.state';

const channel = (flags: Record<string, any> = {}) => ({
  deletedAt: null,
  disabled: false,
  inBetweenSteps: false,
  refreshNeeded: false,
  ...flags,
});

describe('channelState', () => {
  it('names every combination, most final first', () => {
    expect(channelState(channel())).toBe('ready');
    expect(channelState(channel({ refreshNeeded: true }))).toBe('reconnect');
    expect(channelState(channel({ inBetweenSteps: true }))).toBe('incomplete');
    expect(channelState(channel({ disabled: true }))).toBe('off');
    expect(channelState(channel({ deletedAt: new Date() }))).toBe('removed');

    // the combinations, which is where the hand-written checks disagreed
    expect(
      channelState(channel({ disabled: true, refreshNeeded: true }))
    ).toBe('off');
    expect(
      channelState(channel({ inBetweenSteps: true, refreshNeeded: true }))
    ).toBe('incomplete');
    expect(
      channelState(
        channel({ deletedAt: new Date(), disabled: true, refreshNeeded: true })
      )
    ).toBe('removed');
  });

  it('treats a channel needing a reconnect as still connected', () => {
    // a post scheduled for next week is fine if they reconnect before then
    expect(isChannelConnected(channel({ refreshNeeded: true }))).toBe(true);
    expect(isChannelReady(channel({ refreshNeeded: true }))).toBe(false);

    expect(isChannelConnected(channel({ inBetweenSteps: true }))).toBe(false);
    expect(isChannelConnected(channel({ disabled: true }))).toBe(false);
    expect(isChannelConnected(channel({ deletedAt: new Date() }))).toBe(false);
    expect(isChannelReady(channel())).toBe(true);
  });

  it('asks the customer about what they did not choose themselves', () => {
    expect(channelNeedsAttention(channel({ refreshNeeded: true }))).toBe(true);
    expect(channelNeedsAttention(channel({ inBetweenSteps: true }))).toBe(true);
    // they turned it off: they know, and nothing is wrong with it
    expect(channelNeedsAttention(channel({ disabled: true }))).toBe(false);
    expect(channelNeedsAttention(channel())).toBe(false);
  });

  it('keeps the disconnected tombstone a shape of its own', () => {
    const tombstone = channel({
      deletedAt: new Date(),
      disabled: true,
      refreshNeeded: true,
    });
    expect(isChannelDisconnected(tombstone)).toBe(true);
    // a plain deleted row is not one: the lifecycle code may not reconnect it
    expect(isChannelDisconnected(channel({ deletedAt: new Date() }))).toBe(
      false
    );
    expect(isChannelDisconnected(channel({ disabled: true }))).toBe(false);
  });

  // the where clauses have to keep saying exactly what the hand-written ones
  // said, or a query silently changes what it returns
  it('matches the predicates the queries used to spell out', () => {
    expect(CHANNEL_CONNECTED).toEqual({
      deletedAt: null,
      disabled: false,
      inBetweenSteps: false,
    });
    expect(CHANNEL_READY).toEqual({
      deletedAt: null,
      disabled: false,
      inBetweenSteps: false,
      refreshNeeded: false,
    });
    expect(channelNeedsAttentionWhere()).toEqual({
      deletedAt: null,
      disabled: false,
      OR: [{ refreshNeeded: true }, { inBetweenSteps: true }],
    });
    // a caller's own reason is added to the two every caller shares
    expect(channelNeedsAttentionWhere([{ tokenExpiration: { lte: 1 } }]).OR)
      .toEqual([
        { refreshNeeded: true },
        { inBetweenSteps: true },
        { tokenExpiration: { lte: 1 } },
      ]);
    expect(CHANNEL_DISCONNECTED).toEqual({
      deletedAt: { not: null },
      disabled: true,
      refreshNeeded: true,
    });
  });

  // The payloads these run against do not all carry every flag: the channel
  // list never sends deletedAt, and the Studio channel carries only
  // refreshNeeded. A missing flag must read as "not set", never as a reason to
  // call a channel ready - and a caller with too few flags to answer honestly
  // should read `state` from the payload instead.
  it('treats a flag that was not sent as not set', () => {
    expect(channelState({})).toBe('ready');
    expect(channelState({ deletedAt: undefined })).toBe('ready');
    expect(channelState({ disabled: null })).toBe('ready');
    expect(channelState({ refreshNeeded: undefined, disabled: false })).toBe(
      'ready'
    );
    // what the Studio channel payload carries on its own
    expect(isChannelConnected({ refreshNeeded: true })).toBe(true);
    expect(isChannelReady({ refreshNeeded: true })).toBe(false);
    expect(channelNeedsAttention({})).toBe(false);
    expect(isChannelDisconnected({})).toBe(false);
  });

  // a where clause and the predicate beside it must agree, or a row a query
  // returned would be judged differently in memory
  it('agrees with the where clauses on every combination', () => {
    for (const deletedAt of [null, new Date()]) {
      for (const disabled of [false, true]) {
        for (const inBetweenSteps of [false, true]) {
          for (const refreshNeeded of [false, true]) {
            const row = { deletedAt, disabled, inBetweenSteps, refreshNeeded };
            const matches = (where: Record<string, any>) =>
              Object.entries(where).every(([key, value]) => {
                if (key === 'OR') {
                  return (value as any[]).some((clause) =>
                    matches(clause as Record<string, any>)
                  );
                }
                const actual = (row as any)[key];
                if (value && typeof value === 'object' && 'not' in value) {
                  return (value as any).not === null
                    ? actual !== null
                    : actual !== (value as any).not;
                }
                return actual === value;
              });

            expect(matches(CHANNEL_READY)).toBe(isChannelReady(row));
            expect(matches(CHANNEL_CONNECTED)).toBe(isChannelConnected(row));
            expect(matches(channelNeedsAttentionWhere())).toBe(
              channelNeedsAttention(row)
            );
            expect(matches(CHANNEL_DISCONNECTED)).toBe(
              isChannelDisconnected(row)
            );
          }
        }
      }
    }
  });
});
