jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service',
  () => ({
    PostsService: class {},
  })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service',
  () => ({ WebhooksService: class {} })
);

import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

describe('PermissionsService AI section', () => {
  const env = { ...process.env };
  const subscriptionService = {
    getSubscriptionByOrganizationId: jest.fn(),
  };
  const service = new PermissionsService(
    subscriptionService as any,
    {} as any,
    {} as any,
    {} as any
  );
  const ask = () =>
    service.check('org', new Date(), 'SUPERADMIN', [
      [AuthorizationActions.Create, Sections.AI],
    ]);

  afterEach(() => {
    process.env = { ...env };
    pricing.ULTIMATE.ai = false;
    pricing.STANDARD.ai = false;
  });

  describe('without billing (everyone gets the top tier)', () => {
    beforeEach(() => {
      delete process.env.STRIPE_PUBLISHABLE_KEY;
    });

    it('refuses AI while the top tier has AI off, even with a provider key', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const ability = await ask();
      expect(ability.can(AuthorizationActions.Create, Sections.AI)).toBe(false);
    });

    it('refuses AI when the tier allows it but no provider key is set', async () => {
      delete process.env.OPENAI_API_KEY;
      pricing.ULTIMATE.ai = true;
      const ability = await ask();
      expect(ability.can(AuthorizationActions.Create, Sections.AI)).toBe(false);
    });

    it('allows AI with the tier flag and a provider key', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      pricing.ULTIMATE.ai = true;
      const ability = await ask();
      expect(ability.can(AuthorizationActions.Create, Sections.AI)).toBe(true);
    });

    it('still grants other sections', async () => {
      const ability = await service.check('org', new Date(), 'SUPERADMIN', [
        [AuthorizationActions.Create, Sections.WEBHOOKS],
      ]);
      expect(ability.can(AuthorizationActions.Create, Sections.WEBHOOKS)).toBe(
        true
      );
    });
  });

  describe('with billing', () => {
    beforeEach(() => {
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
      subscriptionService.getSubscriptionByOrganizationId.mockResolvedValue({
        subscriptionTier: 'STANDARD',
      });
    });

    it('refuses AI when the paid tier has AI off', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const ability = await ask();
      expect(ability.can(AuthorizationActions.Create, Sections.AI)).toBe(false);
    });

    it('allows AI when the paid tier and a provider key allow it', async () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      pricing.STANDARD.ai = true;
      const ability = await ask();
      expect(ability.can(AuthorizationActions.Create, Sections.AI)).toBe(true);
    });
  });
});
