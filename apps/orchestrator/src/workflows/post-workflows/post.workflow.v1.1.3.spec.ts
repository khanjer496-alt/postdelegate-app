// The workflow runs outside the Temporal sandbox here: every activity proxy
// resolves to the mocks in mockState, timers resolve at once and the poke
// handler is captured so a test can deliver the signal.
const mockState: {
  activities: Record<string, jest.Mock>;
  poke?: () => void;
  condition: (fn: () => boolean, timeout: number) => Promise<boolean>;
} = {
  activities: {},
  condition: async (fn) => fn(),
};

jest.mock('@temporalio/workflow', () => {
  const common = jest.requireActual('@temporalio/common');
  return {
    ActivityFailure: common.ActivityFailure,
    ApplicationFailure: common.ApplicationFailure,
    proxyActivities: () =>
      new Proxy(
        {},
        {
          get:
            (_: unknown, name: string) =>
            (...args: unknown[]) =>
              mockState.activities[name](...args),
        }
      ),
    sleep: jest.fn().mockResolvedValue(undefined),
    condition: (fn: () => boolean, timeout: number) =>
      mockState.condition(fn, timeout),
    defineSignal: (name: string) => name,
    setHandler: (_signal: string, handler: () => void) => {
      mockState.poke = handler;
    },
    startChild: jest.fn().mockResolvedValue(undefined),
  };
});
jest.mock('@gitroom/orchestrator/activities/post.activity', () => ({}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface',
  () => ({})
);

import {
  ActivityFailure,
  ApplicationFailure,
  TimeoutFailure,
  TimeoutType,
} from '@temporalio/common';
import { postWorkflowV113 } from './post.workflow.v1.1.3';

const past = new Date(Date.now() - 60 * 1000);
const future = new Date(Date.now() + 60 * 60 * 1000);

const integration = {
  id: 'i-1',
  organizationId: 'org-1',
  providerIdentifier: 'x',
  name: 'X account',
};

const root = (extra: Record<string, any> = {}) => ({
  id: 'p-1',
  organizationId: 'org-1',
  state: 'QUEUE',
  publishDate: past,
  settings: '{}',
  intervalInDays: null,
  integration,
  ...extra,
});

const comment = (id: string) => ({
  id,
  organizationId: 'org-1',
  state: 'QUEUE',
  delay: 0,
  settings: '{}',
});

// an activity failure as the workflow receives it, without depending on the
// constructor signature of the SDK version
const activityFailure = (cause?: Error) =>
  Object.assign(Object.create(ActivityFailure.prototype), {
    message: 'Activity task failed',
    cause,
  });

const badBody = (message: string) =>
  activityFailure(
    ApplicationFailure.create({ type: 'bad_body', message, nonRetryable: true })
  );

const timeout = () =>
  activityFailure(
    Object.assign(Object.create(TimeoutFailure.prototype), {
      timeoutType: TimeoutType.START_TO_CLOSE,
      lastHeartbeatDetails: 'x: publish',
    })
  );

const run = (postNow = false) =>
  postWorkflowV113({
    taskQueue: 'x',
    postId: 'p-1',
    organizationId: 'org-1',
    postNow,
  });

const writes = () => mockState.activities.changeStateIf.mock.calls;

beforeEach(() => {
  mockState.poke = undefined;
  mockState.condition = async (fn) => fn();
  mockState.activities = {
    getPost: jest.fn().mockResolvedValue(root()),
    getPostsList: jest
      .fn()
      .mockResolvedValue([root(), comment('c-1'), comment('c-2')]),
    hasActiveSubscription: jest.fn().mockResolvedValue(true),
    isCommentable: jest.fn().mockResolvedValue(true),
    postSocialPending: jest.fn().mockResolvedValue([
      {
        id: 'p-1',
        postId: 'x-1',
        releaseURL: 'https://x.com/1',
        status: 'success',
      },
    ]),
    postComment: jest.fn().mockImplementation(async (_r, _l, _i, [post]) => [
      {
        id: post.id,
        postId: `x-${post.id}`,
        releaseURL: `https://x.com/${post.id}`,
        status: 'success',
      },
    ]),
    updatePost: jest.fn().mockResolvedValue(undefined),
    changeStateIf: jest.fn().mockResolvedValue(true),
    inAppNotification: jest.fn().mockResolvedValue(undefined),
    sendWebhooks: jest.fn().mockResolvedValue(undefined),
    internalPlugs: jest.fn().mockResolvedValue([]),
    globalPlugs: jest.fn().mockResolvedValue([]),
    refreshTokenWithCause: jest.fn().mockResolvedValue(false),
  };
});

describe('postWorkflowV113 missing posts', () => {
  it('exits quietly when the post was deleted', async () => {
    mockState.activities.getPost.mockResolvedValue(false);

    await run();

    expect(mockState.activities.hasActiveSubscription).toHaveBeenCalledWith(
      'org-1'
    );
    expect(writes()).toHaveLength(0);
  });

  it('records a lapsed subscription instead of "No Post"', async () => {
    mockState.activities.getPost.mockResolvedValue(false);
    mockState.activities.hasActiveSubscription.mockResolvedValue(false);

    await run();

    expect(writes()).toEqual([
      [
        'p-1',
        ['QUEUE'],
        'ERROR',
        'This post was not published because the organization has no active subscription.',
      ],
    ]);
  });

  it('never writes over a post that is not QUEUE anymore', async () => {
    mockState.activities.getPost.mockResolvedValue(
      root({ state: 'PUBLISHED' })
    );

    await run();

    expect(writes()).toHaveLength(0);
    expect(mockState.activities.postSocialPending).not.toHaveBeenCalled();
  });
});

describe('postWorkflowV113 scheduling wait', () => {
  it('a poke re-reads the post and stops when it became a draft', async () => {
    mockState.activities.getPost
      .mockResolvedValueOnce(root({ publishDate: future }))
      .mockResolvedValueOnce(root({ publishDate: future, state: 'DRAFT' }));
    const timeouts: number[] = [];
    mockState.condition = async (fn, wait) => {
      timeouts.push(wait);
      mockState.poke!();
      return fn();
    };

    await run();

    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toBeGreaterThan(0);
    expect(mockState.activities.getPost).toHaveBeenCalledTimes(2);
    expect(mockState.activities.postSocialPending).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(0);
  });

  it('a poke after the date moved earlier publishes right away', async () => {
    mockState.activities.getPost
      .mockResolvedValueOnce(root({ publishDate: future }))
      .mockResolvedValueOnce(root({ publishDate: past }));
    mockState.condition = async (fn) => {
      mockState.poke!();
      return fn();
    };

    await run();

    expect(mockState.activities.postSocialPending).toHaveBeenCalledTimes(1);
  });

  it('a post deleted during the wait exits quietly', async () => {
    mockState.activities.getPost
      .mockResolvedValueOnce(root({ publishDate: future }))
      .mockResolvedValueOnce(false);
    mockState.condition = async () => false;

    await run();

    expect(mockState.activities.postSocialPending).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(0);
  });
});

describe('postWorkflowV113 failures', () => {
  it('a failed comment errors that comment and the rest, never the published root', async () => {
    mockState.activities.postComment.mockRejectedValueOnce(
      badBody('Reply refused')
    );

    await run();

    expect(writes()).toEqual([
      [
        'c-1',
        ['QUEUE'],
        'ERROR',
        expect.anything(),
        [expect.objectContaining({ id: 'c-1' })],
        undefined,
      ],
      ['c-2', ['QUEUE'], 'ERROR', 'Not published because an earlier comment failed'],
    ]);
    expect(writes().some(([id]) => id === 'p-1')).toBe(false);
    expect(mockState.activities.postComment).toHaveBeenCalledTimes(1);
    expect(mockState.activities.updatePost).toHaveBeenCalledWith(
      'p-1',
      'x-1',
      'https://x.com/1'
    );
    // the root is live: its webhooks still go out
    expect(mockState.activities.sendWebhooks).toHaveBeenCalledTimes(1);
    expect(mockState.activities.inAppNotification).toHaveBeenCalledWith(
      'org-1',
      'Error posting comments on x for X account',
      'Your post is live on x, but a comment in its thread could not be published: Reply refused',
      true,
      false,
      'fail'
    );
  });

  it('an unknown publish error is written once and never retried', async () => {
    mockState.activities.postSocialPending.mockRejectedValue(
      activityFailure(new Error('socket hang up'))
    );

    await expect(run()).resolves.toBe(false);

    expect(mockState.activities.postSocialPending).toHaveBeenCalledTimes(1);
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toBe('p-1');
  });

  it('an unknown comment error is not retried, so an accepted comment is never duplicated', async () => {
    mockState.activities.postComment.mockRejectedValueOnce(
      activityFailure(new Error('socket hang up'))
    );

    await run();

    expect(mockState.activities.postComment).toHaveBeenCalledTimes(1);
    expect(writes().map(([id]) => id)).toEqual(['c-1', 'c-2']);
    // the calendar only shows the main post, so the failed comment is told
    expect(mockState.activities.inAppNotification).toHaveBeenCalledWith(
      'org-1',
      'Error posting comments on x for X account',
      'Your post is live on x, but a comment in its thread could not be published',
      true,
      false,
      'fail'
    );
  });

  it('a refused token refresh on the main post notifies too', async () => {
    mockState.activities.postSocialPending.mockRejectedValue(
      activityFailure(
        ApplicationFailure.create({
          type: 'refresh_token',
          message: 'Token expired',
        })
      )
    );

    await expect(run()).resolves.toBe(false);

    expect(writes()).toHaveLength(1);
    expect(mockState.activities.inAppNotification).toHaveBeenCalledWith(
      'org-1',
      'Error posting on x for X account',
      'An error occurred while posting on x: Token expired',
      true,
      false,
      'fail'
    );
  });

  it('keeps the platform id and URL when the publish went out but could not be marked', async () => {
    mockState.activities.updatePost.mockRejectedValueOnce(
      activityFailure(new Error('db down'))
    );

    await expect(run()).resolves.toBe(false);

    expect(writes()[0]).toEqual([
      'p-1',
      ['QUEUE'],
      'ERROR',
      expect.anything(),
      expect.any(Array),
      { releaseId: 'x-1', releaseURL: 'https://x.com/1' },
    ]);
    expect(mockState.activities.postSocialPending).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the row was no longer writable', async () => {
    mockState.activities.postSocialPending.mockRejectedValue(
      badBody('This channel or post is no longer available.')
    );
    mockState.activities.changeStateIf.mockResolvedValue(false);

    await run();

    expect(mockState.activities.inAppNotification).not.toHaveBeenCalled();
  });

  it('fails the run instead of swallowing a terminal write that never landed', async () => {
    mockState.activities.postSocialPending.mockRejectedValue(timeout());
    mockState.activities.changeStateIf.mockRejectedValue(
      activityFailure(new Error('db down'))
    );

    await expect(run()).rejects.toBeInstanceOf(ActivityFailure);
    expect(mockState.activities.postSocialPending).toHaveBeenCalledTimes(1);
  });

  it('a repeating post with a failed comment gets its webhooks but no next repeat', async () => {
    const { startChild } = jest.requireMock('@temporalio/workflow');
    startChild.mockClear();
    mockState.activities.getPostsList.mockResolvedValue([
      root({ intervalInDays: 1 }),
      comment('c-1'),
    ]);
    mockState.activities.postComment.mockRejectedValueOnce(
      badBody('Reply refused')
    );

    await run();

    expect(mockState.activities.sendWebhooks).toHaveBeenCalledTimes(1);
    expect(startChild).not.toHaveBeenCalled();
  });

  it('a repeating post whose thread went out schedules the next repeat', async () => {
    const { startChild } = jest.requireMock('@temporalio/workflow');
    startChild.mockClear();
    mockState.activities.getPostsList.mockResolvedValue([
      root({ intervalInDays: 1 }),
      comment('c-1'),
    ]);

    await run();

    expect(startChild).toHaveBeenCalledTimes(1);
    expect(startChild.mock.calls[0][1].args[0]).toMatchObject({
      postId: 'p-1',
      postNow: true,
    });
  });

  it('a repeat run writes over its PUBLISHED root', async () => {
    mockState.activities.getPost.mockResolvedValue(
      root({ state: 'PUBLISHED' })
    );
    mockState.activities.postSocialPending.mockRejectedValue(
      badBody('Duplicate content')
    );

    await run(true);

    expect(writes()[0].slice(0, 3)).toEqual([
      'p-1',
      ['QUEUE', 'PUBLISHED'],
      'ERROR',
    ]);
  });
});
