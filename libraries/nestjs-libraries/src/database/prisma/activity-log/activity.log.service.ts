import { Injectable } from '@nestjs/common';
import { ActivityAction } from '@prisma/client';
import {
  ActivityEntry,
  ActivityLogRepository,
} from '@gitroom/nestjs-libraries/database/prisma/activity-log/activity.log.repository';

const PAGE_SIZE = 30;

@Injectable()
export class ActivityLogService {
  constructor(private _activityLogRepository: ActivityLogRepository) {}

  record(entry: ActivityEntry) {
    return this._activityLogRepository.create(entry);
  }

  // History must never break the action it describes
  async recordSafely(entry: ActivityEntry) {
    try {
      await this._activityLogRepository.create(entry);
    } catch (err) {}
  }

  // Called once a post went out, the workflow knows only the post id
  async recordPublished(postId: string) {
    try {
      const post = await this._activityLogRepository.getRootPost(postId);
      if (!post) {
        return;
      }
      await this._activityLogRepository.create({
        organizationId: post.organizationId,
        postId: post.id,
        action: 'PUBLISHED',
        actorType: 'SYSTEM',
      });
    } catch (err) {}
  }

  latestForPosts(
    organizationId: string,
    postIds: string[],
    actions: ActivityAction[]
  ) {
    if (!postIds.length) {
      return Promise.resolve([]);
    }
    return this._activityLogRepository.listForPosts(
      organizationId,
      postIds,
      actions
    );
  }

  async getLastAuthorId(organizationId: string, postId: string) {
    return (
      await this._activityLogRepository.getLastAuthor(organizationId, postId)
    )?.actorUserId;
  }

  async list(organizationId: string, query: { postId?: string; page?: number }) {
    const page = query.page || 0;
    const { items, total } = await this._activityLogRepository.list(
      organizationId,
      { postId: query.postId, page, limit: PAGE_SIZE }
    );

    const postIds = [
      ...new Set(items.map((p) => p.postId).filter(Boolean) as string[]),
    ];
    const posts = postIds.length
      ? await this._activityLogRepository.getPostsSummary(
          organizationId,
          postIds
        )
      : [];
    const byId = new Map(posts.map((p) => [p.id, p]));

    return {
      total,
      pages: Math.ceil(total / PAGE_SIZE),
      items: items.map((item) => {
        const post = item.postId ? byId.get(item.postId) : undefined;
        return {
          id: item.id,
          action: item.action,
          actorType: item.actorType,
          actorName: item.actorName,
          // a client's email is shown to the team, it is what they entered
          actorEmail: item.actorEmail,
          comment: item.comment,
          createdAt: item.createdAt,
          post: post
            ? {
                id: post.id,
                group: post.group,
                deleted: !!post.deletedAt,
                content: post.content,
                integration: post.integration,
              }
            : null,
        };
      }),
    };
  }
}
