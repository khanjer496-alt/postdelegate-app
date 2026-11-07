// the real services pull in every social provider, the spec injects fakes
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.repository', () => ({ UsersRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository', () => ({ OrganizationRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository', () => ({ IntegrationRepository: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.authorization.lifecycle.service', () => ({ IntegrationAuthorizationLifecycleService: class {} }));

import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';

type Member = { id: string; role: 'SUPERADMIN' | 'ADMIN' | 'USER'; disabled?: boolean };

// one workspace the user belongs to, with its whole team
const setup = (members: Member[], name = 'Acme###ent') => {
  const me = members.find((m) => m.id === 'me')!;
  const team = {
    users: members.map((m) => ({ role: m.role, disabled: !!m.disabled, user: { id: m.id } })),
  };
  const organizations = {
    getOrgsByUserId: jest.fn(async () => [
      { id: 'org-A', name, users: [{ role: me.role }], subscription: null },
    ]),
    getTeam: jest.fn(async () => team),
    getActiveTeam: jest.fn(async () => ({
      users: team.users.filter((u) => !u.disabled),
    })),
    deleteTeamMember: jest.fn(async () => ({})),
    deleteOrganization: jest.fn(async () => ({})),
  };
  const users = { deleteAccount: jest.fn(async () => ({})) };
  const integrations = { deleteIntegrationsForAccount: jest.fn(async () => ({})) };
  const lifecycle = { requestOrganizationDeletion: jest.fn(async () => []) };
  const service = new UsersService(
    users as any,
    organizations as any,
    integrations as any,
    {} as any,
    lifecycle as any
  );
  return { service, organizations, users };
};

describe('UsersService.deleteAccount', () => {
  it('refuses while the user is the only Super Admin of a workspace others use, naming it', async () => {
    const { service, users, organizations } = setup([
      { id: 'me', role: 'SUPERADMIN' },
      { id: 'teammate', role: 'USER' },
    ]);

    await expect(service.deleteAccount('me')).rejects.toThrow(
      'You own Acme and other people use it. Make another member the owner in Settings → Team, or remove the other members, then delete your account.'
    );
    expect(users.deleteAccount).not.toHaveBeenCalled();
    expect(organizations.deleteOrganization).not.toHaveBeenCalled();
    expect((await service.getDeleteAccountInfo('me')).sharedWorkspaces).toEqual(['Acme']);
  });

  it('deletes a workspace the user is alone in, as before', async () => {
    const { service, users, organizations } = setup([{ id: 'me', role: 'SUPERADMIN' }]);

    await service.deleteAccount('me');
    expect(organizations.deleteOrganization).toHaveBeenCalledWith('org-A');
    expect(users.deleteAccount).toHaveBeenCalledWith('me');
  });

  it('only counts active members (a disabled one does not block)', async () => {
    const { service, users } = setup([
      { id: 'me', role: 'SUPERADMIN' },
      { id: 'old', role: 'USER', disabled: true },
    ]);

    await service.deleteAccount('me');
    expect(users.deleteAccount).toHaveBeenCalledWith('me');
  });

  it('just leaves a workspace that has another Super Admin', async () => {
    const { service, users, organizations } = setup([
      { id: 'me', role: 'SUPERADMIN' },
      { id: 'co-owner', role: 'SUPERADMIN' },
      { id: 'teammate', role: 'USER' },
    ]);

    await service.deleteAccount('me');
    expect(organizations.deleteOrganization).not.toHaveBeenCalled();
    expect(organizations.deleteTeamMember).toHaveBeenCalledWith('org-A', 'me');
    expect(users.deleteAccount).toHaveBeenCalledWith('me');
  });
});
