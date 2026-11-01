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

import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { YoutubeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';

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
      subscriptionService as any
    );
    jest.spyOn(service, 'startWorkflow').mockResolvedValue(undefined);
    return { service, postRepository, subscriptionService };
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
    return { service };
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
});
