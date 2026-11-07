import { NotFoundException } from '@nestjs/common';
import dayjs from 'dayjs';

// the service pulls in heavy provider / upload modules that are not under test
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({
  MediaService: class {},
}));
jest.mock('@gitroom/helpers/utils/sanitize.post.content', () => ({
  sanitizePostContent: (html: string) => html,
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn() },
}));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator', () => ({
  isSafePublicHttpsUrl: jest.fn(),
}));

import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { YoutubeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';

const safeUrl = isSafePublicHttpsUrl as jest.Mock;

const makeService = (integrationManager: any = {}) => {
  const postRepository = {
    getPost: jest.fn(),
    getPosts: jest.fn(),
    createComment: jest.fn().mockResolvedValue({ id: 'c-1' }),
    updateImages: jest.fn(),
  };
  const mediaService = {
    getOrgMediaById: jest.fn(),
    getMediaById: jest.fn(),
  };
  const service = new PostsService(
    postRepository as any,
    integrationManager,
    {} as any,
    mediaService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  return { service, postRepository, mediaService };
};

describe('PostsService.createPublicComment organization binding', () => {
  const body = { content: 'nice' } as any;

  it('rejects a comment on a post of another organization', async () => {
    const { service, postRepository } = makeService();
    postRepository.getPost.mockResolvedValue({
      id: 'p-1',
      organizationId: 'org-B',
      content: 'x',
      childrenPost: [],
    });

    await expect(
      service.createPublicComment('p-1', body, 'user-1', '1.1.1.1', 'org-A')
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(postRepository.createComment).not.toHaveBeenCalled();
  });

  it('accepts a comment on a post of the caller organization', async () => {
    const { service, postRepository } = makeService();
    postRepository.getPost.mockResolvedValue({
      id: 'p-1',
      organizationId: 'org-A',
      content: 'x',
      childrenPost: [],
    });

    await service.createPublicComment('p-1', body, 'user-1', '1.1.1.1', 'org-A');

    expect(postRepository.createComment).toHaveBeenCalledWith(
      'org-A',
      'user-1',
      'p-1',
      'nice',
      expect.anything()
    );
  });

  it('keeps the public comment flow open to any shared post', async () => {
    const { service, postRepository } = makeService();
    postRepository.getPost.mockResolvedValue({
      id: 'p-1',
      organizationId: 'org-B',
      content: 'x',
      childrenPost: [],
    });

    await service.createPublicComment(
      'p-1',
      { content: 'hi', displayName: 'Guest' } as any,
      null,
      '1.1.1.1'
    );

    expect(postRepository.createComment).toHaveBeenCalledTimes(1);
  });
});

describe('PostsService.updateMedia organization scoping', () => {
  it('resolves media only inside the organization of the post', async () => {
    const { service, mediaService } = makeService();
    mediaService.getOrgMediaById.mockResolvedValue(null);

    const result = await service.updateMedia('post-1', 'org-A', [
      { id: 'foreign-media' },
    ]);

    expect(mediaService.getOrgMediaById).toHaveBeenCalledWith(
      'org-A',
      'foreign-media'
    );
    expect(mediaService.getMediaById).not.toHaveBeenCalled();
    // the foreign media is never attached
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('refreshes an already composed media from the same organization only', async () => {
    const { service, mediaService } = makeService();
    mediaService.getOrgMediaById.mockResolvedValue(null);

    await service.updateMedia('post-1', 'org-A', [
      { id: 'foreign-media', path: '/a.png', name: 'a.png' },
    ]);

    expect(mediaService.getOrgMediaById).toHaveBeenCalledWith(
      'org-A',
      'foreign-media'
    );
    expect(mediaService.getMediaById).not.toHaveBeenCalled();
  });
});

describe('PostsService.getPostsMinified published label', () => {
  const calendarPost = (overrides: Record<string, unknown>) => ({
    id: 'p-1',
    state: 'PUBLISHED',
    image: null,
    settings: JSON.stringify({ content_posting_method: 'UPLOAD' }),
    integration: { providerIdentifier: 'tiktok' },
    ...overrides,
  });
  const integrationManager = {
    getSocialIntegration: (identifier: string) =>
      identifier === 'tiktok'
        ? {
            publishedLabel: (settings: any) =>
              settings.content_posting_method === 'UPLOAD'
                ? 'Sent to TikTok inbox'
                : undefined,
          }
        : {},
  };

  it('labels published posts from the provider and never sends the settings', async () => {
    const { service, postRepository } = makeService(integrationManager);
    postRepository.getPosts.mockResolvedValue([
      calendarPost({ id: 'inbox' }),
      calendarPost({ id: 'queued', state: 'QUEUE' }),
      calendarPost({
        id: 'direct',
        settings: JSON.stringify({ content_posting_method: 'DIRECT_POST' }),
      }),
      calendarPost({ id: 'broken', settings: '{not json' }),
      calendarPost({ id: 'other', integration: { providerIdentifier: 'x' } }),
    ]);

    const { p: posts } = await service.getPostsMinified('org-A', {} as any);

    expect(posts.map((post: any) => [post.i, post.pl])).toEqual([
      ['inbox', 'Sent to TikTok inbox'],
      ['queued', undefined],
      ['direct', undefined],
      ['broken', undefined],
      ['other', undefined],
    ]);
    expect(posts.some((post: any) => 'settings' in post)).toBe(false);
  });
});

describe('PostsService approvals on save', () => {
  const makeApprovalService = (decision: any) => {
    const postRepository = {
      getPostById: jest.fn().mockResolvedValue(null),
      createOrUpdatePost: jest.fn().mockResolvedValue({
        posts: [{ id: 'p-1', state: decision?.hold ? 'DRAFT' : 'QUEUE', content: 'hi' }],
      }),
      holdForReview: jest.fn().mockResolvedValue({ count: 1 }),
      changeState: jest.fn().mockResolvedValue({}),
    };
    const policy = {
      assertAgentGuardrails: jest.fn().mockResolvedValue(undefined),
      decide: jest.fn().mockResolvedValue(decision),
      afterSave: jest
        .fn()
        .mockResolvedValue({ submitted: !!decision?.hold }),
      notifyApprovers: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PostsService(
      postRepository as any,
      { getSocialIntegration: () => undefined } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      policy as any,
      { recordPublished: jest.fn() } as any,
      { getProviderPostsLimits: jest.fn().mockResolvedValue(null) } as any
    );
    jest.spyOn(service, 'startWorkflow').mockResolvedValue(undefined);
    jest.spyOn(service, 'detachStaleAnchors').mockResolvedValue(undefined as any);
    return { service, postRepository, policy };
  };

  const body = (type: 'schedule' | 'draft' | 'now' = 'schedule') =>
    ({
      type,
      date: '2026-11-02T10:00:00',
      shortLink: false,
      tags: [],
      posts: [
        {
          integration: { id: 'i-1', name: 'Brand X' },
          group: 'g',
          settings: { __type: 'linkedin' },
          value: [{ id: 'v-1', content: 'hi', image: [] }],
        },
      ],
    } as any);

  const agent = { type: 'agent' as const, source: 'Claude (MCP)' };

  it('checks the agent guardrails before saving anything', async () => {
    const { service, postRepository, policy } = makeApprovalService({ hold: false });
    policy.assertAgentGuardrails.mockRejectedValue(new Error('blocked'));
    await expect(
      service.createPost('org-1', body(), 'MCP', false, agent)
    ).rejects.toThrow('blocked');
    expect(policy.assertAgentGuardrails).toHaveBeenCalledWith('org-1', agent, ['i-1'], {
      countsTowardLimit: true,
    });
    expect(postRepository.createOrUpdatePost).not.toHaveBeenCalled();
  });

  it('saves a held post as a draft in review, marked with its agent', async () => {
    const decision = { hold: true, approvalStatus: 'IN_REVIEW' };
    const { service, postRepository, policy } = makeApprovalService(decision);
    const output = await service.createPost('org-1', body('now'), 'MCP', false, agent);

    const call = postRepository.createOrUpdatePost.mock.calls[0];
    expect(call[0]).toBe('draft');
    expect(call[1]).toBe('org-1');
    expect(call[call.length - 1]).toEqual({
      approvalStatus: 'IN_REVIEW',
      agentSource: 'Claude (MCP)',
    });
    // a draft never starts publishing, startWorkflow only stops old runs
    expect(service.startWorkflow).toHaveBeenCalledWith('linkedin', 'p-1', 'org-1', 'DRAFT');
    expect(policy.afterSave).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ id: 'p-1' }),
      agent,
      { created: true, decision, notify: false }
    );
    // approvers hear about the whole save once
    expect(policy.notifyApprovers).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ id: 'p-1' }),
      'Claude (MCP)',
      1
    );
    expect(output[0]).toMatchObject({ postId: 'p-1', approvalStatus: 'IN_REVIEW' });
  });

  it('schedules a public API post that is not held, keeping its source and the guardrails', async () => {
    const apiAgent = { type: 'agent' as const, source: 'Public API key', viaApi: true };
    const { service, postRepository, policy } = makeApprovalService({ hold: false });
    await service.createPost('org-1', body(), 'API', false, apiAgent);
    expect(policy.assertAgentGuardrails).toHaveBeenCalledWith('org-1', apiAgent, ['i-1'], {
      countsTowardLimit: true,
    });
    const call = postRepository.createOrUpdatePost.mock.calls[0];
    expect(call[0]).toBe('schedule');
    expect(call[call.length - 1]).toEqual({
      approvalStatus: undefined,
      agentSource: 'Public API key',
    });
  });

  it('keeps the old behaviour when nobody is passed (auto post, internal callers)', async () => {
    const { service, postRepository, policy } = makeApprovalService(undefined);
    await service.createPost('org-1', body(), 'AUTOPOST');
    expect(policy.decide).not.toHaveBeenCalled();
    expect(policy.assertAgentGuardrails).not.toHaveBeenCalled();
    const call = postRepository.createOrUpdatePost.mock.calls[0];
    expect(call[0]).toBe('schedule');
    expect(call[call.length - 1]).toEqual({
      approvalStatus: undefined,
      agentSource: undefined,
    });
  });

  it('an agent update must point at an existing post', async () => {
    const { service, postRepository } = makeApprovalService({ hold: false });
    await expect(
      service.createPost('org-1', body('update' as any), 'API', false, agent)
    ).rejects.toThrow('This post was not found');
    expect(postRepository.createOrUpdatePost).not.toHaveBeenCalled();
  });

  it('an agent update held for review stops the waiting workflow', async () => {
    const decision = { hold: true, approvalStatus: 'IN_REVIEW', previous: 'APPROVED' };
    const { service, postRepository } = makeApprovalService(decision);
    postRepository.getPostById.mockResolvedValue({
      id: 'v-1',
      state: 'QUEUE',
      approvalStatus: 'APPROVED',
    });
    await service.createPost('org-1', body('update' as any), 'API', true, agent);
    expect(postRepository.createOrUpdatePost.mock.calls[0][0]).toBe('draft');
    expect(service.startWorkflow).toHaveBeenCalledWith('linkedin', 'p-1', 'org-1', 'DRAFT');
  });

  it('an agent cannot hold a post that is already published', async () => {
    const decision = { hold: true, approvalStatus: 'IN_REVIEW' };
    const { service, postRepository } = makeApprovalService(decision);
    postRepository.getPostById.mockResolvedValue({
      id: 'p-1',
      group: 'g-1',
      state: 'PUBLISHED',
      approvalStatus: 'NONE',
      integrationId: 'i-1',
      integration: { providerIdentifier: 'x' },
    });
    await expect(
      service.changePostStatus('org-1', 'p-1', 'schedule', agent)
    ).rejects.toThrow('already published');
    expect(postRepository.holdForReview).not.toHaveBeenCalled();
  });

  it('an agent scheduling a draft through the API puts it in review instead', async () => {
    const decision = { hold: true, approvalStatus: 'IN_REVIEW', previous: 'NONE' };
    const { service, postRepository, policy } = makeApprovalService(decision);
    postRepository.getPostById.mockResolvedValue({
      id: 'p-1',
      group: 'g-1',
      state: 'DRAFT',
      approvalStatus: 'NONE',
      content: 'hi',
      integration: { name: 'Brand X', providerIdentifier: 'x' },
    });
    const result = await service.changePostStatus('org-1', 'p-1', 'schedule', agent);
    expect(postRepository.holdForReview).toHaveBeenCalledWith('org-1', 'g-1');
    expect(postRepository.changeState).not.toHaveBeenCalled();
    expect(policy.afterSave).toHaveBeenCalled();
    expect(result).toMatchObject({ state: 'DRAFT', approvalStatus: 'IN_REVIEW' });
  });
});

describe('PostsService monthly cap on one network', () => {
  // a subscription started on the 1st, so the plan month is the calendar month
  const anchor = dayjs().startOf('month').subtract(3, 'month').toDate();
  const monthStart = dayjs().startOf('month').toDate();
  const nextMonth = dayjs(monthStart).add(1, 'month');

  const makeLimitService = (
    limits: Record<string, number> | null = { x: 30 },
    usage = 0,
    queued = 0,
    stored: any[] = []
  ) => {
    const postRepository = {
      countProviderUsage: jest.fn().mockResolvedValue(usage),
      countQueuedProviderPosts: jest.fn().mockResolvedValue(queued),
      getPostsState: jest.fn().mockResolvedValue(stored),
      recordProviderUsage: jest.fn().mockResolvedValue({ count: 1 }),
      getPostById: jest.fn(),
      changeDate: jest.fn().mockResolvedValue({}),
      changeState: jest.fn().mockResolvedValue({}),
    };
    const subscriptionService = {
      getProviderPostsLimits: jest
        .fn()
        .mockResolvedValue(limits ? { plan: 'Starter', limits, anchor } : null),
    };
    // the live trial status, asked only when the trial cap alone refuses
    const paymentService = { isTrialing: jest.fn().mockResolvedValue(false) };
    const integrationService = {
      getIntegrationsList: jest.fn().mockResolvedValue([
        { id: 'i-x', providerIdentifier: 'x' },
        { id: 'i-own', providerIdentifier: 'x-own-key' },
        { id: 'i-li', providerIdentifier: 'linkedin' },
      ]),
    };
    const integrationManager = {
      getSocialIntegration: (identifier: string) =>
        identifier === 'x'
          ? {
              name: 'X',
              planLimitHint: 'Or bring your own key.',
              planRepeatHint: 'Repeats on X need your own key.',
            }
          : undefined,
    };
    const service = new PostsService(
      postRepository as any,
      integrationManager as any,
      integrationService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      subscriptionService as any,
      paymentService as any
    );
    jest.spyOn(service, 'startWorkflow').mockResolvedValue(undefined);
    return { service, postRepository, subscriptionService, paymentService };
  };

  const post = (integration: string, values: number, ids = false) => ({
    integration: { id: integration },
    // the client can claim any network, the channel's own one is counted
    settings: { __type: 'linkedin' },
    value: [...new Array(values)].map((_, i) => ({
      ...(ids ? { id: `${integration}-${i}` } : {}),
      content: 'hi',
    })),
  });

  const queuedRow = (id: string, publishDate = new Date()) => ({
    id,
    state: 'QUEUE',
    publishDate,
    deletedAt: null,
  });

  describe('when a post is saved', () => {
    it('lets a post through while the month has room', async () => {
      const { service, postRepository } = makeLimitService({ x: 30 }, 20, 7);
      await service.checkProviderPostsLimit('org-1', {
        type: 'schedule',
        posts: [post('i-x', 3)],
      });
      expect(postRepository.countProviderUsage).toHaveBeenCalledWith(
        'org-1',
        'x',
        monthStart,
        nextMonth.toDate()
      );
      expect(postRepository.countQueuedProviderPosts).toHaveBeenCalledWith(
        'org-1',
        'x',
        monthStart,
        nextMonth.toDate(),
        []
      );
    });

    it('counts published and queued posts and every post of a thread', async () => {
      const { service } = makeLimitService({ x: 30 }, 20, 8);
      await expect(
        service.checkProviderPostsLimit('org-1', {
          type: 'schedule',
          posts: [post('i-x', 3)],
        })
      ).rejects.toMatchObject({
        status: 402,
        message:
          'Only 2 of your 30 X posts for this month on the Starter plan are left, and this needs 3 (every post of a thread counts). Or bring your own key.',
      });
    });

    it('says the month is used up when nothing is left', async () => {
      const { service } = makeLimitService({ x: 30 }, 30);
      await expect(
        service.checkProviderPostsLimit('org-1', {
          type: 'now',
          posts: [post('i-x', 1)],
        })
      ).rejects.toMatchObject({
        message:
          "You've used your 30 X posts for this month on the Starter plan. Or bring your own key.",
      });
    });

    it('adds up the channels of the same network in one save', async () => {
      const { service, postRepository } = makeLimitService({ x: 30 }, 28);
      await expect(
        service.checkProviderPostsLimit('org-1', {
          type: 'schedule',
          posts: [post('i-x', 1), post('i-x', 2)],
        })
      ).rejects.toMatchObject({ status: 402 });
      expect(postRepository.countProviderUsage).toHaveBeenCalledTimes(1);
    });

    it('counts a passed date in the current plan month', async () => {
      const { service, postRepository } = makeLimitService({ x: 30 }, 0);
      await service.checkProviderPostsLimit('org-1', {
        type: 'schedule',
        date: dayjs(anchor).subtract(1, 'year').format('YYYY-MM-DDTHH:mm:ss'),
        posts: [post('i-x', 1)],
      });
      expect(postRepository.countProviderUsage).toHaveBeenCalledWith(
        'org-1',
        'x',
        monthStart,
        nextMonth.toDate()
      );
    });

    it('counts a post in the plan month it publishes in', async () => {
      const { service, postRepository } = makeLimitService({ x: 30 }, 0, 30);
      await expect(
        service.checkProviderPostsLimit('org-1', {
          type: 'schedule',
          date: nextMonth.add(3, 'day').format('YYYY-MM-DDTHH:mm:ss'),
          posts: [post('i-x', 1)],
        })
      ).rejects.toMatchObject({
        message: `You've used your 30 X posts for the plan month starting ${nextMonth.format(
          'MMMM D'
        )} on the Starter plan. Or bring your own key.`,
      });
      expect(postRepository.countQueuedProviderPosts).toHaveBeenCalledWith(
        'org-1',
        'x',
        nextMonth.toDate(),
        nextMonth.add(1, 'month').toDate(),
        []
      );
    });

    it('does not count a queued post saved again in the same month twice', async () => {
      const { service, postRepository } = makeLimitService({ x: 30 }, 30, 0, [
        queuedRow('i-x-0'),
      ]);
      await service.checkProviderPostsLimit('org-1', {
        type: 'schedule',
        posts: [post('i-x', 1, true)],
      });
      expect(postRepository.countProviderUsage).not.toHaveBeenCalled();
    });

    it('counts a republished post again', async () => {
      const published = {
        id: 'i-x-0',
        state: 'PUBLISHED',
        publishDate: new Date(),
        deletedAt: null,
      };
      const full = makeLimitService({ x: 30 }, 30, 0, [published]);
      await expect(
        full.service.checkProviderPostsLimit('org-1', {
          type: 'schedule',
          posts: [post('i-x', 1, true)],
        })
      ).rejects.toMatchObject({ status: 402 });

      const room = makeLimitService({ x: 30 }, 29, 0, [published]);
      await room.service.checkProviderPostsLimit('org-1', {
        type: 'schedule',
        posts: [post('i-x', 1, true)],
      });
    });

    it('does not cap networks the plan does not list, nor the own key variant', async () => {
      const { service, postRepository } = makeLimitService({ x: 0 }, 0);
      await service.checkProviderPostsLimit('org-1', {
        type: 'schedule',
        inter: 7,
        posts: [post('i-own', 5), post('i-li', 5)],
      });
      expect(postRepository.countProviderUsage).not.toHaveBeenCalled();
    });

    it('takes nothing for a draft', async () => {
      const { service, postRepository } = makeLimitService({ x: 0 });
      await service.checkProviderPostsLimit('org-1', {
        type: 'draft',
        posts: [post('i-x', 1)],
      });
      expect(postRepository.countProviderUsage).not.toHaveBeenCalled();
    });

    it('counts the new entries an in-place update queues', async () => {
      const { service } = makeLimitService({ x: 30 }, 30, 0, [
        queuedRow('kept'),
      ]);
      await expect(
        service.checkProviderPostsLimit('org-1', {
          type: 'update',
          posts: [
            {
              integration: { id: 'i-x' },
              value: [{ id: 'kept' }, {}],
            },
          ],
        })
      ).rejects.toMatchObject({ status: 402 });
    });

    it('lets an in-place update of queued posts through at the cap', async () => {
      const { service, postRepository } = makeLimitService({ x: 30 }, 30, 0, [
        queuedRow('kept'),
      ]);
      await service.checkProviderPostsLimit('org-1', {
        type: 'update',
        posts: [{ integration: { id: 'i-x' }, value: [{ id: 'kept' }] }],
      });
      expect(postRepository.countProviderUsage).not.toHaveBeenCalled();
    });

    it('recounts an in-place update that moves to another plan month', async () => {
      const { service } = makeLimitService({ x: 30 }, 0, 30, [
        queuedRow('kept'),
      ]);
      await expect(
        service.checkProviderPostsLimit('org-1', {
          type: 'update',
          date: nextMonth.add(1, 'day').format('YYYY-MM-DDTHH:mm:ss'),
          posts: [{ integration: { id: 'i-x' }, value: [{ id: 'kept' }] }],
        })
      ).rejects.toMatchObject({ status: 402 });
    });

    it('caps nothing without billing', async () => {
      const { service, postRepository } = makeLimitService(null);
      await service.checkProviderPostsLimit('org-1', {
        type: 'schedule',
        inter: 1,
        posts: [post('i-x', 100)],
      });
      expect(postRepository.countProviderUsage).not.toHaveBeenCalled();
    });

    it('falls back to a plain upgrade message for a network without a hint', async () => {
      const { service } = makeLimitService({ linkedin: 1 }, 1);
      await expect(
        service.checkProviderPostsLimit('org-1', {
          type: 'schedule',
          posts: [post('i-li', 1)],
        })
      ).rejects.toMatchObject({
        message:
          "You've used your 1 linkedin posts for this month on the Starter plan. Upgrade your plan to post more.",
      });
    });
  });

  describe('a passed date on a capped network', () => {
    const save = async (
      integration: string,
      type: 'schedule' | 'update' = 'schedule',
      stored: any[] = [],
      value: any = post(integration, 1)
    ) => {
      const { service, postRepository } = makeLimitService(
        { x: 30 },
        0,
        0,
        stored
      );
      (postRepository as any).createOrUpdatePost = jest
        .fn()
        .mockResolvedValue({ posts: [{ id: 'p-1', state: 'QUEUE' }] });
      jest
        .spyOn(service, 'detachStaleAnchors')
        .mockResolvedValue(undefined as any);
      await service.createPost(
        'org-1',
        {
          type,
          date: '2020-01-01T10:00:00',
          shortLink: false,
          tags: [],
          posts: [value],
        } as any,
        'API'
      );
      return (postRepository as any).createOrUpdatePost.mock.calls[0][2];
    };

    it('is stored as now, the plan month it was counted in', async () => {
      expect(dayjs(await save('i-x')).isAfter(dayjs().subtract(1, 'minute'))).toBe(
        true
      );
    });

    it('stays as it is on other networks', async () => {
      expect(await save('i-li')).toBe('2020-01-01T10:00:00');
    });

    it('keeps the date of a published X post when its text is edited', async () => {
      const published = {
        id: 'i-x-0',
        state: 'PUBLISHED',
        publishDate: new Date('2020-01-01T10:00:00'),
        deletedAt: null,
      };
      expect(
        await save('i-x', 'update', [published], post('i-x', 1, true))
      ).toBe('2020-01-01T10:00:00');
    });

    it('still counts a new entry an update adds with a passed date', async () => {
      const { service, postRepository } = makeLimitService({ x: 30 }, 30, 0, [
        {
          id: 'i-x-0',
          state: 'PUBLISHED',
          publishDate: new Date('2020-01-01T10:00:00'),
          deletedAt: null,
        },
      ]);
      await expect(
        service.checkProviderPostsLimit('org-1', {
          type: 'update',
          date: '2020-01-01T10:00:00',
          posts: [{ integration: { id: 'i-x' }, value: [{ id: 'i-x-0' }, {}] }],
        })
      ).rejects.toMatchObject({ status: 402 });
      // counted in the current plan month, not the passed one
      expect(postRepository.countProviderUsage).toHaveBeenCalledWith(
        'org-1',
        'x',
        monthStart,
        nextMonth.toDate()
      );
    });
  });

  describe('repeating and evergreen posts', () => {
    it('are refused on a capped network, even as a draft', async () => {
      for (const type of ['schedule', 'draft'] as const) {
        const { service } = makeLimitService({ x: 30 });
        await expect(
          service.checkProviderPostsLimit('org-1', {
            type,
            inter: 7,
            posts: [post('i-x', 1)],
          })
        ).rejects.toMatchObject({
          status: 400,
          message: 'Repeats on X need your own key.',
        });
      }
    });

    it('stay available with the own key variant', async () => {
      const { service } = makeLimitService({ x: 30 });
      await service.checkRepeatAllowed('org-1', ['i-own']);
      await expect(
        service.checkRepeatAllowed('org-1', ['i-own', 'i-x'])
      ).rejects.toMatchObject({ status: 400 });
    });

    it('are refused when a stored repeating post is queued again', async () => {
      const { service } = makeLimitService({ x: 30 });
      jest
        .spyOn(service, 'getPostsRecursively')
        .mockResolvedValue([
          { id: 'p-1', integrationId: 'i-x', publishDate: new Date(), intervalInDays: 1 },
        ] as any);
      await expect(
        service.checkStoredPostLimit('org-1', 'p-1')
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('when a stored post is queued again', () => {
    const thread = (state: string, publishDate = new Date()) => [
      { id: 'p-1', integrationId: 'i-x', publishDate, intervalInDays: null, state },
      { id: 'p-2', integrationId: 'i-x', publishDate, intervalInDays: null, state },
    ];

    it('checks every post of its thread', async () => {
      const { service, postRepository } = makeLimitService({ x: 30 }, 29);
      jest
        .spyOn(service, 'getPostsRecursively')
        .mockResolvedValue(thread('DRAFT') as any);
      await expect(
        service.checkStoredPostLimit('org-1', 'p-1')
      ).rejects.toMatchObject({ status: 402 });
      expect(postRepository.countQueuedProviderPosts).toHaveBeenCalledWith(
        'org-1',
        'x',
        expect.any(Date),
        expect.any(Date),
        ['p-1', 'p-2']
      );
    });

    it('checks a published post scheduled again through the API', async () => {
      const { service, postRepository } = makeLimitService({ x: 30 }, 30, 0, [
        { id: 'p-1', state: 'PUBLISHED', publishDate: new Date(), deletedAt: null },
      ]);
      postRepository.getPostById.mockResolvedValue({
        id: 'p-1',
        state: 'PUBLISHED',
        integrationId: 'i-x',
        integration: { providerIdentifier: 'x' },
      });
      jest
        .spyOn(service, 'getPostsRecursively')
        .mockResolvedValue([thread('PUBLISHED')[0]] as any);
      await expect(
        service.changePostStatus('org-1', 'p-1', 'schedule')
      ).rejects.toMatchObject({ status: 402 });
      expect(postRepository.changeState).not.toHaveBeenCalled();
    });

    it('checks a reschedule that moves to a full plan month', async () => {
      const { service, postRepository } = makeLimitService({ x: 30 }, 0, 30, [
        queuedRow('p-1'),
      ]);
      postRepository.getPostById.mockResolvedValue({
        id: 'p-1',
        state: 'QUEUE',
        integration: { providerIdentifier: 'x' },
      });
      jest
        .spyOn(service, 'getPostsRecursively')
        .mockResolvedValue([thread('QUEUE')[0]] as any);
      await expect(
        service.changeDate(
          'org-1',
          'p-1',
          nextMonth.add(2, 'day').format('YYYY-MM-DDTHH:mm:ss'),
          'update'
        )
      ).rejects.toMatchObject({ status: 402 });
      expect(postRepository.changeDate).not.toHaveBeenCalled();
    });

    it('lets a queued post move inside its plan month at the cap', async () => {
      const { service, postRepository } = makeLimitService({ x: 30 }, 30, 0, [
        queuedRow('p-1'),
      ]);
      postRepository.getPostById.mockResolvedValue({
        id: 'p-1',
        state: 'QUEUE',
        integration: { providerIdentifier: 'x' },
      });
      jest
        .spyOn(service, 'getPostsRecursively')
        .mockResolvedValue([thread('QUEUE')[0]] as any);
      const later = dayjs().add(1, 'minute');
      const date = (later.isBefore(nextMonth) ? later : dayjs())
        .format('YYYY-MM-DDTHH:mm:ss');
      await service.changeDate('org-1', 'p-1', date, 'update');
      expect(postRepository.changeDate).toHaveBeenCalled();
    });

    it('checks a published post rescheduled with republish, stored at now for a passed date', async () => {
      const full = makeLimitService({ x: 30 }, 30, 0, []);
      full.postRepository.getPostById.mockResolvedValue({
        id: 'p-1',
        state: 'PUBLISHED',
        integration: { providerIdentifier: 'x' },
      });
      jest
        .spyOn(full.service, 'getPostsRecursively')
        .mockResolvedValue([thread('PUBLISHED')[0]] as any);
      await expect(
        full.service.changeDate('org-1', 'p-1', '2020-01-01T10:00:00', 'schedule', true)
      ).rejects.toMatchObject({ status: 402 });

      const room = makeLimitService({ x: 30 }, 0, 0, []);
      room.postRepository.getPostById.mockResolvedValue({
        id: 'p-1',
        state: 'PUBLISHED',
        integration: { providerIdentifier: 'x' },
      });
      jest
        .spyOn(room.service, 'getPostsRecursively')
        .mockResolvedValue([thread('PUBLISHED')[0]] as any);
      await room.service.changeDate(
        'org-1',
        'p-1',
        '2020-01-01T10:00:00',
        'schedule',
        true
      );
      const stored = room.postRepository.changeDate.mock.calls[0][2];
      expect(dayjs(stored).isAfter(dayjs().subtract(1, 'minute'))).toBe(true);
    });

    it('does not check a draft that only moves', async () => {
      const { service, postRepository } = makeLimitService({ x: 0 });
      postRepository.getPostById.mockResolvedValue({
        id: 'p-1',
        state: 'DRAFT',
        integration: { providerIdentifier: 'x' },
      });
      const spy = jest.spyOn(service, 'checkStoredPostLimit');
      await service.changeDate('org-1', 'p-1', '2030-01-01T10:00:00', 'schedule');
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // An Ultimate subscription marked isTrailing: a real trial, or a paid one
  // whose renewal Stripe is retrying (past_due), which keeps the plan's cap
  describe('a trial', () => {
    const trialPlan = (service: any, subscriptionService: any) => {
      subscriptionService.getProviderPostsLimits.mockResolvedValue({
        plan: 'Ultimate',
        limits: { x: 1000 },
        trialLimits: { x: 30 },
        anchor,
      });
      jest
        .spyOn(service, 'getPostsRecursively')
        .mockResolvedValue([{ id: 'p-1' }] as any);
    };
    const trialMessage =
      'A free trial posts here as much as the Starter plan. Add a card, then end your trial on the Billing page to get your plan\'s full limit.';

    it('holds a trialing subscription to the Starter cap when scheduling', async () => {
      const { service, subscriptionService, paymentService } =
        makeLimitService({ x: 1000 }, 30, 0);
      trialPlan(service, subscriptionService);
      paymentService.isTrialing.mockResolvedValue(true);
      await expect(
        service.checkProviderPostsLimit('org-1', {
          type: 'schedule',
          posts: [post('i-x', 1)],
        })
      ).rejects.toMatchObject({
        status: 402,
        message: `You've used your 30 X posts for this month on the Ultimate trial. ${trialMessage}`,
      });
      expect(paymentService.isTrialing).toHaveBeenCalledWith('org-1');
    });

    it('holds a trialing subscription to the Starter cap when publishing', async () => {
      const { service, subscriptionService, paymentService } =
        makeLimitService({ x: 1000 }, 30);
      trialPlan(service, subscriptionService);
      paymentService.isTrialing.mockResolvedValue(true);
      expect(
        await service.providerPublishProblem('org-1', 'x', [
          { id: 'p-1', parentPostId: null },
        ])
      ).toBe(
        `Monthly X post limit reached on the Ultimate trial (30). ${trialMessage}`
      );
    });

    it.each([
      ['past_due, its renewal being retried', false],
      ['active', false],
    ])(
      'keeps the plan cap of a subscription that is %s',
      async (_, trialing) => {
        const { service, subscriptionService, paymentService } =
          makeLimitService({ x: 1000 }, 30, 0);
        trialPlan(service, subscriptionService);
        paymentService.isTrialing.mockResolvedValue(trialing);
        await expect(
          service.checkProviderPostsLimit('org-1', {
            type: 'schedule',
            posts: [post('i-x', 1)],
          })
        ).resolves.toEqual(new Set(['i-x']));
        expect(
          await service.providerPublishProblem('org-1', 'x', [
            { id: 'p-1', parentPostId: null },
          ])
        ).toBeNull();
      }
    );

    it('never asks Stripe while the trial cap has room or the plan cap refuses anyway', async () => {
      const { service, subscriptionService, paymentService } =
        makeLimitService({ x: 1000 }, 10);
      trialPlan(service, subscriptionService);
      expect(
        await service.providerPublishProblem('org-1', 'x', [
          { id: 'p-1', parentPostId: null },
        ])
      ).toBeNull();

      const full = makeLimitService({ x: 1000 }, 1000);
      trialPlan(full.service, full.subscriptionService);
      expect(
        await full.service.providerPublishProblem('org-1', 'x', [
          { id: 'p-1', parentPostId: null },
        ])
      ).toBe(
        'Monthly X post limit reached on the Ultimate plan (1000). Or bring your own key.'
      );
      expect(paymentService.isTrialing).not.toHaveBeenCalled();
      expect(full.paymentService.isTrialing).not.toHaveBeenCalled();
    });
  });

  describe('when a post goes out', () => {
    it('lets it publish while the month has room for its thread', async () => {
      const { service, postRepository } = makeLimitService({ x: 30 }, 28);
      jest
        .spyOn(service, 'getPostsRecursively')
        .mockResolvedValue([{ id: 'p-1' }, { id: 'p-2' }] as any);
      expect(
        await service.providerPublishProblem('org-1', 'x', [
          { id: 'p-1', parentPostId: null },
        ])
      ).toBeNull();
      expect(postRepository.countProviderUsage).toHaveBeenCalledWith(
        'org-1',
        'x',
        monthStart,
        nextMonth.toDate()
      );
    });

    it('stops it when the published posts leave no room for its thread', async () => {
      const { service } = makeLimitService({ x: 30 }, 29);
      jest
        .spyOn(service, 'getPostsRecursively')
        .mockResolvedValue([{ id: 'p-1' }, { id: 'p-2' }] as any);
      expect(
        await service.providerPublishProblem('org-1', 'x', [
          { id: 'p-1', parentPostId: null },
        ])
      ).toBe(
        'Monthly X post limit reached on the Starter plan (30). Or bring your own key.'
      );
    });

    it('never looks at the plan for a network no plan caps', async () => {
      const { service, subscriptionService } = makeLimitService({ x: 0 });
      expect(
        await service.providerPublishProblem('org-1', 'x-own-key', [
          { id: 'p-1' },
        ])
      ).toBeNull();
      expect(subscriptionService.getProviderPostsLimits).not.toHaveBeenCalled();
    });

    it('records what went out on a capped network only', async () => {
      const { service, postRepository } = makeLimitService();
      await service.recordProviderPublish('org-1', 'x', ['p-1', 'p-2']);
      await service.recordProviderPublish('org-1', 'x-own-key', ['p-3']);
      expect(postRepository.recordProviderUsage).toHaveBeenCalledTimes(1);
      expect(postRepository.recordProviderUsage).toHaveBeenCalledWith(
        'org-1',
        'x',
        ['p-1', 'p-2']
      );
    });
  });
});

describe('PostsService.validatePosts post date context', () => {
  const makeValidationService = () => {
    const integrationService = {
      getIntegrationById: jest.fn().mockResolvedValue({
        id: 'yt-1',
        name: 'Channel',
        providerIdentifier: 'youtube',
        additionalSettings: '[]',
      }),
    };
    const service = new PostsService(
      {} as any,
      {
        // the real settings DTO, the provider media rules are not under test
        getSocialIntegration: () => ({
          dto: YoutubeSettingsDto,
          checkValidity: async () => true,
          maxLength: () => 5000,
        }),
      } as any,
      integrationService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    return { service, integrationService };
  };

  const postDate = dayjs.utc().add(2, 'day');
  const youtubePost = (settings: Record<string, any>, extra = {}) => ({
    integration: { id: 'yt-1' },
    value: [{ content: 'Description', image: [] }],
    settings: { title: 'My video', type: 'public', ...settings },
    ...extra,
  });

  it('checks publishAt against the request date', async () => {
    const { service } = makeValidationService();
    const [result] = await service.validatePosts(
      'org-1',
      [youtubePost({ publishAt: postDate.subtract(1, 'hour').format() })],
      'schedule',
      false,
      postDate.format('YYYY-MM-DDTHH:mm:ss')
    );
    expect(result.valid).toBe(false);
    expect(result.settingsError).toContain('after the post is published');
  });

  it('prefers the date of the channel over the request date', async () => {
    const { service } = makeValidationService();
    const [result] = await service.validatePosts(
      'org-1',
      [
        youtubePost(
          { publishAt: postDate.add(1, 'hour').format() },
          { date: postDate.add(3, 'hour').format('YYYY-MM-DDTHH:mm:ss') }
        ),
      ],
      'schedule',
      false,
      postDate.format('YYYY-MM-DDTHH:mm:ss')
    );
    expect(result.valid).toBe(false);
  });

  it('never trusts a date sent inside the settings', async () => {
    const { service } = makeValidationService();
    const [result] = await service.validatePosts(
      'org-1',
      [
        youtubePost({
          publishAt: postDate.subtract(1, 'hour').format(),
          __validationDate: dayjs.utc().format('YYYY-MM-DDTHH:mm:ss'),
        }),
      ],
      'schedule',
      false,
      postDate.format('YYYY-MM-DDTHH:mm:ss')
    );
    expect(result.valid).toBe(false);
  });

  it('accepts a later YouTube time and settings without it, as before', async () => {
    const { service } = makeValidationService();
    const results = await service.validatePosts(
      'org-1',
      [youtubePost({ publishAt: postDate.add(1, 'hour').format() }), youtubePost({})],
      'schedule',
      false,
      postDate.format('YYYY-MM-DDTHH:mm:ss')
    );
    expect(results.map((r) => r.valid)).toEqual([true, true]);
  });

  it('flags a turned off channel so API and MCP can refuse it', async () => {
    const { service, integrationService } = makeValidationService();
    integrationService.getIntegrationById.mockResolvedValue({
      id: 'yt-1',
      name: 'Channel',
      providerIdentifier: 'youtube',
      additionalSettings: '[]',
      disabled: true,
    });
    const [result] = await service.validatePosts(
      'org-1',
      [youtubePost({})],
      'draft'
    );
    expect(result.disabled).toBe(true);
  });
});

describe('PostsService.validatePosts text for the provider rules', () => {
  it('hands checkValidity each entry as the provider receives it', async () => {
    const checkValidity = jest.fn(async () => 'too long' as const);
    const service = new PostsService(
      {} as any,
      {
        getSocialIntegration: () => ({
          editor: 'html',
          checkValidity,
          maxLength: () => 4096,
        }),
      } as any,
      {
        getIntegrationById: jest.fn().mockResolvedValue({
          id: 'tg-1',
          name: 'Channel',
          providerIdentifier: 'telegram',
          additionalSettings: '[]',
        }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    const [result] = await service.validatePosts('org-1', [
      {
        integration: { id: 'tg-1' },
        value: [
          { content: '<p dir="auto">One &amp; two</p>', image: [{ path: 'a.png' }] },
          { content: 'plain reply', image: [] },
        ],
        settings: {},
      },
    ]);

    expect(result.errors).toBe('too long');
    expect(checkValidity).toHaveBeenCalledWith(
      [[{ path: 'a.png' }], []],
      { __type: 'telegram' },
      [],
      ['<p dir="auto">One & two</p>', 'plain reply']
    );
  });
});

// A network's posting rules for one connected account (postingLimits), like
// Reddit's 5 posts a day, at least 10 minutes apart
describe('PostsService posting limits', () => {
  const now = new Date('2026-11-02T12:00:00.000Z');
  const minutes = (n: number) => new Date(now.getTime() + n * 60 * 1000);
  const reddit = {
    identifier: 'reddit',
    name: 'Reddit',
    postingLimits: { perDay: 5, minSpacingMinutes: 10 },
  };
  const account = { providerIdentifier: 'reddit', internalId: 'u1' };

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(now);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const make = (dates: Date[] = [], stored: any[] = []) => {
    const postRepository = {
      getAccountPostingDates: jest.fn().mockResolvedValue(dates),
      getPostsState: jest.fn().mockResolvedValue(stored),
      getPostById: jest.fn().mockResolvedValue({
        id: 'p-1',
        parentPostId: null,
        publishDate: minutes(60),
        integration: { id: 'i-r', ...account },
      }),
    };
    const integrationService = {
      getIntegrationById: jest.fn().mockResolvedValue({
        id: 'i-r',
        ...account,
      }),
    };
    const integrationManager = {
      getSocialIntegration: (identifier: string) =>
        identifier === 'reddit' ? reddit : { identifier, name: identifier },
    };
    const service = new PostsService(
      postRepository as any,
      integrationManager as any,
      integrationService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    return { service, postRepository, integrationService };
  };

  describe('when a post goes out', () => {
    it('lets it publish when the account has room', async () => {
      const { service, postRepository } = make([minutes(-60), minutes(-30)]);
      expect(
        await service.postingLimitProblem(account, [{ id: 'p-1' }])
      ).toBeNull();
      // the account's published posts only, around now (with 30 seconds of
      // slack), not this post
      expect(postRepository.getAccountPostingDates).toHaveBeenCalledWith(
        'reddit',
        'u1',
        minutes(-24 * 60 + 0.5),
        minutes(24 * 60 + 0.5),
        false,
        ['p-1']
      );
    });

    it('lets a post go out a few seconds before its 10 minutes are up', async () => {
      const { service } = make([minutes(-9.75)]);
      expect(
        await service.postingLimitProblem(account, [{ id: 'p-1' }])
      ).toBeNull();
    });

    it('refuses a post less than 10 minutes after the last one', async () => {
      const { service } = make([minutes(-4)]);
      expect(await service.postingLimitProblem(account, [{ id: 'p-1' }])).toBe(
        'Reddit allows 5 posts a day per account, at least 10 minutes apart. Next allowed at 2026-11-02 12:06 UTC.'
      );
    });

    it('refuses a sixth post in 24 hours until the oldest one leaves them', async () => {
      const { service } = make([
        minutes(-23 * 60),
        minutes(-600),
        minutes(-300),
        minutes(-120),
        minutes(-60),
      ]);
      expect(await service.postingLimitProblem(account, [{ id: 'p-1' }])).toBe(
        'Reddit allows 5 posts a day per account, at least 10 minutes apart. Next allowed at 2026-11-02 13:00 UTC.'
      );
    });

    it('lets the sixth post go once 24 hours have passed since the first', async () => {
      const { service } = make([
        minutes(-24 * 60 - 1),
        minutes(-600),
        minutes(-300),
        minutes(-120),
        minutes(-60),
      ]);
      expect(
        await service.postingLimitProblem(account, [{ id: 'p-1' }])
      ).toBeNull();
    });

    it('never reads posts for a network without posting rules', async () => {
      const { service, postRepository } = make([minutes(-1)]);
      expect(
        await service.postingLimitProblem(
          { providerIdentifier: 'x', internalId: 'u1' },
          [{ id: 'p-1' }]
        )
      ).toBeNull();
      expect(postRepository.getAccountPostingDates).not.toHaveBeenCalled();
    });
  });

  describe('when a post is saved', () => {
    const save = (
      type: 'schedule' | 'now' | 'draft' | 'update',
      date: Date,
      id?: string
    ) => ({
      type,
      date: date.toISOString(),
      posts: [
        {
          integration: { id: 'i-r' },
          settings: { __type: 'reddit' },
          value: [{ ...(id ? { id } : {}) }],
        },
      ],
    });

    it('refuses a schedule 5 minutes before another queued post of the account', async () => {
      const { service, postRepository } = make([minutes(65)]);
      await expect(
        service.checkPostingLimits('org-1', save('schedule', minutes(60)))
      ).rejects.toMatchObject({
        message:
          'Reddit allows 5 posts a day per account, at least 10 minutes apart. Next allowed at 2026-11-02 13:15 UTC.',
      });
      // published and queued posts around the publish time
      expect(postRepository.getAccountPostingDates).toHaveBeenCalledWith(
        'reddit',
        'u1',
        minutes(60 - 24 * 60),
        minutes(60 + 2 * 24 * 60),
        true,
        []
      );
    });

    it('refuses a schedule that would make one 24 hours hold six posts', async () => {
      const { service } = make([
        minutes(120),
        minutes(240),
        minutes(360),
        minutes(480),
        minutes(600),
      ]);
      await expect(
        service.checkPostingLimits('org-1', save('schedule', minutes(60)))
      ).rejects.toMatchObject({
        message: expect.stringContaining(
          'Reddit allows 5 posts a day per account, at least 10 minutes apart.'
        ),
      });
    });

    it('accepts a schedule with room and excludes the post being edited', async () => {
      const { service, postRepository } = make(
        [minutes(-60)],
        [{ id: 'p-1', state: 'QUEUE' }]
      );
      await expect(
        service.checkPostingLimits('org-1', save('update', minutes(60), 'p-1'))
      ).resolves.toBeUndefined();
      expect(
        postRepository.getAccountPostingDates.mock.calls[0][5]
      ).toEqual(['p-1']);
    });

    const stored = (integration: any = { id: 'i-r', ...account }) => ({
      id: 'p-1',
      parentPostId: null,
      publishDate: minutes(60),
      integration,
    });

    it('checks a stored post moved next to another one of the account', async () => {
      const { service, postRepository, integrationService } = make([
        minutes(122),
      ]);
      await expect(
        service.checkStoredPostingLimits('org-1', stored(), minutes(120))
      ).rejects.toMatchObject({
        message: expect.stringContaining('Next allowed at 2026-11-02 14:12 UTC.'),
      });
      expect(postRepository.getAccountPostingDates.mock.calls[0][5]).toEqual([
        'p-1',
      ]);
      // the loaded post had the account, nothing else is read
      expect(integrationService.getIntegrationById).not.toHaveBeenCalled();
      // at its stored date when it does not move
      await expect(
        service.checkStoredPostingLimits('org-1', stored())
      ).resolves.toBeUndefined();
    });

    it('reads the account only for a network with posting rules', async () => {
      const { service, postRepository, integrationService } = make([
        minutes(62),
      ]);
      // an approval's post carries the provider but not the account
      await expect(
        service.checkStoredPostingLimits(
          'org-1',
          stored({ id: 'i-r', providerIdentifier: 'reddit' })
        )
      ).rejects.toMatchObject({
        message: expect.stringContaining('Reddit allows 5 posts a day'),
      });
      expect(integrationService.getIntegrationById).toHaveBeenCalledWith(
        'org-1',
        'i-r'
      );

      integrationService.getIntegrationById.mockClear();
      postRepository.getAccountPostingDates.mockClear();
      await service.checkStoredPostingLimits(
        'org-1',
        stored({ id: 'i-x', providerIdentifier: 'x' })
      );
      expect(integrationService.getIntegrationById).not.toHaveBeenCalled();
      expect(postRepository.getAccountPostingDates).not.toHaveBeenCalled();
    });

    it('skips drafts and updates of posts that already went out', async () => {
      const { service, postRepository } = make(
        [minutes(1)],
        [{ id: 'p-1', state: 'PUBLISHED' }]
      );
      await service.checkPostingLimits('org-1', save('draft', minutes(0)));
      await service.checkPostingLimits(
        'org-1',
        save('update', minutes(0), 'p-1')
      );
      expect(postRepository.getAccountPostingDates).not.toHaveBeenCalled();
    });
  });
});

describe('PostsService.publicPostLink', () => {
  const publicProvider = {
    isPublicReleaseURL: (url: string) =>
      /^https:\/\/x\.com\/[^/]+\/status\/\d+$/.test(url),
  };
  // a provider that reads a settings field to tell a public post from a
  // members-only one, the way X does for a Community post
  const settingsProvider = {
    isPublicReleaseURL: (url: string, settings: any) =>
      /^https:\/\/x\.com\//.test(url) && !settings?.community,
  };
  // a provider that stores an inbox or admin URL and never opts in, like
  // tiktok's creator inbox or listmonk's self-hosted campaign preview
  const privateProvider = {};
  const policyProvider = {
    isPublicReleaseURL: () => true,
    authorizationPolicy: { authorizationRealm: 'google-project:test' },
  };
  const throwingProvider = {
    isPublicReleaseURL: () => {
      throw new Error('boom');
    },
  };

  const providers: Record<string, any> = {
    x: publicProvider,
    community: settingsProvider,
    tiktok: privateProvider,
    listmonk: privateProvider,
    youtube: policyProvider,
    broken: throwingProvider,
  };

  const make = () =>
    makeService({
      getSocialIntegration: (identifier: string) => providers[identifier],
    } as any).service;

  const post = (overrides: any = {}) => ({
    state: 'PUBLISHED' as any,
    releaseURL: 'https://x.com/acme/status/1',
    settings: '{}',
    integration: { providerIdentifier: 'x' },
    ...overrides,
  });

  beforeEach(() => {
    safeUrl.mockReset();
    safeUrl.mockResolvedValue(true);
  });

  it('links the post when the provider says the release URL is public', async () => {
    await expect(make().publicPostLink(post())).resolves.toBe(
      'https://x.com/acme/status/1'
    );
    expect(safeUrl).toHaveBeenCalledWith('https://x.com/acme/status/1');
  });

  it('never links a provider that did not opt in, even with a release URL', async () => {
    await expect(
      make().publicPostLink(
        post({
          releaseURL: 'https://www.tiktok.com/messages?lang=en#7300000000',
          integration: { providerIdentifier: 'tiktok' },
        })
      )
    ).resolves.toBeUndefined();
    await expect(
      make().publicPostLink(
        post({
          releaseURL: 'https://mail.acme.internal/api/campaigns/4/preview',
          integration: { providerIdentifier: 'listmonk' },
        })
      )
    ).resolves.toBeUndefined();
    // a provider that never opts in is not even asked about the URL
    expect(safeUrl).not.toHaveBeenCalled();
  });

  it('rejects a release URL the provider does not recognise as a permalink', async () => {
    // the owner's own article list, not a post
    await expect(
      make().publicPostLink(post({ releaseURL: 'https://x.com/i/articles' }))
    ).resolves.toBeUndefined();
    // a profile page rather than the post
    await expect(
      make().publicPostLink(post({ releaseURL: 'https://x.com/acme' }))
    ).resolves.toBeUndefined();
  });

  it('drops a URL that is not a public https URL, whatever the provider said', async () => {
    safeUrl.mockResolvedValue(false);
    await expect(make().publicPostLink(post())).resolves.toBeUndefined();
    expect(safeUrl).toHaveBeenCalledWith('https://x.com/acme/status/1');
  });

  it('links nothing for a post that is not published or is deleted', async () => {
    for (const state of ['QUEUE', 'DRAFT', 'ERROR']) {
      await expect(make().publicPostLink(post({ state }))).resolves.toBeUndefined();
    }
    await expect(
      make().publicPostLink(post({ deletedAt: new Date() }))
    ).resolves.toBeUndefined();
  });

  it('links nothing when the post has no release URL', async () => {
    await expect(
      make().publicPostLink(post({ releaseURL: '' }))
    ).resolves.toBeUndefined();
    await expect(
      make().publicPostLink(post({ releaseURL: null }))
    ).resolves.toBeUndefined();
  });

  it('links nothing for a deleted, disabled, half-connected or reconnect-needed channel', async () => {
    for (const broken of [
      { deletedAt: new Date() },
      { disabled: true },
      { inBetweenSteps: true },
      { refreshNeeded: true },
    ]) {
      await expect(
        make().publicPostLink(
          post({ integration: { providerIdentifier: 'x', ...broken } })
        )
      ).resolves.toBeUndefined();
    }
  });

  it('links nothing for a provider under an authorizationPolicy', async () => {
    await expect(
      make().publicPostLink(
        post({
          releaseURL: 'https://www.youtube.com/watch?v=abc',
          integration: { providerIdentifier: 'youtube' },
        })
      )
    ).resolves.toBeUndefined();
  });

  it('links the first target when the provider comma-joins several', async () => {
    await expect(
      make().publicPostLink(
        post({
          releaseURL:
            'https://x.com/acme/status/1,https://x.com/acme/status/2',
        })
      )
    ).resolves.toBe('https://x.com/acme/status/1');
  });

  it('links nothing when the post has no integration or an unknown provider', async () => {
    await expect(
      make().publicPostLink(post({ integration: null }))
    ).resolves.toBeUndefined();
    await expect(
      make().publicPostLink(post({ integration: { providerIdentifier: 'nope' } }))
    ).resolves.toBeUndefined();
  });

  it('survives settings that are not valid json, and a provider that throws', async () => {
    await expect(
      make().publicPostLink(post({ settings: 'not json' }))
    ).resolves.toBeUndefined();
    await expect(
      make().publicPostLink(post({ integration: { providerIdentifier: 'broken' } }))
    ).resolves.toBeUndefined();
  });

  it('refuses settings that parse to something other than an object', async () => {
    const communityPost = (settings: string) =>
      post({ settings, integration: { providerIdentifier: 'community' } });

    // the guard works when the settings really are an object
    await expect(
      make().publicPostLink(communityPost('{}'))
    ).resolves.toBe('https://x.com/acme/status/1');
    await expect(
      make().publicPostLink(
        communityPost('{"community":"https://x.com/i/communities/1"}')
      )
    ).resolves.toBeUndefined();

    // and anything that is not an object would read as "no community set",
    // so it must not reach the provider at all
    for (const settings of ['"x"', '42', 'true', 'null', '[]']) {
      await expect(
        make().publicPostLink(communityPost(settings))
      ).resolves.toBeUndefined();
    }
  });
});

describe('PostsService.getPost error curation', () => {
  const failure = (type: string, message: string) =>
    JSON.stringify({ cause: { type, failure: { message } } });

  const load = async (error: string | null) => {
    const { service, postRepository } = makeService();
    postRepository.getPost.mockResolvedValue({
      id: 'p-1',
      group: 'g-1',
      content: 'hello',
      childrenPost: [],
      error,
      integration: { id: 'i-1', name: 'X', providerIdentifier: 'x' },
    });
    const { posts } = await service.getPost('org-1', 'p-1');
    return posts[0];
  };

  // the editor and the approvals inbox are served this payload to any member
  // of the workspace, so it carries the same curated message as the calendar
  it('keeps a provider message and drops a failure of ours', async () => {
    expect((await load(failure('bad_body', 'Duplicate post content'))).error).toBe(
      'Duplicate post content'
    );
    expect(
      (
        await load(
          failure('unknown', 'error:1C800064:Provider routines::bad decrypt')
        )
      ).error
    ).toBe(null);
    expect((await load(null)).error).toBe(null);
  });
});
