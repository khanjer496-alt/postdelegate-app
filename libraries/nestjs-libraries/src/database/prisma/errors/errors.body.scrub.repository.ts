import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

// The paged reads and compare-and-swap writes the scrub-error-bodies command
// needs, plus the read-only counts it reports. Nothing outside that command
// uses it.
@Injectable()
export class ErrorBodyScrubRepository {
  constructor(
    private _errors: PrismaRepository<'errors'>,
    private _post: PrismaRepository<'post'>
  ) {}

  // Ordered by id so a cursor can resume, and selecting only the body.
  page(take: number, cursor?: string): Promise<{ id: string; body: string }[]> {
    return this._errors.model.errors.findMany({
      take,
      ...(cursor ? { where: { id: { gt: cursor } } } : {}),
      orderBy: { id: 'asc' },
      select: { id: true, body: true },
    });
  }

  // Writes only while the row still holds the body the scrub read. A row that
  // changed or was erased in between leaves count 0, and the scrub reports it
  // as skipped rather than overwriting.
  replace(
    id: string,
    previousBody: string,
    body: string
  ): Promise<{ count: number }> {
    return this._errors.model.errors.updateMany({
      where: { id, body: previousBody },
      data: { body },
    });
  }

  // How many rows hold `pattern` - a count, never the rows themselves.
  countErrorMessagesContaining(pattern: string): Promise<number> {
    return this._errors.model.errors.count({
      where: { message: { contains: pattern } },
    });
  }

  countPostErrorsContaining(pattern: string): Promise<number> {
    return this._post.model.post.count({
      where: { error: { contains: pattern } },
    });
  }
}
