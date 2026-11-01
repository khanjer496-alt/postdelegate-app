import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityActor, ApprovalStatus, Prisma, State } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import dayjs from 'dayjs';
import { ApprovalsRepository } from '@gitroom/nestjs-libraries/database/prisma/approvals/approvals.repository';
import {
  ApprovalActor,
  ApprovalPolicyService,
  isAdminRole,
} from '@gitroom/nestjs-libraries/database/prisma/approvals/approval.policy.service';
import { ActivityLogService } from '@gitroom/nestjs-libraries/database/prisma/activity-log/activity.log.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import {
  ClientApprovalDto,
  CreateApprovalLinkDto,
  UpdateApprovalSettingsDto,
} from '@gitroom/nestjs-libraries/dtos/approvals/approvals.dto';

type UserActor = Extract<ApprovalActor, { type: 'user' }>;

// Who performed a transition, as it is written to the history
interface ActedBy {
  actorType: ActivityActor;
  actorUserId?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  linkId?: string | null;
}

type RootPost = NonNullable<
  Awaited<ReturnType<ApprovalsRepository['getRootPost']>>
>;

// statuses an approver can approve from
const APPROVABLE: ApprovalStatus[] = ['IN_REVIEW', 'CHANGES_REQUESTED', 'REJECTED'];

// a link view is written to the history at most this often
const VIEW_LOG_INTERVAL_MINUTES = 30;

export const hashApprovalToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

// 32 random bytes, ~256 bits, url safe
export const createApprovalToken = () => randomBytes(32).toString('base64url');

const byUser = (actor: UserActor): ActedBy => ({
  actorType: 'USER',
  actorUserId: actor.userId,
  actorName: actor.name || null,
});

@Injectable()
export class ApprovalsService {
  constructor(
    private _approvalsRepository: ApprovalsRepository,
    private _approvalPolicyService: ApprovalPolicyService,
    private _activityLogService: ActivityLogService,
    private _postsService: PostsService
  ) {}

  async getSettings(organizationId: string, actor: UserActor) {
    const settings = await this._approvalPolicyService.getSettings(
      organizationId
    );
    const isAdmin = isAdminRole(actor.role);
    return {
      ...settings,
      isAdmin,
      canApprove: this._approvalPolicyService.canApprove(actor, settings),
      // only admins edit the settings, so only they get the member list
      members: isAdmin
        ? (await this._approvalsRepository.getMembers(organizationId)).map(
            (p) => ({
              id: p.user.id,
              email: p.user.email,
              name:
                [p.user.name, p.user.lastName].filter(Boolean).join(' ') ||
                null,
              role: p.role,
            })
          )
        : [],
    };
  }

  async updateSettings(
    organizationId: string,
    actor: UserActor,
    body: UpdateApprovalSettingsDto
  ) {
    if (!isAdminRole(actor.role)) {
      throw new ForbiddenException(
        'Only workspace admins can change approval settings.'
      );
    }

    // ids from another workspace are dropped, never stored
    const members = await this._approvalsRepository.getMembers(organizationId);
    const memberIds = members.map((p) => p.user.id);
    const integrations = await this._approvalsRepository.getIntegrationNames(
      organizationId,
      body.agentIntegrationIds || []
    );

    await this._approvalsRepository.upsertSettings(organizationId, {
      requireApproval: !!body.requireApproval,
      approverIds: [...new Set(body.approverIds || [])].filter((id) =>
        memberIds.includes(id)
      ),
      requireAgentApproval: !!body.requireAgentApproval,
      requireApiApproval: !!body.requireApiApproval,
      agentIntegrationIds: integrations.map((p) => p.id),
      agentMaxPostsPerDay: body.agentMaxPostsPerDay || null,
    });

    await this._activityLogService.recordSafely({
      organizationId,
      action: 'SETTINGS_CHANGED',
      ...byUser(actor),
    });

    return this.getSettings(organizationId, actor);
  }

  async getReviewCount(organizationId: string) {
    return {
      count: await this._approvalsRepository.countReviewQueue(organizationId),
    };
  }

  async getReviewQueue(organizationId: string, source: 'all' | 'agent' = 'all') {
    const posts = await this._approvalsRepository.getReviewQueue(
      organizationId,
      source === 'agent'
    );
    const history = await this._activityLogService.latestForPosts(
      organizationId,
      posts.map((p) => p.id),
      ['SUBMITTED', 'CHANGES_REQUESTED']
    );

    return posts.map((post) => {
      const items = history.filter((p) => p.postId === post.id);
      const submitted = items.find((p) => p.action === 'SUBMITTED');
      const changes = items.find((p) => p.action === 'CHANGES_REQUESTED');
      return {
        ...post,
        submittedBy: submitted?.actorName || post.agentSource || null,
        submittedAt: submitted?.createdAt || post.createdAt,
        changesRequested:
          post.approvalStatus === 'CHANGES_REQUESTED' && changes
            ? {
                by: changes.actorName,
                comment: changes.comment,
                at: changes.createdAt,
              }
            : null,
      };
    });
  }

  private async getPost(organizationId: string, postId: string) {
    const post = await this._approvalsRepository.getRootPost(
      organizationId,
      postId
    );
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    return post;
  }

  private async assertApprover(organizationId: string, actor: UserActor) {
    const settings = await this._approvalPolicyService.getSettings(
      organizationId
    );
    if (!this._approvalPolicyService.canApprove(actor, settings)) {
      throw new ForbiddenException(
        "You can't approve posts in this workspace. Ask an admin to add you as an approver in Settings > Approvals."
      );
    }
  }

  private assertNotPublished(post: RootPost) {
    if (post.state === 'PUBLISHED') {
      throw new BadRequestException('This post was already published.');
    }
    // a scheduled post whose time came may be going out right now
    if (post.state === 'QUEUE' && dayjs(post.publishDate).isBefore(dayjs())) {
      throw new BadRequestException(
        'This post is already being published, it can no longer be reviewed.'
      );
    }
  }

  private notifyPost(post: RootPost) {
    return {
      id: post.id,
      content: post.content,
      integrationName: post.integration?.name,
      provider: post.integration?.providerIdentifier,
    };
  }

  // Moves a post (and its comments) to a new state when it still matches
  // `expected`, then stops (DRAFT) or starts (QUEUE) its publish workflow.
  // Returns false when someone else changed the post first.
  private async moveTo(
    organizationId: string,
    post: RootPost,
    expected: Prisma.PostWhereInput,
    state: State,
    approvalStatus: ApprovalStatus,
    publishDate?: Date
  ) {
    const moved = await this._approvalsRepository.transitionGroup(
      organizationId,
      post,
      expected,
      { state, approvalStatus, ...(publishDate ? { publishDate } : {}) }
    );
    if (!moved) {
      return false;
    }

    await this._postsService.startWorkflow(
      post.integration.providerIdentifier.split('-')[0].toLowerCase(),
      post.id,
      organizationId,
      state
    );
    return true;
  }

  private async hold(
    organizationId: string,
    post: RootPost,
    by: ActedBy,
    // a shared link waits for the client, the approvers are not asked
    notify = true
  ): Promise<boolean> {
    if (post.approvalStatus === 'IN_REVIEW' && post.state === 'DRAFT') {
      return false;
    }
    this.assertNotPublished(post);
    const moved = await this.moveTo(
      organizationId,
      post,
      {
        state: { not: 'PUBLISHED' },
        NOT: [{ state: 'DRAFT', approvalStatus: 'IN_REVIEW' }],
      },
      'DRAFT',
      'IN_REVIEW'
    );
    if (!moved) {
      return false;
    }
    await this._activityLogService.recordSafely({
      organizationId,
      postId: post.id,
      action: 'SUBMITTED',
      ...by,
    });
    if (notify) {
      await this._approvalPolicyService.notifyApprovers(
        organizationId,
        this.notifyPost(post),
        by.actorName
      );
    }
    return true;
  }

  async submit(organizationId: string, postId: string, actor: UserActor) {
    const post = await this.getPost(organizationId, postId);
    await this.hold(organizationId, post, byUser(actor));
    return { id: post.id, approvalStatus: 'IN_REVIEW', state: 'DRAFT' };
  }

  private async approveAs(
    organizationId: string,
    post: RootPost,
    by: ActedBy,
    comment: string | undefined,
    // clients approve only what waits for them, the team can also approve a
    // post it sent back or rejected
    approvable: ApprovalStatus[]
  ) {
    const already = {
      id: post.id,
      approvalStatus: 'APPROVED',
      state: 'QUEUE',
      publishDate: post.publishDate,
      publishedNow: false,
    };
    if (post.state === 'QUEUE' && post.approvalStatus === 'APPROVED') {
      return already;
    }
    if (post.state === 'PUBLISHED') {
      throw new BadRequestException('This post was already published.');
    }
    if (!approvable.includes(post.approvalStatus)) {
      throw new BadRequestException("This post isn't waiting for approval.");
    }

    // the content may have changed since it was checked, e.g. saved as a draft
    const problem = await this._postsService.getStoredPostProblem(
      organizationId,
      post.id
    );
    if (problem) {
      throw new BadRequestException(
        `This post can't be published yet: ${problem}. Open it, fix it, then approve it.`
      );
    }

    // a post waiting for approval is a draft, the plan's monthly cap on its
    // network applies once it is scheduled
    await this._postsService.checkStoredPostLimit(organizationId, post.id);

    // a time that passed while the post waited means "publish now"
    const now = new Date();
    const publishDate = dayjs(post.publishDate).isBefore(now) ? now : undefined;

    const moved = await this.moveTo(
      organizationId,
      post,
      { approvalStatus: { in: approvable }, state: { not: 'PUBLISHED' } },
      'QUEUE',
      'APPROVED',
      publishDate
    );
    if (!moved) {
      // someone acted at the same moment, approving twice is harmless
      const current = await this._approvalsRepository.getRootPost(
        organizationId,
        post.id
      );
      if (current?.state === 'QUEUE' && current.approvalStatus === 'APPROVED') {
        return { ...already, publishDate: current.publishDate };
      }
      throw new BadRequestException(
        'This post was just changed by someone else. Refresh and try again.'
      );
    }

    await this._activityLogService.recordSafely({
      organizationId,
      postId: post.id,
      action: 'APPROVED',
      comment: comment?.trim() || null,
      ...by,
    });
    await this._approvalPolicyService.notifyAuthor(
      organizationId,
      this.notifyPost(post),
      'approved',
      { by: by.actorName, comment, publishedNow: !!publishDate }
    );

    return {
      id: post.id,
      approvalStatus: 'APPROVED',
      state: 'QUEUE',
      publishDate: publishDate || post.publishDate,
      publishedNow: !!publishDate,
    };
  }

  async approve(
    organizationId: string,
    postId: string,
    actor: UserActor,
    comment?: string
  ) {
    await this.assertApprover(organizationId, actor);
    const post = await this.getPost(organizationId, postId);
    return this.approveAs(organizationId, post, byUser(actor), comment, APPROVABLE);
  }

  private async sendBack(
    organizationId: string,
    post: RootPost,
    status: 'CHANGES_REQUESTED' | 'REJECTED',
    by: ActedBy,
    comment: string | undefined,
    expected: Prisma.PostWhereInput = {}
  ) {
    this.assertNotPublished(post);
    const text = comment?.trim() || null;
    const moved = await this.moveTo(
      organizationId,
      post,
      { AND: [expected, { state: { not: 'PUBLISHED' } }] },
      'DRAFT',
      status
    );
    if (!moved) {
      throw new BadRequestException(
        'This post was just changed by someone else. Refresh and try again.'
      );
    }
    await this._activityLogService.recordSafely({
      organizationId,
      postId: post.id,
      action: status,
      comment: text,
      ...by,
    });

    // the feedback also lands in the post's comments, next to the preview
    if (text) {
      await this._postsService.addReviewComment(
        organizationId,
        post.id,
        text,
        by.actorUserId || null,
        by.actorUserId ? undefined : by.actorName || 'Client'
      );
    }

    await this._approvalPolicyService.notifyAuthor(
      organizationId,
      this.notifyPost(post),
      status === 'REJECTED' ? 'rejected' : 'changes_requested',
      { by: by.actorName, comment: text }
    );

    return { id: post.id, approvalStatus: status, state: 'DRAFT' };
  }

  async requestChanges(
    organizationId: string,
    postId: string,
    actor: UserActor,
    comment: string
  ) {
    await this.assertApprover(organizationId, actor);
    if (!comment?.trim()) {
      throw new BadRequestException('Tell the author what to change.');
    }
    const post = await this.getPost(organizationId, postId);
    return this.sendBack(
      organizationId,
      post,
      'CHANGES_REQUESTED',
      byUser(actor),
      comment
    );
  }

  async reject(
    organizationId: string,
    postId: string,
    actor: UserActor,
    comment?: string
  ) {
    await this.assertApprover(organizationId, actor);
    const post = await this.getPost(organizationId, postId);
    return this.sendBack(organizationId, post, 'REJECTED', byUser(actor), comment);
  }

  async getPostHistory(organizationId: string, postId: string, page = 0) {
    // the post must belong to the workspace
    await this.getPost(organizationId, postId);
    return this._activityLogService.list(organizationId, { postId, page });
  }

  // the workspace history names clients by what they typed, approvers only
  async getActivity(organizationId: string, actor: UserActor, page = 0) {
    await this.assertApprover(organizationId, actor);
    return this._activityLogService.list(organizationId, { page });
  }

  // ---- client approval links ----

  async createLink(
    organizationId: string,
    actor: UserActor,
    body: CreateApprovalLinkDto
  ) {
    // a client's approval publishes, so only approvers can hand one out
    await this.assertApprover(organizationId, actor);
    const ids = [...new Set(body.postIds)];
    const posts = await Promise.all(
      ids.map((id) => this._approvalsRepository.getRootPost(organizationId, id))
    );
    if (posts.some((p) => !p)) {
      throw new NotFoundException('Post not found');
    }
    for (const post of posts) {
      this.assertNotPublished(post!);
    }

    const token = createApprovalToken();
    const link = await this._approvalsRepository.createLink({
      organizationId,
      tokenHash: hashApprovalToken(token),
      postIds: ids,
      createdById: actor.userId,
      expiresAt: dayjs().add(body.expiresInDays, 'day').toDate(),
    });

    // shared posts wait for the client, they don't publish on their own
    for (const post of posts) {
      await this.hold(organizationId, post!, byUser(actor), false);
      await this._activityLogService.recordSafely({
        organizationId,
        postId: post!.id,
        action: 'LINK_CREATED',
        linkId: link.id,
        ...byUser(actor),
      });
    }

    return {
      id: link.id,
      expiresAt: link.expiresAt,
      // the token is shown once, only its hash is stored
      url: `${process.env.FRONTEND_URL}/approve/${token}`,
    };
  }

  async listLinks(organizationId: string, actor: UserActor) {
    await this.assertApprover(organizationId, actor);
    const now = new Date();
    return (await this._approvalsRepository.listLinks(organizationId)).map(
      (link) => ({
        ...link,
        status: link.revokedAt
          ? 'revoked'
          : link.expiresAt < now
          ? 'expired'
          : 'active',
      })
    );
  }

  async revokeLink(organizationId: string, actor: UserActor, id: string) {
    await this.assertApprover(organizationId, actor);
    const { count } = await this._approvalsRepository.revokeLink(
      organizationId,
      id
    );
    if (!count) {
      throw new NotFoundException('Link not found');
    }
    await this._activityLogService.recordSafely({
      organizationId,
      action: 'LINK_REVOKED',
      linkId: id,
      ...byUser(actor),
    });
    return { id, revoked: true };
  }

  private async getValidLink(token: string) {
    // a malformed token is answered like an unknown one
    if (!token || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) {
      throw new NotFoundException('This approval link is not valid.');
    }
    const link = await this._approvalsRepository.getLinkByHash(
      hashApprovalToken(token)
    );
    if (!link) {
      throw new NotFoundException('This approval link is not valid.');
    }
    if (link.revokedAt) {
      throw new GoneException('This approval link was turned off.');
    }
    if (link.expiresAt < new Date()) {
      throw new GoneException('This approval link has expired.');
    }
    return link;
  }

  private clientStatus(post: { state: State; approvalStatus: ApprovalStatus }) {
    if (post.state === 'PUBLISHED') return 'published';
    if (post.approvalStatus === 'APPROVED') return 'approved';
    if (post.approvalStatus === 'CHANGES_REQUESTED') return 'changes_requested';
    if (post.approvalStatus === 'REJECTED') return 'rejected';
    return 'waiting';
  }

  async getPublicLink(token: string) {
    const link = await this.getValidLink(token);

    const posts = (
      await Promise.all(
        link.postIds.map((id) =>
          this._postsService.getPostsRecursively(
            id,
            true,
            link.organizationId,
            true
          )
        )
      )
    ).filter((p) => p.length);

    const shouldLog =
      !link.lastViewedAt ||
      dayjs().diff(dayjs(link.lastViewedAt), 'minute') >=
        VIEW_LOG_INTERVAL_MINUTES;
    if (shouldLog) {
      await this._approvalsRepository.touchLink(link.id);
      for (const [root] of posts) {
        await this._activityLogService.recordSafely({
          organizationId: link.organizationId,
          postId: root.id,
          action: 'LINK_VIEWED',
          actorType: 'CLIENT',
          linkId: link.id,
        });
      }
    }

    const organization = await this._approvalsRepository.getOrganizationName(
      link.organizationId
    );

    // unauthenticated: only what the page renders, never tokens or settings
    return {
      // enterprise workspaces carry an internal suffix after ###
      workspace: organization?.name?.split('###')[0] || null,
      expiresAt: link.expiresAt,
      posts: posts.map(([root, ...comments]) => ({
        id: root.id,
        publishDate: root.publishDate,
        status: this.clientStatus(root),
        integration: root.integration
          ? {
              name: root.integration.name,
              picture: root.integration.picture,
              providerIdentifier: root.integration.providerIdentifier,
              profile: root.integration.profile,
            }
          : null,
        values: [root, ...comments].map((p) => ({
          id: p.id,
          content: p.content,
          image: p.image,
        })),
      })),
    };
  }

  async actOnPublicLink(token: string, body: ClientApprovalDto) {
    const link = await this.getValidLink(token);
    if (!link.postIds.includes(body.postId)) {
      throw new NotFoundException('Post not found');
    }
    const post = await this._approvalsRepository.getRootPost(
      link.organizationId,
      body.postId
    );
    if (!post) {
      throw new NotFoundException('This post was removed.');
    }

    const by: ActedBy = {
      actorType: 'CLIENT',
      actorName: body.name.trim(),
      actorEmail: body.email.trim().toLowerCase(),
      linkId: link.id,
    };

    // a client acts only on what waits for a decision, never on a post the
    // team rejected, sent back or already approved
    if (post.approvalStatus !== 'IN_REVIEW') {
      throw new BadRequestException(
        'This post is no longer waiting for your approval.'
      );
    }

    if (body.decision === 'approve') {
      const result = await this.approveAs(
        link.organizationId,
        post,
        by,
        body.comment,
        ['IN_REVIEW']
      );
      return { id: result.id, status: 'approved' };
    }

    if (!body.comment?.trim()) {
      throw new BadRequestException('Tell the team what to change.');
    }
    await this.sendBack(
      link.organizationId,
      post,
      'CHANGES_REQUESTED',
      by,
      body.comment,
      { approvalStatus: 'IN_REVIEW' }
    );
    return { id: post.id, status: 'changes_requested' };
  }
}
