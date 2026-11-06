// the real services pull in every social provider, the spec injects fakes
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository', () => ({ OrganizationRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service', () => ({ AutopostService: class {} }));
jest.mock('@gitroom/nestjs-libraries/services/email.service', () => ({ emailButton: () => '' }));

import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

type Role = 'USER' | 'ADMIN' | 'SUPERADMIN';

const removeAs = async (myRole: Role, theirRole: Role, self = false) => {
  const repository = {
    getOrgsByUserId: jest.fn(async () => [
      { id: 'org-A', users: [{ role: theirRole }] },
    ]),
    deleteTeamMember: jest.fn(async () => ({})),
  };
  const service = new OrganizationService(repository as any, {} as any);
  const org = { id: 'org-A', users: [{ role: myRole }] } as any;
  const result = service.deleteTeamMember(
    org,
    'member',
    self ? 'member' : 'me'
  );
  return { result, repository };
};

describe('OrganizationService.deleteTeamMember', () => {
  it.each([
    ['ADMIN', 'USER'],
    ['SUPERADMIN', 'ADMIN'],
    ['SUPERADMIN', 'USER'],
  ] as const)('lets a %s remove a %s', async (me, them) => {
    const { result, repository } = await removeAs(me, them);
    await expect(result).resolves.toBeDefined();
    expect(repository.deleteTeamMember).toHaveBeenCalledWith('org-A', 'member');
  });

  it.each([
    ['ADMIN', 'ADMIN'],
    ['ADMIN', 'SUPERADMIN'],
    ['USER', 'USER'],
  ] as const)('does not let a %s remove a %s', async (me, them) => {
    const { result, repository } = await removeAs(me, them);
    await expect(result).rejects.toMatchObject({ status: 403 });
    expect(repository.deleteTeamMember).not.toHaveBeenCalled();
  });

  it('does not let a super admin remove themselves', async () => {
    const { result, repository } = await removeAs('SUPERADMIN', 'SUPERADMIN', true);
    await expect(result).rejects.toMatchObject({ status: 400 });
    expect(repository.deleteTeamMember).not.toHaveBeenCalled();
  });
});

describe('OrganizationService.changeTeamMemberRole', () => {
  const makeTransfer = (
    myRole: Role,
    member: { role: Role; disabled?: boolean; deletedAt?: Date } | null,
    superAdmins = 1
  ) => {
    const repository = {
      getTeamMember: jest.fn(async () =>
        member
          ? {
              role: member.role,
              disabled: !!member.disabled,
              user: { deletedAt: member.deletedAt || null },
            }
          : null
      ),
      // the repository refuses to leave no Super Admin (null)
      changeTeamMemberRole: jest.fn(async (_o: string, _u: string, role: Role) =>
        member?.role === 'SUPERADMIN' && role !== 'SUPERADMIN' && superAdmins <= 1
          ? null
          : { role }
      ),
    };
    const service = new OrganizationService(repository as any, {} as any);
    const org = { id: 'org-A', users: [{ role: myRole }] } as any;
    return { service, repository, org };
  };

  it('lets a Super Admin make an active member a Super Admin', async () => {
    const { service, repository, org } = makeTransfer('SUPERADMIN', { role: 'ADMIN' });
    await expect(
      service.changeTeamMemberRole(org, 'member', { role: 'SUPERADMIN' })
    ).resolves.toEqual({ role: 'SUPERADMIN' });
    // scoped to the workspace of the request
    expect(repository.getTeamMember).toHaveBeenCalledWith('org-A', 'member');
    expect(repository.changeTeamMemberRole).toHaveBeenCalledWith('org-A', 'member', 'SUPERADMIN');
  });

  it.each(['ADMIN', 'USER'] as const)('refuses a %s', async (role) => {
    const { service, repository, org } = makeTransfer(role, { role: 'USER' });
    await expect(
      service.changeTeamMemberRole(org, 'member', { role: 'SUPERADMIN' })
    ).rejects.toMatchObject({ status: 403 });
    expect(repository.changeTeamMemberRole).not.toHaveBeenCalled();
  });

  it.each([
    ['not in this workspace', null],
    ['disabled', { role: 'USER' as Role, disabled: true }],
    ['deleted', { role: 'USER' as Role, deletedAt: new Date() }],
  ])('refuses a member that is %s', async (_, member) => {
    const { service, repository, org } = makeTransfer('SUPERADMIN', member);
    await expect(
      service.changeTeamMemberRole(org, 'member', { role: 'SUPERADMIN' })
    ).rejects.toMatchObject({ status: 404 });
    expect(repository.changeTeamMemberRole).not.toHaveBeenCalled();
  });

  it('never demotes the last Super Admin', async () => {
    const { service, org } = makeTransfer('SUPERADMIN', { role: 'SUPERADMIN' }, 1);
    await expect(
      service.changeTeamMemberRole(org, 'me', { role: 'ADMIN' })
    ).rejects.toThrow('at least one Super Admin');
  });

  it('answers 409 when another role change ran at the same moment', async () => {
    const { service, repository, org } = makeTransfer('SUPERADMIN', { role: 'SUPERADMIN' }, 2);
    repository.changeTeamMemberRole.mockRejectedValueOnce(
      Object.assign(new Error('serialization'), { code: 'P2034' })
    );
    await expect(
      service.changeTeamMemberRole(org, 'me', { role: 'ADMIN' })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('lets the old owner step down once another Super Admin exists', async () => {
    const { service, repository, org } = makeTransfer('SUPERADMIN', { role: 'SUPERADMIN' }, 2);
    await service.changeTeamMemberRole(org, 'me', { role: 'ADMIN' });
    expect(repository.changeTeamMemberRole).toHaveBeenCalledWith('org-A', 'me', 'ADMIN');
  });

  it('never removes the last Super Admin (nobody removes themselves)', async () => {
    const { result, repository } = await removeAs('SUPERADMIN', 'SUPERADMIN', true);
    await expect(result).rejects.toMatchObject({ status: 400 });
    expect(repository.deleteTeamMember).not.toHaveBeenCalled();
  });
});
