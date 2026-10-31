// the real services pull in every social provider, the spec injects fakes
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/services/email.service', () => ({
  EmailService: class {},
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
}));
jest.mock('@gitroom/backend/services/auth/providers/providers.manager', () => ({ AuthProviderManager: class {} }));
jest.mock('@gitroom/nestjs-libraries/newsletter/newsletter.service', () => ({
  NewsletterService: { register: jest.fn().mockResolvedValue(undefined) },
}));

import { AuthService } from './auth.service';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { LoginUserDto } from '@gitroom/nestjs-libraries/dtos/auth/login.user.dto';
import { AuthService as Tokens } from '@gitroom/helpers/auth/auth.service';

const localUser = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'a@example.com',
  password: 'hash-1',
  providerName: 'LOCAL',
  activated: true,
  ...over,
});

const setup = (user: any) => {
  const users = {
    getUserById: jest.fn(async () => user),
    getUserByEmail: jest.fn(async () => user),
    updatePassword: jest.fn(async () => ({})),
    activateUser: jest.fn(async () => ({})),
  };
  const emails = { sendEmailSync: jest.fn(async () => undefined) };
  const service = new AuthService(
    users as any,
    {} as any,
    emails as any,
    {} as any,
    {} as any,
    { isLocked: jest.fn(async () => false), recordFailure: jest.fn(), clear: jest.fn() } as any
  );
  return { service, users, emails };
};

const linkToken = (html: string) => html.match(/\/auth\/[a-z]+\/([^"]+)"/)![1];
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('AuthService tokens', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-secret';
    process.env.FRONTEND_URL = 'https://app.example.com';
  });

  describe('password reset', () => {
    it('emails a reset token that expires in 20 minutes and is not a session', async () => {
      const { service, emails } = setup(localUser());
      await service.forgot('a@example.com');
      await flush();
      const token = linkToken((emails.sendEmailSync.mock.calls[0] as any[])[2]);
      const payload: any = Tokens.verifyTypedJWT(token, 'reset');
      expect(payload.exp - payload.iat).toBe(20 * 60);
      expect(payload.id).toBe('u1');
      expect(() => Tokens.verifyTypedJWT(token, 'session')).toThrow();
    });

    it('resets the password once', async () => {
      const { service, users, emails } = setup(localUser());
      await service.forgot('a@example.com');
      await flush();
      const token = linkToken((emails.sendEmailSync.mock.calls[0] as any[])[2]);

      expect(await service.forgotReturn({ token, password: 'new-pass-1' } as any)).toBeTruthy();
      expect(users.updatePassword).toHaveBeenCalledWith('u1', 'new-pass-1');

      // the password hash changed, so the same link is dead
      users.getUserById.mockResolvedValue(localUser({ password: 'hash-2' }) as any);
      expect(await service.forgotReturn({ token, password: 'again-pass-2' } as any)).toBe(false);
      expect(users.updatePassword).toHaveBeenCalledTimes(1);
    });

    it('refuses a session, activation or invite token', async () => {
      const { service, users } = setup(localUser());
      const pv = Tokens.passwordFingerprint('hash-1');
      for (const typ of ['session', 'activation', 'invite'] as const) {
        const token = Tokens.signTypedJWT(typ, { id: 'u1', pv });
        expect(await service.forgotReturn({ token, password: 'x' } as any)).toBe(false);
      }
      const legacy = Tokens.signJWT({ id: 'u1', expires: '2999-01-01 00:00:00' });
      expect(await service.forgotReturn({ token: legacy, password: 'x' } as any)).toBe(false);
      expect(users.updatePassword).not.toHaveBeenCalled();
    });

    it('refuses an expired reset token', async () => {
      const { service, users } = setup(localUser());
      const token = Tokens.signTypedJWT(
        'reset',
        { id: 'u1', pv: Tokens.passwordFingerprint('hash-1') },
        -10
      );
      expect(await service.forgotReturn({ token, password: 'x' } as any)).toBe(false);
      expect(users.updatePassword).not.toHaveBeenCalled();
    });

    it('does not email or reveal anything for an unknown account', async () => {
      const { service, users, emails } = setup(null);
      users.getUserByEmail.mockResolvedValue(null as any);
      expect(await service.forgot('nobody@example.com')).toBe(false);
      await flush();
      expect(emails.sendEmailSync).not.toHaveBeenCalled();
    });
  });

  describe('activation', () => {
    it('sends a token that carries only the id and email', async () => {
      const { service, emails } = setup(localUser({ activated: false }));
      expect(await service.resendActivationEmail('a@example.com')).toBe(true);
      await flush();
      const token = linkToken((emails.sendEmailSync.mock.calls[0] as any[])[2]);
      const payload: any = Tokens.verifyTypedJWT(token, 'activation');
      expect(Object.keys(payload).sort()).toEqual(['email', 'exp', 'iat', 'id', 'typ']);
      expect(payload.exp - payload.iat).toBe(2 * 24 * 3600);
      expect(JSON.stringify(payload)).not.toContain('hash-1');
      expect(() => Tokens.verifyTypedJWT(token, 'session')).toThrow();
    });

    it('activates with an activation token and returns a session', async () => {
      const { service, users } = setup(localUser({ activated: false }));
      const token = Tokens.signTypedJWT('activation', { id: 'u1', email: 'a@example.com' });
      const session = (await service.activate(token, '')) as string;
      expect(users.activateUser).toHaveBeenCalledWith('u1');
      const payload: any = Tokens.verifyTypedJWT(session, 'session');
      expect(payload.id).toBe('u1');
      expect(payload.pv).toBe(Tokens.passwordFingerprint('hash-1'));
      // nothing but who it is travels in the session
      expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'id', 'pv', 'typ']);
    });

    it('does not activate with a session, reset or legacy token', async () => {
      const { service, users } = setup(localUser({ activated: false }));
      for (const token of [
        Tokens.signTypedJWT('session', { id: 'u1' }),
        Tokens.signTypedJWT('reset', { id: 'u1' }),
        Tokens.signJWT({ id: 'u1', email: 'a@example.com', activated: false }),
      ]) {
        expect(await service.activate(token, '')).toBe(false);
      }
      expect(users.activateUser).not.toHaveBeenCalled();
    });

    it('answers a resend the same way for unknown and activated accounts', async () => {
      const unknown = setup(null);
      unknown.users.getUserByEmail.mockResolvedValue(null as any);
      const activated = setup(localUser({ activated: true }));
      expect(await unknown.service.resendActivationEmail('x@example.com')).toBe(false);
      expect(await activated.service.resendActivationEmail('a@example.com')).toBe(false);
      await flush();
      expect(unknown.emails.sendEmailSync).not.toHaveBeenCalled();
      expect(activated.emails.sendEmailSync).not.toHaveBeenCalled();
    });
  });

  describe('invite cookie', () => {
    const invite = (typ: any, extra: object = {}) =>
      Tokens.signTypedJWT(typ, {
        email: 'b@example.com',
        role: 'USER',
        orgId: 'o1',
        id: 'i1',
        timeLimit: '2999-01-01 00:00:00',
        ...extra,
      });

    it('accepts an invite token only', () => {
      const { service } = setup(null);
      expect(service.getOrgFromCookie(invite('invite'))).toMatchObject({ orgId: 'o1' });
      expect(service.getOrgFromCookie(invite('session'))).toBe(false);
      expect(service.getOrgFromCookie(invite('reset'))).toBe(false);
      expect(
        service.getOrgFromCookie(
          Tokens.signJWT({ email: 'b@example.com', role: 'USER', orgId: 'o1', id: 'i1', timeLimit: '2999-01-01 00:00:00' })
        )
      ).toBe(false);
    });
  });
});

describe('AuthService affiliate attribution at registration', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-secret';
    process.env.FRONTEND_URL = 'https://app.example.com';
    delete process.env.DISABLE_REGISTRATION;
  });

  const created = (email: string) => ({
    id: 'org-new',
    users: [{ user: { id: 'user-new', email } }],
  });

  const setupRegistration = () => {
    const users = {
      getUserByEmail: jest.fn(async () => null),
      getUserByProvider: jest.fn(async () => null),
      getUserById: jest.fn(async () => ({ id: 'user-new', password: '' })),
    };
    const organizations = {
      createOrgAndUser: jest.fn(async (body: any) => created(body.email)),
    };
    const emails = { sendEmailSync: jest.fn(async () => undefined) };
    const providers = {
      getProvider: jest.fn(() => ({
        getUser: jest.fn(async () => ({ id: 'g-1', email: 'g@example.com' })),
      })),
    };
    const affiliates = { attributeOrganization: jest.fn(async () => true) };
    const service = new AuthService(
      users as any,
      organizations as any,
      emails as any,
      providers as any,
      affiliates as any,
      { isLocked: jest.fn(async () => false), recordFailure: jest.fn(), clear: jest.fn() } as any
    );
    return { service, affiliates };
  };

  it('attributes an email registration with the referral cookie', async () => {
    const { service, affiliates } = setupRegistration();

    await service.routeAuth(
      'LOCAL' as any,
      Object.assign(new CreateOrgUserDto(), {
        email: 'New@Example.com',
        password: 'secret',
        provider: 'LOCAL',
        company: 'Acme',
      }),
      '1.1.1.1',
      'agent',
      false,
      'friend.1790000000000'
    );

    expect(affiliates.attributeOrganization).toHaveBeenCalledWith({
      organizationId: 'org-new',
      userId: 'user-new',
      email: 'new@example.com',
      cookie: 'friend.1790000000000',
    });
  });

  it('attributes an OAuth registration with the referral cookie', async () => {
    const { service, affiliates } = setupRegistration();

    await service.routeAuth(
      'GOOGLE' as any,
      { provider: 'GOOGLE', providerToken: 'token', company: 'Acme' } as any,
      '1.1.1.1',
      'agent',
      false,
      'friend.1790000000000'
    );

    expect(affiliates.attributeOrganization).toHaveBeenCalledWith({
      organizationId: 'org-new',
      userId: 'user-new',
      email: 'g@example.com',
      cookie: 'friend.1790000000000',
    });
  });

  it('does not attribute when an existing OAuth user signs in', async () => {
    const { service, affiliates } = setupRegistration();
    (service as any)._userService.getUserByProvider = jest.fn(async () => ({
      id: 'existing',
    }));

    await service.routeAuth(
      'GOOGLE' as any,
      { provider: 'GOOGLE', providerToken: 'token', company: 'Acme' } as any,
      '1.1.1.1',
      'agent',
      false,
      'friend.1790000000000'
    );

    expect(affiliates.attributeOrganization).not.toHaveBeenCalled();
  });
});

describe('AuthService login lockout', () => {
  const { LoginLockoutService } = require('@gitroom/nestjs-libraries/services/login.lockout.service');
  // no expiry needed here, the window is covered by login.lockout.service.spec.ts
  const fakeRedis = () => {
    const data = new Map<string, string>();
    return {
      get: async (key: string) => data.get(key) ?? null,
      set: async (key: string, value: string) => void data.set(key, value),
      incr: async (key: string) => {
        const next = Number(data.get(key) || 0) + 1;
        data.set(key, String(next));
        return next;
      },
      expire: async () => 1,
      del: async (...keys: string[]) => keys.forEach((key) => data.delete(key)),
    };
  };

  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-secret';
  });

  const setupLogin = (user: any) => {
    const lockout = new LoginLockoutService();
    lockout.redis = fakeRedis();
    const users = {
      getUserByEmail: jest.fn(async () => user),
      getUserById: jest.fn(async () => user),
    };
    const service = new AuthService(
      users as any, {} as any, {} as any, {} as any, {} as any, lockout
    );
    const login = (email: string, password: string) =>
      service.routeAuth(
        'LOCAL' as any,
        Object.assign(new LoginUserDto(), { email, password, provider: 'LOCAL' }),
        '203.0.113.1',
        'agent'
      );
    return { service, lockout, users, login };
  };
  const goodUser = () => localUser({ password: Tokens.hashPassword('right-password') });
  const GENERIC = 'Invalid user name or password';

  it('rejects the 11th attempt with the generic error even with the right password', async () => {
    const { login, users } = setupLogin(goodUser());
    for (let i = 0; i < 10; i++) {
      await expect(login('a@example.com', 'wrong')).rejects.toThrow(GENERIC);
    }
    users.getUserByEmail.mockClear();
    await expect(login('a@example.com', 'right-password')).rejects.toThrow(GENERIC);
  });

  it('answers the same for an account that does not exist', async () => {
    const { login } = setupLogin(null);
    for (let i = 0; i < 10; i++) {
      await expect(login('ghost@example.com', 'whatever')).rejects.toThrow(GENERIC);
    }
    await expect(login('ghost@example.com', 'whatever')).rejects.toThrow(GENERIC);
  });

  it('a successful login clears the failures', async () => {
    const { login } = setupLogin(goodUser());
    for (let i = 0; i < 9; i++) {
      await expect(login('a@example.com', 'wrong')).rejects.toThrow(GENERIC);
    }
    await expect(login('a@example.com', 'right-password')).resolves.toMatchObject({ addedOrg: false });
    for (let i = 0; i < 9; i++) {
      await expect(login('a@example.com', 'wrong')).rejects.toThrow(GENERIC);
    }
    await expect(login('a@example.com', 'right-password')).resolves.toBeTruthy();
  });

  it('does not lock other accounts', async () => {
    const { login, lockout } = setupLogin(goodUser());
    for (let i = 0; i < 10; i++) {
      await expect(login('victim@example.com', 'wrong')).rejects.toThrow(GENERIC);
    }
    expect(await lockout.isLocked('other@example.com')).toBe(false);
    await expect(login('other@example.com', 'right-password')).resolves.toBeTruthy();
  });
});
