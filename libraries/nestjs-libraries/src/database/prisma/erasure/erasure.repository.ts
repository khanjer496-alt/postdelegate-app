import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PrismaRepository,
  PrismaService,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

type Db = Prisma.TransactionClient;

// One table operation of an erasure. Without data it is a deleteMany, with
// data an updateMany that detaches rows which must survive. The same list is
// counted for a dry run and executed for a real run, so the plan can never
// disagree with what is erased.
interface Step {
  table: string;
  model: string;
  where: Record<string, any>;
  data?: Record<string, any>;
}

export type TableCounts = Record<string, number>;

export interface ErasureUserRow {
  id: string;
  email: string;
  providerName: string;
  isSuperAdmin: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  pictureId: string | null;
}

export interface ErasureMembership {
  userId: string;
  organizationId: string;
  role: string;
  organization: {
    id: string;
    deletedAt: Date | null;
    paymentId: string | null;
    subscription: { id: string; provider: string } | null;
  };
}

export interface ErasureMember {
  organizationId: string;
  userId: string;
  role: string;
}

export interface OrganizationWorkflowTargets {
  integrations: { id: string; postIds: string[] }[];
  extraWorkflowIds: string[];
}

export interface UserErasureOutcome {
  tables: TableCounts;
  objectSources: string[];
  affiliate: 'none' | 'deleted' | 'kept-anonymised';
  tombstone: boolean;
}

const PAGE = 1000;
const TRANSACTION = { timeout: 10 * 60 * 1000, maxWait: 30 * 1000 };

const orderParty = (userId: string) => ({
  OR: [{ buyerId: userId }, { sellerId: userId }],
});

const userOrders = (userId: string) => ({
  OR: [
    { buyerId: userId },
    { sellerId: userId },
    { messageGroup: orderParty(userId) },
  ],
});

// Delete order is dependency safe: children before parents, and rows that
// other tables point at (media, integrations, orders, posts) after them.
const organizationSteps = (org: string): Step[] => [
  {
    table: 'Post.parentPostId',
    model: 'post',
    where: { organizationId: org, parentPostId: { not: null } },
    data: { parentPostId: null },
  },
  {
    table: 'Post.submittedForOrganizationId',
    model: 'post',
    where: { submittedForOrganizationId: org, organizationId: { not: org } },
    data: { submittedForOrganizationId: null },
  },
  {
    table: 'Post.lastMessageId',
    model: 'post',
    where: { lastMessage: { group: { buyerOrganizationId: org } } },
    data: { lastMessageId: null },
  },
  {
    table: 'Post.submittedForOrderId',
    model: 'post',
    where: {
      submittedForOrder: { messageGroup: { buyerOrganizationId: org } },
    },
    data: { submittedForOrderId: null },
  },
  {
    table: 'User.pictureId',
    model: 'user',
    where: { picture: { organizationId: org } },
    data: { pictureId: null },
  },
  {
    table: 'SocialMediaAgency.logoId',
    model: 'socialMediaAgency',
    where: { logo: { organizationId: org } },
    data: { logoId: null },
  },
  { table: 'Errors', model: 'errors', where: { organizationId: org } },
  { table: 'Comments', model: 'comments', where: { organizationId: org } },
  {
    table: 'TagsPosts',
    model: 'tagsPosts',
    where: {
      OR: [{ post: { organizationId: org } }, { tag: { orgId: org } }],
    },
  },
  {
    table: 'PayoutProblems',
    model: 'payoutProblems',
    where: {
      OR: [
        { post: { organizationId: org } },
        { order: { messageGroup: { buyerOrganizationId: org } } },
      ],
    },
  },
  { table: 'Post', model: 'post', where: { organizationId: org } },
  { table: 'Idea', model: 'idea', where: { organizationId: org } },
  { table: 'Tags', model: 'tags', where: { orgId: org } },
  {
    table: 'IntegrationsWebhooks',
    model: 'integrationsWebhooks',
    where: {
      OR: [
        { integration: { organizationId: org } },
        { webhook: { organizationId: org } },
      ],
    },
  },
  {
    table: 'ExisingPlugData',
    model: 'exisingPlugData',
    where: { integration: { organizationId: org } },
  },
  { table: 'Plugs', model: 'plugs', where: { organizationId: org } },
  {
    table: 'OrderItems',
    model: 'orderItems',
    where: {
      OR: [
        { integration: { organizationId: org } },
        { order: { messageGroup: { buyerOrganizationId: org } } },
      ],
    },
  },
  {
    table: 'Orders',
    model: 'orders',
    where: { messageGroup: { buyerOrganizationId: org } },
  },
  {
    table: 'Messages',
    model: 'messages',
    where: { group: { buyerOrganizationId: org } },
  },
  {
    table: 'MessagesGroup',
    model: 'messagesGroup',
    where: { buyerOrganizationId: org },
  },
  { table: 'Webhooks', model: 'webhooks', where: { organizationId: org } },
  {
    table: 'AnalyticsAccountSnapshot',
    model: 'analyticsAccountSnapshot',
    where: { organizationId: org },
  },
  {
    table: 'AnalyticsPostSnapshot',
    model: 'analyticsPostSnapshot',
    where: { organizationId: org },
  },
  {
    table: 'AnalyticsPost',
    model: 'analyticsPost',
    where: { organizationId: org },
  },
  {
    table: 'AnalyticsReportSettings',
    model: 'analyticsReportSettings',
    where: { organizationId: org },
  },
  {
    table: 'Integration',
    model: 'integration',
    where: { organizationId: org },
  },
  { table: 'Customer', model: 'customer', where: { orgId: org } },
  { table: 'Signatures', model: 'signatures', where: { organizationId: org } },
  { table: 'Sets', model: 'sets', where: { organizationId: org } },
  { table: 'PostImport', model: 'postImport', where: { organizationId: org } },
  { table: 'AutoPost', model: 'autoPost', where: { organizationId: org } },
  { table: 'ThirdParty', model: 'thirdParty', where: { organizationId: org } },
  {
    table: 'AiCredential',
    model: 'aiCredential',
    where: { organizationId: org },
  },
  {
    table: 'Notifications',
    model: 'notifications',
    where: { organizationId: org },
  },
  { table: 'GitHub', model: 'gitHub', where: { organizationId: org } },
  { table: 'Credits', model: 'credits', where: { organizationId: org } },
  { table: 'UsedCodes', model: 'usedCodes', where: { orgId: org } },
  {
    table: 'ClippingClip',
    model: 'clippingClip',
    where: { clipping: { organizationId: org } },
  },
  { table: 'Clipping', model: 'clipping', where: { organizationId: org } },
  {
    table: 'OAuthSelfHostedAuthorization',
    model: 'oAuthSelfHostedAuthorization',
    where: { oauthApp: { organizationId: org } },
  },
  {
    table: 'OAuthAuthorization',
    model: 'oAuthAuthorization',
    where: {
      OR: [{ organizationId: org }, { oauthApp: { organizationId: org } }],
    },
  },
  { table: 'OAuthApp', model: 'oAuthApp', where: { organizationId: org } },
  { table: 'Review', model: 'review', where: { organizationId: org } },
  {
    table: 'ActivityLog',
    model: 'activityLog',
    where: { organizationId: org },
  },
  {
    table: 'ApprovalLink',
    model: 'approvalLink',
    where: { organizationId: org },
  },
  {
    table: 'ApprovalSettings',
    model: 'approvalSettings',
    where: { organizationId: org },
  },
  {
    table: 'Subscription',
    model: 'subscription',
    where: { organizationId: org },
  },
  { table: 'Media', model: 'media', where: { organizationId: org } },
  {
    table: 'UserOrganization',
    model: 'userOrganization',
    where: { organizationId: org },
  },
  { table: 'Organization', model: 'organization', where: { id: org } },
];

// A shared organization keeps its content, only the person leaves it
const sharedOrganizationSteps = (user: string, org: string): Step[] => [
  {
    table: 'Comments.userId',
    model: 'comments',
    where: { userId: user, organizationId: org },
    data: { userId: null, displayName: null },
  },
  {
    table: 'ActivityLog.actorUserId',
    model: 'activityLog',
    where: { actorUserId: user, organizationId: org },
    data: { actorUserId: null, actorName: null },
  },
  {
    table: 'ApprovalLink.createdById',
    model: 'approvalLink',
    where: { createdById: user, organizationId: org },
    data: { createdById: null },
  },
  {
    table: 'OAuthAuthorization',
    model: 'oAuthAuthorization',
    where: { userId: user, organizationId: org },
  },
  {
    table: 'UserOrganization',
    model: 'userOrganization',
    where: { userId: user, organizationId: org },
  },
];

const userSteps = (user: string): Step[] => [
  {
    table: 'Comments.userId',
    model: 'comments',
    where: { userId: user },
    data: { userId: null, displayName: null },
  },
  {
    table: 'ActivityLog.actorUserId',
    model: 'activityLog',
    where: { actorUserId: user },
    data: { actorUserId: null, actorName: null },
  },
  {
    table: 'ApprovalLink.createdById',
    model: 'approvalLink',
    where: { createdById: user },
    data: { createdById: null },
  },
  {
    table: 'Post.lastMessageId',
    model: 'post',
    where: { lastMessage: { group: orderParty(user) } },
    data: { lastMessageId: null },
  },
  {
    table: 'Post.submittedForOrderId',
    model: 'post',
    where: { submittedForOrder: userOrders(user) },
    data: { submittedForOrderId: null },
  },
  {
    table: 'OAuthAuthorization',
    model: 'oAuthAuthorization',
    where: { userId: user },
  },
  { table: 'ItemUser', model: 'itemUser', where: { userId: user } },
  {
    table: 'PayoutProblems',
    model: 'payoutProblems',
    where: { OR: [{ userId: user }, { order: userOrders(user) }] },
  },
  {
    table: 'OrderItems',
    model: 'orderItems',
    where: { order: userOrders(user) },
  },
  { table: 'Orders', model: 'orders', where: userOrders(user) },
  {
    table: 'Messages',
    model: 'messages',
    where: { group: orderParty(user) },
  },
  { table: 'MessagesGroup', model: 'messagesGroup', where: orderParty(user) },
  {
    table: 'SocialMediaAgencyNiche',
    model: 'socialMediaAgencyNiche',
    where: { agency: { userId: user } },
  },
  {
    table: 'SocialMediaAgency',
    model: 'socialMediaAgency',
    where: { userId: user },
  },
  { table: 'Review', model: 'review', where: { userId: user } },
  { table: 'ReviewPrompt', model: 'reviewPrompt', where: { userId: user } },
  {
    table: 'UserOrganization',
    model: 'userOrganization',
    where: { userId: user },
  },
];

export const mergeTableCounts = (into: TableCounts, from: TableCounts) => {
  for (const [table, count] of Object.entries(from)) {
    into[table] = (into[table] || 0) + count;
  }
  return into;
};

const isMissingTable = (err: any) =>
  err?.code === 'P2021' || err?.code === 'P2010' || err?.code === 'P2022';

@Injectable()
export class ErasureRepository {
  constructor(
    private _prisma: PrismaRepository<keyof PrismaService>,
    private _transaction: PrismaTransaction
  ) {}

  // Accounts removed from the app have their email replaced by
  // deleted_<md5 of the lowercase email>_<suffix>, so they are found by prefix
  findUsers(
    email: string,
    deletedEmailPrefix: string
  ): Promise<ErasureUserRow[]> {
    return this._prisma.model.user.findMany({
      where: {
        OR: [
          { email: { equals: email, mode: 'insensitive' } },
          { email: { startsWith: deletedEmailPrefix } },
        ],
      },
      select: {
        id: true,
        email: true,
        providerName: true,
        isSuperAdmin: true,
        deletedAt: true,
        createdAt: true,
        pictureId: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Includes soft-deleted organizations, the in-app deletion keeps the rows
  async getMemberships(userIds: string[]) {
    const memberships: ErasureMembership[] =
      await this._prisma.model.userOrganization.findMany({
        where: { userId: { in: userIds } },
        select: {
          userId: true,
          organizationId: true,
          role: true,
          organization: {
            select: {
              id: true,
              deletedAt: true,
              paymentId: true,
              subscription: { select: { id: true, provider: true } },
            },
          },
        },
      });

    const orgIds = [...new Set(memberships.map((m) => m.organizationId))];
    const members: ErasureMember[] = orgIds.length
      ? await this._prisma.model.userOrganization.findMany({
          where: { organizationId: { in: orgIds } },
          select: { organizationId: true, userId: true, role: true },
        })
      : [];

    return { memberships, members };
  }

  async getOrganizationIntegrations(org: string) {
    const rows = await this._prisma.model.integration.findMany({
      where: { organizationId: org },
      select: {
        id: true,
        providerIdentifier: true,
        token: true,
        refreshToken: true,
      },
    });

    return rows.map((row) => ({
      id: row.id,
      providerIdentifier: row.providerIdentifier,
      hasCredentials: !!row.token || !!row.refreshToken,
    }));
  }

  async getOrganizationWorkflowTargets(
    org: string
  ): Promise<OrganizationWorkflowTargets> {
    const db = this._prisma.model;
    const [integrations, posts, autoposts, clippings, clips, media] =
      await Promise.all([
        db.integration.findMany({
          where: { organizationId: org },
          select: { id: true },
        }),
        db.post.findMany({
          where: { organizationId: org },
          select: { id: true, integrationId: true },
        }),
        db.autoPost.findMany({
          where: { organizationId: org },
          select: { id: true },
        }),
        db.clipping.findMany({
          where: { organizationId: org },
          select: { id: true },
        }),
        db.clippingClip.findMany({
          where: { clipping: { organizationId: org } },
          select: { id: true },
        }),
        db.media.findMany({
          where: { organizationId: org, status: { not: 'ready' } },
          select: { id: true },
        }),
      ]);

    const byIntegration = new Map<string, string[]>(
      integrations.map((integration) => [integration.id, []])
    );
    for (const post of posts) {
      byIntegration.get(post.integrationId)?.push(post.id);
    }

    return {
      integrations: [...byIntegration].map(([id, postIds]) => ({
        id,
        postIds,
      })),
      extraWorkflowIds: [
        `streak_${org}`,
        // v1 and v2 digests may still exist next to the v3 one
        `digest_email_workflow_${org}`,
        `digest_email_workflow_v2_${org}`,
        `digest_email_workflow_v3_${org}`,
        ...autoposts.map(({ id }) => `autopost-${id}`),
        ...clippings.map(({ id }) => `clipping_${id}`),
        ...clips.map(({ id }) => `clipping_clip_${id}`),
        ...media.map(({ id }) => `media_${id}`),
      ],
    };
  }

  // Every stored string that can name an uploaded object: media paths and
  // thumbnails, clip files, channel avatars and the image JSON of posts. The
  // caller extracts the object keys of its own bucket from them
  async getOrganizationObjectSources(org: string): Promise<string[]> {
    const db: any = this._prisma.model;
    const sources: string[] = [];
    const paged = async (
      model: string,
      where: Record<string, any>,
      select: Record<string, boolean>
    ) => {
      let cursor: string | undefined;
      for (;;) {
        const rows: any[] = await db[model].findMany({
          where,
          select: { id: true, ...select },
          orderBy: { id: 'asc' },
          take: PAGE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        for (const row of rows) {
          for (const key of Object.keys(select)) {
            if (row[key]) sources.push(row[key]);
          }
        }
        if (rows.length < PAGE) return;
        cursor = rows[rows.length - 1].id;
      }
    };

    await paged(
      'media',
      { organizationId: org },
      { path: true, thumbnail: true }
    );
    await paged(
      'clippingClip',
      { clipping: { organizationId: org } },
      { path: true, thumbnail: true }
    );
    await paged('clipping', { organizationId: org }, { thumbnail: true });
    await paged('integration', { organizationId: org }, { picture: true });
    await paged(
      'post',
      { organizationId: org, image: { not: null } },
      { image: true }
    );

    return sources;
  }

  // True when something that survives the erasure still points at the object
  async countObjectReferences(url: string, key: string) {
    const db = this._prisma.model;
    const counts = await Promise.all([
      db.media.count({
        where: { OR: [{ path: url }, { thumbnail: url }, { name: key }] },
      }),
      db.clippingClip.count({
        where: { OR: [{ path: url }, { thumbnail: url }] },
      }),
      db.clipping.count({ where: { thumbnail: url } }),
      db.integration.count({ where: { picture: url } }),
      db.post.count({ where: { image: { contains: key } } }),
    ]);

    return counts.reduce((sum, count) => sum + count, 0);
  }

  private async runSteps(db: Db, steps: Step[], execute: boolean) {
    const counts: TableCounts = {};
    for (const step of steps) {
      const delegate = (db as any)[step.model];
      let count: number;
      if (!execute) {
        count = await delegate.count({ where: step.where });
      } else if (step.data) {
        count = (
          await delegate.updateMany({ where: step.where, data: step.data })
        ).count;
      } else {
        count = (await delegate.deleteMany({ where: step.where })).count;
      }
      counts[step.table] = (counts[step.table] || 0) + count;
    }
    return counts;
  }

  // Fences the organization before its workflows are stopped, so the cron that
  // restarts missing post workflows no longer picks its posts up
  async suspendOrganization(org: string) {
    await this._transaction.model.$transaction(async (tx) => {
      await tx.post.updateMany({
        where: { organizationId: org, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      await tx.organization.updateMany({
        where: { id: org, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    });
  }

  planOrganization(org: string) {
    return this.runSteps(
      this._prisma.model as unknown as Db,
      organizationSteps(org),
      false
    );
  }

  eraseOrganization(org: string) {
    return this._transaction.model.$transaction(
      (tx) => this.runSteps(tx, organizationSteps(org), true),
      TRANSACTION
    );
  }

  planSharedOrganizationLeave(user: string, org: string) {
    return this.runSteps(
      this._prisma.model as unknown as Db,
      sharedOrganizationSteps(user, org),
      false
    );
  }

  leaveSharedOrganization(user: string, org: string) {
    return this._transaction.model.$transaction(
      (tx) => this.runSteps(tx, sharedOrganizationSteps(user, org), true),
      TRANSACTION
    );
  }

  // Mastra chat memory is keyed by the organization id and its tables belong
  // to the AI framework, so they are cleaned outside the main transaction and
  // a missing table (null) is not an error
  async runOrganizationAiMemory(
    org: string,
    execute: boolean
  ): Promise<Record<string, number | null>> {
    const db: any = this._prisma.model;
    const result: Record<string, number | null> = {};
    const apply = async (
      model: string,
      where: Record<string, any>
    ): Promise<void> => {
      try {
        result[model] = execute
          ? (await db[model].deleteMany({ where })).count
          : await db[model].count({ where });
      } catch (err) {
        if (!isMissingTable(err)) throw err;
        result[model] = null;
      }
    };

    let threadIds: string[] = [];
    try {
      threadIds = (
        await db.mastra_threads.findMany({
          where: { resourceId: org },
          select: { id: true },
        })
      ).map((thread: { id: string }) => thread.id);
    } catch (err) {
      if (!isMissingTable(err)) throw err;
    }

    await apply('mastra_messages', {
      OR: [{ resourceId: org }, { thread_id: { in: threadIds } }],
    });
    await apply('mastra_thread_state', { threadId: { in: threadIds } });
    await apply('mastra_observational_memory', {
      OR: [{ resourceId: org }, { threadId: { in: threadIds } }],
    });
    await apply('mastra_threads', { resourceId: org });
    await apply('mastra_resources', { id: org });
    await apply('mastra_workflow_snapshot', { resourceId: org });
    await apply('mastra_scorers', {
      OR: [{ organizationId: org }, { resourceId: org }],
    });

    return result;
  }

  async getUserAffiliate(user: string) {
    const profile = await this._prisma.model.affiliateProfile.findUnique({
      where: { userId: user },
      select: {
        id: true,
        _count: { select: { commissions: true } },
      },
    });

    return profile
      ? { id: profile.id, commissions: profile._count.commissions }
      : null;
  }

  async planUser(user: string, scopeOrgIds: string[] = []) {
    const db = this._prisma.model as unknown as Db;
    const tables = await this.runSteps(db, userSteps(user), false);
    tables.User = 1;
    // memberships of organizations erased in the same run are counted there
    if (scopeOrgIds.length) {
      tables.UserOrganization = await this._prisma.model.userOrganization.count(
        {
          where: { userId: user, organizationId: { notIn: scopeOrgIds } },
        }
      );
    }

    const affiliate = await this.getUserAffiliate(user);
    if (affiliate) tables.AffiliateProfile = 1;
    return {
      tables,
      affiliate: !affiliate
        ? ('none' as const)
        : affiliate.commissions
        ? ('kept-anonymised' as const)
        : ('deleted' as const),
      commissions: affiliate?.commissions || 0,
    };
  }

  // Hard-deletes the person. With an affiliate commission ledger the user row
  // is kept as an anonymised tombstone because AffiliateProfile.userId is a
  // required foreign key of the ledger.
  eraseUser(user: string): Promise<UserErasureOutcome> {
    return this._transaction.model.$transaction(async (tx) => {
      const row = await tx.user.findUnique({
        where: { id: user },
        select: {
          id: true,
          pictureId: true,
          agencies: { select: { logoId: true } },
        },
      });
      if (!row) {
        return {
          tables: {},
          objectSources: [],
          affiliate: 'none' as const,
          tombstone: false,
        };
      }

      const mediaIds = [row.pictureId, row.agencies?.logoId].filter(
        Boolean
      ) as string[];
      const tables = await this.runSteps(tx, userSteps(user), true);

      // an avatar or agency logo uploaded into a shared organization is
      // personal data, unless a post or another record still uses it
      const objectSources: string[] = [];
      await tx.user.update({ where: { id: user }, data: { pictureId: null } });
      for (const id of mediaIds) {
        const media = await tx.media.findUnique({ where: { id } });
        if (!media) continue;
        const inUse =
          (await tx.post.count({
            where: { image: { contains: media.name } },
          })) +
          (await tx.user.count({ where: { pictureId: id } })) +
          (await tx.oAuthApp.count({ where: { pictureId: id } })) +
          (await tx.socialMediaAgency.count({ where: { logoId: id } }));
        if (inUse) continue;
        await tx.media.delete({ where: { id } });
        tables.Media = (tables.Media || 0) + 1;
        objectSources.push(media.path);
        if (media.thumbnail) objectSources.push(media.thumbnail);
      }

      const profile = await tx.affiliateProfile.findUnique({
        where: { userId: user },
        select: { id: true, _count: { select: { commissions: true } } },
      });
      let affiliate: UserErasureOutcome['affiliate'] = 'none';
      if (profile) {
        const code = `erased-${profile.id}`;
        if (profile._count.commissions) {
          // keep the ledger, strip the person: no payout email, no vanity code
          await tx.affiliateProfile.update({
            where: { id: profile.id },
            data: { payoutEmail: null, code, customCodeSet: false },
          });
          await tx.organization.updateMany({
            where: { referredByAffiliateId: profile.id },
            data: { referralCode: code },
          });
          affiliate = 'kept-anonymised';
        } else {
          await tx.organization.updateMany({
            where: { referredByAffiliateId: profile.id },
            data: { referredByAffiliateId: null, referralCode: null },
          });
          await tx.affiliateProfile.delete({ where: { id: profile.id } });
          affiliate = 'deleted';
        }
        tables.AffiliateProfile = 1;
      }

      if (affiliate === 'kept-anonymised') {
        await tx.user.update({
          where: { id: user },
          data: {
            email: `erased_${user}`,
            password: null,
            name: null,
            lastName: null,
            providerId: null,
            bio: null,
            ip: null,
            agent: null,
            account: null,
            timezoneName: null,
            inviteId: null,
            activated: false,
            isSuperAdmin: false,
            deletedAt: new Date(),
          },
        });
      } else {
        await tx.user.delete({ where: { id: user } });
      }
      tables.User = 1;

      return {
        tables,
        objectSources,
        affiliate,
        tombstone: affiliate === 'kept-anonymised',
      };
    }, TRANSACTION);
  }
}
