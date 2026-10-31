import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { IdeaStatus } from '@prisma/client';

const ideaSelect = {
  id: true,
  title: true,
  notes: true,
  media: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  tag: {
    select: {
      id: true,
      name: true,
      color: true,
      kind: true,
      deletedAt: true,
    },
  },
} as const;

@Injectable()
export class IdeasRepository {
  constructor(
    private _idea: PrismaRepository<'idea'>,
    private _tags: PrismaRepository<'tags'>
  ) {}

  getIdeas(orgId: string) {
    return this._idea.model.idea.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
      select: ideaSelect,
      orderBy: {
        createdAt: 'desc',
      },
      take: 500,
    });
  }

  getIdea(orgId: string, id: string) {
    return this._idea.model.idea.findFirst({
      where: {
        id,
        organizationId: orgId,
        deletedAt: null,
      },
      select: ideaSelect,
    });
  }

  // a tag can only be attached when it belongs to the same workspace
  tagOfOrg(orgId: string, tagId: string) {
    return this._tags.model.tags.findFirst({
      where: {
        id: tagId,
        orgId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });
  }

  createIdea(
    orgId: string,
    userId: string,
    data: {
      title: string;
      notes: string | null;
      media: string | null;
      tagId: string | null;
      status: IdeaStatus;
    }
  ) {
    return this._idea.model.idea.create({
      data: {
        organizationId: orgId,
        createdById: userId,
        ...data,
      },
      select: ideaSelect,
    });
  }

  async updateIdea(
    orgId: string,
    id: string,
    data: {
      title?: string;
      notes?: string | null;
      media?: string | null;
      tagId?: string | null;
      status?: IdeaStatus;
    }
  ) {
    const { count } = await this._idea.model.idea.updateMany({
      where: {
        id,
        organizationId: orgId,
        deletedAt: null,
      },
      data,
    });
    return count;
  }

  async deleteIdea(orgId: string, id: string) {
    const { count } = await this._idea.model.idea.updateMany({
      where: {
        id,
        organizationId: orgId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });
    return count;
  }
}
