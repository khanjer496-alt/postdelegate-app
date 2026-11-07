import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { STUDIO_AI_ASSET_KINDS } from '@gitroom/nestjs-libraries/studio/ai/studio.ai.interface';

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
    private _transaction: PrismaTransaction,
    private _studioAsset: PrismaRepository<'studioAsset'>
  ) {}

  // Projects of assistants and the public API are left out unless asked
  // for, so they never push the workspace's own projects off the list
  getProjects(org: string, includeApi = false) {
    return this._studioProject.model.studioProject.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
        ...(includeApi ? {} : { source: null }),
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 100,
      select: {
        id: true,
        name: true,
        template: true,
        source: true,
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

  createProject(
    org: string,
    name: string,
    template: string,
    spec: string,
    source?: string
  ) {
    return this._studioProject.model.studioProject.create({
      data: {
        organizationId: org,
        name,
        template,
        spec,
        ...(source ? { source } : {}),
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

  // A project that never got a render (its start failed) leaves no row
  // behind. Returns false when it has renders, those keep their project
  async removeUnrenderedProject(org: string, id: string) {
    const { count } =
      await this._studioProject.model.studioProject.deleteMany({
        where: {
          id,
          organizationId: org,
          renders: { none: {} },
        },
      });
    return count > 0;
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

  // The finished videos of the workspace that are still in the media
  // library's hands, newest first
  getFinishedRenders(org: string) {
    return this._studioRender.model.studioRender.findMany({
      where: {
        organizationId: org,
        status: 'completed',
        mediaId: { not: null },
        project: { deletedAt: null },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
      select: {
        ...renderSelect,
        project: {
          select: {
            name: true,
            template: true,
          },
        },
      },
    });
  }

  // Only finished renders of the workspace with their video
  getRendersToSchedule(org: string, ids: string[]) {
    return this._studioRender.model.studioRender.findMany({
      where: {
        id: { in: ids },
        organizationId: org,
        status: 'completed',
        mediaId: { not: null },
      },
      select: {
        id: true,
        mediaId: true,
      },
    });
  }

  // Render records nothing reads anymore; their videos are media and stay
  pruneRenders(before: Date) {
    return this._studioRender.model.studioRender.deleteMany({
      where: {
        createdAt: { lt: before },
        status: { in: STUDIO_FINAL_STATUSES },
      },
    });
  }

  createAsset(
    org: string,
    data: { kind: string; name: string; path: string; originalName: string }
  ) {
    return this._studioAsset.model.studioAsset.create({
      data: {
        organizationId: org,
        ...data,
      },
      select: {
        id: true,
        originalName: true,
        path: true,
      },
    });
  }

  getAsset(org: string, id: string) {
    return this._studioAsset.model.studioAsset.findFirst({
      where: {
        id,
        organizationId: org,
        kind: 'music',
      },
      select: {
        id: true,
        name: true,
        path: true,
        originalName: true,
        projectId: true,
      },
    });
  }

  countAssets(org: string) {
    return this._studioAsset.model.studioAsset.count({
      where: {
        organizationId: org,
        kind: 'music',
      },
    });
  }

  getProjectAssets(org: string, projectId: string) {
    return this._studioAsset.model.studioAsset.findMany({
      where: {
        organizationId: org,
        projectId,
      },
      select: {
        id: true,
        path: true,
      },
    });
  }

  // The project takes an asset of the workspace no other project uses.
  // False when there is no such asset
  async attachAsset(org: string, id: string, projectId: string) {
    return !!(
      await this._studioAsset.model.studioAsset.updateMany({
        where: {
          id,
          organizationId: org,
          kind: 'music',
          OR: [{ projectId: null }, { projectId }],
        },
        data: {
          projectId,
        },
      })
    ).count;
  }

  // The project lets go of every asset but "keep"; one let go of counts as
  // unused from now on
  detachAssets(org: string, projectId: string, keep?: string) {
    return this._studioAsset.model.studioAsset.updateMany({
      where: {
        organizationId: org,
        projectId,
        kind: 'music',
        ...(keep ? { id: { not: keep } } : {}),
      },
      data: {
        projectId: null,
      },
    });
  }

  // The voices and stills the AI made for a project. They stay with it while
  // it lives, so the cleanup of unused assets never takes them; a file no
  // longer asked for is removed at once, and all of them with the project
  getAiAssets(projectId: string) {
    return this._studioAsset.model.studioAsset.findMany({
      where: {
        projectId,
        kind: { in: STUDIO_AI_ASSET_KINDS },
      },
      select: {
        id: true,
        kind: true,
        name: true,
        path: true,
        data: true,
      },
    });
  }

  createAiAsset(
    org: string,
    projectId: string,
    data: { kind: string; name: string; path: string; data: string }
  ) {
    return this._studioAsset.model.studioAsset.create({
      data: {
        organizationId: org,
        projectId,
        ...data,
      },
      select: {
        id: true,
      },
    });
  }

  updateAiAssetData(id: string, data: string) {
    return this._studioAsset.model.studioAsset.updateMany({
      where: {
        id,
        kind: { in: STUDIO_AI_ASSET_KINDS },
      },
      data: {
        data,
      },
    });
  }

  // Whether the row was there to delete
  async deleteAiAsset(id: string) {
    return !!(
      await this._studioAsset.model.studioAsset.deleteMany({
        where: {
          id,
          kind: { in: STUDIO_AI_ASSET_KINDS },
        },
      })
    ).count;
  }

  // Assets of deleted projects, and assets no project has used since
  // "unusedSince", leaving out the ones in "skip"
  getAssetsToRemove(unusedSince: Date, skip: string[], take: number) {
    return this._studioAsset.model.studioAsset.findMany({
      where: {
        ...(skip.length ? { id: { notIn: skip } } : {}),
        OR: [
          { projectId: null, updatedAt: { lt: unusedSince } },
          { project: { deletedAt: { not: null } } },
        ],
      },
      orderBy: {
        createdAt: 'asc',
      },
      take,
      select: {
        id: true,
        path: true,
      },
    });
  }

  // Deletes the asset only while nothing uses it: unused since
  // "unusedSince", or its project deleted. A project that took it in the
  // meantime keeps it (count 0)
  deleteRemovableAsset(id: string, unusedSince: Date) {
    return this._studioAsset.model.studioAsset.deleteMany({
      where: {
        id,
        OR: [
          { projectId: null, updatedAt: { lt: unusedSince } },
          { project: { deletedAt: { not: null } } },
        ],
      },
    });
  }
}
