jest.mock('@gitroom/backend/services/auth/permissions/permissions.service', () => ({ PermissionsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({ RefreshIntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.missing.scopes', () => ({ NotEnoughScopesFilter: class { catch() {} } }));
jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({ NotEnoughScopes: class extends Error {} }));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher', () => ({ getSsrfSafeDispatcher: jest.fn() }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
// the session checks are the middleware's own, covered by its spec
jest.mock('@gitroom/backend/services/auth/auth.middleware', () => ({ getSessionUser: jest.fn(async () => null) }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => {
  const data = new Map<string, string>();
  return {
    ioRedis: {
      data,
      get: jest.fn(async (key: string) => data.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => data.set(key, value)),
      del: jest.fn(async (key: string) => data.delete(key)),
    },
  };
});

import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { getSessionUser } from '@gitroom/backend/services/auth/auth.middleware';
import {
  CONNECT_LINK_TTL,
  CONNECT_OTHER_BROWSER_MESSAGE,
  connectNonceCookieOptions,
  CONNECT_SESSION_TTL,
  connectNonceCookie,
  saveConnectBinding,
} from '@gitroom/nestjs-libraries/integrations/connect.binding';
import { NoAuthIntegrationsController } from './no.auth.integrations.controller';

const redis = ioRedis as any;
const sessionUser = getSessionUser as jest.Mock;

const make = (
  provider: object,
  limits: { existing?: object | null; canAdd?: boolean } = {},
  members: string[] = ['u1']
) => {
  const org = { id: 'org-1', name: 'Acme', apiKey: 'api', isTrailing: false };
  const permissions = {
    canAddChannel: jest.fn(async () => limits.canAdd ?? true),
    channelLimitMessage: jest.fn(async (): Promise<string | undefined> => undefined),
  };
  const integrationService = {
    getIntegrationByInternalId: jest.fn(async () => limits.existing ?? null),
    createOrUpdateIntegration: jest.fn(async () => ({ id: 'int-1', name: 'x' })),
    migrateIntegrationOnConnect: jest.fn(),
    checkCappedProviderSwitch: jest.fn(),
    checkProviderAvailable: jest.fn(),
    saveProviderPage: jest.fn(async () => ({ saved: true })),
    informAboutLinkConnect: jest.fn(async () => undefined),
  };
  const controller = new NoAuthIntegrationsController(
    {
      getAllowedSocialsIntegrations: () => ['demo'],
      getSocialIntegration: () => provider,
    } as any,
    integrationService as any,
    { startRefreshWorkflow: jest.fn(async () => undefined) } as any,
    {
      getOrgById: jest.fn(async () => org),
      getOrgByIdWithSubscription: jest.fn(async () => org),
      getActiveTeam: jest.fn(async () => ({
        users: members.map((id) => ({ role: 'USER', user: { id } })),
      })),
    } as any,
    permissions as any,
    {
      getUserById: jest.fn(async (id: string) => ({
        id,
        name: 'Jane',
        lastName: 'Doe',
        email: 'jane@acme.com',
      })),
    } as any
  );
  return { controller, integrationService, permissions };
};

const authenticated = {
  name: 'Demo',
  authenticate: jest.fn(async () => ({
    id: '1',
    name: 'Demo',
    accessToken: 'a',
    refreshToken: 'r',
    expiresIn: 1,
    picture: '',
    username: 'demo',
  })),
};

describe('NoAuthIntegrationsController state keys', () => {
  beforeEach(() => {
    redis.data.clear();
    redis.data.set('login:s1', 'verifier');
    redis.data.set('organization:s1', 'org-1');
  });

  it('spends the organization state when a channel is connected', async () => {
    const { controller } = make({ ...authenticated });
    await controller.connectSocialMedia('demo', { state: 's1', code: 'c', timezone: 0 } as any);
    expect(redis.data.has('organization:s1')).toBe(false);
    expect(redis.data.has('login:s1')).toBe(false);

    // a replay of the same state has nothing left to act on
    await expect(
      controller.connectSocialMedia('demo', { state: 's1', code: 'c', timezone: 0 } as any)
    ).rejects.toBeDefined();
  });

  it('keeps it for the page picking step of a two step provider, then spends it', async () => {
    const { controller, integrationService } = make({
      ...authenticated,
      isBetweenSteps: true,
    });
    await controller.connectSocialMedia('demo', { state: 's1', code: 'c', timezone: 0 } as any);
    expect(redis.data.get('organization:s1')).toBe('org-1');

    await controller.saveProviderPage(
      'int-1',
      { state: 's1', page: 'p' },
      { method: 'POST', cookies: {}, headers: {} } as any,
      { cookie: jest.fn() } as any
    );
    expect(integrationService.saveProviderPage).toHaveBeenCalledTimes(1);
    expect(redis.data.has('organization:s1')).toBe(false);

    await expect(
      controller.saveProviderPage(
        'int-1',
        { state: 's1', page: 'p' },
        { method: 'POST', cookies: {}, headers: {} } as any,
        { cookie: jest.fn() } as any
      )
    ).rejects.toThrow('This connection link expired or was already used');
    expect(integrationService.saveProviderPage).toHaveBeenCalledTimes(1);
  });

  it('keeps the state when saving the page fails, so the person can retry', async () => {
    const { controller, integrationService } = make({ ...authenticated, isBetweenSteps: true });
    integrationService.saveProviderPage.mockRejectedValueOnce(new Error('bad page'));
    await expect(
      controller.saveProviderPage(
        'int-1',
        { state: 's1', page: 'p' },
        { method: 'POST', cookies: {}, headers: {} } as any,
        { cookie: jest.fn() } as any
      )
    ).rejects.toThrow('bad page');
    expect(redis.data.get('organization:s1')).toBe('org-1');
  });
});

describe('NoAuthIntegrationsController channel limit', () => {
  beforeEach(() => {
    redis.data.clear();
    redis.data.set('login:s1', 'verifier');
    redis.data.set('organization:s1', 'org-1');
  });

  it('refuses a new channel over the plan limit', async () => {
    const { controller, integrationService } = make(
      { ...authenticated },
      { canAdd: false }
    );
    await expect(
      controller.connectSocialMedia('demo', { state: 's1', code: 'c', timezone: 0 } as any)
    ).rejects.toMatchObject({ response: { section: 'channel' } });
    expect(integrationService.createOrUpdateIntegration).not.toHaveBeenCalled();
  });

  it('lets a channel the workspace already has reconnect at the limit', async () => {
    const { controller, integrationService, permissions } = make(
      { ...authenticated },
      { canAdd: false, existing: { id: 'int-1' } }
    );
    await controller.connectSocialMedia('demo', { state: 's1', code: 'c', timezone: 0 } as any);
    expect(integrationService.getIntegrationByInternalId).toHaveBeenCalledWith('org-1', '1');
    expect(permissions.canAddChannel).not.toHaveBeenCalled();
    expect(integrationService.createOrUpdateIntegration).toHaveBeenCalled();
  });
});

// OAuth login CSRF: a consent link started in one workspace and opened by
// someone else must not attach their account to that workspace
describe('NoAuthIntegrationsController connect binding', () => {
  const body = (extra: object = {}) =>
    ({ state: 's1', code: 'c', timezone: 0, ...extra } as any);
  const request = (
    cookies: Record<string, string> = {},
    headers: Record<string, string> = {}
  ) => ({ method: 'POST', cookies, headers } as any);
  const response = () => ({ cookie: jest.fn() } as any);

  beforeAll(() => {
    process.env.FRONTEND_URL = 'https://app.example.com';
  });

  afterAll(() => {
    delete process.env.NOT_SECURED;
  });

  beforeEach(() => {
    delete process.env.NOT_SECURED;
    redis.data.clear();
    redis.set.mockClear();
    sessionUser.mockReset();
    sessionUser.mockResolvedValue(null);
    authenticated.authenticate.mockClear();
    redis.data.set('login:s1', 'verifier');
    redis.data.set('organization:s1', 'org-1');
  });

  // what the app's GET /integrations/social left behind for member u1
  const startedInApp = async () =>
    (
      await saveConnectBinding('s1', {
        type: 'session',
        orgId: 'org-1',
        userId: 'u1',
      })
    ).nonce as string;

  describe('a connect started in the app', () => {
    it('is refused in a browser without its cookie (the forwarded consent link)', async () => {
      const { controller, integrationService } = make({ ...authenticated });
      await startedInApp();
      await expect(
        controller.connectSocialMedia('demo', body(), request(), response())
      ).rejects.toMatchObject({
        status: 403,
        message: CONNECT_OTHER_BROWSER_MESSAGE,
      });
      expect(authenticated.authenticate).not.toHaveBeenCalled();
      expect(integrationService.createOrUpdateIntegration).not.toHaveBeenCalled();
      // a refused callback spends nothing
      expect(redis.data.get('login:s1')).toBe('verifier');
      expect(redis.data.get('organization:s1')).toBe('org-1');
    });

    it('is refused for another signed-in user, even a member of the workspace', async () => {
      const { controller, integrationService } = make(
        { ...authenticated },
        {},
        ['u1', 'u2']
      );
      await startedInApp();
      sessionUser.mockResolvedValue({ id: 'u2' });
      await expect(
        controller.connectSocialMedia(
          'demo',
          body(),
          request({}, { auth: 'token-of-u2' }),
          response()
        )
      ).rejects.toMatchObject({ status: 403 });
      expect(integrationService.createOrUpdateIntegration).not.toHaveBeenCalled();
    });

    it('is refused with a wrong nonce', async () => {
      const { controller } = make({ ...authenticated });
      await startedInApp();
      await expect(
        controller.connectSocialMedia(
          'demo',
          body(),
          request({ [connectNonceCookie('s1')]: 'guessed' }),
          response()
        )
      ).rejects.toMatchObject({ status: 403 });
    });

    it('is refused once the member left the workspace, cookie or not', async () => {
      const { controller } = make({ ...authenticated }, {}, []);
      const nonce = await startedInApp();
      await expect(
        controller.connectSocialMedia(
          'demo',
          body(),
          request({ [connectNonceCookie('s1')]: nonce }),
          response()
        )
      ).rejects.toMatchObject({ status: 403 });
    });

    it('connects in the same browser, then spends the binding and its cookie', async () => {
      const { controller, integrationService } = make({ ...authenticated });
      const nonce = await startedInApp();
      const res = response();
      const result: any = await controller.connectSocialMedia(
        'demo',
        body(),
        request({ [connectNonceCookie('s1')]: nonce }),
        res
      );
      expect(result.needsConfirmation).toBeUndefined();
      expect(integrationService.createOrUpdateIntegration).toHaveBeenCalledTimes(1);
      expect(integrationService.informAboutLinkConnect).not.toHaveBeenCalled();
      expect(redis.data.has('binding:s1')).toBe(false);
      expect(redis.data.has('organization:s1')).toBe(false);
      // cleared with the attributes it was set with
      expect(res.cookie).toHaveBeenCalledWith(
        connectNonceCookie('s1'),
        '',
        connectNonceCookieOptions(-1)
      );
    });

    it('is a host-only __Host- cookie: no Domain, Secure, HttpOnly, Lax', () => {
      expect(connectNonceCookie('s1')).toMatch(/^__Host-connect_[0-9a-f]{16}$/);
      const options = connectNonceCookieOptions(3600);
      expect(options).toEqual({
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        maxAge: 3600 * 1000,
      });
      expect(options).not.toHaveProperty('domain');

      process.env.NOT_SECURED = 'true';
      expect(connectNonceCookie('s1')).toMatch(/^connect_[0-9a-f]{16}$/);
      expect(connectNonceCookieOptions(3600).secure).toBe(false);
    });

    it('does not take the same member signed in for the cookie in production', async () => {
      const { controller, integrationService } = make({ ...authenticated });
      await startedInApp();
      sessionUser.mockResolvedValue({ id: 'u1' });
      await expect(
        controller.connectSocialMedia(
          'demo',
          body(),
          request({}, { auth: 'token-of-u1' }),
          response()
        )
      ).rejects.toMatchObject({ status: 403 });
      expect(integrationService.createOrUpdateIntegration).not.toHaveBeenCalled();
    });

    it('under NOT_SECURED connects for the same member signed in, when the cookie did not come back', async () => {
      process.env.NOT_SECURED = 'true';
      const { controller, integrationService } = make({ ...authenticated });
      await startedInApp();
      sessionUser.mockResolvedValue({ id: 'u1' });
      await controller.connectSocialMedia(
        'demo',
        body(),
        request({}, { auth: 'token-of-u1' }),
        response()
      );
      expect(sessionUser).toHaveBeenCalledWith(expect.anything(), 'token-of-u1');
      expect(integrationService.createOrUpdateIntegration).toHaveBeenCalledTimes(1);
    });

    it('does not trust the auth cookie of a request sent from another site', async () => {
      process.env.NOT_SECURED = 'true';
      const { controller } = make({ ...authenticated });
      await startedInApp();
      sessionUser.mockResolvedValue({ id: 'u1' });
      await expect(
        controller.connectSocialMedia(
          'demo',
          body(),
          request({ auth: 'token-of-u1' }, { origin: 'https://evil.example' }),
          response()
        )
      ).rejects.toMatchObject({ status: 403 });
      expect(sessionUser).not.toHaveBeenCalled();
    });

    it('needs the same browser for the page picking step too', async () => {
      const { controller, integrationService } = make({
        ...authenticated,
        isBetweenSteps: true,
      });
      const nonce = await startedInApp();
      const cookies = { [connectNonceCookie('s1')]: nonce };
      await controller.connectSocialMedia('demo', body(), request(cookies), response());
      expect(redis.data.has('binding:s1')).toBe(true);

      await expect(
        controller.saveProviderPage('int-1', { state: 's1' }, request(), response())
      ).rejects.toMatchObject({ status: 403 });
      expect(integrationService.saveProviderPage).not.toHaveBeenCalled();

      await controller.saveProviderPage(
        'int-1',
        { state: 's1' },
        request(cookies),
        response()
      );
      expect(integrationService.saveProviderPage).toHaveBeenCalledTimes(1);
      expect(redis.data.has('binding:s1')).toBe(false);
      expect(redis.data.has('organization:s1')).toBe(false);
    });
  });

  describe.each(['invite', 'api', 'enterprise', 'mobile'] as const)(
    'a %s link',
    (type) => {
      const shared = () =>
        saveConnectBinding('s1', { type, orgId: 'org-1', userId: 'u1' });

      it('lives an hour, like every connect, and sets no cookie', async () => {
        const { nonce, ttl } = await shared();
        expect(nonce).toBeUndefined();
        expect(ttl).toBe(CONNECT_LINK_TTL);
        expect(JSON.parse(redis.data.get('binding:s1'))).not.toHaveProperty(
          'nonceHash'
        );
      });

      it('asks for a confirmation before the code is exchanged', async () => {
        const { controller, integrationService } = make({ ...authenticated });
        await shared();
        expect(
          await controller.connectSocialMedia('demo', body(), request(), response())
        ).toEqual({
          needsConfirmation: true,
          workspaceName: 'Acme',
          providerName: 'Demo',
          createdBy: 'Jane Doe (ja***@acme.com)',
          signedInOutsideWorkspace: false,
        });
        expect(authenticated.authenticate).not.toHaveBeenCalled();
        expect(integrationService.createOrUpdateIntegration).not.toHaveBeenCalled();
        expect(redis.data.get('login:s1')).toBe('verifier');
        expect(redis.data.get('organization:s1')).toBe('org-1');
      });

      it('connects once confirmed, in any browser, tells the admins, and works only once', async () => {
        const { controller, integrationService } = make({ ...authenticated });
        await shared();
        await controller.connectSocialMedia(
          'demo',
          body({ confirmed: true }),
          request(),
          response()
        );
        expect(integrationService.createOrUpdateIntegration).toHaveBeenCalledTimes(1);
        // a mobile connect is the member's own, a partner manages its own
        if (type === 'invite' || type === 'api') {
          expect(integrationService.informAboutLinkConnect).toHaveBeenCalledWith(
            'org-1',
            'Acme',
            '@demo',
            'Demo'
          );
        } else {
          expect(integrationService.informAboutLinkConnect).not.toHaveBeenCalled();
        }
        expect(redis.data.has('binding:s1')).toBe(false);

        await expect(
          controller.connectSocialMedia(
            'demo',
            body({ confirmed: true }),
            request(),
            response()
          )
        ).rejects.toBeDefined();
        expect(integrationService.createOrUpdateIntegration).toHaveBeenCalledTimes(1);
      });

      it('warns a signed-in person who is not a member of the workspace', async () => {
        const { controller } = make({ ...authenticated });
        await shared();
        sessionUser.mockResolvedValue({ id: 'u9' });
        const answer: any = await controller.connectSocialMedia(
          'demo',
          body(),
          request({}, { auth: 'token-of-u9' }),
          response()
        );
        expect(answer.signedInOutsideWorkspace).toBe(true);

        sessionUser.mockResolvedValue({ id: 'u1' });
        const member: any = await controller.connectSocialMedia(
          'demo',
          body(),
          request({}, { auth: 'token-of-u1' }),
          response()
        );
        expect(member.signedInOutsideWorkspace).toBe(false);
      });

      it('refuses a full plan before asking for a confirmation', async () => {
        const { controller, integrationService } = make(
          { ...authenticated },
          { canAdd: false }
        );
        await shared();
        await expect(
          controller.connectSocialMedia('demo', body(), request(), response())
        ).rejects.toMatchObject({ response: { section: 'channel' } });
        expect(integrationService.checkProviderAvailable).toHaveBeenCalledWith(
          'org-1',
          'demo',
          undefined
        );
        expect(authenticated.authenticate).not.toHaveBeenCalled();
      });

      it('lets a reconnect of a channel the workspace has be confirmed at the limit', async () => {
        const { controller } = make(
          { ...authenticated },
          { canAdd: false, existing: { id: 'int-1' } }
        );
        await shared();
        redis.data.set('refresh:s1', '1');
        expect(
          await controller.connectSocialMedia('demo', body(), request(), response())
        ).toMatchObject({ needsConfirmation: true });
      });

      it('is dropped by Cancel, so its code can not be completed later', async () => {
        const { controller, integrationService } = make({ ...authenticated });
        await shared();
        redis.data.set('refresh:s1', '1');
        expect(await controller.cancelLinkConnect('s1')).toEqual({
          cancelled: true,
        });
        for (const key of ['login', 'organization', 'refresh', 'binding']) {
          expect(redis.data.has(`${key}:s1`)).toBe(false);
        }
        await expect(
          controller.connectSocialMedia(
            'demo',
            body({ confirmed: true }),
            request(),
            response()
          )
        ).rejects.toBeDefined();
        expect(integrationService.createOrUpdateIntegration).not.toHaveBeenCalled();
      });

      it('lets only a confirmed connect pick its page', async () => {
        const { controller, integrationService } = make({
          ...authenticated,
          isBetweenSteps: true,
        });
        await shared();
        await expect(
          controller.saveProviderPage('int-1', { state: 's1' }, request(), response())
        ).rejects.toMatchObject({ status: 400 });
        expect(integrationService.saveProviderPage).not.toHaveBeenCalled();

        await controller.connectSocialMedia(
          'demo',
          body({ confirmed: true }),
          request(),
          response()
        );
        expect(JSON.parse(redis.data.get('binding:s1')).confirmed).toBe(true);

        await controller.saveProviderPage(
          'int-1',
          { state: 's1' },
          request(),
          response()
        );
        expect(integrationService.saveProviderPage).toHaveBeenCalledTimes(1);
        expect(redis.data.has('binding:s1')).toBe(false);
      });
    }
  );

  it('never cancels a connect started in the app by its state', async () => {
    const { controller } = make({ ...authenticated });
    await startedInApp();
    expect(await controller.cancelLinkConnect('s1')).toEqual({ cancelled: false });
    expect(redis.data.get('login:s1')).toBe('verifier');
    expect(redis.data.has('binding:s1')).toBe(true);
  });

  it('gives a connect started in the app an hour and a nonce cookie', async () => {
    const { nonce, ttl } = await saveConnectBinding('s2', {
      type: 'session',
      orgId: 'org-1',
      userId: 'u1',
    });
    expect(ttl).toBe(CONNECT_SESSION_TTL);
    expect(nonce).toHaveLength(32);
    const stored = JSON.parse(redis.data.get('binding:s2'));
    // only a hash of the nonce is kept server side
    expect(stored.nonceHash).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain(nonce);
  });

  it('refuses a binding of another workspace', async () => {
    const { controller } = make({ ...authenticated });
    await saveConnectBinding('s1', { type: 'invite', orgId: 'org-2' });
    await expect(
      controller.connectSocialMedia('demo', body({ confirmed: true }), request(), response())
    ).rejects.toMatchObject({ status: 403 });
  });

  it('keeps the old behaviour for a state started before bindings existed', async () => {
    const { controller, integrationService } = make({ ...authenticated });
    await controller.connectSocialMedia('demo', body(), request(), response());
    expect(integrationService.createOrUpdateIntegration).toHaveBeenCalledTimes(1);
  });
});
