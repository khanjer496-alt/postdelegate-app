jest.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({ PrismaRepository: class {}, PrismaTransaction: class {} }));

import { OAuthRepository } from './oauth.repository';

const authorization = (memberships: Array<{ organizationId: string; disabled: boolean }>) => ({
  id: 'a1',
  organizationId: 'org-1',
  userId: 'u1',
  oauthAppId: 'app',
  organization: { id: 'org-1' },
  user: { id: 'u1', email: 'a@example.com', activated: true, organizations: memberships },
});

const make = (found: any) => {
  const findFirst = jest.fn(async () => found);
  const repository = new OAuthRepository(
    {} as any,
    { model: { oAuthAuthorization: { findFirst } } } as any,
    {} as any,
    {} as any
  );
  return { repository, findFirst };
};

describe('OAuthRepository.findByAccessToken', () => {
  it('returns the authorization while the approver is an active member', async () => {
    const { repository } = make(
      authorization([
        { organizationId: 'org-2', disabled: true },
        { organizationId: 'org-1', disabled: false },
      ])
    );
    const result: any = await repository.findByAccessToken(['enc']);
    expect(result.organizationId).toBe('org-1');
    // the memberships are an internal detail of the check
    expect(result.user).toEqual({ id: 'u1', email: 'a@example.com', activated: true });
  });

  it('treats the token as revoked when the approver was removed from the org', async () => {
    const { repository } = make(authorization([{ organizationId: 'org-2', disabled: false }]));
    expect(await repository.findByAccessToken(['enc'])).toBeNull();
  });

  it('treats the token as revoked when the approver was disabled in the org', async () => {
    const { repository } = make(authorization([{ organizationId: 'org-1', disabled: true }]));
    expect(await repository.findByAccessToken(['enc'])).toBeNull();
  });

  it('returns nothing for an unknown token', async () => {
    const { repository } = make(null);
    expect(await repository.findByAccessToken(['enc'])).toBeNull();
  });

  it('only looks up live, non-revoked tokens of active users and orgs', async () => {
    const { repository, findFirst } = make(null);
    await repository.findByAccessToken(['enc']);
    expect((findFirst.mock.calls[0] as any[])[0].where).toEqual({
      accessToken: { in: ['enc'] },
      revokedAt: null,
      oauthApp: { deletedAt: null },
      user: { deletedAt: null, activated: true },
      organization: { deletedAt: null },
    });
  });
});

describe('OAuthRepository consent and exchange', () => {
  const make = () => {
    const oAuthAuthorization = {
      upsert: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUnique: jest.fn(async () => ({
        organizationId: 'org-1',
        organization: { paymentId: 'cus_1' },
      })),
    };
    const repository = new OAuthRepository(
      {} as any,
      { model: { oAuthAuthorization } } as any,
      {} as any,
      {} as any
    );
    return { repository, oAuthAuthorization };
  };

  it('a new consent keeps the working token and never lifts a revocation', async () => {
    const { repository, oAuthAuthorization } = make();
    await repository.createAuthorization({
      oauthAppId: 'app',
      userId: 'u1',
      organizationId: 'org-1',
      authorizationCode: 'code',
      codeExpiresAt: new Date(),
    });
    const { update } = (oAuthAuthorization.upsert.mock.calls[0] as any[])[0];
    expect(update).not.toHaveProperty('accessToken');
    expect(update).not.toHaveProperty('revokedAt');
    expect(update.authorizationCode).toBe('code');
  });

  it('spends the code only while it is still that code and not expired', async () => {
    const { repository, oAuthAuthorization } = make();
    expect(
      await repository.exchangeCodeForToken('a1', 'stored-code', 'token')
    ).toEqual({ organizationId: 'org-1', organization: { paymentId: 'cus_1' } });
    const args = (oAuthAuthorization.updateMany.mock.calls[0] as any[])[0];
    expect(args.where).toMatchObject({
      id: 'a1',
      authorizationCode: 'stored-code',
      codeExpiresAt: { gt: expect.any(Date) },
    });
    expect(args.data).toMatchObject({
      accessToken: 'token',
      revokedAt: null,
      authorizationCode: null,
    });

    oAuthAuthorization.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(
      await repository.exchangeCodeForToken('a1', 'stored-code', 'token')
    ).toBeNull();
  });
});
