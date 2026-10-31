import { Injectable } from '@nestjs/common';
import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { TemporalService } from 'nestjs-temporal-core';
import { TypedSearchAttributes } from '@temporalio/common';
import { organizationId } from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { Context } from '@temporalio/activity';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';

export type NotificationType = 'success' | 'fail' | 'info';

@Injectable()
export class NotificationService {
  constructor(
    private _notificationRepository: NotificationsRepository,
    private _emailService: EmailService,
    private _organizationRepository: OrganizationRepository,
    private _temporalService: TemporalService,
    private _integrationManager: IntegrationManager
  ) {}

  private activityPostId(): string | null | undefined {
    try {
      const workflowId = Context.current().info.workflowExecution.workflowId;
      if (!workflowId.startsWith('post_')) return undefined;
      // Publishing and recurring-child IDs are post_<local-id>[_suffix].
      // An unknown posting context must never fall back to unscoped storage.
      return workflowId.slice('post_'.length).split('_')[0] || null;
    } catch {
      return undefined;
    }
  }

  getMainPageCount(organizationId: string, userId: string) {
    return this._notificationRepository.getMainPageCount(
      organizationId,
      userId
    );
  }

  getNotificationsPaginated(organizationId: string, page: number) {
    return this._notificationRepository.getNotificationsPaginated(
      organizationId,
      page
    );
  }

  getNotifications(organizationId: string, userId: string) {
    return this._notificationRepository.getNotifications(
      organizationId,
      userId
    );
  }

  async inAppNotification(
    orgId: string,
    subject: string,
    message: string,
    sendEmail = false,
    digest = false,
    type: NotificationType = 'success',
    scope?: { integrationId: string }
  ) {
    const postId = this.activityPostId();
    if (postId === null) return;
    let integrationId = scope?.integrationId;
    let providerIdentifier: string | undefined;
    if (postId !== undefined) {
      const post = await this._notificationRepository.getPostNotificationContext(orgId, postId);
      if (!post || post.deletedAt || post.integration.deletedAt) return;
      integrationId = post.integrationId;
      providerIdentifier = post.integration.providerIdentifier;
    } else if (integrationId) {
      const connection = await this._notificationRepository.getIntegrationNotificationContext(orgId, integrationId);
      if (!connection || connection.deletedAt) return;
      providerIdentifier = connection.providerIdentifier;
    }

    if (integrationId && providerIdentifier) {
      const provider = this._integrationManager.getSocialIntegration(providerIdentifier);
      if (provider?.authorizationPolicy) {
        // Do not copy provider URLs, channel identities or raw error messages
        // into notifications, email queues or a shared digest's history.
        subject = 'Publishing status update';
        message = postId === undefined
          ? 'A connected account needs your attention. Open the calendar to review its status.'
          : type === 'fail'
          ? 'A post could not be published. Open the calendar to review it.'
          : type === 'info'
          ? 'A post needs your attention. Open the calendar to review its status.'
          : 'Your post was published. Open the calendar to review it.';
      }
      const stored = await this._notificationRepository.createScopedNotification(orgId, integrationId, message, postId);
      if (!stored) return;
    } else {
      await this._notificationRepository.createNotification(orgId, message);
    }
    if (!sendEmail) {
      return;
    }

    if (digest) {
      try {
        await this._temporalService.client
          .getRawClient()
          ?.workflow.signalWithStart('digestEmailWorkflowV2', {
            // v2 only changes the digest subject; v1 runs stay registered and idle
            workflowId: 'digest_email_workflow_v2_' + orgId,
            signal: 'email',
            signalArgs: [
              [
                {
                  title: subject,
                  message,
                  type,
                },
              ],
            ],
            taskQueue: 'main',
            workflowIdConflictPolicy: 'USE_EXISTING',
            args: [{ organizationId: orgId }],
            typedSearchAttributes: new TypedSearchAttributes([
              {
                key: organizationId,
                value: orgId,
              },
            ]),
          });
      } catch (err) {}

      return;
    }

    await this.sendEmailsToOrg(orgId, subject, message, type);
  }

  async sendEmailsToOrg(
    orgId: string,
    subject: string,
    message: string,
    type?: NotificationType
  ) {
    const userOrg = await this._organizationRepository.getAllUsersOrgs(orgId);
    for (const user of userOrg?.users || []) {
      // 'info' type is always sent regardless of preferences
      if (type !== 'info') {
        // Filter users based on their email preferences
        if (type === 'success' && !user.user.sendSuccessEmails) {
          continue;
        }
        if (type === 'fail' && !user.user.sendFailureEmails) {
          continue;
        }
      }
      await this.sendEmail(user.user.email, subject, message);
    }
  }

  // Account matters (billing, the plan) only the admins can act on
  async sendEmailsToOrgAdmins(orgId: string, subject: string, message: string) {
    const admins = await this._organizationRepository.getOrgAdmins(orgId);
    // one person can be an admin through two logins with the same email
    for (const email of new Set(admins.map((admin) => admin.user.email))) {
      await this.sendEmail(email, subject, message);
    }
  }

  async sendEmail(to: string, subject: string, html: string, replyTo?: string) {
    await this._emailService.sendEmail(to, subject, html, 'top', replyTo);
  }

  hasEmailProvider() {
    return this._emailService.hasProvider();
  }
}
