import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

// statuses of a render nothing will ever change again
export const STUDIO_FINAL_STATUSES = ['completed', 'failed', 'cancelled'];

const renderSelect = {
  id: true,
  projectId: true,
  status: true,
  progress: true,
  seconds: true,
  error: true,
  mediaId: true,
  path: true,
  thumbnail: true,
  createdAt: true,
  updatedAt: true,
};

// thrown inside the transaction only to roll the media row back
class StudioRenderLost extends Error {}

@Injectable()
export class StudioRepository {
  constructor(
    private _studioProject: PrismaRepository<'studioProject'>,
    private _studioRender: PrismaRepository<'studioRender'>,
    private _transaction: PrismaTransaction
  ) {}

  getProjects(org: string) {
    return this._studioProject.model.studioProject.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 100,
      select: {
        id: true,
        name: true,
        template: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  getProject(org: string, id: string) {
    return this._studioProject.model.studioProject.findFirst({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        template: true,
        spec: true,
        createdAt: true,
        updatedAt: true,
        renders: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 10,
          select: renderSelect,
        },
      },
    });
  }

  createProject(org: string, name: string, template: string, spec: string) {
    return this._studioProject.model.studioProject.create({
      data: {
        organizationId: org,
        name,
        template,
        spec,
      },
      select: {
        id: true,
      },
    });
  }

  updateProject(
    org: string,
    id: string,
    data: { name?: string; spec?: string }
  ) {
    return this._studioProject.model.studioProject.update({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
      },
      data,
      select: {
        id: true,
      },
    });
  }

  deleteProject(org: string, id: string) {
    return this._studioProject.model.studioProject.update({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
      select: {
        id: true,
      },
    });
  }

  createRender(
    org: string,
    projectId: string,
    seconds: number,
    specSnapshot: string
  ) {
    return this._studioRender.model.studioRender.create({
      data: {
        organizationId: org,
        projectId,
        seconds,
        specSnapshot,
      },
      select: {
        id: true,
      },
    });
  }

  getRender(org: string, id: string) {
    return this._studioRender.model.studioRender.findFirst({
      where: {
        id,
        organizationId: org,
      },
      select: renderSelect,
    });
  }

  // For the worker, which only has the id
  getRenderById(id: string) {
    return this._studioRender.model.studioRender.findUnique({
      where: {
        id,
      },
      include: {
        project: {
          select: {
            name: true,
            template: true,
          },
        },
      },
    });
  }

  updateRender(
    id: string,
    data: {
      status?: string;
      progress?: number;
      error?: string | null;
      mediaId?: string;
      path?: string;
      thumbnail?: string | null;
    }
  ) {
    return this._studioRender.model.studioRender.update({
      where: {
        id,
      },
      data,
      select: {
        id: true,
      },
    });
  }

  // Whether the render may still save its video: not cancelled, failed or
  // saved, and its project not deleted
  async isRenderLive(id: string) {
    return !!(await this._studioRender.model.studioRender.findFirst({
      where: {
        id,
        mediaId: null,
        status: { notIn: STUDIO_FINAL_STATUSES },
        project: { deletedAt: null },
      },
      select: { id: true },
    }));
  }

  // The media row and the render's link to it in one transaction. Only a
  // render still live and without a media wins; an attempt that lost (a
  // retry racing the first one, a cancel, a deleted project) rolls back and
  // leaves no media behind. Returns null when it lost
  async saveRenderMedia(
    id: string,
    org: string,
    media: {
      name: string;
      path: string;
      originalName: string;
      thumbnail: string;
      alt: string;
    }
  ) {
    try {
      return await this._transaction.model.$transaction(async (tx) => {
        const saved = await tx.media.create({
          data: {
            organization: { connect: { id: org } },
            name: media.name,
            path: media.path,
            originalName: media.originalName,
            thumbnail: media.thumbnail,
            thumbnailTimestamp: 0,
            alt: media.alt,
          },
          select: { id: true },
        });

        const claimed = await tx.studioRender.updateMany({
          where: {
            id,
            mediaId: null,
            status: { notIn: STUDIO_FINAL_STATUSES },
            project: { deletedAt: null },
          },
          data: {
            mediaId: saved.id,
            path: media.path,
            thumbnail: media.thumbnail,
          },
        });
        if (!claimed.count) {
          throw new StudioRenderLost();
        }

        return saved;
      });
    } catch (err) {
      if (err instanceof StudioRenderLost) {
        return null;
      }
      throw err;
    }
  }

  // Renders of a workspace that are queued or running, oldest first: the
  // oldest is the one whose turn it is
  getActiveRenders(org: string) {
    return this._studioRender.model.studioRender.findMany({
      where: {
        organizationId: org,
        status: {
          notIn: STUDIO_FINAL_STATUSES,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
        projectId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  // Only renders touched lately: one whose workflow died must not hold the
  // queue of every workspace until its own workspace comes back
  countQueuedRenders(since: Date) {
    return this._studioRender.model.studioRender.count({
      where: {
        status: 'queued',
        updatedAt: {
          gte: since,
        },
      },
    });
  }

  // Starts that count toward a limit: a render that failed on our side is
  // never held against the workspace
  countRendersSince(org: string, since?: Date) {
    return this._studioRender.model.studioRender.count({
      where: {
        organizationId: org,
        status: {
          not: 'failed',
        },
        ...(since ? { createdAt: { gte: since } } : {}),
      },
    });
  }
}
