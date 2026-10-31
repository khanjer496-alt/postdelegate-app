import { Injectable } from '@nestjs/common';
import { ActivityAction, ActivityActor } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export interface ActivityEntry {
  organizationId: string;
  postId?: string | null;
  action: ActivityAction;
  actorType: ActivityActor;
  actorUserId?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  comment?: string | null;
  linkId?: string | null;
}

// Append-only: the history is only ever created and read
@Injectable()
export class ActivityLogRepository {
  constructor(
    private _activity: PrismaRepository<'activityLog'>,
    private _post: PrismaRepository<'post'>
  ) {}

  create(entry: ActivityEntry) {
    return this._activity.model.activityLog.create({ data: entry });
  }

  async list(
    organizationId: string,
    query: { postId?: string; page: number; limit: number }
  ) {
    const where = {
      organizationId,
      ...(query.postId ? { postId: query.postId } : {}),
    };
    const [items, total] = await Promise.all([
      this._activity.model.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.page * query.limit,
        take: query.limit,
      }),
      this._activity.model.activityLog.count({ where }),
    ]);
    return { items, total };
  }

  // Newest first, for a set of posts
  listForPosts(
    organizationId: string,
    postIds: string[],
    actions: ActivityAction[]
  ) {
    return this._activity.model.activityLog.findMany({
      where: { organizationId, postId: { in: postIds }, action: { in: actions } },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    });
  }

  // The posts an activity page mentions, only the ones of this workspace
  getPostsSummary(organizationId: string, ids: string[]) {
    return this._post.model.post.findMany({
      where: { organizationId, id: { in: ids } },
      select: {
        id: true,
        group: true,
        content: true,
        deletedAt: true,
        integration: {
          select: {
            name: true,
            picture: true,
            providerIdentifier: true,
          },
        },
      },
    });
  }

  // The main post a published row belongs to, comments are not logged
  getRootPost(postId: string) {
    return this._post.model.post.findFirst({
      where: { id: postId, parentPostId: null },
      select: { id: true, organizationId: true },
    });
  }

  // Who to tell when a post is approved or sent back: the last member who
  // submitted it, or the one who created it
  getLastAuthor(organizationId: string, postId: string) {
    return this._activity.model.activityLog.findFirst({
      where: {
        organizationId,
        postId,
        actorType: 'USER',
        actorUserId: { not: null },
        action: { in: ['SUBMITTED', 'CREATED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { actorUserId: true },
    });
  }
}
