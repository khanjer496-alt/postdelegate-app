import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { auditErrorBody } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.audit.body';

const UNKNOWN_TOKEN = 'An unknown error occurred';

interface ListErrorsParams {
  page?: number;
  limit?: number;
  platform?: string;
  email?: string;
  unknownFirst?: boolean;
}

@Injectable()
export class ErrorsRepository {
  constructor(private _errors: PrismaRepository<'errors'>) {}

  private buildWhere(params: ListErrorsParams) {
    const where: any = {};
    if (params.platform) {
      where.platform = params.platform;
    }
    if (params.email) {
      where.organization = {
        users: {
          some: {
            user: {
              email: { contains: params.email, mode: 'insensitive' },
            },
          },
        },
      };
    }
    return where;
  }

  // The columns the admin errors view shows, and no others.
  private get select() {
    return {
      id: true,
      message: true,
      body: true,
      platform: true,
      postId: true,
      createdAt: true,
      organization: {
        select: {
          id: true,
          name: true,
          users: {
            select: {
              user: { select: { id: true, email: true, name: true } },
            },
          },
        },
      },
      post: { select: { id: true, content: true } },
    } as const;
  }

  // rows written before the allowlist can still hold whole post rows
  private audited<T extends { body: string }>(items: T[]): T[] {
    return items.map((item) => ({ ...item, body: auditErrorBody(item.body) }));
  }

  async listPlatforms() {
    const rows = await this._errors.model.errors.findMany({
      distinct: ['platform'],
      select: { platform: true },
      orderBy: { platform: 'asc' },
    });
    return rows.map((r) => r.platform);
  }

  async listErrors(params: ListErrorsParams) {
    const page = Math.max(0, params.page || 0);
    const limit = Math.min(Math.max(1, params.limit || 20), 100);
    const skip = page * limit;
    const where = this.buildWhere(params);
    const select = this.select;

    if (!params.unknownFirst) {
      const [items, total] = await Promise.all([
        this._errors.model.errors.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          select,
        }),
        this._errors.model.errors.count({ where }),
      ]);
      return {
        items: this.audited(items),
        total,
        page,
        limit,
        hasMore: skip + items.length < total,
      };
    }

    const unknownWhere = { ...where, message: { contains: UNKNOWN_TOKEN } };
    const knownWhere = {
      ...where,
      NOT: { message: { contains: UNKNOWN_TOKEN } },
    };

    const [unknownTotal, knownTotal] = await Promise.all([
      this._errors.model.errors.count({ where: unknownWhere }),
      this._errors.model.errors.count({ where: knownWhere }),
    ]);

    let unknownItems: any[] = [];
    let knownItems: any[] = [];

    if (skip < unknownTotal) {
      const takeUnknown = Math.min(unknownTotal - skip, limit);
      unknownItems = await this._errors.model.errors.findMany({
        where: unknownWhere,
        orderBy: { createdAt: 'desc' },
        skip,
        take: takeUnknown,
        select,
      });
      const remaining = limit - unknownItems.length;
      if (remaining > 0) {
        knownItems = await this._errors.model.errors.findMany({
          where: knownWhere,
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: remaining,
          select,
        });
      }
    } else {
      knownItems = await this._errors.model.errors.findMany({
        where: knownWhere,
        orderBy: { createdAt: 'desc' },
        skip: skip - unknownTotal,
        take: limit,
        select,
      });
    }

    const items = this.audited([...unknownItems, ...knownItems]);
    const total = unknownTotal + knownTotal;
    return {
      items,
      total,
      page,
      limit,
      hasMore: skip + items.length < total,
    };
  }
}
