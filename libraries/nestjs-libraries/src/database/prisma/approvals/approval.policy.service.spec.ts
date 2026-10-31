import { BadRequestException } from '@nestjs/common';

// the notification service pulls in temporal and every provider
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
  ApprovalPolicyService,
  DEFAULT_APPROVAL_SETTINGS,
  decideApproval,
  updateCanHold,
  userActor,
} from './approval.policy.service';

const settings = (over: Partial<typeof DEFAULT_APPROVAL_SETTINGS> = {}) => ({
  ...DEFAULT_APPROVAL_SETTINGS,
  ...over,
});

const agent = { type: 'agent' as const, source: 'Claude (MCP)' };
const apiAgent = {
  type: 'agent' as const,
  source: 'Public API key',
  viaApi: true,
};
const member = { type: 'user' as const, userId: 'u-member', role: 'USER' };
const admin = { type: 'user' as const, userId: 'u-admin', role: 'ADMIN' };

const makeService = (row: any = null, over: Record<string, any> = {}) => {
  const repository = {
    getSettings: jest.fn().mockResolvedValue(row),
    getIntegrationNames: jest.fn().mockResolvedValue([]),
    countAgentPostsSince: jest.fn().mockResolvedValue(0),
    getApprovers: jest.fn().mockResolvedValue([]),
    getMember: jest.fn().mockResolvedValue(null),
    ...over,
  };
  const activity = {
    recordSafely: jest.fn().mockResolvedValue(undefined),
    getLastAuthorId: jest.fn().mockResolvedValue(null),
  };
  const notifications = {
    inAppNotification: jest.fn().mockResolvedValue(undefined),
    sendEmail: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ApprovalPolicyService(
    repository as any,
    activity as any,
    notifications as any
  );
  return { service, repository, activity, notifications };
};

describe('decideApproval', () => {
  it('changes nothing with the defaults, so existing workspaces keep publishing', () => {
    expect(decideApproval(settings(), member, false)).toEqual({
      hold: false,
      previous: undefined,
    });
    expect(decideApproval(settings(), agent, false)).toEqual({
      hold: false,
      previous: undefined,
    });
  });

  it('holds agent posts when the workspace requires approval for AI posts', () => {
    expect(
      decideApproval(settings({ requireAgentApproval: true }), agent, false)
    ).toEqual({ hold: true, approvalStatus: 'IN_REVIEW', previous: undefined });
  });

  it('does not hold public API or CLI posts by default', () => {
    expect(
      decideApproval(settings({ requireAgentApproval: true }), apiAgent, false)
    ).toEqual({ hold: false, previous: undefined });
    // the API setting alone does nothing without the AI setting
    expect(
      decideApproval(settings({ requireApiApproval: true }), apiAgent, false)
        .hold
    ).toBe(false);
  });

  it('holds public API and CLI posts when the workspace also asks for API approval', () => {
    expect(
      decideApproval(
        settings({ requireAgentApproval: true, requireApiApproval: true }),
        apiAgent,
        false
      )
    ).toEqual({ hold: true, approvalStatus: 'IN_REVIEW', previous: undefined });
  });

  it('keeps a waiting post waiting when an API client saves it again', () => {
    expect(
      decideApproval(settings(), apiAgent, false, 'CHANGES_REQUESTED').hold
    ).toBe(true);
  });

  it('does not hold member posts because of the agent setting', () => {
    expect(
      decideApproval(settings({ requireAgentApproval: true }), member, false)
        .hold
    ).toBe(false);
  });

  it('holds posts of members who cannot approve when approval is required', () => {
    expect(
      decideApproval(settings({ requireApproval: true }), member, false)
    ).toEqual({ hold: true, approvalStatus: 'IN_REVIEW', previous: undefined });
  });

  it('lets approvers schedule directly when approval is required', () => {
    expect(
      decideApproval(settings({ requireApproval: true }), admin, true).hold
    ).toBe(false);
  });

  it('keeps a waiting post waiting when someone who cannot approve schedules it', () => {
    for (const previous of [
      'IN_REVIEW',
      'CHANGES_REQUESTED',
      'REJECTED',
    ] as const) {
      expect(decideApproval(settings(), member, false, previous)).toEqual({
        hold: true,
        approvalStatus: 'IN_REVIEW',
        previous,
      });
    }
  });

  it('never lets an agent schedule a waiting post, even with agent approval off', () => {
    expect(decideApproval(settings(), agent, false, 'IN_REVIEW').hold).toBe(
      true
    );
  });

  it('approves a waiting post when an approver schedules it', () => {
    expect(decideApproval(settings(), admin, true, 'IN_REVIEW')).toEqual({
      hold: false,
      approvalStatus: 'APPROVED',
      previous: 'IN_REVIEW',
    });
  });

  it('leaves an already approved post alone', () => {
    expect(
      decideApproval(settings({ requireApproval: true }), admin, true, 'APPROVED')
    ).toEqual({ hold: false, previous: 'APPROVED' });
  });
});

describe('ApprovalPolicyService settings and roles', () => {
  it('uses the defaults (everything off) for a workspace without a row', async () => {
    const { service, repository } = makeService(null);
    expect(await service.getSettings('org-1')).toEqual(DEFAULT_APPROVAL_SETTINGS);
    expect(repository.getSettings).toHaveBeenCalledWith('org-1');
  });

  it('reads the stored row of the workspace', async () => {
    const { service } = makeService({
      requireApproval: true,
      approverIds: ['u-2'],
      requireAgentApproval: true,
      agentIntegrationIds: ['i-1'],
      agentMaxPostsPerDay: 5,
    });
    expect(await service.getSettings('org-1')).toEqual({
      requireApproval: true,
      approverIds: ['u-2'],
      requireAgentApproval: true,
      agentIntegrationIds: ['i-1'],
      agentMaxPostsPerDay: 5,
    });
  });

  it('lets admins and picked members approve, nobody else', () => {
    const { service } = makeService();
    const s = settings({ approverIds: ['u-picked'] });
    expect(service.canApprove(admin, s)).toBe(true);
    expect(
      service.canApprove({ ...admin, role: 'SUPERADMIN', userId: 'x' }, s)
    ).toBe(true);
    expect(service.canApprove(member, s)).toBe(false);
    expect(service.canApprove({ ...member, userId: 'u-picked' }, s)).toBe(true);
    expect(service.canApprove(agent, s)).toBe(false);
    expect(service.canApprove(undefined, s)).toBe(false);
  });

  it('builds the actor from the role in the current workspace', () => {
    expect(
      userActor(
        { id: 'u-1', name: 'Dana', lastName: 'Lee', email: 'd@x.com' },
        { users: [{ role: 'ADMIN' }] }
      )
    ).toEqual({ type: 'user', userId: 'u-1', role: 'ADMIN', name: 'Dana Lee' });
  });

  it('never holds drafts, and only the stored version decides an update', async () => {
    const { service, repository } = makeService({
      ...DEFAULT_APPROVAL_SETTINGS,
      requireAgentApproval: true,
    });
    expect((await service.decide('org-1', agent, 'draft')).hold).toBe(false);
    // an update of a plain draft stays a draft
    expect(
      (
        await service.decide('org-1', agent, 'update', {
          state: 'DRAFT',
          approvalStatus: 'NONE',
        })
      ).hold
    ).toBe(false);
    expect(repository.getSettings).not.toHaveBeenCalled();
    expect((await service.decide('org-1', agent, 'now')).hold).toBe(true);
  });

  it('sends an agent update of a scheduled post back to review', async () => {
    const { service } = makeService({
      ...DEFAULT_APPROVAL_SETTINGS,
      requireAgentApproval: true,
    });
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    expect(
      await service.decide('org-1', agent, 'update', {
        state: 'QUEUE',
        approvalStatus: 'APPROVED',
        publishDate: tomorrow,
      })
    ).toEqual({ hold: true, approvalStatus: 'IN_REVIEW', previous: 'APPROVED' });
  });

  it('an update never approves a waiting post, even by an approver', async () => {
    const { service } = makeService(null);
    expect(
      await service.decide('org-1', admin, 'update', {
        state: 'DRAFT',
        approvalStatus: 'IN_REVIEW',
      })
    ).toEqual({ hold: false, previous: 'IN_REVIEW' });
  });
});

describe('updateCanHold', () => {
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const hourAgo = new Date(Date.now() - 3600 * 1000);
  it('only holds scheduled-for-later or waiting posts', () => {
    expect(updateCanHold(null)).toBe(false);
    expect(updateCanHold({ state: 'PUBLISHED', approvalStatus: 'APPROVED' })).toBe(false);
    expect(updateCanHold({ state: 'ERROR' })).toBe(false);
    expect(updateCanHold({ state: 'QUEUE', publishDate: hourAgo })).toBe(false);
    expect(updateCanHold({ state: 'DRAFT', approvalStatus: 'NONE' })).toBe(false);
    expect(updateCanHold({ state: 'QUEUE', publishDate: tomorrow })).toBe(true);
    expect(updateCanHold({ state: 'DRAFT', approvalStatus: 'REJECTED' })).toBe(true);
  });
});

describe('ApprovalPolicyService.assertAgentGuardrails', () => {
  const NOW = new Date('2026-10-31T15:00:00Z');

  it('allows anything when no guardrail is set', async () => {
    const { service, repository } = makeService(null);
    await expect(
      service.assertAgentGuardrails('org-1', agent, ['i-1', 'i-2'], { now: NOW })
    ).resolves.toBeUndefined();
    expect(repository.countAgentPostsSince).not.toHaveBeenCalled();
  });

  it('blocks channels that are not open to agents, with a clear message, and logs it', async () => {
    const { service, repository, activity } = makeService(
      { ...DEFAULT_APPROVAL_SETTINGS, agentIntegrationIds: ['i-1'] },
      {
        getIntegrationNames: jest.fn().mockResolvedValue([
          { id: 'i-1', name: 'Brand X' },
          { id: 'i-2', name: 'CEO LinkedIn' },
        ]),
      }
    );

    const error = await service
      .assertAgentGuardrails('org-1', agent, ['i-1', 'i-2'], NOW)
      .catch((e) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toContain(`can't post to "CEO LinkedIn"`);
    expect(error.message).toContain('Channels agents can use: Brand X.');
    expect(error.message).toContain('Settings > Approvals');
    // names are looked up inside the workspace only
    expect(repository.getIntegrationNames).toHaveBeenCalledWith('org-1', [
      'i-2',
      'i-1',
    ]);
    expect(activity.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        action: 'GUARDRAIL_BLOCKED',
        actorType: 'AGENT',
        actorName: 'Claude (MCP)',
      })
    );
  });

  it('allows the channels that are open to agents', async () => {
    const { service } = makeService({
      ...DEFAULT_APPROVAL_SETTINGS,
      agentIntegrationIds: ['i-1', 'i-2'],
    });
    await expect(
      service.assertAgentGuardrails('org-1', agent, ['i-2', 'i-2'], { now: NOW })
    ).resolves.toBeUndefined();
  });

  it('counts the posts agents created today (UTC) in this workspace', async () => {
    const { service, repository } = makeService(
      { ...DEFAULT_APPROVAL_SETTINGS, agentMaxPostsPerDay: 5 },
      { countAgentPostsSince: jest.fn().mockResolvedValue(3) }
    );
    await expect(
      service.assertAgentGuardrails('org-1', agent, ['i-1', 'i-2'], { now: NOW })
    ).resolves.toBeUndefined();
    expect(repository.countAgentPostsSince).toHaveBeenCalledWith(
      'org-1',
      new Date('2026-10-31T00:00:00Z')
    );
  });

  it('blocks a request that goes over the daily limit, saying how many are left', async () => {
    const { service, activity } = makeService(
      { ...DEFAULT_APPROVAL_SETTINGS, agentMaxPostsPerDay: 5 },
      { countAgentPostsSince: jest.fn().mockResolvedValue(4) }
    );
    const error = await service
      .assertAgentGuardrails('org-1', agent, ['i-1', 'i-2'], NOW)
      .catch((e) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toContain('up to 5 posts per day');
    expect(error.message).toContain('only 1 more can be created today');
    expect(activity.recordSafely).toHaveBeenCalledTimes(1);
  });

  it('does not count in-place updates against the daily limit', async () => {
    const { service, repository } = makeService(
      { ...DEFAULT_APPROVAL_SETTINGS, agentMaxPostsPerDay: 2 },
      { countAgentPostsSince: jest.fn().mockResolvedValue(2) }
    );
    await expect(
      service.assertAgentGuardrails('org-1', agent, ['i-1'], {
        now: NOW,
        countsTowardLimit: false,
      })
    ).resolves.toBeUndefined();
    expect(repository.countAgentPostsSince).not.toHaveBeenCalled();
  });

  it('says when the limit is used up', async () => {
    const { service } = makeService(
      { ...DEFAULT_APPROVAL_SETTINGS, agentMaxPostsPerDay: 2 },
      { countAgentPostsSince: jest.fn().mockResolvedValue(2) }
    );
    await expect(
      service.assertAgentGuardrails('org-1', agent, ['i-1'], { now: NOW })
    ).rejects.toThrow('no more can be created until tomorrow');
  });
});

describe('ApprovalPolicyService.afterSave', () => {
  const post = { id: 'p-1', content: '<p>Hello</p>', integrationName: 'Brand X' };

  it('logs the creation by an agent and the submission, and tells the approvers', async () => {
    const { service, activity, repository, notifications } = makeService(null, {
      getApprovers: jest.fn().mockResolvedValue([
        { user: { id: 'a', email: 'a@x.com' } },
        { user: { id: 'b', email: 'a@x.com' } },
      ]),
    });
    const outcome = await service.afterSave('org-1', post, agent, {
      created: true,
      decision: { hold: true, approvalStatus: 'IN_REVIEW' },
    });
    expect(outcome).toEqual({ submitted: true });

    expect(activity.recordSafely.mock.calls.map((c) => c[0].action)).toEqual([
      'CREATED',
      'SUBMITTED',
    ]);
    expect(activity.recordSafely.mock.calls[0][0]).toMatchObject({
      organizationId: 'org-1',
      postId: 'p-1',
      actorType: 'AGENT',
      actorName: 'Claude (MCP)',
      actorUserId: null,
    });
    expect(repository.getApprovers).toHaveBeenCalledWith('org-1', []);
    expect(notifications.inAppNotification).toHaveBeenCalledWith(
      'org-1',
      'A post is waiting for your review',
      expect.stringContaining('Claude (MCP) sent a post for Brand X')
    );
    // one email per address
    expect(notifications.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('leaves the notification to the caller with notify: false', async () => {
    const { service, notifications, activity } = makeService();
    const outcome = await service.afterSave('org-1', post, member, {
      created: false,
      decision: { hold: true, approvalStatus: 'IN_REVIEW' },
      notify: false,
    });
    expect(outcome.submitted).toBe(true);
    expect(activity.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUBMITTED' })
    );
    expect(notifications.inAppNotification).not.toHaveBeenCalled();
  });

  it('tells approvers once about a save of several posts', async () => {
    const { service, notifications } = makeService();
    await service.notifyApprovers('org-1', post, 'Sam', 3);
    expect(notifications.inAppNotification).toHaveBeenCalledWith(
      'org-1',
      '3 posts are waiting for your review',
      expect.stringContaining('Sam sent 3 posts for review.')
    );
  });

  it('does not notify again when a waiting post is saved again', async () => {
    const { service, notifications, activity } = makeService();
    await service.afterSave('org-1', post, member, {
      created: false,
      decision: { hold: true, approvalStatus: 'IN_REVIEW', previous: 'IN_REVIEW' },
    });
    expect(activity.recordSafely).not.toHaveBeenCalled();
    expect(notifications.inAppNotification).not.toHaveBeenCalled();
  });

  it('logs an approval when an approver schedules a waiting post and tells the author', async () => {
    const { service, activity, notifications, repository } = makeService(null, {
      getMember: jest
        .fn()
        .mockResolvedValue({ user: { email: 'author@x.com' } }),
    });
    activity.getLastAuthorId.mockResolvedValue('u-member');
    await service.afterSave(
      'org-1',
      post,
      { ...admin, name: 'Dana' },
      {
        created: false,
        decision: { hold: false, approvalStatus: 'APPROVED', previous: 'IN_REVIEW' },
      }
    );
    expect(activity.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'APPROVED', actorUserId: 'u-admin' })
    );
    expect(repository.getMember).toHaveBeenCalledWith('org-1', 'u-member');
    expect(notifications.sendEmail).toHaveBeenCalledWith(
      'author@x.com',
      'Your post was approved',
      expect.any(String)
    );
  });
});
