import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';

// heavy modules that are not under test
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock('@gitroom/helpers/utils/sanitize.post.content', () => ({
  postContentPlainText: (html: string) => String(html).replace(/<[^>]+>/g, ''),
}));
jest.mock('@gitroom/nestjs-libraries/services/email.service', () => ({
  emailButton: () => '',
  emailCard: () => '',
}));

import {
  ApprovalsService,
  createApprovalToken,
  hashApprovalToken,
} from './approvals.service';
import { DEFAULT_APPROVAL_SETTINGS } from './approval.policy.service';

const ORG = 'org-1';
const admin = { type: 'user' as const, userId: 'u-admin', role: 'ADMIN', name: 'Dana' };
const member = { type: 'user' as const, userId: 'u-member', role: 'USER', name: 'Sam' };

const future = () => new Date(Date.now() + 24 * 3600 * 1000);
const past = () => new Date(Date.now() - 3600 * 1000);

const makePost = (over: Record<string, any> = {}) => ({
  id: 'p-1',
  group: 'g-1',
  state: 'DRAFT',
  approvalStatus: 'IN_REVIEW',
  publishDate: future(),
  content: '<p>Hello</p>',
  agentSource: 'Claude (MCP)',
  organizationId: ORG,
  integration: { id: 'i-1', name: 'Brand X', providerIdentifier: 'linkedin-page' },
  ...over,
});

const makeService = (opts: { post?: any; settings?: any; link?: any } = {}) => {
  const repository = {
    getRootPost: jest
      .fn()
      .mockImplementation(async (org: string, id: string) =>
        org === ORG && opts.post !== null
          ? { ...(opts.post || makePost()), id }
          : null
      ),
    transitionGroup: jest.fn().mockResolvedValue(true),
    getMembers: jest.fn().mockResolvedValue([
      { role: 'ADMIN', user: { id: 'u-admin', email: 'a@x.com', name: 'Dana', lastName: null } },
      { role: 'USER', user: { id: 'u-member', email: 'm@x.com', name: 'Sam', lastName: null } },
    ]),
    getIntegrationNames: jest
      .fn()
      .mockImplementation(async (_org: string, ids: string[]) =>
        ids.filter((id) => id === 'i-1').map((id) => ({ id, name: 'Brand X' }))
      ),
    upsertSettings: jest.fn().mockResolvedValue({}),
    createLink: jest.fn().mockImplementation(async (data: any) => ({
      id: 'link-1',
      expiresAt: data.expiresAt,
      postIds: data.postIds,
      createdAt: new Date(),
    })),
    getLinkByHash: jest.fn().mockResolvedValue(opts.link ?? null),
    touchLink: jest.fn().mockResolvedValue({}),
    revokeLink: jest.fn().mockResolvedValue({ count: 1 }),
    getOrganizationName: jest.fn().mockResolvedValue({ name: 'Acme' }),
  };
  const policy = {
    getSettings: jest
      .fn()
      .mockResolvedValue(opts.settings || { ...DEFAULT_APPROVAL_SETTINGS }),
    canApprove: jest.fn((actor: any, settings: any) =>
      actor?.type === 'user' &&
      (['ADMIN', 'SUPERADMIN'].includes(actor.role) ||
        settings.approverIds.includes(actor.userId))
    ),
    notifyApprovers: jest.fn().mockResolvedValue(undefined),
    notifyAuthor: jest.fn().mockResolvedValue(undefined),
  };
  const activity = {
    recordSafely: jest.fn().mockResolvedValue(undefined),
    list: jest.fn().mockResolvedValue({ total: 0, pages: 0, items: [] }),
    latestForPosts: jest.fn().mockResolvedValue([]),
  };
  const posts = {
    startWorkflow: jest.fn().mockResolvedValue(undefined),
    addReviewComment: jest.fn().mockResolvedValue({}),
    getPostsRecursively: jest.fn().mockResolvedValue([]),
    getStoredPostProblem: jest.fn().mockResolvedValue(null),
    checkStoredPostLimit: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ApprovalsService(
    repository as any,
    policy as any,
    activity as any,
    posts as any
  );
  return { service, repository, policy, activity, posts };
};

// the data a transition wrote, and the condition it claimed the post with
const moved = (repository: any, index = 0) => {
  const [org, post, expected, data] = repository.transitionGroup.mock.calls[index];
  return { org, post, expected, data };
};

describe('ApprovalsService transitions', () => {
  it('approving a waiting post schedules it and starts the publish workflow', async () => {
    const { service, repository, posts, activity, policy } = makeService();
    const result = await service.approve(ORG, 'p-1', admin, 'Looks great');

    const call = moved(repository);
    expect(call.org).toBe(ORG);
    expect(call.post).toMatchObject({ id: 'p-1', group: 'g-1' });
    expect(call.expected).toEqual({
      approvalStatus: { in: ['IN_REVIEW', 'CHANGES_REQUESTED', 'REJECTED'] },
      state: { not: 'PUBLISHED' },
    });
    expect(call.data).toEqual({ state: 'QUEUE', approvalStatus: 'APPROVED' });
    expect(posts.startWorkflow).toHaveBeenCalledWith('linkedin', 'p-1', ORG, 'QUEUE');
    expect(activity.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'APPROVED',
        actorType: 'USER',
        actorUserId: 'u-admin',
        comment: 'Looks great',
      })
    );
    expect(policy.notifyAuthor).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ id: 'p-1' }),
      'approved',
      { by: 'Dana', comment: 'Looks great', publishedNow: false }
    );
    expect(result).toMatchObject({ approvalStatus: 'APPROVED', state: 'QUEUE', publishedNow: false });
  });

  it('publishes right away when the planned time passed while waiting', async () => {
    const { service, repository } = makeService({ post: makePost({ publishDate: past() }) });
    const result = await service.approve(ORG, 'p-1', admin);
    const { data } = moved(repository);
    expect(data.publishDate).toBeInstanceOf(Date);
    expect(Math.abs(data.publishDate.getTime() - Date.now())).toBeLessThan(5000);
    expect(result.publishedNow).toBe(true);
  });

  it('only approvers can approve, request changes or reject', async () => {
    const { service, repository } = makeService();
    await expect(service.approve(ORG, 'p-1', member)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.requestChanges(ORG, 'p-1', member, 'x')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.reject(ORG, 'p-1', member)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.createLink(ORG, member, { postIds: ['p-1'], expiresInDays: 7 })
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.revokeLink(ORG, member, 'link-1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getActivity(ORG, member)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.transitionGroup).not.toHaveBeenCalled();
    expect(repository.createLink).not.toHaveBeenCalled();
    expect(repository.revokeLink).not.toHaveBeenCalled();
  });

  it('a member picked in the settings can approve', async () => {
    const { service, repository } = makeService({
      settings: { ...DEFAULT_APPROVAL_SETTINGS, approverIds: ['u-member'] },
    });
    await service.approve(ORG, 'p-1', member);
    expect(repository.transitionGroup).toHaveBeenCalled();
  });

  it('does not approve content that would fail to publish', async () => {
    const { service, repository, posts } = makeService();
    posts.getStoredPostProblem.mockResolvedValue('it needs at least one character or one image');
    await expect(service.approve(ORG, 'p-1', admin)).rejects.toThrow(
      "This post can't be published yet: it needs at least one character or one image"
    );
    expect(posts.getStoredPostProblem).toHaveBeenCalledWith(ORG, 'p-1');
    expect(repository.transitionGroup).not.toHaveBeenCalled();
  });

  it('does not approve a post past the plan cap on its network', async () => {
    const { service, repository, posts } = makeService();
    posts.checkStoredPostLimit.mockRejectedValue(new Error('cap reached'));
    await expect(service.approve(ORG, 'p-1', admin)).rejects.toThrow(
      'cap reached'
    );
    expect(posts.checkStoredPostLimit).toHaveBeenCalledWith(ORG, 'p-1');
    expect(repository.transitionGroup).not.toHaveBeenCalled();
  });

  it('two approvals at once publish only once', async () => {
    const { service, repository, posts, activity } = makeService();
    repository.transitionGroup.mockResolvedValueOnce(false);
    repository.getRootPost
      .mockResolvedValueOnce(makePost())
      .mockResolvedValueOnce(makePost({ state: 'QUEUE', approvalStatus: 'APPROVED' }));
    const result = await service.approve(ORG, 'p-1', admin);
    expect(result.approvalStatus).toBe('APPROVED');
    expect(posts.startWorkflow).not.toHaveBeenCalled();
    expect(activity.recordSafely).not.toHaveBeenCalled();
  });

  it('does not approve a published post or one that is not waiting', async () => {
    const published = makeService({ post: makePost({ state: 'PUBLISHED', approvalStatus: 'APPROVED' }) });
    await expect(published.service.approve(ORG, 'p-1', admin)).rejects.toBeInstanceOf(BadRequestException);

    const plain = makeService({ post: makePost({ approvalStatus: 'NONE' }) });
    await expect(plain.service.approve(ORG, 'p-1', admin)).rejects.toThrow("isn't waiting for approval");
  });

  it('approving twice is harmless', async () => {
    const { service, repository, posts } = makeService({
      post: makePost({ state: 'QUEUE', approvalStatus: 'APPROVED' }),
    });
    await service.approve(ORG, 'p-1', admin);
    expect(repository.transitionGroup).not.toHaveBeenCalled();
    expect(posts.startWorkflow).not.toHaveBeenCalled();
  });

  it('requesting changes holds the post, stops its workflow and keeps the comment', async () => {
    const { service, repository, posts, activity, policy } = makeService({
      post: makePost({ state: 'QUEUE', approvalStatus: 'APPROVED' }),
    });
    await service.requestChanges(ORG, 'p-1', admin, '  Shorter please ');

    expect(moved(repository).data).toEqual({
      state: 'DRAFT',
      approvalStatus: 'CHANGES_REQUESTED',
    });
    expect(posts.startWorkflow).toHaveBeenCalledWith('linkedin', 'p-1', ORG, 'DRAFT');
    expect(activity.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CHANGES_REQUESTED', comment: 'Shorter please' })
    );
    expect(posts.addReviewComment).toHaveBeenCalledWith(ORG, 'p-1', 'Shorter please', 'u-admin', undefined);
    expect(policy.notifyAuthor).toHaveBeenCalledWith(
      ORG,
      expect.anything(),
      'changes_requested',
      { by: 'Dana', comment: 'Shorter please' }
    );
  });

  it('asking for changes needs a comment', async () => {
    const { service } = makeService();
    await expect(service.requestChanges(ORG, 'p-1', admin, '   ')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejecting keeps the post as a draft that will not publish', async () => {
    const { service, repository, policy } = makeService();
    await service.reject(ORG, 'p-1', admin);
    expect(moved(repository).data).toEqual({
      state: 'DRAFT',
      approvalStatus: 'REJECTED',
    });
    expect(policy.notifyAuthor).toHaveBeenCalledWith(ORG, expect.anything(), 'rejected', {
      by: 'Dana',
      comment: null,
    });
  });

  it('cannot send back a post that is being published', async () => {
    const { service } = makeService({
      post: makePost({ state: 'QUEUE', approvalStatus: 'NONE', publishDate: past() }),
    });
    await expect(service.requestChanges(ORG, 'p-1', admin, 'x')).rejects.toThrow('already being published');
  });

  it('submitting holds the post and tells the approvers once', async () => {
    const { service, repository, policy } = makeService({
      post: makePost({ state: 'QUEUE', approvalStatus: 'NONE' }),
    });
    await service.submit(ORG, 'p-1', member);
    expect(moved(repository).data).toEqual({
      state: 'DRAFT',
      approvalStatus: 'IN_REVIEW',
    });
    expect(policy.notifyApprovers).toHaveBeenCalledWith(ORG, expect.objectContaining({ id: 'p-1' }), 'Sam');

    const waiting = makeService();
    await waiting.service.submit(ORG, 'p-1', member);
    expect(waiting.repository.transitionGroup).not.toHaveBeenCalled();
    expect(waiting.policy.notifyApprovers).not.toHaveBeenCalled();
  });
});

describe('ApprovalsService tenant scoping', () => {
  it('looks posts up inside the caller workspace only', async () => {
    const { service, repository } = makeService();
    await expect(service.approve('org-2', 'p-1', admin)).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.getRootPost).toHaveBeenCalledWith('org-2', 'p-1');
    expect(repository.transitionGroup).not.toHaveBeenCalled();
  });

  it('reads history only for a post of the workspace', async () => {
    const { service, activity } = makeService();
    await expect(service.getPostHistory('org-2', 'p-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(activity.list).not.toHaveBeenCalled();
    await service.getPostHistory(ORG, 'p-1', 2);
    expect(activity.list).toHaveBeenCalledWith(ORG, { postId: 'p-1', page: 2 });
  });

  it('refuses to share a post from another workspace', async () => {
    const { service, repository } = makeService();
    await expect(
      service.createLink('org-2', admin, { postIds: ['p-1'], expiresInDays: 7 })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.createLink).not.toHaveBeenCalled();
  });

  it('settings: only admins change them, and foreign ids are dropped', async () => {
    const { service, repository } = makeService();
    const body = {
      requireApproval: true,
      approverIds: ['u-member', 'u-from-other-org'],
      requireAgentApproval: true,
      requireApiApproval: true,
      agentIntegrationIds: ['i-1', 'i-other-org'],
      agentMaxPostsPerDay: 10,
    };
    await expect(service.updateSettings(ORG, member, body)).rejects.toBeInstanceOf(ForbiddenException);

    await service.updateSettings(ORG, admin, body);
    expect(repository.getMembers).toHaveBeenCalledWith(ORG);
    expect(repository.getIntegrationNames).toHaveBeenCalledWith(ORG, ['i-1', 'i-other-org']);
    expect(repository.upsertSettings).toHaveBeenCalledWith(ORG, {
      requireApproval: true,
      approverIds: ['u-member'],
      requireAgentApproval: true,
      requireApiApproval: true,
      agentIntegrationIds: ['i-1'],
      agentMaxPostsPerDay: 10,
    });
  });

  it('settings: members never get the member list', async () => {
    const { service, repository } = makeService();
    const view = await service.getSettings(ORG, member);
    expect(view.members).toEqual([]);
    expect(view.canApprove).toBe(false);
    expect(repository.getMembers).not.toHaveBeenCalled();
  });
});

describe('ApprovalsService client links', () => {
  const activeLink = (over: Record<string, any> = {}) => ({
    id: 'link-1',
    organizationId: ORG,
    tokenHash: 'h',
    postIds: ['p-1'],
    expiresAt: future(),
    revokedAt: null,
    lastViewedAt: null,
    createdAt: past(),
    ...over,
  });

  it('creates unguessable tokens and stores only their hash', async () => {
    const tokens = new Set(Array.from({ length: 50 }, createApprovalToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    }
    expect(hashApprovalToken('abc')).toHaveLength(64);
    expect(hashApprovalToken('abc')).not.toContain('abc');

    const { service, repository } = makeService({ post: makePost({ approvalStatus: 'NONE', state: 'QUEUE' }) });
    const link = await service.createLink(ORG, admin, { postIds: ['p-1', 'p-1'], expiresInDays: 7 });
    const token = link.url.split('/approve/')[1];
    const stored = repository.createLink.mock.calls[0][0];
    expect(stored.tokenHash).toBe(hashApprovalToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.postIds).toEqual(['p-1']);
    expect(stored.organizationId).toBe(ORG);
    const days = (stored.expiresAt.getTime() - Date.now()) / (24 * 3600 * 1000);
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it('sharing does not make the sharer the author the decision emails go to', async () => {
    const { service, activity } = makeService({
      post: makePost({ approvalStatus: 'NONE', state: 'QUEUE' }),
    });
    await service.createLink(ORG, admin, { postIds: ['p-1'], expiresInDays: 3 });
    const actions = activity.recordSafely.mock.calls.map((call: any[]) => call[0].action);
    expect(actions).toEqual(['LINK_CREATED']);
  });

  it('shared posts wait for the client instead of publishing, approvers are not emailed', async () => {
    const { service, repository, posts, policy } = makeService({
      post: makePost({ approvalStatus: 'NONE', state: 'QUEUE' }),
    });
    await service.createLink(ORG, admin, { postIds: ['p-1'], expiresInDays: 3 });
    expect(moved(repository).data).toEqual({ state: 'DRAFT', approvalStatus: 'IN_REVIEW' });
    expect(posts.startWorkflow).toHaveBeenCalledWith('linkedin', 'p-1', ORG, 'DRAFT');
    expect(policy.notifyApprovers).not.toHaveBeenCalled();
  });

  it('answers a malformed token without touching the database', async () => {
    const { service, repository } = makeService();
    await expect(service.getPublicLink('../../etc')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getPublicLink('')).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.getLinkByHash).not.toHaveBeenCalled();
  });

  it('looks a token up by its hash and refuses unknown, revoked and expired links', async () => {
    const token = createApprovalToken();

    const unknown = makeService({ link: null });
    await expect(unknown.service.getPublicLink(token)).rejects.toBeInstanceOf(NotFoundException);
    expect(unknown.repository.getLinkByHash).toHaveBeenCalledWith(hashApprovalToken(token));

    const revoked = makeService({ link: activeLink({ revokedAt: new Date() }) });
    await expect(revoked.service.getPublicLink(token)).rejects.toBeInstanceOf(GoneException);

    const expired = makeService({ link: activeLink({ expiresAt: past() }) });
    await expect(expired.service.getPublicLink(token)).rejects.toBeInstanceOf(GoneException);
    await expect(
      expired.service.actOnPublicLink(token, {
        postId: 'p-1',
        decision: 'approve',
        name: 'Jo',
        email: 'jo@x.com',
      })
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('shows only safe fields and logs a view at most every 30 minutes', async () => {
    const { service, posts, activity, repository } = makeService({ link: activeLink() });
    posts.getPostsRecursively.mockResolvedValue([
      {
        id: 'p-1',
        state: 'DRAFT',
        approvalStatus: 'IN_REVIEW',
        publishDate: future(),
        content: '<p>Hi</p>',
        image: '[]',
        settings: '{"secret":true}',
        integration: { name: 'Brand X', picture: 'pic', providerIdentifier: 'x', profile: 'brandx', token: 'SECRET' },
      },
    ]);
    const view = await service.getPublicLink(createApprovalToken());
    expect(posts.getPostsRecursively).toHaveBeenCalledWith('p-1', true, ORG, true);
    expect(JSON.stringify(view)).not.toContain('SECRET');
    expect(JSON.stringify(view)).not.toContain('secret');
    expect(view.posts[0].status).toBe('waiting');
    expect(view.workspace).toBe('Acme');
    expect(repository.touchLink).toHaveBeenCalledWith('link-1');
    expect(activity.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LINK_VIEWED', actorType: 'CLIENT', postId: 'p-1' })
    );

    const recent = makeService({ link: activeLink({ lastViewedAt: new Date() }) });
    await recent.service.getPublicLink(createApprovalToken());
    expect(recent.repository.touchLink).not.toHaveBeenCalled();
  });

  it('a client acts only on the posts of the link, and is recorded with what they entered', async () => {
    const token = createApprovalToken();
    const { service, repository, activity } = makeService({ link: activeLink() });

    await expect(
      service.actOnPublicLink(token, { postId: 'p-other', decision: 'approve', name: 'Jo', email: 'jo@x.com' })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.getRootPost).not.toHaveBeenCalled();

    const result = await service.actOnPublicLink(token, {
      postId: 'p-1',
      decision: 'approve',
      name: ' Jo ',
      email: 'Jo@X.com',
    });
    expect(result).toEqual({ id: 'p-1', status: 'approved' });
    // the post is read in the link's workspace
    expect(repository.getRootPost).toHaveBeenCalledWith(ORG, 'p-1');
    expect(activity.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'APPROVED',
        actorType: 'CLIENT',
        actorName: 'Jo',
        actorEmail: 'jo@x.com',
        linkId: 'link-1',
      })
    );
  });

  it('a client cannot approve a post the team rejected, sent back or approved', async () => {
    const token = createApprovalToken();
    for (const approvalStatus of ['REJECTED', 'CHANGES_REQUESTED', 'APPROVED']) {
      const { service, repository } = makeService({
        link: activeLink(),
        post: makePost({ approvalStatus }),
      });
      await expect(
        service.actOnPublicLink(token, { postId: 'p-1', decision: 'approve', name: 'Jo', email: 'jo@x.com' })
      ).rejects.toThrow('no longer waiting for your approval');
      expect(repository.transitionGroup).not.toHaveBeenCalled();
    }
  });

  it('a client approval claims the post only while it is in review', async () => {
    const token = createApprovalToken();
    const { service, repository } = makeService({ link: activeLink() });
    await service.actOnPublicLink(token, { postId: 'p-1', decision: 'approve', name: 'Jo', email: 'jo@x.com' });
    expect(moved(repository).expected).toEqual({
      approvalStatus: { in: ['IN_REVIEW'] },
      state: { not: 'PUBLISHED' },
    });
  });

  it('a client asking for changes must say what to change, and it lands in the comments', async () => {
    const token = createApprovalToken();
    const { service, posts } = makeService({ link: activeLink() });
    await expect(
      service.actOnPublicLink(token, { postId: 'p-1', decision: 'request_changes', name: 'Jo', email: 'jo@x.com' })
    ).rejects.toBeInstanceOf(BadRequestException);

    await service.actOnPublicLink(token, {
      postId: 'p-1',
      decision: 'request_changes',
      name: 'Jo',
      email: 'jo@x.com',
      comment: 'Use the new logo',
    });
    expect(posts.addReviewComment).toHaveBeenCalledWith(ORG, 'p-1', 'Use the new logo', null, 'Jo');
  });

  it('an old link cannot approve a version resubmitted after the client asked for changes', async () => {
    const token = createApprovalToken();
    const { service, repository, activity } = makeService({ link: activeLink() });
    // the client asked for changes after the link was shared, then the team resubmitted
    activity.latestForPosts.mockResolvedValue([
      { postId: 'p-1', action: 'CHANGES_REQUESTED', createdAt: new Date() },
    ]);

    await expect(
      service.actOnPublicLink(token, { postId: 'p-1', decision: 'approve', name: 'Jo', email: 'jo@x.com' })
    ).rejects.toThrow('Ask the team for a new link');
    expect(repository.transitionGroup).not.toHaveBeenCalled();
  });

  it('shows a resubmitted post as outdated on the old link', async () => {
    const { service, activity, posts } = makeService({ link: activeLink() });
    posts.getPostsRecursively.mockResolvedValue([
      { ...makePost(), integration: null },
    ]);
    activity.latestForPosts.mockResolvedValue([
      { postId: 'p-1', action: 'CHANGES_REQUESTED', createdAt: new Date() },
    ]);

    const page = await service.getPublicLink(createApprovalToken());
    expect(page.posts[0].status).toBe('outdated');
  });

  it('a decision made before the link was shared does not outdate it', async () => {
    const token = createApprovalToken();
    const { service, activity } = makeService({ link: activeLink() });
    activity.latestForPosts.mockResolvedValue([
      { postId: 'p-1', action: 'CHANGES_REQUESTED', createdAt: new Date(Date.now() - 2 * 3600 * 1000) },
    ]);

    await expect(
      service.actOnPublicLink(token, { postId: 'p-1', decision: 'approve', name: 'Jo', email: 'jo@x.com' })
    ).resolves.toEqual({ id: 'p-1', status: 'approved' });
  });

  it('revokes only a link of the workspace', async () => {
    const { service, repository } = makeService();
    repository.revokeLink.mockResolvedValueOnce({ count: 0 });
    // the caller is an admin of org-2 in this case
    await expect(service.revokeLink('org-2', admin, 'link-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.revokeLink).toHaveBeenCalledWith('org-2', 'link-1');
  });
});
