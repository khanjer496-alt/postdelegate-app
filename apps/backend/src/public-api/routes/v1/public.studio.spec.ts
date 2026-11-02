// the controller imports every provider and service of the public API, only
// the Studio routes are under test
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({
  MediaService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
  socialIntegrationList: [],
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({
  RefreshToken: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({
  UsersService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service',
  () => ({ AdminStatsService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/clipping/clipping.service',
  () => ({ ClippingService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/studio/studio.service',
  () => ({ StudioService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service', () => ({
  OAuthService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/chat/validation.schemas.helper', () => ({
  getValidationSchemas: () => ({}),
}));
jest.mock('@gitroom/nestjs-libraries/upload/multer.stream.engine', () => ({
  streamUploadOptions: () => ({}),
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));
jest.mock('@gitroom/backend/services/auth/super.admin.guard', () => ({
  SuperAdminGuard: class {},
}));
jest.mock('@gitroom/backend/api/routes/posts.validation.exception', () => ({
  PostValidationException: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/approvals/approval.policy.service',
  () => ({})
);
jest.mock('@gitroom/nestjs-libraries/sentry/initialize.sentry', () => ({
  setSentryUserContext: jest.fn(),
}));
jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));

import 'reflect-metadata';
import { HttpException, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common/enums/request-method.enum';
import { PublicIntegrationsController } from '@gitroom/backend/public-api/routes/v1/public.integrations.controller';
import { PublicAuthMiddleware } from '@gitroom/backend/services/auth/public.auth.middleware';
import { CreateStudioRenderDto } from '@gitroom/nestjs-libraries/dtos/studio/studio.render.dto';

const studioController = (studioService: Record<string, jest.Mock>) =>
  new (PublicIntegrationsController as any)(
    ...Array(11).fill({}),
    studioService
  ) as PublicIntegrationsController;

const route = (name: keyof PublicIntegrationsController) => {
  const handler = PublicIntegrationsController.prototype[name] as any;
  return {
    method: Reflect.getMetadata(METHOD_METADATA, handler),
    path: Reflect.getMetadata(PATH_METADATA, handler),
  };
};

describe('Public API Studio routes', () => {
  let studioService: Record<string, jest.Mock>;
  const org = { id: 'org-1' } as any;

  beforeEach(() => {
    studioService = {
      getTemplateSchemas: jest.fn().mockReturnValue([
        { identifier: 'hook-over-clip', schema: { type: 'object' } },
      ]),
      renderFromSpec: jest
        .fn()
        .mockResolvedValue({ id: 'render-1', projectId: 'project-1' }),
      getRender: jest.fn().mockResolvedValue({ id: 'render-1' }),
      cancelRender: jest.fn().mockResolvedValue({ status: 'cancelled' }),
    };
  });

  it('are served under /public/v1', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, PublicIntegrationsController)
    ).toBe('/public/v1');
    expect(route('getStudioTemplates')).toEqual({
      method: RequestMethod.GET,
      path: '/studio/templates',
    });
    expect(route('startStudioRender')).toEqual({
      method: RequestMethod.POST,
      path: '/studio/renders',
    });
    expect(route('getStudioRender')).toEqual({
      method: RequestMethod.GET,
      path: '/studio/renders/:id',
    });
    expect(route('cancelStudioRender')).toEqual({
      method: RequestMethod.POST,
      path: '/studio/renders/:id/cancel',
    });
  });

  it('caps starting renders at 30 an hour per workspace', () => {
    const handler = PublicIntegrationsController.prototype.startStudioRender;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(30);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(
      60 * 60 * 1000
    );
  });

  it('lists the templates with their schemas', () => {
    expect(studioController(studioService).getStudioTemplates()).toEqual([
      { identifier: 'hook-over-clip', schema: { type: 'object' } },
    ]);
  });

  it('renders, reads and cancels in the workspace of the API key only', async () => {
    const controller = studioController(studioService);
    const body = {
      template: 'hook-over-clip',
      spec: { input: { mediaId: 'm' } },
    };

    await expect(controller.startStudioRender(org, body)).resolves.toEqual({
      id: 'render-1',
      projectId: 'project-1',
    });
    expect(studioService.renderFromSpec).toHaveBeenCalledWith(org, body);

    await controller.getStudioRender(org, 'render-1');
    expect(studioService.getRender).toHaveBeenCalledWith('org-1', 'render-1');

    await controller.cancelStudioRender(org, 'render-1');
    expect(studioService.cancelRender).toHaveBeenCalledWith(
      'org-1',
      'render-1'
    );
  });

  it('passes the service errors through with their status', async () => {
    studioService.getRender.mockRejectedValue(
      new HttpException('Render not found', 404)
    );
    studioService.renderFromSpec.mockRejectedValue(
      new HttpException('Studio is busy right now, try again in a few minutes', 429)
    );
    const controller = studioController(studioService);

    await expect(
      controller.getStudioRender({ id: 'org-2' } as any, 'render-1')
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      controller.startStudioRender(org, { template: 'x', spec: {} })
    ).rejects.toMatchObject({ status: 429 });
  });

  describe('request body', () => {
    const pipe = new ValidationPipe({ transform: true });
    const validate = (value: unknown) =>
      pipe.transform(value, {
        type: 'body',
        metatype: CreateStudioRenderDto,
      });

    it('takes a template, a spec object and an optional name', async () => {
      await expect(
        validate({ template: 'hook-over-clip', spec: {}, name: 'Teaser' })
      ).resolves.toBeInstanceOf(CreateStudioRenderDto);
    });

    it('rejects a missing template or spec, or a spec that is not an object', async () => {
      await expect(validate({ spec: {} })).rejects.toMatchObject({
        status: 400,
      });
      await expect(validate({ template: 'hook-over-clip' })).rejects.toMatchObject({
        status: 400,
      });
      await expect(
        validate({ template: 'hook-over-clip', spec: 'https://evil.example' })
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        validate({ template: 'hook-over-clip', spec: {}, name: 'x'.repeat(101) })
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('auth', () => {
    const run = async (
      headers: Record<string, string>,
      found: { org?: any } = {}
    ) => {
      const middleware = new PublicAuthMiddleware(
        {
          getOrgByApiKey: jest.fn(async () => found.org || null),
        } as any,
        { getOrgByOAuthToken: jest.fn(async () => null) } as any
      );
      const res: any = {
        status: jest.fn(() => res),
        json: jest.fn(() => res),
      };
      const req: any = { headers, method: 'POST', path: '/public/v1/studio/renders' };
      const next = jest.fn();
      await middleware.use(req, res, next);
      return { req, res, next };
    };

    afterEach(() => {
      delete process.env.STRIPE_SECRET_KEY;
    });

    it('needs an API key', async () => {
      const { res, next } = await run({});
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects an unknown API key or OAuth token', async () => {
      expect((await run({ authorization: 'nope' })).res.status).toHaveBeenCalledWith(401);
      expect(
        (await run({ authorization: 'pos_nope' })).res.status
      ).toHaveBeenCalledWith(401);
    });

    it('needs a subscription when billing is on', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test';
      const { res, next } = await run(
        { authorization: 'key' },
        { org: { id: 'org-1', subscription: null } }
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('scopes the request to the workspace of the key', async () => {
      const { req, next } = await run(
        { authorization: 'key' },
        { org: { id: 'org-1' } }
      );
      expect(next).toHaveBeenCalled();
      expect(req.org.id).toBe('org-1');
    });
  });
});
