import { BadRequestException, Injectable } from '@nestjs/common';
import { ApprovalStatus } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  ApprovalSettingsData,
  ApprovalsRepository,
} from '@gitroom/nestjs-libraries/database/prisma/approvals/approvals.repository';
import { ActivityLogService } from '@gitroom/nestjs-libraries/database/prisma/activity-log/activity.log.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import {
  emailButton,
  emailCard,
} from '@gitroom/nestjs-libraries/services/email.service';
import { postContentPlainText } from '@gitroom/helpers/utils/sanitize.post.content';
import { escape } from 'lodash';

dayjs.extend(utc);

// Who is saving or acting on a post. Agents are MCP clients, the public API,
// the CLI and the in-app agent; `source` says which one. `viaApi` marks the
// public API and the CLI: their posts only count as AI-created for approval
// when the workspace also asks for API approval.
export type ApprovalActor =
  | { type: 'user'; userId: string; role?: string; name?: string }
  | { type: 'agent'; source: string; viaApi?: boolean };

export type ApprovalSettingsView = ApprovalSettingsData;

// The stored post a save replaces, when there is one
export interface ExistingPost {
  approvalStatus?: ApprovalStatus;
  state?: string;
  publishDate?: Date | string;
}

export interface NotifyPost {
  id: string;
  content: string;
  integrationName?: string;
  provider?: string;
}

// What saving a post does to its review state
export interface ApprovalDecision {
  // save it as a draft, it waits for an approver
  hold: boolean;
  // the status to store, undefined keeps the current one
  approvalStatus?: ApprovalStatus;
  previous?: ApprovalStatus;
}

// A workspace without a settings row keeps the behaviour from before
// approvals: nothing waits for anyone.
export const DEFAULT_APPROVAL_SETTINGS: ApprovalSettingsView = {
  requireApproval: false,
  approverIds: [],
  requireAgentApproval: false,
  requireApiApproval: false,
  agentIntegrationIds: [],
  agentMaxPostsPerDay: null,
};

// statuses an approver clears by scheduling the post themselves
const AWAITING: ApprovalStatus[] = ['IN_REVIEW', 'CHANGES_REQUESTED', 'REJECTED'];

export const isAdminRole = (role?: string) =>
  role === 'ADMIN' || role === 'SUPERADMIN';

// The signed-in member, with the role they have in the current workspace
export const userActor = (
  user: { id: string; name?: string | null; lastName?: string | null; email?: string },
  organization: { users?: { role?: string }[] }
): Extract<ApprovalActor, { type: 'user' }> => ({
  type: 'user',
  userId: user.id,
  role: organization?.users?.[0]?.role,
  name:
    [user.name, user.lastName].filter(Boolean).join(' ').trim() ||
    user.email ||
    undefined,
});

export const actorName = (actor: ApprovalActor) =>
  actor.type === 'agent' ? actor.source : actor.name || null;

const snippet = (content: string, length = 180) => {
  const text = postContentPlainText(content || '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
};

@Injectable()
export class ApprovalPolicyService {
  constructor(
    private _approvalsRepository: ApprovalsRepository,
    private _activityLogService: ActivityLogService,
    private _notificationService: NotificationService
  ) {}

  async getSettings(organizationId: string): Promise<ApprovalSettingsView> {
    const row = await this._approvalsRepository.getSettings(organizationId);
    if (!row) {
      return { ...DEFAULT_APPROVAL_SETTINGS };
    }
    return {
      requireApproval: row.requireApproval,
      approverIds: row.approverIds || [],
      requireAgentApproval: row.requireAgentApproval,
      requireApiApproval: row.requireApiApproval,
      agentIntegrationIds: row.agentIntegrationIds || [],
      agentMaxPostsPerDay: row.agentMaxPostsPerDay ?? null,
    };
  }

  canApprove(
    actor: ApprovalActor | undefined,
    settings: ApprovalSettingsView
  ) {
    if (!actor || actor.type !== 'user') {
      return false;
    }
    return (
      isAdminRole(actor.role) || settings.approverIds.includes(actor.userId)
    );
  }

  // The review state a save leads to. Drafts never change it; scheduling or
  // posting now does. An in-place update of a scheduled or waiting post can
  // send it back to review, but never approves it.
  async decide(
    organizationId: string,
    actor: ApprovalActor | undefined,
    type: 'draft' | 'schedule' | 'now' | 'update',
    existing?: ExistingPost | null
  ): Promise<ApprovalDecision> {
    const previous = existing?.approvalStatus;
    if (!actor || type === 'draft') {
      return { hold: false, previous };
    }
    if (type === 'update' && !updateCanHold(existing)) {
      return { hold: false, previous };
    }

    const settings = await this.getSettings(organizationId);
    const decision = decideApproval(
      settings,
      actor,
      this.canApprove(actor, settings),
      previous
    );
    return type === 'update' && !decision.hold
      ? { hold: false, previous }
      : decision;
  }

  // Server-side limits for posts agents create. Throws a message written for
  // the agent, so it can tell the person what to do.
  async assertAgentGuardrails(
    organizationId: string,
    actor: Extract<ApprovalActor, { type: 'agent' }>,
    integrationIds: string[],
    // in-place updates create nothing, only the channels are checked
    options: { countsTowardLimit?: boolean; now?: Date } = {}
  ) {
    const { countsTowardLimit = true, now = new Date() } = options;
    const settings = await this.getSettings(organizationId);
    const blocked = async (message: string) => {
      await this._activityLogService.recordSafely({
        organizationId,
        action: 'GUARDRAIL_BLOCKED',
        actorType: 'AGENT',
        actorName: actor.source,
        comment: message,
      });
      throw new BadRequestException(message);
    };

    if (settings.agentIntegrationIds.length) {
      const notAllowed = [...new Set(integrationIds)].filter(
        (id) => !settings.agentIntegrationIds.includes(id)
      );
      if (notAllowed.length) {
        const names = await this._approvalsRepository.getIntegrationNames(
          organizationId,
          [...notAllowed, ...settings.agentIntegrationIds]
        );
        const name = (id: string) =>
          names.find((p) => p.id === id)?.name || id;
        const allowed = settings.agentIntegrationIds
          .filter((id) => names.some((p) => p.id === id))
          .map(name);
        await blocked(
          `AI agents can't post to ${notAllowed
            .map((id) => `"${name(id)}"`)
            .join(', ')} in this workspace. ${
            allowed.length
              ? `Channels agents can use: ${allowed.join(', ')}.`
              : 'No channels are open to agents right now.'
          } A workspace admin can change this in Settings > Approvals.`
        );
      }
    }

    if (settings.agentMaxPostsPerDay && countsTowardLimit) {
      const since = dayjs.utc(now).startOf('day').toDate();
      const created = await this._approvalsRepository.countAgentPostsSince(
        organizationId,
        since
      );
      const requested = integrationIds.length;
      if (created + requested > settings.agentMaxPostsPerDay) {
        const left = Math.max(0, settings.agentMaxPostsPerDay - created);
        await blocked(
          `This workspace lets AI agents create up to ${
            settings.agentMaxPostsPerDay
          } posts per day (UTC). ${created} ${
            created === 1 ? 'was' : 'were'
          } already created today, so ${
            left === 0
              ? 'no more can be created until tomorrow'
              : `only ${left} more can be created today`
          }. A workspace admin can raise the limit in Settings > Approvals.`
        );
      }
    }
  }

  // History and notifications once a post is saved. Returns whether the post
  // was sent for review, so a save of several channels tells the approvers
  // once (notify: false) instead of once per channel.
  async afterSave(
    organizationId: string,
    post: NotifyPost,
    actor: ApprovalActor,
    outcome: { created: boolean; decision?: ApprovalDecision; notify?: boolean }
  ) {
    const base = {
      organizationId,
      postId: post.id,
      actorType: actor.type === 'agent' ? ('AGENT' as const) : ('USER' as const),
      actorUserId: actor.type === 'user' ? actor.userId : null,
      actorName: actorName(actor),
    };

    if (outcome.created) {
      await this._activityLogService.recordSafely({ ...base, action: 'CREATED' });
    }

    const status = outcome.decision?.approvalStatus;
    const submitted =
      status === 'IN_REVIEW' && outcome.decision?.previous !== 'IN_REVIEW';
    if (submitted) {
      await this._activityLogService.recordSafely({
        ...base,
        action: 'SUBMITTED',
      });
      if (outcome.notify !== false) {
        await this.notifyApprovers(organizationId, post, actorName(actor));
      }
    }

    if (status === 'APPROVED' && outcome.decision?.previous !== 'APPROVED') {
      await this._activityLogService.recordSafely({ ...base, action: 'APPROVED' });
      await this.notifyAuthor(organizationId, post, 'approved', {
        by: actorName(actor),
      });
    }

    return { submitted };
  }

  async notifyApprovers(
    organizationId: string,
    post: NotifyPost,
    by?: string | null,
    count = 1
  ) {
    try {
      const settings = await this.getSettings(organizationId);
      const subject =
        count > 1
          ? `${count} posts are waiting for your review`
          : 'A post is waiting for your review';
      const intro =
        count > 1
          ? `${by || 'Someone'} sent ${count} posts for review.`
          : `${by || 'Someone'} sent a post${
              post.integrationName ? ` for ${post.integrationName}` : ''
            } for review.`;

      // in-app notifications are shared by the whole workspace
      await this._notificationService.inAppNotification(
        organizationId,
        subject,
        `${intro} An approver can approve it or ask for changes in Approvals.`
      );

      const approvers = await this._approvalsRepository.getApprovers(
        organizationId,
        settings.approverIds
      );
      const html = this.emailHtml(intro, post, {
        tone: 'info',
        status: 'Needs review',
      });
      for (const email of new Set(approvers.map((p) => p.user.email))) {
        await this._notificationService.sendEmail(email, subject, html);
      }
    } catch (err) {}
  }

  async notifyAuthor(
    organizationId: string,
    post: NotifyPost,
    decision: 'approved' | 'changes_requested' | 'rejected',
    details: { by?: string | null; comment?: string | null; publishedNow?: boolean } = {}
  ) {
    try {
      const by = details.by || 'An approver';
      const channel = post.integrationName ? ` for ${post.integrationName}` : '';
      const when = details.publishedNow
        ? "Its planned time had passed, so it's publishing now."
        : "It's scheduled and will publish on time.";
      const subject =
        decision === 'approved'
          ? 'Your post was approved'
          : decision === 'rejected'
          ? 'Your post was rejected'
          : 'Changes were requested on your post';
      // the email goes to the author, the in-app notification to everyone
      const email =
        decision === 'approved'
          ? `${by} approved your post${channel}. ${when}`
          : decision === 'rejected'
          ? `${by} rejected your post${channel}. It won't be published.`
          : `${by} asked for changes on your post${channel}.`;
      const shared =
        decision === 'approved'
          ? `${by} approved a post${channel}. ${when}`
          : decision === 'rejected'
          ? `${by} rejected a post${channel}. It won't be published.`
          : `${by} asked for changes on a post${channel}.`;

      await this._notificationService.inAppNotification(
        organizationId,
        decision === 'approved'
          ? 'A post was approved'
          : decision === 'rejected'
          ? 'A post was rejected'
          : 'Changes were requested on a post',
        details.comment ? `${shared} "${snippet(details.comment, 300)}"` : shared
      );

      const authorId = await this._activityLogService.getLastAuthorId(
        organizationId,
        post.id
      );
      if (!authorId) {
        return;
      }
      const author = await this._approvalsRepository.getMember(
        organizationId,
        authorId
      );
      if (!author?.user?.email) {
        return;
      }
      await this._notificationService.sendEmail(
        author.user.email,
        subject,
        this.emailHtml(
          email,
          post,
          decision === 'approved'
            ? { tone: 'success', status: 'Approved' }
            : decision === 'rejected'
            ? { tone: 'fail', status: 'Rejected' }
            : { tone: 'info', status: 'Changes requested' },
          details.comment
        )
      );
    } catch (err) {}
  }

  private emailHtml(
    intro: string,
    post: Omit<NotifyPost, 'id'>,
    badge: { tone: 'success' | 'fail' | 'info'; status: string },
    comment?: string | null
  ) {
    const app = process.env.FRONTEND_URL;
    const text = snippet(post.content);
    return [
      `<p style="margin:0 0 20px">${escape(intro)}</p>`,
      emailCard({
        ...badge,
        title: post.integrationName,
        icon:
          post.provider && app
            ? `${app}/icons/platforms/${post.provider}.png`
            : undefined,
        message: comment ? `"${snippet(comment, 600)}"` : text || undefined,
      }),
      emailButton(`${app}/review`, 'Open Approvals'),
    ].join('');
  }
}

// A scheduled post whose time came may be going out right now: its publish
// workflow is running, so it can't be held, moved or restarted without risking
// a second copy on the channel.
export const isBeingPublished = (post?: ExistingPost | null) =>
  post?.state === 'QUEUE' &&
  !!post.publishDate &&
  dayjs(post.publishDate).isBefore(dayjs());

// An in-place update can only hold a post that is scheduled for later or
// already in the review flow; published, failed, publishing and plain drafts
// are left as they are.
export const updateCanHold = (existing?: ExistingPost | null) => {
  if (!existing || !existing.state) {
    return false;
  }
  if (existing.state === 'PUBLISHED' || existing.state === 'ERROR') {
    return false;
  }
  if (isBeingPublished(existing)) {
    return false;
  }
  if (
    existing.state === 'DRAFT' &&
    (!existing.approvalStatus || existing.approvalStatus === 'NONE')
  ) {
    return false;
  }
  return true;
};

// The review rules, kept apart from the database so they read in one place.
// - an agent's post waits when the workspace asks for agent approval; posts
//   from the public API and the CLI only when it asks for API approval too
// - a member who can't approve waits when the workspace asks for approval,
//   or when the post is already waiting
// - an approver scheduling a waiting post approves it
export const decideApproval = (
  settings: ApprovalSettingsView,
  actor: ApprovalActor,
  canApprove: boolean,
  previous?: ApprovalStatus
): ApprovalDecision => {
  const waiting = !!previous && AWAITING.includes(previous);
  const hold =
    actor.type === 'agent'
      ? (settings.requireAgentApproval &&
          (!actor.viaApi || settings.requireApiApproval)) ||
        waiting
      : !canApprove && (settings.requireApproval || waiting);

  if (hold) {
    return { hold: true, approvalStatus: 'IN_REVIEW', previous };
  }

  if (waiting) {
    return { hold: false, approvalStatus: 'APPROVED', previous };
  }

  return { hold: false, previous };
};
