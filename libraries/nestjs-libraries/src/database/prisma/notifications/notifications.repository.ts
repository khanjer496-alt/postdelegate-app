import { PrismaRepository, PrismaTransaction } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { capitalize } from 'lodash';

export const notificationScopeLink = (integrationId: string, postId?: string) => postId
  ? `/launches?postId=${encodeURIComponent(postId)}&notification=publishing`
  : `/launches?integrationId=${encodeURIComponent(integrationId)}&notification=connection`;

@Injectable()
export class NotificationsRepository {
  constructor(
    private _notifications: PrismaRepository<'notifications'>,
    private _user: PrismaRepository<'user'>,
    private _posts: PrismaRepository<'post'>,
    private _transaction: PrismaTransaction
  ) {}

  getPostNotificationContext(organizationId: string, postId: string) {
    return this._posts.model.post.findFirst({
      where: { organizationId, id: postId },
      select: {
        id: true, integrationId: true, deletedAt: true,
        integration: { select: { providerIdentifier: true, deletedAt: true } },
      },
    });
  }

  getIntegrationNotificationContext(organizationId: string, integrationId: string) {
    return this._transaction.model.$transaction((tx) => tx.integration.findFirst({
      where: { organizationId, id: integrationId },
      select: { id: true, providerIdentifier: true, deletedAt: true },
    }));
  }

  createScopedNotification(organizationId: string, integrationId: string, content: string, postId?: string) {
    return this._transaction.model.$transaction(async (tx) => {
      // Serialize against the lifecycle's deletion write on this same row.
      // A late activity cannot recreate data after cleanup has won the lock.
      const connection = await tx.integration.updateMany({
        where: { organizationId, id: integrationId, deletedAt: null },
        data: { deletedAt: null },
      });
      if (!connection.count) return false;
      if (postId && !(await tx.post.findFirst({
        where: { organizationId, integrationId, id: postId, deletedAt: null },
        select: { id: true },
      }))) return false;
      await tx.notifications.create({
        data: { organizationId, content, link: notificationScopeLink(integrationId, postId) },
      });
      return true;
    });
  }

  async purgeAuthorizationNotifications(organizationId: string, integrationId: string): Promise<{ deleted: number; unattributed: number }> {
    return this._transaction.model.$transaction(async (tx) => {
      const integration = await tx.integration.findFirst({
        where: { organizationId, id: integrationId, deletedAt: { not: null } },
        select: { id: true, providerIdentifier: true },
      });
      if (!integration) return { deleted: 0, unattributed: 0 };

      // Existing notification rows have no post/channel foreign key. Only a
      // dedicated new link or an exact historical system template with a known
      // release URL is sufficient attribution; free text is never bulk erased.
      const limit = 1000;
      const posts = await tx.post.findMany({
        where: { organizationId, integration: { providerIdentifier: integration.providerIdentifier } },
        select: { id: true, integrationId: true, releaseURL: true },
        take: limit + 1,
      });
      const scopedPosts = posts.slice(0, limit).filter((post) => post.integrationId === integrationId);
      const links = new Set([
        notificationScopeLink(integrationId),
        ...scopedPosts.map((post) => notificationScopeLink(integrationId, post.id)),
      ]);
      const providerName = capitalize(integration.providerIdentifier);
      const successMessage = (url: string) => `Your post has been published on ${providerName} at ${url}`;
      const messageOwners = new Map<string, Set<string>>();
      for (const post of posts.slice(0, limit)) {
        if (!post.releaseURL) continue;
        const message = successMessage(post.releaseURL);
        const owners = messageOwners.get(message) || new Set<string>();
        owners.add(post.integrationId);
        messageOwners.set(message, owners);
      }
      const prefixes = [
        `Your post has been published on ${providerName} at `,
        `We couldn't post to ${integration.providerIdentifier} for `,
        `Your post was sent to ${providerName}, but we couldn't confirm it was published.`,
        `An error occurred while posting on ${integration.providerIdentifier}`,
        `An error occurred while posting comments on ${integration.providerIdentifier}`,
        `Could not refresh your ${integration.providerIdentifier} channel `,
      ];
      const notifications = await tx.notifications.findMany({
        where: {
          organizationId,
          OR: [
            { link: { in: [...links] } },
            { link: null, OR: prefixes.map((prefix) => ({ content: { startsWith: prefix } })) },
          ],
        },
        select: { id: true, content: true, link: true },
        take: limit + 1,
      });
      const ids: string[] = [];
      let unattributed = posts.length > limit || notifications.length > limit ? 1 : 0;
      for (const notification of notifications.slice(0, limit)) {
        if (notification.link && links.has(notification.link)) {
          ids.push(notification.id);
          continue;
        }
        const owners = messageOwners.get(notification.content);
        if (posts.length <= limit && owners?.size === 1) {
          if (owners.has(integrationId)) ids.push(notification.id);
          continue; // An exact notice for another channel remains untouched.
        }
        unattributed++;
      }
      const removed = ids.length ? await tx.notifications.deleteMany({
        where: { organizationId, id: { in: ids } },
      }) : { count: 0 };
      return { deleted: removed.count, unattributed };
    });
  }

  getLastReadNotification(userId: string) {
    return this._user.model.user.findFirst({
      where: {
        id: userId,
      },
      select: {
        lastReadNotifications: true,
      },
    });
  }

  async getMainPageCount(organizationId: string, userId: string) {
    const { lastReadNotifications } = (await this.getLastReadNotification(
      userId
    ))!;

    return {
      total: await this._notifications.model.notifications.count({
        where: {
          organizationId,
          createdAt: {
            gt: lastReadNotifications!,
          },
        },
      }),
    };
  }

  async createNotification(organizationId: string, content: string) {
    await this._notifications.model.notifications.create({
      data: {
        organizationId,
        content,
      },
    });
  }

  async getNotificationsSince(organizationId: string, since: string) {
    return this._notifications.model.notifications.findMany({
      where: {
        organizationId,
        createdAt: {
          gte: new Date(since),
        },
      },
    });
  }

  async getNotificationsPaginated(organizationId: string, page: number) {
    const limit = 100;
    const skip = page * limit;

    const where = {
      organizationId,
      deletedAt: null as Date | null,
    };

    const [notifications, total] = await Promise.all([
      this._notifications.model.notifications.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        select: {
          id: true,
          content: true,
          link: true,
          createdAt: true,
        },
      }),
      this._notifications.model.notifications.count({ where }),
    ]);

    return {
      notifications,
      total,
      page,
      limit,
      hasMore: skip + notifications.length < total,
    };
  }

  async getNotifications(organizationId: string, userId: string) {
    const { lastReadNotifications } = (await this.getLastReadNotification(
      userId
    ))!;

    await this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        lastReadNotifications: new Date(),
      },
    });

    return {
      lastReadNotifications,
      notifications: await this._notifications.model.notifications.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        take: 10,
        where: {
          organizationId,
        },
        select: {
          createdAt: true,
          content: true,
        },
      }),
    };
  }
}
