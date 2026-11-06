import { Injectable } from '@nestjs/common';
import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';
import {
  EmailCard,
  EmailService,
  emailButton,
  emailCard,
} from '@gitroom/nestjs-libraries/services/email.service';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { TemporalService } from 'nestjs-temporal-core';
import { TypedSearchAttributes } from '@temporalio/common';
import { organizationId } from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { Context } from '@temporalio/activity';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { SocialProvider } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { lowerFirst } from 'lodash';
import dayjs from 'dayjs';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

export type NotificationType = 'success' | 'fail' | 'info';

// a queued digest entry, the optional fields describe the post's channel
export type DigestNotification = {
  message: string;
  title?: string;
  type: NotificationType;
  provider?: string;
  publishedLabel?: string;
  publishedLinkLabel?: string;
  createdAt?: string;
};

const DIGEST_LIMIT = 10;
const DIGEST_SUBJECT = '[PostDelegate] Your latest notifications';
// the messages the publishing workflows write
const PUBLISHED_MESSAGE = /^Your post has been published on (\S+) at ?(\S*)\s*$/;
const ERROR_MESSAGE =
  /^An error occurred while posting (comments )?on (\S+?)(?:: ([\s\S]+))?$/;
// a scheduled post held because its channel is turned off (a trial that
// ended, a downgrade), written once per post by the publishing workflow
const DISABLED_CHANNEL_MESSAGE = /because it's disabled\. Please enable it and try again\.$/;

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
    const channelDisabled = DISABLED_CHANNEL_MESSAGE.test(message);
    let integrationId = scope?.integrationId;
    let providerIdentifier: string | undefined;
    let settings: string | null | undefined;
    let digestContext: Partial<DigestNotification> = {};
    if (postId !== undefined) {
      const post = await this._notificationRepository.getPostNotificationContext(orgId, postId);
      if (!post || post.deletedAt || post.integration.deletedAt) return;
      integrationId = post.integrationId;
      providerIdentifier = post.integration.providerIdentifier;
      settings = post.settings;
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
      } else if (sendEmail && digest) {
        digestContext = this.digestContext(provider, providerIdentifier, type, settings);
      }
      const stored = await this._notificationRepository.createScopedNotification(orgId, integrationId, message, postId);
      if (!stored) return;
    } else {
      await this._notificationRepository.createNotification(orgId, message);
    }
    if (!sendEmail) {
      return;
    }

    // every held post would email everyone, one notice a day is enough
    if (channelDisabled && !digest) {
      await this.sendChannelsPausedEmail(orgId);
      return;
    }

    if (digest) {
      try {
        await this._temporalService.client
          .getRawClient()
          ?.workflow.signalWithStart('digestEmailWorkflowV3', {
            // v3 renders one card per notification; v1/v2 runs stay registered and finish their queue
            workflowId: 'digest_email_workflow_v3_' + orgId,
            signal: 'email',
            signalArgs: [
              [
                {
                  title: subject,
                  message,
                  type,
                  ...digestContext,
                  createdAt: new Date().toISOString(),
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

  // the provider describes its channel in the digest, e.g. an inbox upload is
  // not called published
  private digestContext(
    provider: SocialProvider | undefined,
    identifier: string,
    type: NotificationType,
    settings?: string | null
  ): Partial<DigestNotification> {
    if (!provider) {
      return {};
    }
    if (type !== 'success' || !settings) {
      return { provider: identifier };
    }
    try {
      const parsed = JSON.parse(settings) || {};
      return {
        provider: identifier,
        publishedLabel: provider.publishedLabel?.(parsed),
        publishedLinkLabel: provider.publishedLinkLabel?.(parsed),
      };
    } catch (err) {
      return { provider: identifier };
    }
  }

  async sendDigestEmail(
    userId: string,
    to: string,
    notifications: DigestNotification[]
  ) {
    const user = await this._notificationRepository.getUserTimezone(userId);
    const { subject, html } = this.digestEmail(
      notifications,
      user?.timezoneName
    );
    await this._emailService.sendEmail(to, subject, html, 'bottom');
  }

  digestEmail(notifications: DigestNotification[], timezone?: string | null) {
    const app = process.env.FRONTEND_URL;
    // failures need action, so they come first
    const ordered = [
      ...notifications.filter((p) => p.type === 'fail'),
      ...notifications.filter((p) => p.type !== 'fail'),
    ];
    const cards = ordered
      .slice(0, DIGEST_LIMIT)
      .map((notification) => this.digestCard(notification, timezone));
    const more = ordered.length - DIGEST_LIMIT;

    const html = [
      `<p style="margin:0 0 20px">Here's what happened with your posts.</p>`,
      ...cards.map(emailCard),
      more > 0
        ? `<p style="margin:4px 0 0">And ${more} more ${
            more === 1 ? 'notification' : 'notifications'
          }. <a href="${app}/launches" target="_blank">See them in PostDelegate</a></p>`
        : '',
      emailButton(`${app}/launches`, 'Open PostDelegate'),
    ].join('');

    return {
      subject:
        notifications.length === 1
          ? this.digestSubject(notifications[0], cards[0])
          : DIGEST_SUBJECT,
      html,
    };
  }

  private digestSubject(notification: DigestNotification, card: EmailCard) {
    if (
      notification.type === 'success' &&
      PUBLISHED_MESSAGE.test(notification.message) &&
      card.title
    ) {
      return notification.publishedLabel
        ? `Your post was ${lowerFirst(notification.publishedLabel)}`
        : `Your post has been published on ${card.title}`;
    }
    return notification.title || DIGEST_SUBJECT;
  }

  // one notification as a card: the channel's name and icon, a status, the
  // time and a link instead of the raw URL; anything else keeps its text
  digestCard(
    notification: DigestNotification,
    timezone?: string | null
  ): EmailCard {
    const published = notification.message.match(PUBLISHED_MESSAGE);
    const error = notification.message.match(ERROR_MESSAGE);
    const identifier =
      notification.provider ||
      (published?.[1] || error?.[2] || '').toLowerCase();
    const provider = identifier
      ? this._integrationManager.getSocialIntegration(identifier)
      : undefined;
    const card = {
      title: provider?.name?.replace(/\s+/g, ' ').trim() || undefined,
      icon:
        provider && process.env.FRONTEND_URL
          ? `${process.env.FRONTEND_URL}/icons/platforms/${provider.identifier}.png`
          : undefined,
      time: this.digestTime(notification.createdAt, timezone),
    };

    if (notification.type === 'fail') {
      // the card already names the channel, so only the reason is kept
      return {
        ...card,
        tone: 'fail',
        status: error?.[1] ? 'Comments failed' : 'Failed',
        message: (card.title && error?.[3]) || notification.message,
      };
    }

    if (notification.type === 'success' && published) {
      // a post without a URL, or with an unsafe one, gets no button
      const href = this.digestLink(published[2]);
      return {
        ...card,
        // a provider label means the post is not public yet, e.g. an inbox upload
        tone: notification.publishedLabel ? 'info' : 'success',
        status: notification.publishedLabel || 'Published',
        ...(href
          ? {
              link: {
                href,
                label: notification.publishedLinkLabel || 'View post',
              },
            }
          : {}),
      };
    }

    return {
      ...card,
      tone: notification.type === 'info' ? 'info' : 'success',
      status: notification.type === 'info' ? 'Needs attention' : 'Update',
      message: notification.message,
    };
  }

  private digestLink(url: string) {
    if (!url) {
      return undefined;
    }
    try {
      return ['http:', 'https:'].includes(new URL(url).protocol)
        ? url
        : undefined;
    } catch (err) {
      return undefined;
    }
  }

  private digestTime(createdAt?: string, timezone?: string | null) {
    const date = createdAt ? new Date(createdAt) : undefined;
    if (!date || isNaN(date.getTime())) {
      return undefined;
    }
    const format = (timeZone: string) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(date);
    try {
      return format(timezone || 'UTC');
    } catch (err) {
      // an unknown timezone name
      return format('UTC');
    }
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

  // Once a day per workspace, however many posts were held. A held post is a
  // publishing failure, so it goes to the members who want failure emails
  // (the 'info' type would skip every preference). The day is claimed first
  // so posts held at the same moment send one notice, and released when the
  // send fails so the next held post tries again
  private async sendChannelsPausedEmail(orgId: string) {
    const key = `channels-paused-email:${orgId}:${dayjs().format('YYYY-MM-DD')}`;
    let claimed = false;
    try {
      if ((await ioRedis.set(key, '1', 'EX', 24 * 60 * 60, 'NX')) !== 'OK') {
        return;
      }
      claimed = true;
    } catch (err) {
      // without redis the notice still goes out
    }

    try {
      await this.sendEmailsToOrg(
        orgId,
        'Some scheduled posts were not published',
        'One or more scheduled posts were not published because their channel is turned off. This happens when a trial ends or the plan changes. Turn the channels back on from the calendar, or upgrade your plan, then reschedule the posts.',
        'fail'
      );
    } catch (err) {
      if (claimed) {
        await ioRedis.del(key).catch(() => undefined);
      }
      throw err;
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
