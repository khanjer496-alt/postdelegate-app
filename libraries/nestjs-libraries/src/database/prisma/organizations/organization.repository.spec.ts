import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';

const makeRepo = () => {
  const user = {
    findUnique: jest.fn().mockResolvedValue({ email: 'Invited@Example.com' }),
    findFirst: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockReturnValue('user-update'),
  };
  const userOrganization = {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockReturnValue('membership-create'),
  };
  const organization = {
    findFirst: jest.fn().mockResolvedValue({ subscription: null }),
  };
  const $transaction = jest.fn().mockResolvedValue([{ id: 'membership' }, {}]);
  const repo = new OrganizationRepository(
    { model: { organization } } as any,
    { model: { userOrganization } } as any,
    { model: { user } } as any,
    { model: { $transaction } } as any
  );
  return { repo, user, userOrganization, $transaction };
};

describe('OrganizationRepository.addUserToOrg invites', () => {
  it('accepts the invite for the invited email regardless of case', async () => {
    const { repo, $transaction } = makeRepo();

    const result = await repo.addUserToOrg(
      'user-1',
      'inv-1',
      'org-A',
      'USER',
      'invited@example.com'
    );

    expect(result).toEqual({ id: 'membership' });
    expect($transaction).toHaveBeenCalledWith([
      'membership-create',
      'user-update',
    ]);
  });

  it('rejects an account whose email differs from the invited one', async () => {
    const { repo, $transaction, userOrganization } = makeRepo();

    await expect(
      repo.addUserToOrg('user-1', 'inv-1', 'org-A', 'USER', 'other@example.com')
    ).resolves.toBe(false);

    expect(userOrganization.create).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it('rejects an invite token without an email', async () => {
    const { repo, $transaction } = makeRepo();

    await expect(
      repo.addUserToOrg('user-1', 'inv-1', 'org-A', 'USER', '')
    ).resolves.toBe(false);
    expect($transaction).not.toHaveBeenCalled();
  });

  it('does not let an invite id that was already used join again', async () => {
    const { repo, user, $transaction } = makeRepo();
    user.findFirst.mockResolvedValue({ id: 'someone' });

    await expect(
      repo.addUserToOrg('user-1', 'inv-1', 'org-A', 'USER', 'invited@example.com')
    ).resolves.toBe(false);
    expect($transaction).not.toHaveBeenCalled();
  });

  it('does not add a user that is already a member', async () => {
    const { repo, userOrganization, $transaction } = makeRepo();
    userOrganization.findFirst.mockResolvedValue({ id: 'm-1' });

    await expect(
      repo.addUserToOrg('user-1', 'inv-1', 'org-A', 'USER', 'invited@example.com')
    ).resolves.toBe(false);
    expect($transaction).not.toHaveBeenCalled();
  });

  it('keeps admin-initiated adds (no invite email) working', async () => {
    const { repo, user, $transaction } = makeRepo();

    await repo.addUserToOrg('user-1', 'generated', 'org-A', 'USER');

    expect(user.findUnique).not.toHaveBeenCalled();
    expect($transaction).toHaveBeenCalledTimes(1);
  });
});
