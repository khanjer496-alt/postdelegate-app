jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service', () => ({
  OAuthService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/services/exception.filter', () => ({
  HttpForbiddenException: class extends Error {},
}));
jest.mock('@gitroom/nestjs-libraries/sentry/initialize.sentry', () => ({
  setSentryUserContext: () => undefined,
}));

import { PublicAuthMiddleware } from '@gitroom/backend/services/auth/public.auth.middleware';

const superAdminOrg = { id: 'org-admin', subscription: {} };
const otherOrg = { id: 'org-other', subscription: {} };

const run = async (headers: Record<string, string>) => {
  const organizationService = {
    getOrgByApiKey: jest.fn(async (key: string) =>
      key === 'admin-key' ? superAdminOrg : null
    ),
    canUseSuperAdminApi: jest.fn(async () => true),
    getOrgByIdWithSubscription: jest.fn(async (id: string) =>
      id === otherOrg.id ? otherOrg : null
    ),
  };
  const middleware = new PublicAuthMiddleware(
    organizationService as any,
    {} as any
  );
  const req: any = { headers, method: 'GET', path: '/public/v1/posts' };
  const res: any = {
    status: jest.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(),
  };
  const next = jest.fn();

  await middleware.use(req, res, next);
  return { req, res, next, organizationService };
};

describe('PublicAuthMiddleware x-postiz-org override', () => {
  const env = { ...process.env };
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.ENABLE_SUPER_ADMIN_API;
  });
  afterAll(() => {
    process.env = env;
  });

  it('answers 404 to the header unless ENABLE_SUPER_ADMIN_API=true, even for a super admin key', async () => {
    const { req, res, next, organizationService } = await run({
      authorization: 'admin-key',
      'x-postiz-org': otherOrg.id,
    });

    expect(res.statusCode).toBe(404);
    expect(next).not.toHaveBeenCalled();
    expect(req.org.id).toBe(superAdminOrg.id);
    expect(organizationService.getOrgByIdWithSubscription).not.toHaveBeenCalled();
  });

  it('lets the request through as its own org without the header', async () => {
    const { req, next } = await run({ authorization: 'admin-key' });

    expect(next).toHaveBeenCalled();
    expect(req.org.id).toBe(superAdminOrg.id);
  });

  it('acts as the other org for a super admin key once enabled', async () => {
    process.env.ENABLE_SUPER_ADMIN_API = 'true';

    const { req, next } = await run({
      authorization: 'admin-key',
      'x-postiz-org': otherOrg.id,
    });

    expect(next).toHaveBeenCalled();
    expect(req.org.id).toBe(otherOrg.id);
  });

  it('keeps refusing OAuth tokens once enabled', async () => {
    process.env.ENABLE_SUPER_ADMIN_API = 'true';
    const middleware = new PublicAuthMiddleware(
      { canUseSuperAdminApi: jest.fn(async () => true) } as any,
      {
        getOrgByOAuthToken: jest.fn(async () => ({
          organization: superAdminOrg,
        })),
      } as any
    );
    const res: any = {
      status: jest.fn(function (this: any, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: jest.fn(),
    };
    const next = jest.fn();

    await middleware.use(
      { headers: { authorization: 'pos_token', 'x-postiz-org': otherOrg.id } } as any,
      res,
      next
    );

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
