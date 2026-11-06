import { PrismaRepository, PrismaTransaction } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import dayjs from 'dayjs';
import { Integration, Prisma } from '@prisma/client';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { IntegrationTimeDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.time.dto';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { PlugDto } from '@gitroom/nestjs-libraries/dtos/plugs/plug.dto';
import { ProviderAuthorizationCheck } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';
import {
  decryptCredentials,
  encryptCredentials,
  TokenEncryption,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/token.encryption';

type Credentials = { token?: string | null; refreshToken?: string | null };
const blankCredentials = <T extends Credentials>(row: T): T => ({
  ...row,
  ...('token' in row ? { token: '' } : {}),
  ...('refreshToken' in row ? { refreshToken: null } : {}),
});
type IntegrationModel = Pick<
  Prisma.TransactionClient['integration'],
  'findFirst' | 'updateMany'
>;

const authorizationSelect = {
  id: true, organizationId: true, providerIdentifier: true, token: true,
  refreshToken: true, internalId: true, rootInternalId: true, name: true,
  profile: true, picture: true, disabled: true, refreshNeeded: true,
  inBetweenSteps: true, deletedAt: true, updatedAt: true,
} as const;

export const isOwnedIntegrationPicture = (picture: string) => {
  try {
    const image = new URL(picture);
    if (image.username || image.password || image.search || image.hash) return false;
    return [process.env.CLOUDFLARE_BUCKET_URL, process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/uploads/` : undefined]
      .filter(Boolean).some((value) => {
        const base = new URL(value!);
        const prefix = base.pathname.replace(/\/$/, '') + '/';
        return image.origin === base.origin && image.pathname.startsWith(prefix) &&
          /^[A-Za-z0-9_-]+\.(jpe?g|png|gif|webp)$/i.test(image.pathname.slice(prefix.length));
      });
  } catch { return false; }
};

@Injectable()
export class IntegrationRepository {
  private storage = UploadFactory.createStorage();
  constructor(
    private _integration: PrismaRepository<'integration'>,
    private _posts: PrismaRepository<'post'>,
    private _plugs: PrismaRepository<'plugs'>,
    private _exisingPlugData: PrismaRepository<'exisingPlugData'>,
    private _customers: PrismaRepository<'customer'>,
    private _mentions: PrismaRepository<'mentions'>,
    private _transaction: PrismaTransaction,
    private _notificationsRepository: NotificationsRepository
  ) {
    // throws on a malformed key, warns once when tokens stay plaintext
    TokenEncryption.warnIfDisabled();
  }

  // Credentials are encrypted at rest (see token.encryption.ts). Every row
  // leaves this repository with plaintext tokens, and every write goes in
  // encrypted. A value that cannot be decrypted throws a TokenEncryptionError.
  private decryptRow<T extends Credentials>(row: T): T;
  private decryptRow<T extends Credentials>(row: T | null): T | null;
  private decryptRow<T extends Credentials>(row: T | null): T | null {
    return row ? decryptCredentials(row) : row;
  }

  // For lists: one unreadable row must not hide the others. The unreadable
  // credentials are blanked ('skip' leaves the row out) and the id is logged,
  // never the value.
  private decryptRows<T extends Credentials & { id: string }>(
    rows: T[],
    unreadable: 'blank' | 'skip'
  ): T[] {
    const result: T[] = [];
    for (const row of rows) {
      try {
        result.push(decryptCredentials(row));
      } catch (err) {
        console.error(`Integration ${row.id}: ${(err as Error).message}`);
        if (unreadable === 'blank') {
          result.push(blankCredentials(row));
        }
      }
    }
    return result;
  }

  private tokenEquals(stored: string, expected: string) {
    try {
      return TokenEncryption.decrypt(stored) === expected;
    } catch {
      return false;
    }
  }

  // Tokens are stored with a random IV, so SQL cannot compare them with the
  // plaintext a caller remembers. The stored value is read, decrypted and
  // compared here, and the write is pinned to that exact stored value, so it
  // still matches nothing when the token changed in between. Returns null when
  // the row does not exist or holds another token.
  private async pinStoredToken(
    model: IntegrationModel,
    where: Prisma.IntegrationWhereInput,
    expectedToken?: string
  ): Promise<Prisma.IntegrationWhereInput | null> {
    if (!expectedToken) return where;
    const row = await model.findFirst({ where, select: { token: true } });
    if (!row || !this.tokenEquals(row.token, expectedToken)) return null;
    return { ...where, token: row.token };
  }

  private async updateManyIfTokenMatches(
    model: IntegrationModel,
    where: Prisma.IntegrationWhereInput,
    expectedToken: string | undefined,
    data: Prisma.IntegrationUpdateManyMutationInput
  ): Promise<{ count: number }> {
    // a retry covers the stored value being re-encrypted (backfill) between
    // the read and the write
    for (let attempt = 0; attempt < 3; attempt++) {
      const pinned = await this.pinStoredToken(model, where, expectedToken);
      if (!pinned) return { count: 0 };
      const result = await model.updateMany({ where: pinned, data });
      if (result.count || !expectedToken) return result;
    }
    return { count: 0 };
  }

  private async lockAuthorizationGrant(tx: Prisma.TransactionClient, provider: string, subject?: string | null) {
    if (!subject) return;
    await tx.integration.updateMany({ where: { providerIdentifier: provider, rootInternalId: subject }, data: { rootInternalId: subject } });
  }

  private async assertNoPendingAuthorizationDeletion(model: Prisma.TransactionClient['integration'], provider: string, subject: string) {
    const pending = await model.findFirst({
      where: { providerIdentifier: provider, rootInternalId: subject, deletedAt: { not: null }, disabled: true, refreshNeeded: true, OR: [{ token: { not: '' } }, { refreshToken: { not: '' } }] },
      select: { id: true },
    });
    if (pending) throw new ConflictException('The previous disconnect is still processing remote revocation. Please reconnect after data removal completes.');
  }

  getMentions(platform: string, q: string) {
    return this._mentions.model.mentions.findMany({
      where: {
        platform,
        OR: [
          {
            name: {
              contains: q,
              mode: 'insensitive',
            },
          },
          {
            username: {
              contains: q,
              mode: 'insensitive',
            },
          },
        ],
      },
      orderBy: {
        name: 'asc',
      },
      take: 100,
      select: {
        name: true,
        username: true,
        image: true,
      },
    });
  }

  insertMentions(
    platform: string,
    mentions: { name: string; username: string; image: string }[]
  ) {
    if (mentions.length === 0) {
      return [] as any[];
    }
    return this._mentions.model.mentions.createMany({
      data: mentions.map((mention) => ({
        platform,
        name: mention.name,
        username: mention.username,
        image: mention.image,
      })),
      skipDuplicates: true,
    });
  }

  async checkPreviousConnections(org: string, id: string) {
    // Deleted accounts keep their integrations with an md5 hashed
    // rootInternalId, so match both the raw id and its hash to still catch
    // channels that were connected by a deleted account.
    const findIt = await this._integration.model.integration.findMany({
      where: {
        rootInternalId: {
          in: [id, createHash('md5').update(id).digest('hex')],
        },
      },
      select: {
        organizationId: true,
        id: true,
      },
    });

    if (findIt.some((f) => f.organizationId === org)) {
      return false;
    }

    return findIt.length > 0;
  }

  updateProviderSettings(org: string, id: string, settings: string) {
    return this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        additionalSettings: settings,
      },
    });
  }

  updateCustomName(org: string, id: string, name: string) {
    return this._integration.model.integration.update({
      select: {
        id: true,
      },
      where: {
        id,
        organizationId: org,
      },
      data: {
        customName: name.trim() || null,
      },
    });
  }

  async setTimes(org: string, id: string, times: IntegrationTimeDto) {
    return this._integration.model.integration.update({
      select: {
        id: true,
      },
      where: {
        id,
        organizationId: org,
      },
      data: {
        postingTimes: JSON.stringify(times.time),
      },
    });
  }

  getPlug(plugId: string) {
    return this._plugs.model.plugs.findFirst({
      where: {
        id: plugId,
      },
      include: {
        integration: true,
      },
    });
  }

  async getPlugs(orgId: string, integrationId: string) {
    return this._plugs.model.plugs.findMany({
      where: {
        integrationId,
        organizationId: orgId,
        activated: true,
      },
      include: {
        integration: {
          select: {
            id: true,
            providerIdentifier: true,
          },
        },
      },
    });
  }

  async updateIntegration(id: string, params: Partial<Integration>, newDeletedGeneration = false, useRemoteAvatar = false) {
    return this.decryptRow(
      await this.writeIntegration(id, encryptCredentials(params), newDeletedGeneration, useRemoteAvatar)
    );
  }

  private async writeIntegration(id: string, params: Partial<Integration>, newDeletedGeneration: boolean, useRemoteAvatar: boolean) {
    if (newDeletedGeneration) return this._transaction.model.$transaction(async (tx) => {
      let source = await tx.integration.findUnique({ where: { id } });
      if (!source || source.deletedAt) throw new ConflictException('This connection was removed. Please reconnect.');
      await this.lockAuthorizationGrant(tx, source.providerIdentifier, source.rootInternalId || source.internalId);
      source = await tx.integration.findUnique({ where: { id } });
      if (!source || source.deletedAt) throw new ConflictException('This connection was removed. Please reconnect.');
      await this.assertNoPendingAuthorizationDeletion(tx.integration, source.providerIdentifier, source.rootInternalId || source.internalId);
      let existing = await tx.integration.findUnique({ where: { organizationId_internalId: { organizationId: params.organizationId!, internalId: params.internalId! } } });
      if (existing?.deletedAt) {
        await tx.integration.update({ where: { id: existing.id, deletedAt: { not: null } }, data: { internalId: `retired_${existing.id}_${makeId(10)}` }, select: { id: true } });
        existing = null;
      }
      if (existing && existing.id !== id) {
        await tx.post.updateMany({ where: { integrationId: id }, data: { deletedAt: new Date() } });
        await tx.integration.update({ where: { id, deletedAt: null }, data: { internalId: `retired_${id}_${makeId(10)}`, deletedAt: new Date() }, select: { id: true } });
      }
      return tx.integration.update({
        where: { id: existing?.id || id, deletedAt: null },
        data: { ...params, rootInternalId: source.rootInternalId, refreshToken: source.refreshToken, tokenExpiration: source.tokenExpiration, disabled: false, deletedAt: null, refreshNeeded: false },
      });
    });
    if (
      params.picture && !useRemoteAvatar && !isOwnedIntegrationPicture(params.picture)
    ) {
      params.picture = await this.storage.uploadSimple(params.picture);
    }

    let existing = await this._integration.model.integration.findUnique({
      where: {
        organizationId_internalId: {
          organizationId: params.organizationId!,
          internalId: params.internalId,
        },
      },
    });

    if (newDeletedGeneration && existing?.deletedAt) {
      await this._integration.model.integration.update({
        where: { id: existing.id },
        data: { internalId: `retired_${existing.id}_${makeId(10)}` },
        select: { id: true },
      });
      existing = null;
    }

    // The page was picked through a fresh login: the row that keeps living
    // must also take that login's identity and refresh token, otherwise the
    // next refresh runs as the old identity and cannot find the page.
    const fresh = existing
      ? await this._integration.model.integration.findUnique({
          where: { id },
          select: {
            rootInternalId: true,
            refreshToken: true,
            tokenExpiration: true,
          },
        })
      : null;

    if (existing) {
      await this._posts.model.post.updateMany({
        where: {
          integrationId: id,
        },
        data: {
          deletedAt: new Date(),
        },
      });

      await this._integration.model.integration.update({
        where: {
          id,
        },
        data: {
          internalId: `deleted_${params.internalId}_${makeId(10)}`,
          deletedAt: new Date(),
        },
      });
    }

    return this._integration.model.integration.update({
      where: {
        ...(existing ? { id: existing.id } : { id }),
        ...(newDeletedGeneration ? { deletedAt: null } : {}),
      },
      data: {
        ...params,
        ...(fresh?.rootInternalId
          ? { rootInternalId: fresh.rootInternalId }
          : {}),
        ...(fresh?.refreshToken ? { refreshToken: fresh.refreshToken } : {}),
        ...(fresh?.tokenExpiration
          ? { tokenExpiration: fresh.tokenExpiration }
          : {}),
        disabled: false,
        deletedAt: null,
        refreshNeeded: false,
      },
    });
  }

  disconnectChannel(org: string, id: string, expectedToken?: string) {
    return this.updateManyIfTokenMatches(
      this._integration.model.integration,
      { id, organizationId: org, deletedAt: null, refreshNeeded: false },
      expectedToken,
      { refreshNeeded: true }
    );
  }

  // the channel row of an account, deleted or not, as connect upserts it
  getIntegrationByInternalIdWithDeleted(org: string, internalId: string) {
    return this._integration.model.integration.findUnique({
      where: {
        organizationId_internalId: {
          organizationId: org,
          internalId,
        },
      },
      select: {
        id: true,
        name: true,
        providerIdentifier: true,
        deletedAt: true,
      },
    });
  }

  // frees the account's internalId of a deleted channel row, which keeps its
  // posts and history, so a connection starts a new row
  retireDeletedIntegration(org: string, id: string) {
    return this._integration.model.integration.updateMany({
      where: {
        id,
        organizationId: org,
        deletedAt: { not: null },
      },
      data: {
        internalId: `retired_${id}_${makeId(10)}`,
      },
    });
  }

  async getIntegrationByInternalId(org: string, internalId: string) {
    return this.decryptRow(
      await this._integration.model.integration.findFirst({
        where: {
          organizationId: org,
          internalId,
          deletedAt: null,
        },
      })
    );
  }

  // Moves a channel to another provider in place (MIGRATE_PROVIDERS): only the
  // provider and the app-scoped ids change, so the integration id - and with it
  // scheduled posts, settings and customers - survives the migration. The
  // follow-up createOrUpdateIntegration upsert matches the new internalId and
  // stores the fresh tokens.
  async migrateIntegration(
    org: string,
    id: string,
    internalId: string,
    providerIdentifier: string,
    rootInternalId: string
  ) {
    // A soft-deleted channel can still hold the target internalId
    // (deleteChannel keeps it): rename it out of the way like updateIntegration
    // does, otherwise the organizationId_internalId unique constraint rejects
    // the migration. Live channels are rejected by the service before this.
    const existing = await this._integration.model.integration.findUnique({
      where: {
        organizationId_internalId: {
          organizationId: org,
          internalId,
        },
      },
    });

    if (existing && existing.deletedAt) {
      await this._integration.model.integration.update({
        where: {
          id: existing.id,
        },
        data: {
          internalId: `deleted_${internalId}_${makeId(10)}`,
        },
      });
    }

    return this.decryptRow(
      await this._integration.model.integration.update({
        where: {
          id,
          organizationId: org,
        },
        data: {
          internalId,
          providerIdentifier,
          rootInternalId,
        },
      })
    );
  }

  async createOrUpdateIntegration(
    additionalSettings:
      | {
          title: string;
          description: string;
          type: 'checkbox' | 'text' | 'textarea';
          value: any;
          regex?: string;
        }[]
      | undefined,
    oneTimeToken: boolean,
    org: string,
    name: string,
    picture: string | undefined,
    type: 'article' | 'social',
    internalId: string,
    provider: string,
    token: string,
    refreshToken = '',
    expiresIn = 999999999,
    username?: string,
    isBetweenSteps = false,
    refresh?: string,
    timezone?: number,
    customInstanceDetails?: string,
    newDeletedGeneration = false
  ) {
    const postTimes = timezone
      ? {
          postingTimes: JSON.stringify([
            { time: 560 - timezone },
            { time: 850 - timezone },
            { time: 1140 - timezone },
          ]),
        }
      : {};
    const storedToken = TokenEncryption.encrypt(token);
    const storedRefreshToken = TokenEncryption.encrypt(refreshToken);
    const write = {
      where: {
        organizationId_internalId: {
          internalId,
          organizationId: org,
        },
      },
      create: {
        type: type as any,
        name,
        providerIdentifier: provider,
        token: storedToken,
        profile: username,
        ...(picture ? { picture } : {}),
        inBetweenSteps: isBetweenSteps,
        refreshToken: storedRefreshToken,
        ...(expiresIn
          ? { tokenExpiration: new Date(Date.now() + expiresIn * 1000) }
          : {}),
        internalId,
        ...postTimes,
        organizationId: org,
        refreshNeeded: false,
        rootInternalId: internalId,
        ...(customInstanceDetails ? { customInstanceDetails } : {}),
        additionalSettings: additionalSettings
          ? JSON.stringify(additionalSettings)
          : '[]',
      },
      update: {
        ...(additionalSettings
          ? { additionalSettings: JSON.stringify(additionalSettings) }
          : {}),
        ...(customInstanceDetails ? { customInstanceDetails } : {}),
        type: type as any,
        ...(!refresh
          ? {
              inBetweenSteps: isBetweenSteps,
            }
          : {}),
        ...(picture ? { picture } : {}),
        profile: username,
        providerIdentifier: provider,
        token: storedToken,
        // never wipe a stored refresh token with an empty one
        ...(refreshToken ? { refreshToken: storedRefreshToken } : {}),
        ...(expiresIn
          ? { tokenExpiration: new Date(Date.now() + expiresIn * 1000) }
          : {}),
        internalId,
        organizationId: org,
        deletedAt: null,
        refreshNeeded: false,
      },
    };
    const upsert = newDeletedGeneration
      ? await this._transaction.model.$transaction(async (tx) => {
          await this.lockAuthorizationGrant(tx, provider, internalId);
          await this.assertNoPendingAuthorizationDeletion(tx.integration, provider, internalId);
          const existing = await tx.integration.findUnique({ where: write.where });
          if (existing?.deletedAt) {
            await tx.integration.update({ where: { id: existing.id, deletedAt: { not: null } }, data: { internalId: `retired_${existing.id}_${makeId(10)}` }, select: { id: true } });
          }
          return existing && !existing.deletedAt
            ? tx.integration.update({ where: { id: existing.id, deletedAt: null }, data: write.update })
            : tx.integration.create({ data: write.create });
        })
      : await this._integration.model.integration.upsert(write);

    if (oneTimeToken) {
      const rootId =
        (
          await this._integration.model.integration.findFirst({
            where: {
              organizationId: org,
              internalId: internalId,
            },
          })
        )?.rootInternalId || internalId;

      await this._integration.model.integration.updateMany({
        where: {
          id: {
            not: upsert.id,
          },
          rootInternalId: rootId,
        },
        data: {
          token: storedToken,
          refreshToken: storedRefreshToken,
          refreshNeeded: false,
          ...(expiresIn
            ? { tokenExpiration: new Date(Date.now() + expiresIn * 1000) }
            : {}),
        },
      });
    }

    return this.decryptRow(upsert);
  }

  async needsToBeRefreshed() {
    return this.decryptRows(
      await this._integration.model.integration.findMany({
        where: {
          tokenExpiration: {
            lte: dayjs().add(1, 'day').toDate(),
          },
          inBetweenSteps: false,
          deletedAt: null,
          refreshNeeded: false,
        },
      }),
      // refreshing with blanked credentials would disconnect the channel
      'skip'
    );
  }

  async setBetweenRefreshSteps(id: string, expectedToken?: string) {
    return this.updateManyIfTokenMatches(
      this._integration.model.integration,
      { id, deletedAt: null, inBetweenSteps: false },
      expectedToken,
      { inBetweenSteps: true }
    );
  }

  refreshNeeded(org: string, id: string, expectedToken?: string) {
    return this.updateManyIfTokenMatches(
      this._integration.model.integration,
      { id, organizationId: org, deletedAt: null, refreshNeeded: false },
      expectedToken,
      { refreshNeeded: true }
    );
  }

  updateNameAndUrl(id: string, name: string, url: string) {
    return this._integration.model.integration.update({
      select: {
        id: true,
      },
      where: {
        id,
      },
      data: {
        ...(name ? { name } : {}),
        ...(url ? { picture: url } : {}),
      },
    });
  }

  async getIntegrationById(org: string, id: string) {
    return this.decryptRow(
      await this._integration.model.integration.findFirst({
        where: {
          organizationId: org,
          id,
          deletedAt: null,
        },
      })
    );
  }

  async getIntegrationForOrder(
    id: string,
    order: string,
    user: string,
    org: string
  ) {
    const integration = await this._posts.model.post.findFirst({
      where: {
        integrationId: id,
        submittedForOrder: {
          id: order,
          messageGroup: {
            OR: [
              { sellerId: user },
              { buyerId: user },
              { buyerOrganizationId: org },
            ],
          },
        },
      },
      select: {
        integration: {
          select: {
            id: true,
            name: true,
            picture: true,
            inBetweenSteps: true,
            providerIdentifier: true,
          },
        },
      },
    });

    return integration?.integration;
  }

  async updateOnCustomerName(org: string, id: string, name: string) {
    const customer = !name
      ? undefined
      : (await this._customers.model.customer.findFirst({
          where: {
            orgId: org,
            name,
          },
        })) ||
        (await this._customers.model.customer.create({
          data: {
            name,
            orgId: org,
          },
        }));

    return this._integration.model.integration.update({
      select: {
        id: true,
      },
      where: {
        id,
        organizationId: org,
      },
      data: {
        customer: !customer
          ? { disconnect: true }
          : {
              connect: {
                id: customer.id,
              },
            },
      },
    });
  }

  async updateIntegrationGroup(org: string, id: string, group: string) {
    if (group) {
      const customer = await this._customers.model.customer.findFirst({
        where: {
          id: group,
          orgId: org,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });

      if (!customer) {
        throw new NotFoundException('Customer not found');
      }
    }

    return this._integration.model.integration.update({
      select: {
        id: true,
      },
      where: {
        id,
        organizationId: org,
      },
      data: !group
        ? {
            customer: {
              disconnect: true,
            },
          }
        : {
            customer: {
              connect: {
                id: group,
              },
            },
          },
    });
  }

  getCustomerByName(orgId: string, name: string) {
    return this._customers.model.customer.findFirst({
      where: {
        orgId,
        name,
        deletedAt: null,
      },
    });
  }

  updateCustomerName(orgId: string, id: string, name: string) {
    return this._customers.model.customer.update({
      where: {
        id,
        orgId,
      },
      data: {
        name,
      },
    });
  }

  customers(orgId: string) {
    return this._customers.model.customer.findMany({
      where: {
        orgId,
        deletedAt: null,
      },
    });
  }

  async getIntegrationsList(org: string) {
    return this.decryptRows(
      await this._integration.model.integration.findMany({
        where: {
          organizationId: org,
          deletedAt: null,
        },
        include: {
          customer: true,
        },
      }),
      'blank'
    );
  }

  private async latestPostsFor(
    org: string,
    state: 'PUBLISHED' | 'ERROR',
    field: 'publishDate' | 'updatedAt',
    options: { topLevelOnly: boolean; includeDeleted: boolean },
    groups: { integrationId: string; date: Date | null }[]
  ) {
    const matches = groups.filter((group) => group.date);

    if (!matches.length) {
      return [];
    }

    return this._posts.model.post.findMany({
      where: {
        organizationId: org,
        state,
        ...(options.includeDeleted ? {} : { deletedAt: null }),
        ...(options.topLevelOnly ? { parentPostId: null } : {}),
        OR: matches.map(
          (group) =>
            ({
              integrationId: group.integrationId,
              [field]: group.date,
            } as Prisma.PostWhereInput)
        ),
      },
      orderBy: {
        id: 'asc',
      },
      select: {
        id: true,
        integrationId: true,
        publishDate: true,
        updatedAt: true,
        releaseURL: true,
        error: true,
      },
    });
  }

  private firstPerIntegration<T extends { integrationId: string }>(posts: T[]) {
    const byIntegration = new Map<string, T>();

    for (const post of posts) {
      if (!byIntegration.has(post.integrationId)) {
        byIntegration.set(post.integrationId, post);
      }
    }

    return byIntegration;
  }

  async getChannelHealth(org: string, includeDeleted = false) {
    const [integrations, lastPublished, lastErrored] = await Promise.all([
      this._integration.model.integration.findMany({
        where: {
          organizationId: org,
        },
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          id: true,
          internalId: true,
          name: true,
          providerIdentifier: true,
          type: true,
          disabled: true,
          refreshNeeded: true,
          inBetweenSteps: true,
          tokenExpiration: true,
          deletedAt: true,
          createdAt: true,
          updatedAt: true,
          customer: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
      this._posts.model.post.groupBy({
        by: ['integrationId'],
        where: {
          organizationId: org,
          state: 'PUBLISHED',
          ...(includeDeleted ? {} : { deletedAt: null }),
          parentPostId: null,
        },
        _max: { publishDate: true },
      }),
      this._posts.model.post.groupBy({
        by: ['integrationId'],
        where: {
          organizationId: org,
          state: 'ERROR',
          ...(includeDeleted ? {} : { deletedAt: null }),
        },
        _max: { updatedAt: true },
      }),
    ]);

    const [publishedPosts, erroredPosts] = await Promise.all([
      this.latestPostsFor(
        org,
        'PUBLISHED',
        'publishDate',
        { topLevelOnly: true, includeDeleted },
        lastPublished.map((group) => ({
          integrationId: group.integrationId,
          date: group._max.publishDate,
        }))
      ),
      this.latestPostsFor(
        org,
        'ERROR',
        'updatedAt',
        { topLevelOnly: false, includeDeleted },
        lastErrored.map((group) => ({
          integrationId: group.integrationId,
          date: group._max.updatedAt,
        }))
      ),
    ]);

    const publishedByIntegration = this.firstPerIntegration(publishedPosts);
    const erroredByIntegration = this.firstPerIntegration(erroredPosts);

    return integrations.map((integration) => {
      const published = publishedByIntegration.get(integration.id);
      const errored = erroredByIntegration.get(integration.id);

      return {
        ...integration,
        lastPublishedAt: published?.publishDate || null,
        lastPublishedPostId: published?.id || null,
        lastPublishedUrl: published?.releaseURL || null,
        lastErrorAt: errored?.updatedAt || null,
        lastErrorPostId: errored?.id || null,
        lastError: errored?.error || null,
      };
    });
  }

  async disableChannel(org: string, id: string) {
    await this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        disabled: true,
      },
    });
  }

  async enableChannel(org: string, id: string) {
    await this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        disabled: false,
      },
    });
  }

  getPostsForChannel(org: string, id: string) {
    return this._posts.model.post.groupBy({
      by: ['group'],
      where: {
        organizationId: org,
        integrationId: id,
        deletedAt: null,
      },
    });
  }

  // clearCredentials: the provider revoked the grant, its stored tokens go
  // with the channel instead of waiting for a deletion request
  deleteChannel(org: string, id: string, clearCredentials = false) {
    return this._integration.model.integration.update({
      select: {
        id: true,
      },
      where: {
        id,
        organizationId: org,
      },
      data: {
        deletedAt: new Date(),
        ...(clearCredentials
          ? { token: '', refreshToken: null, tokenExpiration: null }
          : {}),
      },
    });
  }

  async deleteIntegrationsForAccount(org: string, lifecycleOwnedIds: string[] = []) {
    const hash = (value: string) =>
      createHash('md5').update(value).digest('hex');

    await this._posts.model.post.updateMany({
      where: {
        organizationId: org,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });

    const integrations = await this._integration.model.integration.findMany({
      where: {
        organizationId: org,
        id: { notIn: lifecycleOwnedIds },
      },
    });

    // md5 is deterministic, so a hashed rootInternalId can still be matched
    // by checkPreviousConnections when the same channel is connected again
    // from a new account.
    for (const integration of integrations) {
      await this._integration.model.integration.update({
        where: {
          id: integration.id,
        },
        data: {
          name: hash(integration.name),
          internalId: hash(integration.internalId),
          rootInternalId: integration.rootInternalId
            ? hash(integration.rootInternalId)
            : null,
          token: hash(integration.token),
          refreshToken: integration.refreshToken
            ? hash(integration.refreshToken)
            : null,
          profile: integration.profile ? hash(integration.profile) : null,
          customInstanceDetails: integration.customInstanceDetails
            ? hash(integration.customInstanceDetails)
            : null,
          picture: null,
          deletedAt: integration.deletedAt || new Date(),
        },
      });
    }
  }

  // Private lifecycle reads deliberately include deleted connections. Never
  // return these rows from a controller: they contain retry credentials.
  async getIntegrationForCleanup(org: string, id: string) {
    return this.decryptRow(await this._integration.model.integration.findFirst({ where: { organizationId: org, id }, select: authorizationSelect }));
  }

  getAuthorizationIntegrationsForOrganization(org: string) {
    return this._integration.model.integration.findMany({ where: { organizationId: org }, select: { id: true, providerIdentifier: true } });
  }

  // A row whose credentials cannot be decrypted is flagged instead of dropped
  // or blanked, so the page keeps its length (the cursor) and the lifecycle
  // never acts on it as if the provider had revoked the grant.
  async getAuthorizationIntegrationsPage(cursor?: string) {
    const rows = await this._integration.model.integration.findMany({
      where: { OR: [{ deletedAt: null }, { deletedAt: { not: null }, disabled: true, refreshNeeded: true }] },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' }, take: 100, select: authorizationSelect,
    });
    return rows.map((row) => {
      try {
        return { ...decryptCredentials(row), credentialsUnreadable: false };
      } catch (err) {
        console.error(`Integration ${row.id}: ${(err as Error).message}`);
        return { ...blankCredentials(row), credentialsUnreadable: true };
      }
    });
  }

  // Live channels of these providers, in any organization and including a
  // pending location or page choice (inBetweenSteps), still connected through
  // the same account (rootInternalId), apart from the ones being removed
  countLiveChannelsOnGrant(rootInternalId: string, providerIdentifiers: string[], excludeIds: string[]) {
    return this._integration.model.integration.count({
      where: { rootInternalId, providerIdentifier: { in: providerIdentifiers }, deletedAt: null, id: { notIn: excludeIds } },
    });
  }

  async findAuthorizationGrantCandidates(subject: string) {
    return this.decryptRows(
      await this._integration.model.integration.findMany({ where: { rootInternalId: subject }, select: authorizationSelect }),
      'skip'
    );
  }

  async markAuthorizationDeletionRequested(org: string, id: string, expectedToken?: string) {
    return this._transaction.model.$transaction(async (tx) => {
      let where = await this.pinStoredToken(tx.integration, { organizationId: org, id }, expectedToken);
      if (!where) return { matched: false };
      let row = await tx.integration.findFirst({ where, select: authorizationSelect });
      if (!row) return { matched: false };
      if (row.deletedAt && row.disabled && row.refreshNeeded) return { matched: true };
      await this.lockAuthorizationGrant(tx, row.providerIdentifier, row.rootInternalId);
      where = await this.pinStoredToken(tx.integration, { organizationId: org, id }, expectedToken);
      if (!where) return { matched: false };
      row = await tx.integration.findFirst({ where, select: authorizationSelect });
      if (!row) return { matched: false };
      if (row.deletedAt && row.disabled && row.refreshNeeded) return { matched: true };
      const changed = await tx.integration.updateMany({ where, data: { deletedAt: row.deletedAt || new Date(), disabled: true, refreshNeeded: true } });
      return { matched: changed.count > 0 };
    });
  }

  touchAuthorizationHistoryWait(org: string, id: string) {
    return this._integration.model.integration.updateMany({ where: { organizationId: org, id, internalId: `erased_${id}`, deletedAt: { not: null }, token: '', refreshToken: null }, data: { token: '' } });
  }

  async getAuthorizationPostIds(org: string, id: string) {
    return (await this._posts.model.post.findMany({ where: { organizationId: org, integrationId: id }, select: { id: true } })).map((post) => post.id);
  }

  purgeAuthorizationNotifications(org: string, id: string) {
    return this._notificationsRepository.purgeAuthorizationNotifications(org, id);
  }

  async updateAuthorizationIfActive(
    org: string, id: string,
    credentials?: Extract<ProviderAuthorizationCheck, { status: 'valid' }>['credentials'],
    identity?: Extract<ProviderAuthorizationCheck, { status: 'valid' }>['identity'],
    expectedToken?: string,
    oneTimeToken = false
  ) {
    const base = { organizationId: org, id, deletedAt: null, inBetweenSteps: false };
    const data = {
        ...encryptCredentials({
          ...(credentials?.accessToken ? { token: credentials.accessToken } : {}),
          ...(credentials?.refreshToken ? { refreshToken: credentials.refreshToken } : {}),
        }),
        ...(credentials?.expiresIn ? { tokenExpiration: new Date(Date.now() + credentials.expiresIn * 1000) } : {}),
        ...(identity ? { name: identity.name, ...(identity.profile !== undefined ? { profile: identity.profile } : {}), ...(identity.picture !== undefined ? { picture: identity.picture } : {}) } : {}),
      };
    if (!oneTimeToken) return this.updateManyIfTokenMatches(this._integration.model.integration, base, expectedToken, data);
    // Preserve single-use grant rotation across the connections sharing that
    // exact credential, while refusing to overwrite a newly reconnected grant.
    return this._transaction.model.$transaction(async (tx) => {
      const where = await this.pinStoredToken(tx.integration, base, expectedToken);
      if (!where) return { count: 0 };
      const current = await tx.integration.findFirst({ where, select: { rootInternalId: true } });
      if (!current) return { count: 0 };
      const updated = await tx.integration.updateMany({ where, data });
      if (updated.count && current.rootInternalId && expectedToken) {
        const siblings = await tx.integration.findMany({
          where: { id: { not: id }, rootInternalId: current.rootInternalId, deletedAt: null, inBetweenSteps: false },
          select: { id: true, token: true },
        });
        for (const sibling of siblings) {
          if (!this.tokenEquals(sibling.token, expectedToken)) continue;
          await tx.integration.updateMany({
            where: { id: sibling.id, token: sibling.token, deletedAt: null, inBetweenSteps: false },
            data,
          });
        }
      }
      return updated;
    });
  }

  async hasAvatarReferences(picture: string, excludingIntegrationId: string) {
    return this._transaction.model.$transaction(async (tx) => {
      const [integrations, media, posts] = await Promise.all([
        tx.integration.count({ where: { picture, id: { not: excludingIntegrationId } } }),
        tx.media.count({ where: { OR: [{ path: picture }, { thumbnail: picture }] } }),
        tx.post.count({ where: { image: { contains: picture } } }),
      ]);
      return integrations + media + posts > 0;
    });
  }

  async scrubAuthorizationData(org: string, id: string) {
    return this._transaction.model.$transaction(async (tx) => {
      const row = await tx.integration.findFirst({ where: { id, organizationId: org, deletedAt: { not: null }, disabled: true, refreshNeeded: true }, select: { id: true } });
      if (!row) return { count: 0 };
      await tx.errors.deleteMany({ where: { organizationId: org, post: { integrationId: id } } });
      await tx.post.updateMany({ where: { organizationId: org, integrationId: id }, data: { releaseId: null, releaseURL: null, error: null } });
      await tx.exisingPlugData.deleteMany({ where: { integrationId: id } });
      await tx.plugs.updateMany({ where: { integrationId: id, organizationId: org }, data: { activated: false, data: '{}' } });
      return tx.integration.updateMany({
        where: { id, organizationId: org, deletedAt: { not: null }, disabled: true, refreshNeeded: true },
        data: { token: '', refreshToken: null, tokenExpiration: null, name: 'Disconnected channel', internalId: `erased_${id}`, rootInternalId: null, profile: null, picture: null, additionalSettings: '[]', customInstanceDetails: null },
      });
    });
  }

  async checkForDeletedOnceAndUpdate(org: string, page: string) {
    return this._integration.model.integration.updateMany({
      where: {
        organizationId: org,
        internalId: page,
        deletedAt: {
          not: null,
        },
      },
      data: {
        internalId: makeId(10),
      },
    });
  }

  async disableIntegrations(org: string, totalChannels: number) {
    const getChannels = await this._integration.model.integration.findMany({
      where: {
        organizationId: org,
        disabled: false,
        deletedAt: null,
      },
      // a downgrade keeps the channels the workspace had first
      orderBy: { createdAt: 'desc' },
      take: totalChannels,
      select: {
        id: true,
      },
    });

    for (const channel of getChannels) {
      await this._integration.model.integration.update({
        where: {
          id: channel.id,
        },
        data: {
          disabled: true,
        },
      });
    }
  }

  enableAllIntegrations(org: string) {
    return this._integration.model.integration.updateMany({
      where: {
        organizationId: org,
        disabled: true,
        deletedAt: null,
      },
      data: {
        disabled: false,
      },
    });
  }

  getPlugsByIntegrationId(org: string, id: string) {
    return this._plugs.model.plugs.findMany({
      where: {
        organizationId: org,
        integrationId: id,
      },
    });
  }

  async createOrUpdatePlug(org: string, integrationId: string, body: PlugDto) {
    const integration = await this._integration.model.integration.findFirst({
      where: {
        id: integrationId,
        organizationId: org,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!integration) {
      throw new NotFoundException('Integration not found');
    }

    return this._plugs.model.plugs.upsert({
      where: {
        organizationId: org,
        plugFunction_integrationId: {
          integrationId,
          plugFunction: body.func,
        },
      },
      create: {
        integrationId,
        organizationId: org,
        plugFunction: body.func,
        data: JSON.stringify(body.fields),
        activated: true,
      },
      update: {
        data: JSON.stringify(body.fields),
      },
      select: {
        activated: true,
      },
    });
  }

  changePlugActivation(orgId: string, plugId: string, status: boolean) {
    return this._plugs.model.plugs.update({
      where: {
        organizationId: orgId,
        id: plugId,
      },
      data: {
        activated: !!status,
      },
    });
  }

  async loadExisingData(
    methodName: string,
    integrationId: string,
    id: string[]
  ) {
    return this._exisingPlugData.model.exisingPlugData.findMany({
      where: {
        integrationId,
        methodName,
        value: {
          in: id,
        },
      },
    });
  }

  async saveExisingData(
    methodName: string,
    integrationId: string,
    value: string[]
  ) {
    return this._exisingPlugData.model.exisingPlugData.createMany({
      data: value.map((p) => ({
        integrationId,
        methodName,
        value: p,
      })),
    });
  }

  // The stored (still encrypted) credential columns, a page at a time, for the
  // encryption backfill. Rows without any credential (erased) are left out.
  getStoredCredentialsPage(take: number, cursor?: string) {
    return this._integration.model.integration.findMany({
      where: { OR: [{ token: { not: '' } }, { refreshToken: { notIn: [''] } }] },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      take,
      select: { id: true, token: true, refreshToken: true },
    });
  }

  // Pinned to the stored values: a row that changed since it was read (a
  // reconnect or a token refresh) is left alone and counts as 0.
  replaceStoredCredentials(
    id: string,
    from: { token: string; refreshToken: string | null },
    to: { token: string; refreshToken: string | null }
  ) {
    return this._integration.model.integration.updateMany({
      where: { id, token: from.token, refreshToken: from.refreshToken },
      data: { token: to.token, refreshToken: to.refreshToken },
    });
  }

  async getPostingTimes(orgId: string, integrationsId?: string) {
    return this._integration.model.integration.findMany({
      where: {
        ...(integrationsId ? { id: integrationsId } : {}),
        organizationId: orgId,
        disabled: false,
        deletedAt: null,
      },
      select: {
        postingTimes: true,
      },
    });
  }
}
