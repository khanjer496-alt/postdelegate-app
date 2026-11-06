jest.mock('@gitroom/backend/services/auth/auth.service', () => ({ AuthService: class {} }));
jest.mock('@gitroom/nestjs-libraries/services/email.service', () => ({ EmailService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/social/farcaster.provider', () => ({ FarcasterProvider: class {} }));
jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));

import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';
import { AuthController } from './auth.controller';

const proto: any = AuthController.prototype;

const limitOf = (name: string) => ({
  guards: Reflect.getMetadata('__guards__', proto[name]) || [],
  limit: Reflect.getMetadata('THROTTLER:LIMITdefault', proto[name]),
  ttl: Reflect.getMetadata('THROTTLER:TTLdefault', proto[name]),
});

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

describe('AuthController rate limits', () => {
  it.each([
    ['login', 10, MINUTE],
    ['register', 10, HOUR],
    ['forgot', 5, HOUR],
    ['forgotReturn', 10, HOUR],
    ['activate', 20, HOUR],
    ['resendActivation', 5, HOUR],
    ['oauthExists', 30, 10 * MINUTE],
    ['oauthLink', 60, MINUTE],
  ])('%s is limited per client address', (name, limit, ttl) => {
    const found = limitOf(name);
    expect(found.guards).toContain(ThrottlerRealIpGuard);
    expect(found.limit).toBe(limit);
    expect(found.ttl).toBe(ttl);
  });
});

describe('AuthController account enumeration', () => {
  const make = (service: object) =>
    new AuthController(service as any, {} as any);

  it('answers /forgot the same for every outcome', async () => {
    for (const forgot of [
      jest.fn().mockResolvedValue(true),
      jest.fn().mockResolvedValue(false),
      jest.fn().mockRejectedValue(new Error('smtp down')),
    ]) {
      expect(await make({ forgot }).forgot({ email: 'a@b.c' } as any)).toEqual({
        forgot: true,
      });
    }
  });

  it('answers /resend-activation the same for every outcome', async () => {
    for (const resendActivationEmail of [
      jest.fn().mockResolvedValue(true),
      jest.fn().mockResolvedValue(false),
      jest.fn().mockRejectedValue(new Error('User not found')),
    ]) {
      expect(
        await make({ resendActivationEmail }).resendActivation({
          email: 'a@b.c',
        } as any)
      ).toEqual({ success: true });
    }
  });
});

describe('AuthController referral cookie', () => {
  const response = () => {
    const res: any = {
      header: jest.fn(),
      cookie: jest.fn(),
      status: jest.fn(() => res),
      json: jest.fn(),
      send: jest.fn(),
    };
    return res;
  };

  it.each(['register', 'login'] as const)(
    '%s hands the referral cookie to the auth service',
    async (name) => {
      const routeAuth = jest
        .fn()
        .mockResolvedValue({ jwt: 'jwt', addedOrg: false });
      const controller = new AuthController(
        {
          routeAuth,
          getOrgFromCookie: jest.fn().mockReturnValue(false),
        } as any,
        { hasProvider: () => false } as any
      );

      await (controller as any)[name](
        { cookies: { pd_ref: 'friend.1790000000000' } },
        { provider: 'LOCAL', email: 'a@b.c', password: 'secret' },
        response(),
        '1.1.1.1',
        'agent'
      );

      expect(routeAuth).toHaveBeenCalledWith(
        'LOCAL',
        expect.anything(),
        '1.1.1.1',
        'agent',
        false,
        'friend.1790000000000'
      );
    }
  );
});

describe('AuthController invite cookie', () => {
  const response = () => {
    const res: any = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      header: jest.fn(),
      json: jest.fn(),
      send: jest.fn(),
    };
    res.status = jest.fn(() => res);
    return res;
  };
  const login = (addedOrg: unknown) =>
    new AuthController(
      {
        getOrgFromCookie: jest.fn(() => ({ id: 'i1', orgId: 'o1', role: 'USER' })),
        routeAuth: jest.fn(async () => ({ jwt: 'jwt', addedOrg })),
      } as any,
      {} as any
    );

  it.each([
    ['joined', { organizationId: 'o1' }],
    ['already a member', { failed: 'already_member' }],
    ['refused', { failed: 'wrong_email' }],
  ])('spends the invite cookie on a sign in that %s', async (_, addedOrg) => {
    const res = response();
    await login(addedOrg).login(
      { cookies: { org: 'invite-token' } } as any,
      { provider: 'LOCAL' } as any,
      res,
      '1.1.1.1',
      'agent'
    );
    expect(res.clearCookie).toHaveBeenCalledWith('org', expect.objectContaining({ path: '/' }));
  });

  it('does not warn a member that their accepted invite was used', async () => {
    const res = response();
    await login({ failed: 'already_member' }).login(
      { cookies: { org: 'invite-token' } } as any,
      { provider: 'LOCAL' } as any,
      res,
      '1.1.1.1',
      'agent'
    );
    expect(res.cookie).not.toHaveBeenCalledWith('invite_error', expect.anything(), expect.anything());
  });
});
