// the real services pull in every social provider, the specs only need the types
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service', () => ({ WebhooksService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service', () => ({ AiCredentialService: class {} }));

import { PermissionsService } from './permissions.service';
import { AuthorizationActions, Sections } from './permission.exception.class';

const create = AuthorizationActions.Create;

const makeService = (tier?: string) => {
  const subscription = tier ? { subscriptionTier: tier } : null;
  return new PermissionsService(
    {
      getSubscriptionByOrganizationId: jest.fn().mockResolvedValue(subscription),
      getSubscription: jest.fn().mockResolvedValue(subscription),
    } as any,
    { countPostsFromDay: jest.fn().mockResolvedValue(0) } as any,
    {
      getIntegrationsList: jest.fn().mockResolvedValue([]),
      getIntegrationByInternalId: jest.fn(),
    } as any,
    { getTotal: jest.fn().mockResolvedValue(0) } as any,
    { hasCredential: jest.fn().mockResolvedValue(false) } as any
  );
};

const canDo = async (
  role: 'USER' | 'ADMIN' | 'SUPERADMIN',
  section: Sections,
  tier?: string
) => {
  const ability = await makeService(tier).check(
    'org',
    new Date(),
    role,
    [[create, section]]
  );
  return ability.can(create, section);
};

describe('PermissionsService role sections', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  describe('billing off (no STRIPE_PUBLISHABLE_KEY)', () => {
    beforeEach(() => {
      delete process.env.STRIPE_PUBLISHABLE_KEY;
    });

    it('denies the admin section to a plain member', async () => {
      expect(await canDo('USER', Sections.ADMIN)).toBe(false);
    });

    it.each(['ADMIN', 'SUPERADMIN'] as const)(
      'grants the admin section to %s',
      async (role) => {
        expect(await canDo(role, Sections.ADMIN)).toBe(true);
      }
    );

    it('still skips plan and quota sections for everyone', async () => {
      for (const section of [
        Sections.CHANNEL,
        Sections.POSTS_PER_MONTH,
        Sections.TEAM_MEMBERS,
        Sections.WEBHOOKS,
      ]) {
        // AI is not a quota here: it also needs a provider key and an AI tier,
        // covered in permissions.service.ai.spec.ts
        expect(await canDo('USER', section)).toBe(true);
      }
    });

    it('needs every requested policy, like the team routes do', async () => {
      const ability = await makeService().check('org', new Date(), 'USER', [
        [create, Sections.TEAM_MEMBERS],
        [create, Sections.ADMIN],
      ]);
      expect(ability.can(create, Sections.TEAM_MEMBERS)).toBe(true);
      expect(ability.can(create, Sections.ADMIN)).toBe(false);
    });
  });

  describe('billing on', () => {
    beforeEach(() => {
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
    });

    it('decides the admin section by role only', async () => {
      expect(await canDo('USER', Sections.ADMIN, 'PRO')).toBe(false);
      expect(await canDo('ADMIN', Sections.ADMIN, 'PRO')).toBe(true);
      expect(await canDo('SUPERADMIN', Sections.ADMIN, 'PRO')).toBe(true);
    });
  });
});
