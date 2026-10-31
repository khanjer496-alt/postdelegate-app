import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ErasureMember,
  ErasureMembership,
  ErasureRepository,
  ErasureUserRow,
  TableCounts,
  mergeTableCounts,
} from '@gitroom/nestjs-libraries/database/prisma/erasure/erasure.repository';
import { IntegrationAuthorizationLifecycleService } from '@gitroom/nestjs-libraries/integrations/integration.authorization.lifecycle.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { PaymentService } from '@gitroom/nestjs-libraries/services/payment/payment.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';

export interface ErasureOptions {
  email: string;
  orgId?: string;
  // repeats the target: the email, or the organization id when --org is used
  confirm?: string;
  dryRun?: boolean;
  allowSuperAdmin?: boolean;
  allowOwnerlessOrgs?: boolean;
  skipProviderRevocation?: boolean;
  receiptDir?: string;
}

export type ErasureRefusalCode =
  | 'INVALID_EMAIL'
  | 'CONFIRM_MISMATCH'
  | 'USER_NOT_FOUND'
  | 'ORG_NOT_FOUND'
  | 'SUPERADMIN'
  | 'BLOCKED'
  | 'STORAGE_NOT_CONFIGURED';

export class ErasureRefusal extends Error {
  constructor(public code: ErasureRefusalCode, message: string) {
    super(message);
  }
}

export interface ObjectReport {
  candidates: number;
  deleted?: number;
  alreadyMissing?: number;
  sharedKept?: number;
  // object keys that could not be deleted, retry them by hand
  failed?: string[];
  // written to the receipt before the commit, while the keys are still known
  pendingKeys?: string[];
}

export interface OrganizationReport {
  id: string;
  action: 'ERASE' | 'LEAVE';
  tables: TableCounts;
  aiMemory?: Record<string, number | null>;
  objects?: ObjectReport;
  workflows?: { candidates: number; terminated?: number };
  hasSubscription?: boolean;
  providerRevocationPending?: number;
  blockers: string[];
  status: 'planned' | 'erased' | 'left' | 'failed';
}

export interface UserReport {
  id: string;
  providerName: string;
  // the account was already removed from the app (soft delete)
  removedFromApp: boolean;
  tables: TableCounts;
  affiliate?: 'none' | 'deleted' | 'kept-anonymised';
  commissions?: number;
  tombstone?: boolean;
  objects?: ObjectReport;
  status: 'planned' | 'erased' | 'kept' | 'failed';
}

export interface ErasureReport {
  mode: 'dry-run' | 'erase';
  emailHash: string;
  scope: 'person' | 'organization';
  startedAt: string;
  finishedAt?: string;
  users: UserReport[];
  organizations: OrganizationReport[];
  notes: string[];
  // contains operator-only identifiers (Stripe customer ids), receipt is 0600
  followUp: string[];
  receiptPath?: string;
  status: 'planned' | 'in-progress' | 'completed' | 'failed';
  error?: string;
}

const hash = (algorithm: string, value: string) =>
  createHash(algorithm).update(value).digest('hex');

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const CONCURRENCY = 10;

@Injectable()
export class ErasureService {
  private storage = UploadFactory.createStorage();

  constructor(
    private _repository: ErasureRepository,
    private _lifecycle: IntegrationAuthorizationLifecycleService,
    private _manager: IntegrationManager,
    private _payment: PaymentService
  ) {}

  async run(options: ErasureOptions): Promise<ErasureReport> {
    const email = (options.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
      throw new ErasureRefusal('INVALID_EMAIL', 'A valid --email is required.');
    }

    // The confirmation repeats the target and is checked before anything is
    // read. Without it, or with --dry-run, nothing is ever written.
    const expected = options.orgId ? options.orgId : email;
    if (
      options.confirm !== undefined &&
      options.confirm.trim().toLowerCase() !== expected.trim().toLowerCase()
    ) {
      throw new ErasureRefusal(
        'CONFIRM_MISMATCH',
        `--confirm must repeat the target exactly (${
          options.orgId ? 'the --org id' : 'the --email'
        }). Nothing was changed.`
      );
    }
    const execute = options.confirm !== undefined && !options.dryRun;

    const report: ErasureReport = {
      mode: execute ? 'erase' : 'dry-run',
      emailHash: hash('sha256', email),
      scope: options.orgId ? 'organization' : 'person',
      startedAt: new Date().toISOString(),
      users: [],
      organizations: [],
      notes: [],
      followUp: [],
      status: 'planned',
    };

    const users = await this.resolveUsers(email);
    if (users.some((user) => user.isSuperAdmin) && !options.allowSuperAdmin) {
      throw new ErasureRefusal(
        'SUPERADMIN',
        'The target is a platform super admin. Refusing; pass --allow-superadmin to override.'
      );
    }

    const { memberships, members } = await this._repository.getMemberships(
      users.map((user) => user.id)
    );
    const targetIds = new Set(users.map((user) => user.id));
    const orgs = this.classify(memberships, members, targetIds, options);

    const storageNote = this.storageNote();
    if (storageNote) {
      if (execute) {
        throw new ErasureRefusal('STORAGE_NOT_CONFIGURED', storageNote);
      }
      report.notes.push(`WARNING: ${storageNote}`);
    }

    for (const user of users) {
      report.users.push({
        id: user.id,
        providerName: user.providerName,
        removedFromApp: !!user.deletedAt,
        tables: {},
        status: 'planned',
      });
    }

    for (const org of orgs) {
      report.organizations.push(
        await this.plan(org, users, targetIds, options)
      );
    }
    await this.planUsers(report, users, options);

    report.notes.push(
      'Posts already published to a social network, and media shared by URL in them, are outside PostDelegate control and stay there.',
      'Temporal keeps closed workflow history until the namespace retention expires; encrypted backups rotate out on the normal schedule.'
    );

    if (!execute) {
      this.audit('erasure.planned', report);
      return report;
    }

    const blocked = report.organizations.filter((org) => org.blockers.length);
    if (blocked.length) {
      await this.startProviderRevocation(report, blocked);
      this.audit('erasure.refused', report);
      throw new ErasureRefusal(
        'BLOCKED',
        blocked.map((org) => `${org.id}: ${org.blockers.join('; ')}`).join('\n')
      );
    }

    // fail before anything changes when the receipt cannot be written
    report.status = 'in-progress';
    await this.saveReceipt(report, options);

    try {
      await this.execute(report, orgs, users, options);
      report.status = 'completed';
    } catch (err: any) {
      report.status = 'failed';
      report.error = String(err?.message || err).slice(0, 500);
      await this.saveReceipt(report, options);
      this.audit('erasure.failed', report);
      throw err;
    }

    report.finishedAt = new Date().toISOString();
    await this.saveReceipt(report, options);
    this.audit('erasure.completed', report);
    return report;
  }

  private async resolveUsers(email: string): Promise<ErasureUserRow[]> {
    const prefix = `deleted_${hash('md5', email)}_`;
    const rows = await this._repository.findUsers(email, prefix);
    // the database match is case-insensitive and prefix based, confirm it here
    const users = rows.filter(
      (row) => row.email.toLowerCase() === email || row.email.startsWith(prefix)
    );
    if (!users.length) {
      throw new ErasureRefusal(
        'USER_NOT_FOUND',
        'No account matches this email, neither live nor removed from the app.'
      );
    }
    return users;
  }

  private classify(
    memberships: ErasureMembership[],
    members: ErasureMember[],
    targetIds: Set<string>,
    options: ErasureOptions
  ) {
    const byOrg = new Map<string, ErasureMembership[]>();
    for (const membership of memberships) {
      byOrg.set(membership.organizationId, [
        ...(byOrg.get(membership.organizationId) || []),
        membership,
      ]);
    }

    if (options.orgId && !byOrg.has(options.orgId)) {
      throw new ErasureRefusal(
        'ORG_NOT_FOUND',
        'The --org is not an organization of this person.'
      );
    }

    return [...byOrg]
      .filter(([id]) => !options.orgId || id === options.orgId)
      .map(([id, rows]) => {
        const all = members.filter((member) => member.organizationId === id);
        const others = all.filter((member) => !targetIds.has(member.userId));
        return {
          id,
          organization: rows[0].organization,
          sole: others.length === 0,
          targetUserIds: rows.map((row) => row.userId),
          // the person owns it and nobody else would be left to
          ownerless:
            others.length > 0 &&
            rows.some((row) => row.role === 'SUPERADMIN') &&
            !others.some((member) => member.role === 'SUPERADMIN'),
        };
      });
  }

  private async plan(
    org: ReturnType<ErasureService['classify']>[number],
    users: ErasureUserRow[],
    targetIds: Set<string>,
    options: ErasureOptions
  ): Promise<OrganizationReport> {
    if (!org.sole) {
      const tables: TableCounts = {};
      for (const userId of org.targetUserIds) {
        mergeTableCounts(
          tables,
          await this._repository.planSharedOrganizationLeave(userId, org.id)
        );
      }
      return {
        id: org.id,
        action: 'LEAVE',
        tables,
        blockers:
          org.ownerless && !options.allowOwnerlessOrgs
            ? [
                'the person is the only owner of a workspace shared with others; make another member an owner first, or pass --allow-ownerless-orgs',
              ]
            : [],
        status: 'planned',
      };
    }

    const [tables, aiMemory, integrations, targets, sources] =
      await Promise.all([
        this._repository.planOrganization(org.id),
        this._repository.runOrganizationAiMemory(org.id, false),
        this._repository.getOrganizationIntegrations(org.id),
        this._repository.getOrganizationWorkflowTargets(org.id),
        this._repository.getOrganizationObjectSources(org.id),
      ]);

    const pendingRevocation = integrations.filter(
      (integration) =>
        integration.hasCredentials &&
        !!this._manager.getSocialIntegration(integration.providerIdentifier)
          ?.authorizationPolicy
    );

    return {
      id: org.id,
      action: 'ERASE',
      tables,
      aiMemory,
      objects: { candidates: this.objectUrls(sources).length },
      providerRevocationPending: options.skipProviderRevocation
        ? 0
        : pendingRevocation.length,
      workflows: {
        candidates:
          targets.integrations.length +
          targets.integrations.reduce((sum, i) => sum + i.postIds.length, 0) +
          targets.extraWorkflowIds.length,
      },
      hasSubscription:
        !!org.organization.subscription || !!org.organization.paymentId,
      blockers:
        pendingRevocation.length && !options.skipProviderRevocation
          ? [
              `${pendingRevocation.length} channel(s) still hold provider authorization that must be revoked first (the in-app deletion lifecycle does this); a real run starts that revocation, then re-run when it has finished, or pass --skip-provider-revocation to erase the credentials without revoking them`,
            ]
          : [],
      status: 'planned',
    };
  }

  private async planUsers(
    report: ErasureReport,
    users: ErasureUserRow[],
    options: ErasureOptions
  ) {
    if (options.orgId) {
      for (const user of report.users) {
        user.status = 'kept';
      }
      report.notes.push(
        'Scoped to one organization with --org: the user rows are kept. Run without --org to erase the person.'
      );
      return;
    }

    const erased = report.organizations
      .filter((org) => org.action === 'ERASE')
      .map((org) => org.id);
    for (const user of report.users) {
      const plan = await this._repository.planUser(user.id, erased);
      user.tables = plan.tables;
      user.affiliate = plan.affiliate;
      user.commissions = plan.commissions;
      user.tombstone = plan.affiliate === 'kept-anonymised';
    }
  }

  private async startProviderRevocation(
    report: ErasureReport,
    blocked: OrganizationReport[]
  ) {
    for (const org of blocked.filter(
      (item) => item.providerRevocationPending
    )) {
      try {
        const ids = await this._lifecycle.requestOrganizationDeletion(org.id);
        report.notes.push(
          `Provider revocation started for ${ids.length} channel(s) of ${org.id}; re-run when it has finished.`
        );
      } catch (err: any) {
        report.notes.push(
          `Provider revocation could not be started for ${org.id}: ${String(
            err?.message || err
          ).slice(0, 200)}`
        );
      }
    }
  }

  private async execute(
    report: ErasureReport,
    orgs: ReturnType<ErasureService['classify']>,
    users: ErasureUserRow[],
    options: ErasureOptions
  ) {
    for (const org of orgs) {
      const item = report.organizations.find((o) => o.id === org.id)!;
      try {
        if (item.action === 'ERASE') {
          await this.eraseOrganization(report, org, item, options);
          item.status = 'erased';
        } else if (options.orgId) {
          for (const userId of org.targetUserIds) {
            await this._repository.leaveSharedOrganization(userId, org.id);
          }
          item.status = 'left';
        }
      } catch (err) {
        item.status = 'failed';
        throw err;
      }
    }

    if (options.orgId) return;

    for (const user of report.users) {
      try {
        const outcome = await this._repository.eraseUser(user.id);
        user.tables = outcome.tables;
        user.affiliate = outcome.affiliate;
        user.tombstone = outcome.tombstone;
        user.objects = await this.deleteObjects(
          this.objectUrls(outcome.objectSources)
        );
        user.status = 'erased';
      } catch (err) {
        user.status = 'failed';
        throw err;
      }
    }

    // memberships of shared workspaces went with the user rows
    for (const item of report.organizations) {
      if (item.action === 'LEAVE') item.status = 'left';
    }
  }

  private async eraseOrganization(
    report: ErasureReport,
    org: ReturnType<ErasureService['classify']>[number],
    item: OrganizationReport,
    options: ErasureOptions
  ) {
    // billing first: nothing has changed yet if it fails, and an erased
    // organization must not keep being charged
    if (item.hasSubscription) {
      await this._payment.cancelAllSubscriptions(org.id);
      if (org.organization.paymentId) {
        report.followUp.push(
          `Stripe customer ${org.organization.paymentId} (organization ${org.id}): subscription cancelled; delete the customer in Stripe once invoices are no longer needed for tax records.`
        );
      }
    }

    await this._repository.suspendOrganization(org.id);

    const targets = await this._repository.getOrganizationWorkflowTargets(
      org.id
    );
    const closed = await this._lifecycle.closeWorkflows(
      org.id,
      targets.integrations.map((integration) => integration.id),
      targets.integrations.flatMap((integration) => integration.postIds),
      targets.extraWorkflowIds
    );
    item.workflows = {
      candidates: item.workflows?.candidates || 0,
      terminated: closed.terminated,
    };
    if (!closed.stopped) {
      throw new Error(
        `${closed.pending} Temporal workflow(s) of ${org.id} could not be stopped; nothing was deleted, retry shortly.`
      );
    }

    // the object keys are only known from rows that are about to disappear:
    // write them to the receipt before the commit
    const urls = this.objectUrls(
      await this._repository.getOrganizationObjectSources(org.id)
    );
    item.objects = {
      candidates: urls.length,
      pendingKeys: urls.map((url) => this.keyOf(url)),
    };
    await this.saveReceipt(report, options);

    item.tables = await this._repository.eraseOrganization(org.id);

    item.aiMemory = await this._repository.runOrganizationAiMemory(
      org.id,
      true
    );
    try {
      // every analytics cache key of the organization, they expire in an hour
      await this._lifecycle.purgeAnalytics(org.id, ['*']);
    } catch {
      report.notes.push(
        `Redis analytics cache of ${org.id} could not be purged; it expires within an hour.`
      );
    }

    item.objects = await this.deleteObjects(urls);
  }

  private storageNote() {
    return this.objectPrefix()
      ? undefined
      : 'Object storage is not configured for URL matching (CLOUDFLARE_BUCKET_URL or FRONTEND_URL missing), uploaded media cannot be located or deleted.';
  }

  // public URL prefix of the objects this deployment stores
  private objectPrefix(): string | undefined {
    const prefix =
      (process.env.STORAGE_PROVIDER || 'local') === 'cloudflare'
        ? process.env.CLOUDFLARE_BUCKET_URL
        : process.env.FRONTEND_URL
        ? `${process.env.FRONTEND_URL}/uploads`
        : undefined;
    return prefix ? prefix.replace(/\/+$/, '') : undefined;
  }

  // Pulls the URLs of this deployment out of plain URLs and JSON blobs
  private objectUrls(sources: string[]): string[] {
    const prefix = this.objectPrefix();
    if (!prefix) return [];
    const local = (process.env.STORAGE_PROVIDER || 'local') !== 'cloudflare';
    const pattern = new RegExp(
      `${escapeRegExp(prefix)}/${
        local ? '(?:\\d{4}/\\d{2}/\\d{2}/)?' : ''
      }[A-Za-z0-9._-]+`,
      'g'
    );
    const urls = new Set<string>();
    for (const source of sources) {
      for (const match of source.match(pattern) || []) urls.add(match);
    }
    return [...urls];
  }

  private keyOf(url: string) {
    return url.slice((this.objectPrefix() || '').length + 1);
  }

  // After the database commit. A missing object is not an error, an object
  // that a surviving record still points at is kept.
  private async deleteObjects(urls: string[]): Promise<ObjectReport> {
    const result: ObjectReport = {
      candidates: urls.length,
      deleted: 0,
      alreadyMissing: 0,
      sharedKept: 0,
      failed: [],
    };

    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      await Promise.all(
        urls.slice(i, i + CONCURRENCY).map(async (url) => {
          const key = this.keyOf(url);
          try {
            if (await this._repository.countObjectReferences(url, key)) {
              result.sharedKept!++;
              return;
            }
            if (
              this.storage.objectSize &&
              (await this.storage.objectSize(key)) === null
            ) {
              result.alreadyMissing!++;
              return;
            }
            await this.storage.removeFile(url);
            result.deleted!++;
          } catch (err: any) {
            if (
              err?.name === 'NoSuchKey' ||
              err?.name === 'NotFound' ||
              err?.$metadata?.httpStatusCode === 404
            ) {
              result.alreadyMissing!++;
              return;
            }
            result.failed!.push(key);
          }
        })
      );
    }

    return result;
  }

  private async saveReceipt(report: ErasureReport, options: ErasureOptions) {
    const name = `erasure-${report.emailHash.slice(
      0,
      12
    )}-${report.startedAt.replace(/[:.]/g, '-')}.json`;
    const dirs = [
      options.receiptDir,
      process.env.ERASURE_RECEIPT_DIR,
      '/config/erasure-receipts',
      join(tmpdir(), 'erasure-receipts'),
    ].filter(Boolean) as string[];

    for (const dir of dirs) {
      try {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const path = join(dir, name);
        report.receiptPath = path;
        await writeFile(path, JSON.stringify(report, null, 2), { mode: 0o600 });
        return path;
      } catch {
        report.receiptPath = undefined;
      }
    }
    throw new Error(
      'No writable receipt directory; nothing further was erased.'
    );
  }

  // One line per event; only the email hash and organization ids are logged
  private audit(event: string, report: ErasureReport) {
    console.log(
      `ERASURE_AUDIT ${JSON.stringify({
        event,
        at: new Date().toISOString(),
        emailHash: report.emailHash,
        mode: report.mode,
        organizations: report.organizations.map((org) => ({
          id: org.id,
          action: org.action,
          status: org.status,
        })),
        users: report.users.length,
        receipt: report.receiptPath,
      })}`
    );
  }
}
