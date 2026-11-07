import { Prisma } from '@prisma/client';
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
  const userOrganizationTx = {
    create: jest.fn().mockResolvedValue({ id: 'membership' }),
  };
  const userTx = {
    findFirst: user.findFirst,
    update: jest.fn().mockResolvedValue({ id: 'user-1' }),
  };
  // an interactive transaction: the invite is checked inside it
  const $transaction = jest.fn(async (fn: any) =>
    fn({ user: userTx, userOrganization: userOrganizationTx })
  );
  const repo = new OrganizationRepository(
    { model: { organization } } as any,
    { model: { userOrganization } } as any,
    { model: { user } } as any,
    { model: { $transaction } } as any
  );
  return { repo, user, userOrganization, organization, $transaction };
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
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects an account whose email differs from the invited one', async () => {
    const { repo, $transaction, userOrganization } = makeRepo();

    await expect(
      repo.addUserToOrg('user-1', 'inv-1', 'org-A', 'USER', 'other@example.com')
    ).resolves.toEqual({ failed: 'wrong_email' });

    expect(userOrganization.create).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it('rejects an invite token without an email', async () => {
    const { repo, $transaction } = makeRepo();

    await expect(
      repo.addUserToOrg('user-1', 'inv-1', 'org-A', 'USER', '')
    ).resolves.toEqual({ failed: 'wrong_email' });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('does not let an invite id that was already used join again', async () => {
    const { repo, user } = makeRepo();
    user.findFirst.mockResolvedValue({ id: 'someone' });

    await expect(
      repo.addUserToOrg('user-1', 'inv-1', 'org-A', 'USER', 'invited@example.com')
    ).resolves.toEqual({ failed: 'already_used' });
  });

  it('checks the invite inside the transaction that burns it', async () => {
    const { repo, user, $transaction } = makeRepo();
    // unused when the request starts, spent by a concurrent accept by the
    // time the transaction reads it
    user.findFirst.mockImplementation(async () =>
      $transaction.mock.calls.length ? { id: 'someone' } : null
    );

    await expect(
      repo.addUserToOrg('user-1', 'inv-1', 'org-A', 'USER', 'invited@example.com')
    ).resolves.toEqual({ failed: 'already_used' });
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it('tells the loser of two concurrent accepts the invite was used', async () => {
    const { repo, $transaction } = makeRepo();
    $transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('serialization failure', {
        code: 'P2034',
        clientVersion: 'test',
      })
    );

    await expect(
      repo.addUserToOrg('user-1', 'inv-1', 'org-A', 'USER', 'invited@example.com')
    ).resolves.toEqual({ failed: 'already_used' });
  });

  it('does not add a user that is already a member', async () => {
    const { repo, userOrganization, $transaction } = makeRepo();
    userOrganization.findFirst.mockResolvedValue({ id: 'm-1' });

    await expect(
      repo.addUserToOrg('user-1', 'inv-1', 'org-A', 'USER', 'invited@example.com')
    ).resolves.toEqual({ failed: 'already_member' });
    expect($transaction).not.toHaveBeenCalled();
  });

  it('tells a member who already accepted the invite nothing went wrong', async () => {
    const { repo, user, userOrganization } = makeRepo();
    // the invite was used, by this very member
    user.findFirst.mockResolvedValue({ id: 'user-1' });
    userOrganization.findFirst.mockResolvedValue({ id: 'm-1' });

    await expect(
      repo.addUserToOrg('user-1', 'inv-1', 'org-A', 'USER', 'invited@example.com')
    ).resolves.toEqual({ failed: 'already_member' });
  });

  it('keeps admin-initiated adds (no invite email) working', async () => {
    const { repo, user, $transaction } = makeRepo();

    await repo.addUserToOrg('user-1', 'generated', 'org-A', 'USER');

    expect(user.findUnique).not.toHaveBeenCalled();
    expect($transaction).toHaveBeenCalledTimes(1);
  });

  describe('with billing on', () => {
    const key = process.env.STRIPE_PUBLISHABLE_KEY;
    beforeEach(() => {
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
    });
    afterEach(() => {
      if (key === undefined) {
        delete process.env.STRIPE_PUBLISHABLE_KEY;
      } else {
        process.env.STRIPE_PUBLISHABLE_KEY = key;
      }
    });

    it.each([
      ['a FREE or lapsed workspace', null],
      ['a plan without team members', { subscriptionTier: 'STANDARD' }],
    ])('does not add a member to %s', async (_, subscription) => {
      const { repo, organization, $transaction } = makeRepo();
      organization.findFirst.mockResolvedValue({ subscription });

      await expect(
        repo.addUserToOrg('user-1', 'inv-1', 'org-A', 'USER', 'invited@example.com')
      ).resolves.toEqual({ failed: 'plan' });
      expect($transaction).not.toHaveBeenCalled();
    });

    it('adds a member to a plan with team members', async () => {
      const { repo, organization, $transaction } = makeRepo();
      organization.findFirst.mockResolvedValue({
        subscription: { subscriptionTier: 'TEAM' },
      });

      await expect(
        repo.addUserToOrg('user-1', 'inv-1', 'org-A', 'USER', 'invited@example.com')
      ).resolves.toEqual({ id: 'membership' });
    });
  });
});

describe('OrganizationRepository member emails', () => {
  const makeEmailRepo = () => {
    const organization = { findUnique: jest.fn().mockResolvedValue({ users: [] }) };
    const repo = new OrganizationRepository(
      { model: { organization } } as any,
      {} as any,
      {} as any,
      {} as any
    );
    return { repo, organization };
  };

  it.each(['getAllUsersOrgs', 'getActiveTeam'] as const)(
    '%s leaves out disabled members and deleted accounts',
    async (method) => {
      const { repo, organization } = makeEmailRepo();
      await repo[method]('org-A');
      expect(organization.findUnique.mock.calls[0][0].select.users.where).toEqual({
        disabled: false,
        user: { deletedAt: null },
      });
    }
  );
});

describe('OrganizationRepository.changeTeamMemberRole', () => {
  const makeRoleRepo = (role: string, owners: number) => {
    const tx = {
      userOrganization: {
        findFirst: jest.fn(async () => ({ role })),
        count: jest.fn(async () => owners),
        update: jest.fn(async (args: any) => ({ role: args.data.role })),
      },
    };
    const $transaction = jest.fn(async (fn: any, options: any) => fn(tx));
    const repo = new OrganizationRepository(
      {} as any,
      {} as any,
      {} as any,
      { model: { $transaction } } as any
    );
    return { repo, tx, $transaction };
  };

  it('counts and updates in one serializable transaction', async () => {
    const { repo, $transaction } = makeRoleRepo('SUPERADMIN', 2);
    await expect(repo.changeTeamMemberRole('org-A', 'me', 'ADMIN' as any)).resolves.toEqual({
      role: 'ADMIN',
    });
    expect($transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable' });
  });

  it('never leaves a workspace without a Super Admin', async () => {
    const { repo, tx } = makeRoleRepo('SUPERADMIN', 1);
    await expect(repo.changeTeamMemberRole('org-A', 'me', 'ADMIN' as any)).resolves.toBeNull();
    expect(tx.userOrganization.update).not.toHaveBeenCalled();
  });
});

describe('OrganizationRepository.getLastPublishDate', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date('2026-11-02T10:00:00Z').getTime();

  const makeStreakRepo = (
    posts: { publishDate: Date }[],
    recurring: Record<string, unknown>[]
  ) => {
    const organization = {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce({ post: posts })
        .mockResolvedValueOnce({ post: recurring }),
    };
    return new OrganizationRepository(
      { model: { organization } } as any,
      {} as any,
      {} as any,
      {} as any
    );
  };

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(now);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('counts the latest share of a plain repeating post', async () => {
    const repo = makeStreakRepo(
      [],
      [
        {
          publishDate: new Date(now - 10 * DAY + 60 * 1000),
          state: 'PUBLISHED',
          intervalInDays: 1,
          evergreenMaxShares: null,
          evergreenUntil: null,
        },
      ]
    );

    expect(await repo.getLastPublishDate('org-A')).toBe(now);
  });

  it('stops counting an evergreen post once it used its shares', async () => {
    const anchor = now - 10 * DAY;
    const repo = makeStreakRepo(
      [],
      [
        {
          publishDate: new Date(anchor),
          state: 'PUBLISHED',
          intervalInDays: 1,
          evergreenMaxShares: 3,
          evergreenUntil: null,
        },
      ]
    );

    expect(await repo.getLastPublishDate('org-A')).toBe(anchor + 3 * DAY);
  });

  it('stops counting a stopped evergreen post at its end date', async () => {
    const anchor = now - 10 * DAY;
    const repo = makeStreakRepo(
      [],
      [
        {
          publishDate: new Date(anchor),
          state: 'PUBLISHED',
          intervalInDays: 2,
          evergreenMaxShares: null,
          evergreenUntil: new Date(anchor + 5 * DAY),
        },
      ]
    );

    expect(await repo.getLastPublishDate('org-A')).toBe(anchor + 4 * DAY);
  });

  it('counts a queued repeating post only on its own date', async () => {
    const queued = now - 3 * DAY;
    const repo = makeStreakRepo(
      [{ publishDate: new Date(now - 5 * DAY) }],
      [
        {
          publishDate: new Date(queued),
          state: 'QUEUE',
          intervalInDays: 1,
          evergreenMaxShares: null,
          evergreenUntil: null,
        },
      ]
    );

    expect(await repo.getLastPublishDate('org-A')).toBe(queued);
  });

  it('never returns a date in the future', async () => {
    const repo = makeStreakRepo([{ publishDate: new Date(now + 60 * 1000) }], []);

    expect(await repo.getLastPublishDate('org-A')).toBe(now);
  });
});
