import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export type SecretTable =
  | 'organization'
  | 'oAuthAuthorization'
  | 'oAuthApp'
  | 'oAuthSelfHostedAuthorization'
  | 'aiCredential'
  | 'thirdParty'
  | 'integration';

// The paged reads and compare-and-swap writes the secrets backfill needs. One
// repository rather than a method on each of the seven owning repositories:
// this is a single maintenance job over columns that happen to live in
// different tables, and nothing outside the backfill uses it.
@Injectable()
export class SecretBackfillRepository {
  constructor(private _db: PrismaRepository<SecretTable>) {}

  // The model accessor is the one dynamic part: the table comes from the
  // backfill's plan list, which is a closed set of literals above.
  private model(table: SecretTable) {
    return (this._db.model as Record<SecretTable, any>)[table];
  }

  // Ordered by id so a cursor can resume, and selecting only the columns the
  // plan declares, so no secret is read that does not have to be.
  page(
    table: SecretTable,
    columns: string[],
    take: number,
    cursor?: string
  ): Promise<Record<string, any>[]> {
    return this.model(table).findMany({
      take,
      ...(cursor ? { where: { id: { gt: cursor } } } : {}),
      orderBy: { id: 'asc' },
      select: columns.reduce(
        (select, column) => ({ ...select, [column]: true }),
        { id: true } as Record<string, boolean>
      ),
    });
  }

  // Writes only while the row still holds what the backfill read. A reconnect,
  // a token refresh or a key rotation that landed in between leaves count 0,
  // and the backfill reports it as skipped rather than overwriting.
  replace(
    table: SecretTable,
    id: string,
    previous: Record<string, unknown>,
    next: Record<string, unknown>
  ): Promise<{ count: number }> {
    return this.model(table).updateMany({
      where: { id, ...previous },
      data: next,
    });
  }
}
