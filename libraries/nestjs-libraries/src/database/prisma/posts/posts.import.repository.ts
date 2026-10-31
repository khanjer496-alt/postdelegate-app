import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// an import that stopped half way (a deploy, a crash) without finishing or
// releasing its claim; a running import touches its claim after every post
const STALE_AFTER = 15 * 60 * 1000;

@Injectable()
export class PostsImportRepository {
  constructor(private _postImport: PrismaRepository<'postImport'>) {}

  // The unique (organization, hash) row makes the claim atomic: two requests
  // with the same file can't both start creating posts
  async claim(orgId: string, hash: string) {
    try {
      await this._postImport.model.postImport.create({
        data: {
          organizationId: orgId,
          hash,
        },
      });
      return { claimed: true as const, progress: null as string | null };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this._postImport.model.postImport.findUnique({
          where: {
            organizationId_hash: {
              organizationId: orgId,
              hash,
            },
          },
          select: {
            status: true,
            result: true,
          },
        });
        if (existing?.status === 'processing') {
          const { count } = await this._postImport.model.postImport.updateMany({
            where: {
              organizationId: orgId,
              hash,
              status: 'processing',
              updatedAt: { lt: new Date(Date.now() - STALE_AFTER) },
            },
            data: { updatedAt: new Date() },
          });
          if (count === 1) {
            // the rows it already created are not created again
            return { claimed: true as const, progress: existing.result };
          }
        }
        return { claimed: false as const, existing };
      }
      throw err;
    }
  }

  finish(orgId: string, hash: string, result: string) {
    return this._postImport.model.postImport.update({
      where: {
        organizationId_hash: {
          organizationId: orgId,
          hash,
        },
      },
      data: {
        status: 'done',
        result,
      },
    });
  }

  // saves the progress of a running import, which also keeps it fresh
  touch(orgId: string, hash: string, progress: string) {
    return this._postImport.model.postImport.updateMany({
      where: {
        organizationId: orgId,
        hash,
        status: 'processing',
      },
      data: { updatedAt: new Date(), result: progress },
    });
  }

  // nothing was created, so the same file can be imported again
  release(orgId: string, hash: string) {
    return this._postImport.model.postImport.deleteMany({
      where: {
        organizationId: orgId,
        hash,
        status: 'processing',
      },
    });
  }
}
