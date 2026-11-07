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
import {
  BadBody,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { TokenEncryptionError } from '@gitroom/nestjs-libraries/database/prisma/integrations/token.encryption';

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

describe('PostActivity refresh failure cause', () => {
  const integration = {
    id: 'i-1',
    organizationId: 'org-1',
    providerIdentifier: 'bluesky',
    token: 'token',
  } as any;

  const make = (thrown: unknown) => {
    const refreshIntegrationService = {
      refresh: jest.fn().mockRejectedValue(thrown),
      setBetweenSteps: jest.fn().mockResolvedValue(undefined),
    };
    const integrationService = {
      getIntegrationById: jest.fn().mockResolvedValue(integration),
    };
    const integrationManager = {
      getSocialIntegration: jest.fn().mockReturnValue({ refreshWait: false }),
    };
    const activity = new PostActivity(
      {} as any,
      {} as any,
      integrationManager as any,
      integrationService as any,
      refreshIntegrationService as any,
      {} as any,
      {} as any,
      {} as any
    );
    return { activity, refreshIntegrationService };
  };

  const causeOf = (r: { setBetweenSteps: jest.Mock }) =>
    r.setBetweenSteps.mock.calls[0]?.[1];

  // whatever lands here is read out in the "connect it again" notification and
  // its email, so only a message the provider gave us may travel with it

  it('passes on the sentence a reConnect failure read', async () => {
    // reConnect is the one thing in the try that fails with a message worth
    // reading, and every implementation throws a plain Error - the one that
    // matters most says reconnecting will NOT help
    const page = make(
      new Error(
        'Your Facebook user has no permission to manage this page. Ask a page admin for full content access, then reconnect the channel'
      )
    );
    await expect(page.activity.refreshToken(integration)).resolves.toBe(false);
    expect(causeOf(page.refreshIntegrationService)).toBe(
      'Your Facebook user has no permission to manage this page. Ask a page admin for full content access, then reconnect the channel'
    );

    const gone = make(new Error('Page not found in your accounts'));
    await expect(gone.activity.refreshToken(integration)).resolves.toBe(false);
    expect(causeOf(gone.refreshIntegrationService)).toBe(
      'Page not found in your accounts'
    );

    // and one that arrives as a provider failure instead
    const { activity, refreshIntegrationService } = make(
      new RefreshToken('bluesky', '{}', {} as any, 'Refresh token has expired')
    );
    await expect(activity.refreshToken(integration)).resolves.toBe(false);
    expect(causeOf(refreshIntegrationService)).toBe('Refresh token has expired');
  });

  it('drops a failure of our own, whatever its message says', async () => {
    // the real shape of a decrypt failure: TokenEncryption catches openssl's
    // own error and rethrows this, and the message names an internal env var
    const encryption = make(
      new TokenEncryptionError(
        'A stored token could not be decrypted: it was tampered with or TOKEN_ENCRYPTION_KEY is not the key it was encrypted with'
      )
    );
    await expect(encryption.activity.refreshToken(integration)).resolves.toBe(
      false
    );
    expect(causeOf(encryption.refreshIntegrationService)).toBe('');

    const typed = make(new TypeError('Cannot read properties of null'));
    await expect(typed.activity.refreshToken(integration)).resolves.toBe(false);
    expect(causeOf(typed.refreshIntegrationService)).toBe('');

    const socket = make(
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    );
    await expect(socket.activity.refreshToken(integration)).resolves.toBe(false);
    expect(causeOf(socket.refreshIntegrationService)).toBe('');
  });

  it('keeps the workflow cause, except the unmapped placeholder', async () => {
    const kept = make(new TypeError('Cannot read properties of null'));
    await expect(
      kept.activity.refreshTokenWithCause(
        integration,
        'Please re-authenticate your YouTube account'
      )
    ).resolves.toBe(false);
    expect(causeOf(kept.refreshIntegrationService)).toBe(
      'Please re-authenticate your YouTube account'
    );

    // lemmy rebuilds its RefreshToken with handleErrors' placeholder when it
    // could not map the response at all
    const unmapped = make(new TypeError('Cannot read properties of null'));
    await expect(
      unmapped.activity.refreshTokenWithCause(integration, 'Unknown Error')
    ).resolves.toBe(false);
    expect(causeOf(unmapped.refreshIntegrationService)).toBe('');
  });
});
