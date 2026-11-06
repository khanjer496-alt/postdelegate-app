import {
  ActivationService,
  ATTENTION_FAILED_POSTS_DAYS,
  ATTENTION_FAILED_POSTS_LIMIT,
  ATTENTION_TOKEN_WARNING_DAYS,
  channelAttentionReason,
} from './activation.service';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-31T12:00:00Z');

const makeRepository = () => ({
  hasChannel: jest.fn().mockResolvedValue(false),
  hasPost: jest.fn().mockResolvedValue(false),
  hasScheduledPost: jest.fn().mockResolvedValue(false),
  hasTeammate: jest.fn().mockResolvedValue(false),
  getChecklistDismissedAt: jest.fn().mockResolvedValue(null),
  dismissChecklist: jest.fn().mockResolvedValue({ count: 1 }),
  getFailedPosts: jest.fn().mockResolvedValue([]),
  countFailedPosts: jest.fn().mockResolvedValue(0),
  getChannelsNeedingAttention: jest.fn().mockResolvedValue([]),
});

const setup = () => {
  const repository = makeRepository();
  const service = new ActivationService(repository as any);
  return { service, repository };
};

describe('ActivationService checklist', () => {
  it('reads every fact of the organization', async () => {
    const { service, repository } = setup();
    repository.hasChannel.mockResolvedValue(true);
    repository.hasPost.mockResolvedValue(true);

    expect(await service.getChecklist('u1', 'org1')).toEqual({
      dismissed: false,
      steps: { channel: true, post: true, scheduled: false, teammate: false },
    });
    expect(repository.getChecklistDismissedAt).toHaveBeenCalledWith(
      'u1',
      'org1'
    );
    for (const fact of [
      'hasChannel',
      'hasPost',
      'hasScheduledPost',
      'hasTeammate',
    ] as const) {
      expect(repository[fact]).toHaveBeenCalledWith('org1');
    }
  });

  it('counts a scheduled post as a created post', async () => {
    const { service, repository } = setup();
    repository.hasScheduledPost.mockResolvedValue(true);

    const { steps } = await service.getChecklist('u1', 'org1');
    expect(steps.post).toBe(true);
    expect(steps.scheduled).toBe(true);
  });

  it('skips the queries once the member dismissed it', async () => {
    const { service, repository } = setup();
    repository.getChecklistDismissedAt.mockResolvedValue(NOW);

    expect((await service.getChecklist('u1', 'org1')).dismissed).toBe(true);
    expect(repository.hasChannel).not.toHaveBeenCalled();
    expect(repository.hasPost).not.toHaveBeenCalled();
    expect(repository.hasScheduledPost).not.toHaveBeenCalled();
    expect(repository.hasTeammate).not.toHaveBeenCalled();
  });

  it('dismisses for this member in this organization only', async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    const { service, repository } = setup();

    expect(await service.dismissChecklist('u1', 'org1')).toEqual({
      dismissed: true,
    });
    expect(repository.dismissChecklist).toHaveBeenCalledWith('u1', 'org1', NOW);
    jest.useRealTimers();
  });
});

describe('channelAttentionReason', () => {
  const base = {
    refreshNeeded: false,
    inBetweenSteps: false,
    tokenExpiration: null as Date | null,
  };

  it('asks to reconnect a disconnected channel first', () => {
    expect(
      channelAttentionReason(
        { ...base, refreshNeeded: true, inBetweenSteps: true },
        NOW
      )
    ).toBe('reconnect');
  });

  it('asks to finish a half connected channel', () => {
    expect(channelAttentionReason({ ...base, inBetweenSteps: true }, NOW)).toBe(
      'finish_setup'
    );
  });

  it('tells an expired token from one that is about to expire', () => {
    expect(
      channelAttentionReason(
        { ...base, tokenExpiration: new Date(NOW.getTime() - DAY) },
        NOW
      )
    ).toBe('expired');
    expect(
      channelAttentionReason(
        { ...base, tokenExpiration: new Date(NOW.getTime() + DAY) },
        NOW
      )
    ).toBe('expiring');
  });
});

describe('ActivationService needs attention', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('scopes every query to the organization and its windows', async () => {
    const { service, repository } = setup();
    await service.getNeedsAttention('org1');

    const since = new Date(NOW.getTime() - ATTENTION_FAILED_POSTS_DAYS * DAY);
    const expiresBefore = new Date(
      NOW.getTime() + ATTENTION_TOKEN_WARNING_DAYS * DAY
    );
    expect(repository.getFailedPosts).toHaveBeenCalledWith(
      'org1',
      since,
      ATTENTION_FAILED_POSTS_LIMIT
    );
    expect(repository.countFailedPosts).toHaveBeenCalledWith('org1', since);
    expect(repository.getChannelsNeedingAttention).toHaveBeenCalledWith(
      'org1',
      expiresBefore
    );
  });

  it('returns nothing when all is well', async () => {
    const { service } = setup();
    expect(await service.getNeedsAttention('org1')).toEqual({
      failedPosts: [],
      failedPostsTotal: 0,
      channels: [],
    });
  });

  it('shapes failed posts into a short plain text excerpt', async () => {
    const { service, repository } = setup();
    const publishDate = new Date(NOW.getTime() - DAY);
    repository.getFailedPosts.mockResolvedValue([
      {
        id: 'p1',
        group: 'g1',
        publishDate,
        content: `<p>Hello <strong>world</strong></p><p>${'a'.repeat(300)}</p>`,
        error: 'Token expired',
        integration: {
          id: 'i1',
          name: 'Original',
          customName: 'Renamed',
          picture: 'pic.png',
          providerIdentifier: 'x',
        },
      },
    ]);
    repository.countFailedPosts.mockResolvedValue(7);

    const result = await service.getNeedsAttention('org1');
    expect(result.failedPostsTotal).toBe(7);
    const [post] = result.failedPosts;
    expect(post).toMatchObject({
      id: 'p1',
      group: 'g1',
      publishDate,
      error: 'Token expired',
      integration: {
        id: 'i1',
        name: 'Renamed',
        picture: 'pic.png',
        identifier: 'x',
      },
    });
    expect(post.excerpt.startsWith('Hello world')).toBe(true);
    expect(post.excerpt).not.toContain('<');
    expect(post.excerpt.length).toBeLessThanOrEqual(120);
    expect(post.excerpt.endsWith('…')).toBe(true);
  });

  it('labels each channel with the reason it needs attention', async () => {
    const { service, repository } = setup();
    const soon = new Date(NOW.getTime() + 2 * DAY);
    repository.getChannelsNeedingAttention.mockResolvedValue([
      {
        id: 'i1',
        name: 'One',
        customName: null,
        picture: null,
        providerIdentifier: 'linkedin',
        refreshNeeded: true,
        inBetweenSteps: false,
        tokenExpiration: null,
      },
      {
        id: 'i2',
        name: 'Two',
        customName: null,
        picture: 'two.png',
        providerIdentifier: 'facebook',
        refreshNeeded: false,
        inBetweenSteps: false,
        tokenExpiration: soon,
      },
    ]);

    expect((await service.getNeedsAttention('org1')).channels).toEqual([
      {
        id: 'i1',
        name: 'One',
        picture: null,
        identifier: 'linkedin',
        reason: 'reconnect',
        expiresAt: null,
      },
      {
        id: 'i2',
        name: 'Two',
        picture: 'two.png',
        identifier: 'facebook',
        reason: 'expiring',
        expiresAt: soon,
      },
    ]);
  });
});
