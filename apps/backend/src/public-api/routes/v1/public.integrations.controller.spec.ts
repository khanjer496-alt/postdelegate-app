// the real services pull in every social provider, the spec injects fakes
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({ MediaService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {}, socialIntegrationList: [] }));
jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({ RefreshIntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({ RefreshToken: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service', () => ({ AdminStatsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/clipping/clipping.service', () => ({ ClippingService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/studio/studio.service', () => ({ StudioService: class {} }));
jest.mock('@gitroom/nestjs-libraries/chat/validation.schemas.helper', () => ({ getValidationSchemas: jest.fn() }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({ ioRedis: {} }));
jest.mock('@gitroom/backend/services/auth/super.admin.guard', () => ({ SuperAdminGuard: class {} }));
jest.mock('@gitroom/nestjs-libraries/upload/multer.stream.engine', () => ({ streamUploadOptions: () => ({}) }));
jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));

import { PublicIntegrationsController } from './public.integrations.controller';
import { PostValidationException } from '@gitroom/backend/api/routes/posts.validation.exception';

const validationOf = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  identifier: 'x',
  name: 'My X',
  valid: false,
  settingsError: 'Pick who can reply',
  errors: true,
  emptyContent: false,
  tooLong: false,
  maximumCharacters: 280,
  disabled: false,
  ...over,
});

const setup = (validation = validationOf()) => {
  const posts = {
    // with replaceDraft off the real one keeps the request type
    mapTypeToPost: jest.fn(async (body: any) => body),
    validatePosts: jest.fn(async () => [validation]),
    createPost: jest.fn(async () => [{ postId: 'p1' }]),
  };
  const controller = new (PublicIntegrationsController as any)(
    {},
    posts
  ) as PublicIntegrationsController;
  const create = (type?: string) =>
    controller.createPost({ id: 'org-1' } as any, undefined, {
      type,
      date: '2999-01-01T00:00:00Z',
      posts: [{ integration: { id: 'i1' }, value: [{ content: 'hi' }], settings: {} }],
    });
  return { posts, create };
};

describe('PublicIntegrationsController.createPost', () => {
  it('maps and validates a draft as a draft', async () => {
    const { posts, create } = setup();

    await create('draft');

    expect(posts.mapTypeToPost).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'draft' }),
      'org-1',
      false,
      'draft'
    );
    // incomplete settings are fine on a draft
    expect(posts.createPost).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ type: 'draft' }),
      'API',
      false,
      expect.anything()
    );
  });

  it('still refuses incomplete settings on a scheduled post', async () => {
    const { create } = setup();
    await expect(create('schedule')).rejects.toBeInstanceOf(PostValidationException);
  });

  it('schedules an unknown or missing type', async () => {
    const { posts, create } = setup(validationOf({ valid: true }));
    await create(undefined);
    expect(posts.mapTypeToPost).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'schedule' }),
      'org-1',
      false,
      'schedule'
    );
  });

  it('keeps a draft for a turned off channel', async () => {
    const { posts, create } = setup(validationOf({ valid: true, disabled: true }));
    await create('draft');
    expect(posts.createPost).toHaveBeenCalled();
  });

  it.each(['schedule', 'now'])(
    'refuses a %s post for a turned off channel',
    async (type) => {
      const { posts, create } = setup(validationOf({ valid: true, disabled: true }));
      await expect(create(type)).rejects.toBeInstanceOf(PostValidationException);
      expect(posts.createPost).not.toHaveBeenCalled();
    }
  );
});
