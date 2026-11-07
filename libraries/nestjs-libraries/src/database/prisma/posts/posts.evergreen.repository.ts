import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class PostsEvergreenRepository {
  constructor(private _post: PrismaRepository<'post'>) {}

  // the channel posts of a group (not their comments), the ones that carry
  // the repeat schedule
  getGroupRoots(orgId: string, group: string) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        group,
        parentPostId: null,
        deletedAt: null,
      },
      select: {
        id: true,
        state: true,
        publishDate: true,
        intervalInDays: true,
        evergreenMaxShares: true,
        evergreenUntil: true,
        evergreenVariants: true,
        settings: true,
        integration: {
          select: {
            id: true,
            name: true,
            providerIdentifier: true,
          },
        },
      },
      orderBy: {
        publishDate: 'asc',
      },
    });
  }

  updateGroupRoots(
    orgId: string,
    group: string,
    data: {
      intervalInDays: number | null;
      evergreenMaxShares: number | null;
      evergreenUntil: Date | null;
      evergreenVariants: string | null;
    }
  ) {
    return this._post.model.post.updateMany({
      where: {
        organizationId: orgId,
        group,
        parentPostId: null,
        deletedAt: null,
      },
      data,
    });
  }
}
