import { createHash } from 'crypto';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const storage = {
  removeFile: jest.fn(),
  objectSize: jest.fn(),
};

jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => storage },
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/integration.authorization.lifecycle.service',
  () => ({ IntegrationAuthorizationLifecycleService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('@gitroom/nestjs-libraries/services/payment/payment.service', () => ({
  PaymentService: class {},
}));

import { ErasureRefusal, ErasureService } from './erasure.service';

const EMAIL = 'person@example.com';
const BUCKET = 'https://media.test';
const sha = (value: string, algorithm = 'sha256') =>
  createHash(algorithm).update(value).digest('hex');

const user = (id: string, over: Record<string, any> = {}) => ({
  id,
  email: 'Person@Example.com',
  providerName: 'LOCAL',
  isSuperAdmin: false,
  deletedAt: null,
  createdAt: new Date('2026-01-01'),
  pictureId: null,
  ...over,
});

const membership = (
  userId: string,
  organizationId: string,
  role = 'SUPERADMIN',
  organization: Record<string, any> = {}
) => ({
  userId,
  organizationId,
  role,
  organization: {
    id: organizationId,
    deletedAt: null,
    paymentId: null,
    subscription: null,
    ...organization,
  },
});

const setup = (
  scenario: {
    users?: any[];
    memberships?: any[];
    members?: any[];
    integrations?: any[];
    sources?: string[];
    workflowsStopped?: boolean;
    policy?: boolean;
  } = {}
) => {
  const users = scenario.users || [user('u1')];
  const repository: Record<string, jest.Mock> = {
    findUsers: jest.fn().mockResolvedValue(users),
    getMemberships: jest.fn().mockResolvedValue({
      memberships: scenario.memberships || [
        membership('u1', 'org-sole', 'SUPERADMIN', {
          paymentId: 'cus_123',
          subscription: { id: 's1', provider: 'stripe' },
        }),
        membership('u1', 'org-shared', 'USER'),
      ],
      members: scenario.members || [
        { organizationId: 'org-sole', userId: 'u1', role: 'SUPERADMIN' },
        { organizationId: 'org-shared', userId: 'u1', role: 'USER' },
        { organizationId: 'org-shared', userId: 'other', role: 'SUPERADMIN' },
      ],
    }),
    getOrganizationIntegrations: jest
      .fn()
      .mockResolvedValue(scenario.integrations || []),
    getOrganizationWorkflowTargets: jest.fn().mockResolvedValue({
      integrations: [{ id: 'int-1', postIds: ['p1', 'p2'] }],
      extraWorkflowIds: ['streak_org-sole'],
    }),
    getOrganizationObjectSources: jest
      .fn()
      .mockResolvedValue(
        scenario.sources || [
          `${BUCKET}/a.png`,
          `[{"id":"x","path":"${BUCKET}/b.mp4"}]`,
          'https://elsewhere.test/c.png',
        ]
      ),
    planOrganization: jest.fn().mockResolvedValue({ Post: 4, Integration: 1 }),
    runOrganizationAiMemory: jest
      .fn()
      .mockResolvedValue({ mastra_messages: 2 }),
    planSharedOrganizationLeave: jest
      .fn()
      .mockResolvedValue({ 'Comments.userId': 2, UserOrganization: 1 }),
    planUser: jest.fn().mockResolvedValue({
      tables: { User: 1, ItemUser: 3 },
      affiliate: 'none',
      commissions: 0,
    }),
    suspendOrganization: jest.fn().mockResolvedValue(undefined),
    eraseOrganization: jest
      .fn()
      .mockResolvedValue({ Post: 4, Organization: 1 }),
    leaveSharedOrganization: jest.fn().mockResolvedValue({}),
    eraseUser: jest.fn().mockResolvedValue({
      tables: { User: 1 },
      objectSources: [],
      affiliate: 'none',
      tombstone: false,
    }),
    countObjectReferences: jest.fn().mockResolvedValue(0),
  };
  const lifecycle = {
    closeWorkflows: jest.fn().mockResolvedValue({
      stopped: scenario.workflowsStopped !== false,
      newlyStopped: true,
      terminated: 3,
      pending: scenario.workflowsStopped === false ? 2 : 0,
    }),
    purgeAnalytics: jest.fn().mockResolvedValue(undefined),
    requestOrganizationDeletion: jest.fn().mockResolvedValue(['int-1']),
  };
  const manager = {
    getSocialIntegration: jest
      .fn()
      .mockReturnValue(scenario.policy ? { authorizationPolicy: {} } : {}),
  };
  const payment = {
    cancelAllSubscriptions: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ErasureService(
    repository as any,
    lifecycle as any,
    manager as any,
    payment as any
  );
  const receiptDir = mkdtempSync(join(tmpdir(), 'erasure-spec-'));

  return { service, repository, lifecycle, manager, payment, receiptDir };
};

const writeMocks = (s: ReturnType<typeof setup>) => [
  s.repository.suspendOrganization,
  s.repository.eraseOrganization,
  s.repository.leaveSharedOrganization,
  s.repository.eraseUser,
  s.lifecycle.closeWorkflows,
  s.lifecycle.purgeAnalytics,
  s.lifecycle.requestOrganizationDeletion,
  s.payment.cancelAllSubscriptions,
  storage.removeFile,
];

describe('ErasureService', () => {
  const env = { ...process.env };
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.STORAGE_PROVIDER = 'cloudflare';
    process.env.CLOUDFLARE_BUCKET_URL = `${BUCKET}/`;
    storage.removeFile.mockReset().mockResolvedValue(undefined);
    storage.objectSize.mockReset().mockResolvedValue(10);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...env };
    logSpy.mockRestore();
  });

  describe('dry run', () => {
    it('is the default and makes no write of any kind', async () => {
      const s = setup();

      const report = await s.service.run({
        email: EMAIL,
        receiptDir: s.receiptDir,
      });

      expect(report.mode).toBe('dry-run');
      expect(report.status).toBe('planned');
      for (const mock of writeMocks(s)) expect(mock).not.toHaveBeenCalled();
      expect(readdirSync(s.receiptDir)).toEqual([]);
    });

    it('plans the sole organization for erasure and the shared one as a leave', async () => {
      const s = setup();

      const report = await s.service.run({ email: EMAIL });

      const byId = Object.fromEntries(
        report.organizations.map((org) => [org.id, org])
      );
      expect(byId['org-sole'].action).toBe('ERASE');
      expect(byId['org-sole'].tables).toEqual({ Post: 4, Integration: 1 });
      expect(byId['org-sole'].hasSubscription).toBe(true);
      expect(byId['org-sole'].workflows?.candidates).toBe(1 + 2 + 1);
      expect(byId['org-shared'].action).toBe('LEAVE');
      expect(s.repository.planOrganization).toHaveBeenCalledTimes(1);
      expect(s.repository.planOrganization).toHaveBeenCalledWith('org-sole');
      expect(report.users[0].tables).toEqual({ User: 1, ItemUser: 3 });
    });

    it('counts only objects of the own bucket, found in plain urls and JSON', async () => {
      const s = setup();

      const report = await s.service.run({ email: EMAIL });

      expect(
        report.organizations.find((org) => org.id === 'org-sole')?.objects
      ).toEqual({ candidates: 2 });
    });

    it('still makes no write when --dry-run accompanies a matching --confirm', async () => {
      const s = setup();

      const report = await s.service.run({
        email: EMAIL,
        confirm: EMAIL,
        dryRun: true,
        receiptDir: s.receiptDir,
      });

      expect(report.mode).toBe('dry-run');
      for (const mock of writeMocks(s)) expect(mock).not.toHaveBeenCalled();
    });

    it('reports blockers without acting on them', async () => {
      const s = setup({
        policy: true,
        integrations: [
          { id: 'int-1', providerIdentifier: 'youtube', hasCredentials: true },
        ],
      });

      const report = await s.service.run({ email: EMAIL });

      expect(
        report.organizations.find((org) => org.id === 'org-sole')?.blockers
      ).toHaveLength(1);
      expect(s.lifecycle.requestOrganizationDeletion).not.toHaveBeenCalled();
    });
  });

  describe('confirmation', () => {
    it('refuses a --confirm that does not repeat the email, before reading anything', async () => {
      const s = setup();

      await expect(
        s.service.run({ email: EMAIL, confirm: 'someone-else@example.com' })
      ).rejects.toMatchObject({ code: 'CONFIRM_MISMATCH' });

      expect(s.repository.findUsers).not.toHaveBeenCalled();
      for (const mock of writeMocks(s)) expect(mock).not.toHaveBeenCalled();
    });

    it('requires the organization id as --confirm when --org is used', async () => {
      const s = setup();

      await expect(
        s.service.run({ email: EMAIL, orgId: 'org-shared', confirm: EMAIL })
      ).rejects.toBeInstanceOf(ErasureRefusal);
      for (const mock of writeMocks(s)) expect(mock).not.toHaveBeenCalled();
    });

    it('accepts the email in another case', async () => {
      const s = setup();

      const report = await s.service.run({
        email: EMAIL.toUpperCase(),
        confirm: `  ${EMAIL}`,
        receiptDir: s.receiptDir,
      });

      expect(report.mode).toBe('erase');
    });

    it('refuses an invalid email', async () => {
      const s = setup();

      await expect(s.service.run({ email: 'nope' })).rejects.toMatchObject({
        code: 'INVALID_EMAIL',
      });
    });
  });

  describe('super admin guard', () => {
    it('refuses a platform super admin, also in a dry run', async () => {
      const s = setup({ users: [user('u1', { isSuperAdmin: true })] });

      await expect(s.service.run({ email: EMAIL })).rejects.toMatchObject({
        code: 'SUPERADMIN',
      });
      await expect(
        s.service.run({
          email: EMAIL,
          confirm: EMAIL,
          receiptDir: s.receiptDir,
        })
      ).rejects.toMatchObject({ code: 'SUPERADMIN' });
      for (const mock of writeMocks(s)) expect(mock).not.toHaveBeenCalled();
    });

    it('proceeds with --allow-superadmin', async () => {
      const s = setup({ users: [user('u1', { isSuperAdmin: true })] });

      const report = await s.service.run({
        email: EMAIL,
        confirm: EMAIL,
        allowSuperAdmin: true,
        receiptDir: s.receiptDir,
      });

      expect(report.status).toBe('completed');
    });
  });

  describe('real run', () => {
    it('erases the sole organization and only leaves the shared one', async () => {
      const s = setup();

      const report = await s.service.run({
        email: EMAIL,
        confirm: EMAIL,
        receiptDir: s.receiptDir,
      });

      expect(s.repository.eraseOrganization).toHaveBeenCalledTimes(1);
      expect(s.repository.eraseOrganization).toHaveBeenCalledWith('org-sole');
      expect(s.repository.leaveSharedOrganization).not.toHaveBeenCalled();
      // the person leaves the shared workspace through the user erasure
      expect(s.repository.eraseUser).toHaveBeenCalledWith('u1');
      expect(report.organizations.map((org) => [org.id, org.status])).toEqual([
        ['org-sole', 'erased'],
        ['org-shared', 'left'],
      ]);
    });

    it('cancels billing, then fences, stops workflows and deletes in that order', async () => {
      const s = setup();
      const order: string[] = [];
      s.payment.cancelAllSubscriptions.mockImplementation(async () => {
        order.push('billing');
      });
      s.repository.suspendOrganization.mockImplementation(async () => {
        order.push('suspend');
      });
      s.lifecycle.closeWorkflows.mockImplementation(async () => {
        order.push('workflows');
        return { stopped: true, newlyStopped: true, terminated: 1, pending: 0 };
      });
      s.repository.eraseOrganization.mockImplementation(async () => {
        order.push('database');
        return {};
      });
      storage.removeFile.mockImplementation(async () => {
        order.push('r2');
      });

      await s.service.run({
        email: EMAIL,
        confirm: EMAIL,
        receiptDir: s.receiptDir,
      });

      expect(order.slice(0, 4)).toEqual([
        'billing',
        'suspend',
        'workflows',
        'database',
      ]);
      // objects are deleted only after the database commit
      expect(order.indexOf('r2')).toBeGreaterThan(order.indexOf('database'));
      expect(s.lifecycle.closeWorkflows).toHaveBeenCalledWith(
        'org-sole',
        ['int-1'],
        ['p1', 'p2'],
        ['streak_org-sole']
      );
    });

    it('stops without deleting when a workflow cannot be stopped', async () => {
      const s = setup({ workflowsStopped: false });

      await expect(
        s.service.run({
          email: EMAIL,
          confirm: EMAIL,
          receiptDir: s.receiptDir,
        })
      ).rejects.toThrow(/could not be stopped/);

      expect(s.repository.eraseOrganization).not.toHaveBeenCalled();
      expect(s.repository.eraseUser).not.toHaveBeenCalled();
      expect(storage.removeFile).not.toHaveBeenCalled();
      const [file] = readdirSync(s.receiptDir);
      expect(
        JSON.parse(readFileSync(join(s.receiptDir, file), 'utf8')).status
      ).toBe('failed');
    });

    it('does not cancel billing when the organization has no subscription', async () => {
      const s = setup({
        memberships: [membership('u1', 'org-sole')],
        members: [
          { organizationId: 'org-sole', userId: 'u1', role: 'SUPERADMIN' },
        ],
      });

      await s.service.run({
        email: EMAIL,
        confirm: EMAIL,
        receiptDir: s.receiptDir,
      });

      expect(s.payment.cancelAllSubscriptions).not.toHaveBeenCalled();
    });

    it('writes an audit line and a 0600 receipt without the email or any address', async () => {
      const s = setup();

      const report = await s.service.run({
        email: EMAIL,
        confirm: EMAIL,
        receiptDir: s.receiptDir,
      });

      const audit = logSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith('ERASURE_AUDIT '));
      expect(audit.length).toBeGreaterThan(0);
      const last = JSON.parse(
        audit[audit.length - 1].slice('ERASURE_AUDIT '.length)
      );
      expect(last).toMatchObject({
        event: 'erasure.completed',
        emailHash: sha(EMAIL),
      });
      expect(last.organizations.map((o: any) => o.id)).toEqual([
        'org-sole',
        'org-shared',
      ]);
      for (const line of audit) {
        expect(line.toLowerCase()).not.toContain(EMAIL);
      }

      const [file] = readdirSync(s.receiptDir);
      const path = join(s.receiptDir, file);
      expect(report.receiptPath).toBe(path);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      const body = readFileSync(path, 'utf8');
      expect(body.toLowerCase()).not.toContain(EMAIL);
      expect(JSON.parse(body).emailHash).toBe(sha(EMAIL));
      // the Stripe customer id is an operator follow-up kept in the receipt only
      expect(JSON.parse(body).followUp.join(' ')).toContain('cus_123');
    });

    it('falls back to the temp directory when the receipt directory is not writable', async () => {
      const s = setup();
      // a path below a regular file can never be created, on any OS
      const blocker = join(mkdtempSync(join(tmpdir(), 'erasure-')), 'file');
      writeFileSync(blocker, '');
      process.env.ERASURE_RECEIPT_DIR = join(blocker, 'not-writable');

      const report = s.service.run({
        email: EMAIL,
        confirm: EMAIL,
        receiptDir: join(blocker, 'also-not-writable'),
      });

      await expect(report).resolves.toMatchObject({ status: 'completed' });
    });
  });

  describe('several accounts with the same email', () => {
    it('lists and erases every account, and treats their shared organization as sole', async () => {
      const s = setup({
        users: [user('u1'), user('u2', { providerName: 'GOOGLE' })],
        memberships: [
          membership('u1', 'org-a'),
          membership('u2', 'org-a', 'USER'),
          membership('u2', 'org-b'),
        ],
        members: [
          { organizationId: 'org-a', userId: 'u1', role: 'SUPERADMIN' },
          { organizationId: 'org-a', userId: 'u2', role: 'USER' },
          { organizationId: 'org-b', userId: 'u2', role: 'SUPERADMIN' },
        ],
      });

      const dry = await s.service.run({ email: EMAIL });
      expect(dry.users.map((u) => [u.id, u.providerName])).toEqual([
        ['u1', 'LOCAL'],
        ['u2', 'GOOGLE'],
      ]);

      const real = await s.service.run({
        email: EMAIL,
        confirm: EMAIL,
        receiptDir: s.receiptDir,
      });

      expect(real.organizations.map((o) => [o.id, o.action])).toEqual([
        ['org-a', 'ERASE'],
        ['org-b', 'ERASE'],
      ]);
      expect(s.repository.eraseUser.mock.calls.map((c) => c[0])).toEqual([
        'u1',
        'u2',
      ]);
    });

    it('matches accounts already removed from the app by their hashed email', async () => {
      const prefix = `deleted_${sha(EMAIL, 'md5')}_`;
      const s = setup({
        users: [
          user('u1', { email: `${prefix}abcde`, deletedAt: new Date() }),
          user('u2', { email: 'deleted_0000_xxxxx' }),
        ],
        memberships: [membership('u1', 'org-sole')],
        members: [
          { organizationId: 'org-sole', userId: 'u1', role: 'SUPERADMIN' },
        ],
      });

      const report = await s.service.run({ email: EMAIL });

      expect(s.repository.findUsers).toHaveBeenCalledWith(EMAIL, prefix);
      expect(report.users.map((u) => [u.id, u.removedFromApp])).toEqual([
        ['u1', true],
      ]);
    });

    it('refuses an email without any account', async () => {
      const s = setup({ users: [] });

      await expect(s.service.run({ email: EMAIL })).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
      });
    });
  });

  describe('ledger', () => {
    it('reports an anonymised tombstone when commissions are kept', async () => {
      const s = setup();
      s.repository.eraseUser.mockResolvedValue({
        tables: { User: 1, AffiliateProfile: 1 },
        objectSources: [],
        affiliate: 'kept-anonymised',
        tombstone: true,
      });

      const report = await s.service.run({
        email: EMAIL,
        confirm: EMAIL,
        receiptDir: s.receiptDir,
      });

      expect(report.users[0]).toMatchObject({
        affiliate: 'kept-anonymised',
        tombstone: true,
        status: 'erased',
      });
    });
  });

  describe('blockers', () => {
    it('refuses a shared workspace that would be left without an owner', async () => {
      const s = setup({
        members: [
          { organizationId: 'org-sole', userId: 'u1', role: 'SUPERADMIN' },
          { organizationId: 'org-shared', userId: 'u1', role: 'SUPERADMIN' },
          { organizationId: 'org-shared', userId: 'other', role: 'USER' },
        ],
        memberships: [
          membership('u1', 'org-sole'),
          membership('u1', 'org-shared', 'SUPERADMIN'),
        ],
      });

      await expect(
        s.service.run({
          email: EMAIL,
          confirm: EMAIL,
          receiptDir: s.receiptDir,
        })
      ).rejects.toMatchObject({ code: 'BLOCKED' });
      expect(s.repository.eraseOrganization).not.toHaveBeenCalled();
      expect(s.repository.eraseUser).not.toHaveBeenCalled();

      const allowed = await s.service.run({
        email: EMAIL,
        confirm: EMAIL,
        allowOwnerlessOrgs: true,
        receiptDir: s.receiptDir,
      });
      expect(allowed.status).toBe('completed');
    });

    it('starts provider revocation and refuses while a channel still holds authorization', async () => {
      const s = setup({
        policy: true,
        integrations: [
          { id: 'int-1', providerIdentifier: 'youtube', hasCredentials: true },
        ],
      });

      await expect(
        s.service.run({
          email: EMAIL,
          confirm: EMAIL,
          receiptDir: s.receiptDir,
        })
      ).rejects.toMatchObject({ code: 'BLOCKED' });

      expect(s.lifecycle.requestOrganizationDeletion).toHaveBeenCalledWith(
        'org-sole'
      );
      expect(s.repository.eraseOrganization).not.toHaveBeenCalled();
      expect(s.payment.cancelAllSubscriptions).not.toHaveBeenCalled();
    });

    it('erases channels whose authorization was already revoked', async () => {
      const s = setup({
        policy: true,
        integrations: [
          { id: 'int-1', providerIdentifier: 'youtube', hasCredentials: false },
        ],
      });

      const report = await s.service.run({
        email: EMAIL,
        confirm: EMAIL,
        receiptDir: s.receiptDir,
      });

      expect(report.status).toBe('completed');
    });

    it('can skip provider revocation explicitly', async () => {
      const s = setup({
        policy: true,
        integrations: [
          { id: 'int-1', providerIdentifier: 'youtube', hasCredentials: true },
        ],
      });

      const report = await s.service.run({
        email: EMAIL,
        confirm: EMAIL,
        skipProviderRevocation: true,
        receiptDir: s.receiptDir,
      });

      expect(report.status).toBe('completed');
      expect(s.lifecycle.requestOrganizationDeletion).not.toHaveBeenCalled();
    });

    it('refuses a real run when object storage cannot be matched', async () => {
      const s = setup();
      delete process.env.CLOUDFLARE_BUCKET_URL;

      await expect(
        s.service.run({
          email: EMAIL,
          confirm: EMAIL,
          receiptDir: s.receiptDir,
        })
      ).rejects.toMatchObject({ code: 'STORAGE_NOT_CONFIGURED' });
      for (const mock of writeMocks(s)) expect(mock).not.toHaveBeenCalled();
    });
  });

  describe('--org scope', () => {
    it('only removes the person from a shared organization and keeps the user rows', async () => {
      const s = setup();

      const report = await s.service.run({
        email: EMAIL,
        orgId: 'org-shared',
        confirm: 'org-shared',
        receiptDir: s.receiptDir,
      });

      expect(report.organizations.map((o) => o.id)).toEqual(['org-shared']);
      expect(s.repository.leaveSharedOrganization).toHaveBeenCalledWith(
        'u1',
        'org-shared'
      );
      expect(s.repository.eraseOrganization).not.toHaveBeenCalled();
      expect(s.repository.eraseUser).not.toHaveBeenCalled();
      expect(report.users[0].status).toBe('kept');
    });

    it('erases a sole organization without erasing the person', async () => {
      const s = setup();

      await s.service.run({
        email: EMAIL,
        orgId: 'org-sole',
        confirm: 'org-sole',
        receiptDir: s.receiptDir,
      });

      expect(s.repository.eraseOrganization).toHaveBeenCalledWith('org-sole');
      expect(s.repository.eraseUser).not.toHaveBeenCalled();
    });

    it("refuses an organization that is not the person's", async () => {
      const s = setup();

      await expect(
        s.service.run({ email: EMAIL, orgId: 'org-other' })
      ).rejects.toMatchObject({ code: 'ORG_NOT_FOUND' });
    });
  });

  describe('uploaded objects', () => {
    it('deletes after the commit, tolerates missing objects, keeps referenced ones and reports failures', async () => {
      const s = setup({
        sources: [
          `${BUCKET}/gone.png`,
          `${BUCKET}/shared.png`,
          `${BUCKET}/broken.png`,
          `${BUCKET}/ok.png`,
          `{"image":"${BUCKET}/ok.png"}`,
        ],
        memberships: [membership('u1', 'org-sole')],
        members: [
          { organizationId: 'org-sole', userId: 'u1', role: 'SUPERADMIN' },
        ],
      });
      storage.objectSize.mockImplementation(async (key: string) =>
        key === 'gone.png' ? null : 5
      );
      s.repository.countObjectReferences.mockImplementation(
        async (_url: string, key: string) => (key === 'shared.png' ? 1 : 0)
      );
      storage.removeFile.mockImplementation(async (url: string) => {
        if (url.endsWith('broken.png')) throw new Error('R2 down');
      });

      const report = await s.service.run({
        email: EMAIL,
        confirm: EMAIL,
        receiptDir: s.receiptDir,
      });

      expect(report.organizations[0].objects).toEqual({
        candidates: 4,
        deleted: 1,
        alreadyMissing: 1,
        sharedKept: 1,
        failed: ['broken.png'],
      });
      expect(storage.removeFile).toHaveBeenCalledWith(`${BUCKET}/ok.png`);
      expect(storage.removeFile).not.toHaveBeenCalledWith(`${BUCKET}/gone.png`);
      expect(storage.removeFile).not.toHaveBeenCalledWith(
        `${BUCKET}/shared.png`
      );
    });

    it('writes the object keys to the receipt before the commit', async () => {
      const s = setup({
        memberships: [membership('u1', 'org-sole')],
        members: [
          { organizationId: 'org-sole', userId: 'u1', role: 'SUPERADMIN' },
        ],
      });
      let receiptAtCommit: any;
      s.repository.eraseOrganization.mockImplementation(async () => {
        const [file] = readdirSync(s.receiptDir);
        receiptAtCommit = JSON.parse(
          readFileSync(join(s.receiptDir, file), 'utf8')
        );
        return {};
      });

      await s.service.run({
        email: EMAIL,
        confirm: EMAIL,
        receiptDir: s.receiptDir,
      });

      expect(
        receiptAtCommit.organizations[0].objects.pendingKeys.sort()
      ).toEqual(['a.png', 'b.mp4']);
    });
  });
});
