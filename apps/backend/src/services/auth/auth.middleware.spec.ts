jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/chat/mastra.service', () => ({ MastraService: class {} }));
jest.mock('@gitroom/nestjs-libraries/sentry/initialize.sentry', () => ({ setSentryUserContext: jest.fn() }));

import { AuthMiddleware } from './auth.middleware';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

const user = {
  id: 'u1',
  email: 'a@example.com',
  password: 'hash-1',
  activated: true,
  isSuperAdmin: false,
};
const org = { id: 'o1', apiKey: 'k', users: [{ disabled: false, role: 'USER' }] };

const setup = (found: any = user) => {
  const users = { getUserById: jest.fn(async () => (found ? { ...found } : null)) };
  const orgs = {
    getOrgsByUserId: jest.fn(async () => [org]),
    updateApiKey: jest.fn(),
    getUserOrg: jest.fn(),
  };
  return { middleware: new AuthMiddleware(orgs as any, users as any), users };
};

const run = async (
  middleware: AuthMiddleware,
  req: { method?: string; headers?: Record<string, string>; cookies?: Record<string, string> }
) => {
  const next = jest.fn();
  const request: any = {
    method: 'GET',
    headers: {},
    cookies: {},
    ...req,
  };
  try {
    await middleware.use(request, {} as any, next);
    return { allowed: next.mock.calls.length === 1, request };
  } catch (err) {
    return { allowed: false, request };
  }
};

const session = (over: object = {}) =>
  AuthService.signTypedJWT('session', {
    id: 'u1',
    pv: AuthService.passwordFingerprint('hash-1'),
    ...over,
  });

describe('AuthMiddleware', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-secret';
    process.env.FRONTEND_URL = 'https://app.example.com';
  });

  it('accepts a session token in the header and the cookie', async () => {
    const { middleware } = setup();
    expect((await run(middleware, { headers: { auth: session() } })).allowed).toBe(true);
    expect(
      (
        await run(middleware, {
          cookies: { auth: session() },
        })
      ).allowed
    ).toBe(true);
  });

  it('rejects reset, activation, invite and legacy tokens as a session', async () => {
    const { middleware } = setup();
    const pv = AuthService.passwordFingerprint('hash-1');
    for (const typ of ['reset', 'activation', 'invite', 'extension'] as const) {
      const token = AuthService.signTypedJWT(typ, { id: 'u1', pv });
      expect((await run(middleware, { headers: { auth: token } })).allowed).toBe(false);
    }
    const legacy = AuthService.signJWT({ id: 'u1', email: 'a@example.com' });
    expect((await run(middleware, { headers: { auth: legacy } })).allowed).toBe(false);
    const legacyReset = AuthService.signJWT({ id: 'u1', expires: '2999-01-01 00:00:00' });
    expect((await run(middleware, { headers: { auth: legacyReset } })).allowed).toBe(false);
  });

  it('rejects an expired session and a session from before a password change', async () => {
    const { middleware } = setup();
    const expired = AuthService.signTypedJWT(
      'session',
      { id: 'u1', pv: AuthService.passwordFingerprint('hash-1') },
      -5
    );
    expect((await run(middleware, { headers: { auth: expired } })).allowed).toBe(false);

    const changed = setup({ ...user, password: 'hash-2' });
    expect(
      (await run(changed.middleware, { headers: { auth: session() } })).allowed
    ).toBe(false);
  });

  it('rejects an unknown or not activated user', async () => {
    expect((await run(setup(null).middleware, { headers: { auth: session() } })).allowed).toBe(false);
    expect(
      (
        await run(setup({ ...user, activated: false }).middleware, {
          headers: { auth: session() },
        })
      ).allowed
    ).toBe(false);
  });

  it('attaches the user without the password hash', async () => {
    const { middleware } = setup();
    const { request } = await run(middleware, { headers: { auth: session() } });
    expect(request.user.id).toBe('u1');
    expect(request.user.password).toBeUndefined();
    expect(request.org.id).toBe('o1');
  });

  describe('CSRF on cookie authentication', () => {
    it('rejects a cross-site write that rides on the cookie', async () => {
      const { middleware } = setup();
      const result = await run(middleware, {
        method: 'POST',
        cookies: { auth: session() },
        headers: { origin: 'https://evil.example.org' },
      });
      expect(result.allowed).toBe(false);
    });

    it('rejects a cookie write with no origin or referer', async () => {
      const { middleware } = setup();
      expect(
        (await run(middleware, { method: 'DELETE', cookies: { auth: session() } })).allowed
      ).toBe(false);
    });

    it('allows a write from the app origin', async () => {
      const { middleware } = setup();
      expect(
        (
          await run(middleware, {
            method: 'POST',
            cookies: { auth: session() },
            headers: { origin: 'https://app.example.com' },
          })
        ).allowed
      ).toBe(true);
    });

    it('allows cross-site reads and header-authenticated writes', async () => {
      const { middleware } = setup();
      expect(
        (
          await run(middleware, {
            method: 'GET',
            cookies: { auth: session() },
            headers: { origin: 'https://evil.example.org' },
          })
        ).allowed
      ).toBe(true);
      expect(
        (await run(middleware, { method: 'POST', headers: { auth: session() } })).allowed
      ).toBe(true);
    });
  });
});
