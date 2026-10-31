import { NotFoundException } from '@nestjs/common';

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
      { recordPublished: jest.fn() } as any
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
