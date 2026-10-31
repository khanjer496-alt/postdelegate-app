import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Injectable()
export class AnalyticsRepository {
  constructor(
    private _post: PrismaRepository<'post'>,
    private _integration: PrismaRepository<'integration'>
  ) {}

  // Top-level posts of the organization (thread children share a parentPostId)
  // on channels that still exist: published and failed in [from, now], queued
  // in (now, until]. Only the three columns the overview needs are read.
  getOverviewPosts(orgId: string, from: Date, now: Date, until: Date) {
    const where: Prisma.PostWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      parentPostId: null,
      integration: {
        organizationId: orgId,
        deletedAt: null,
      },
      OR: [
        {
          state: { in: ['PUBLISHED', 'ERROR'] },
          publishDate: { gte: from, lte: now },
        },
        {
          state: 'QUEUE',
          publishDate: { gt: now, lte: until },
        },
      ],
    };

    return this._post.model.post.findMany({
      where,
      select: {
        integrationId: true,
        state: true,
        publishDate: true,
      },
    });
  }

  getOverviewChannels(orgId: string) {
    return this._integration.model.integration.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        customName: true,
        picture: true,
        providerIdentifier: true,
        type: true,
        disabled: true,
        refreshNeeded: true,
        inBetweenSteps: true,
        tokenExpiration: true,
      },
    });
  }
}
