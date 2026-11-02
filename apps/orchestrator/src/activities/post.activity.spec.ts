// the activity module pulls in temporal, every provider and the database
jest.mock('nestjs-temporal-core', () => ({
  Activity: () => () => undefined,
  ActivityMethod: () => () => undefined,
  TemporalService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {}, NotificationType: {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({ RefreshIntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service', () => ({ WebhooksService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher', () => ({ ssrfSafeFetch: jest.fn() }));
jest.mock('@gitroom/nestjs-libraries/temporal/temporal.heartbeat', () => ({
  setHeartbeatDetails: jest.fn(),
  withHeartbeat: (fn: () => Promise<unknown>) => fn(),
}));

import { PostActivity } from './post.activity';
import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';

describe('PostActivity posting limits backstop', () => {
  const integration = {
    id: 'i-r',
    organizationId: 'org-1',
    providerIdentifier: 'reddit',
    internalId: 'u1',
    token: 'token',
  } as any;
  const posts = [
    {
      id: 'p-1',
      parentPostId: null,
      organizationId: 'org-1',
      integrationId: 'i-r',
      content: 'hi',
      settings: '{}',
      image: '[]',
    },
  ] as any;

  const make = (
    problem: string | null,
    postingLimits: any = { perDay: 5, minSpacingMinutes: 10 }
  ) => {
    const provider = {
      editor: 'normal',
      postingLimits,
      postPending: jest.fn().mockResolvedValue([{ id: 'p-1', status: 'pending' }]),
      post: jest.fn(),
    };
    const postsService = {
      providerPublishProblem: jest.fn().mockResolvedValue(null),
      postingLimitProblem: jest.fn().mockResolvedValue(problem),
      recordProviderPublish: jest.fn().mockResolvedValue(undefined),
      updateTags: jest.fn().mockResolvedValue(posts),
      updateMedia: jest.fn().mockResolvedValue([]),
      getPostById: jest.fn().mockResolvedValue({ ...posts[0], integration }),
    };
    const activity = new PostActivity(
      postsService as any,
      {} as any,
      { getSocialIntegration: () => provider } as any,
      { getIntegrationById: jest.fn().mockResolvedValue(integration) } as any,
      {} as any,
      {} as any,
      { client: { getRawClient: () => ({ workflow: { start: jest.fn() } }) } } as any,
      {} as any
    );
    return { activity, provider, postsService };
  };

  it('fails a post over the limits with a terminal error before anything is sent', async () => {
    const message =
      'Reddit allows 5 posts a day per account, at least 10 minutes apart. Next allowed at 2026-11-02 12:06 UTC.';
    const { activity, provider, postsService } = make(message);
    const error = await activity
      .postSocialPending(integration, posts)
      .catch((err) => err);
    expect(postsService.postingLimitProblem).toHaveBeenCalledWith(
      integration,
      posts
    );
    expect(error).toBeInstanceOf(BadBody);
    expect(error.nonRetryable).toBe(true);
    expect(error.message).toBe(message);
    expect(provider.postPending).not.toHaveBeenCalled();
    expect(provider.post).not.toHaveBeenCalled();
  });

  it('publishes within the limits, and skips the check for networks without them', async () => {
    const limited = make(null);
    await limited.activity.postSocialPending(integration, posts);
    expect(limited.provider.postPending).toHaveBeenCalledTimes(1);

    const free = make(null, null);
    await free.activity.postSocialPending(integration, posts);
    expect(free.postsService.postingLimitProblem).not.toHaveBeenCalled();
    expect(free.provider.postPending).toHaveBeenCalledTimes(1);
  });
});

describe('PostActivity monthly cap backstop', () => {
  const integration = {
    id: 'i-x',
    organizationId: 'org-1',
    providerIdentifier: 'x',
    internalId: '42',
    token: 'token',
  } as any;
  const posts = [
    {
      id: 'p-1',
      parentPostId: null,
      organizationId: 'org-1',
      integrationId: 'i-x',
      content: 'hi',
      settings: '{}',
      image: '[]',
    },
  ] as any;

  const make = (problem: string | null) => {
    const provider = {
      editor: 'normal',
      postPending: jest.fn().mockResolvedValue([{ id: 'p-1', status: 'pending' }]),
      post: jest.fn(),
    };
    const postsService = {
      providerPublishProblem: jest.fn().mockResolvedValue(problem),
      recordProviderPublish: jest.fn().mockResolvedValue(undefined),
      updateTags: jest.fn().mockResolvedValue(posts),
      updateMedia: jest.fn().mockResolvedValue([]),
      getPostById: jest.fn().mockResolvedValue({ ...posts[0], integration }),
    };
    const integrationService = {
      getIntegrationById: jest.fn().mockResolvedValue(integration),
    };
    const activity = new PostActivity(
      postsService as any,
      {} as any,
      { getSocialIntegration: () => provider } as any,
      integrationService as any,
      {} as any,
      {} as any,
      { client: { getRawClient: () => ({ workflow: { start: jest.fn() } }) } } as any,
      {} as any
    );
    return { activity, provider, postsService };
  };

  it('publishes under the cap and records what went out', async () => {
    const { activity, provider, postsService } = make(null);
    await activity.postSocialPending(integration, posts);
    expect(provider.postPending).toHaveBeenCalledTimes(1);
    expect(postsService.providerPublishProblem).toHaveBeenCalledWith(
      'org-1',
      'x',
      posts
    );
    expect(postsService.recordProviderPublish).toHaveBeenCalledWith(
      'org-1',
      'x',
      ['p-1']
    );
  });

  it('fails over the cap with a terminal error and never calls the network', async () => {
    const { activity, provider, postsService } = make(
      'Monthly X post limit reached on the Starter plan (30).'
    );
    const error = await activity
      .postSocialPending(integration, posts)
      .catch((err) => err);
    expect(error).toBeInstanceOf(BadBody);
    // a non retryable bad_body: every workflow version marks the post ERROR
    // and notifies, Temporal never retries it
    expect(error.type).toBe('bad_body');
    expect(error.nonRetryable).toBe(true);
    expect(error.message).toBe(
      'Monthly X post limit reached on the Starter plan (30).'
    );
    expect(provider.postPending).not.toHaveBeenCalled();
    expect(provider.post).not.toHaveBeenCalled();
    expect(postsService.recordProviderPublish).not.toHaveBeenCalled();
  });

  it('still returns the published post when recording fails', async () => {
    const { activity, postsService } = make(null);
    postsService.recordProviderPublish.mockRejectedValue(new Error('db down'));
    await expect(
      activity.postSocialPending(integration, posts)
    ).resolves.toEqual([{ id: 'p-1', status: 'pending' }]);
  });
});
