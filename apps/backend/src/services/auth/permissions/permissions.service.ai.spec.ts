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
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service',
  () => ({ AiCredentialService: class {} })
);

import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

describe('PermissionsService AI section', () => {
  const env = { ...process.env };
  const subscriptionService = {
    getSubscriptionByOrganizationId: jest.fn(),
  };
  const aiCredentialService = { hasCredential: jest.fn() };
  const service = new PermissionsService(
    subscriptionService as any,
    {} as any,
    {} as any,
    {} as any,
    aiCredentialService as any
  );
  const ask = () =>
    service.check('org', new Date(), 'SUPERADMIN', [
      [AuthorizationActions.Create, Sections.AI],
    ]);

  beforeEach(() => {
    aiCredentialService.hasCredential.mockReset();
  });

  afterEach(() => {
    process.env = { ...env };
  });

  describe.each([
    ['without billing (everyone gets the top tier)', false],
    ['with billing', true],
  ])('%s', (_label, billing) => {
    beforeEach(() => {
      if (billing) {
        process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
        subscriptionService.getSubscriptionByOrganizationId.mockResolvedValue({
          subscriptionTier: 'STANDARD',
        });
      } else {
        delete process.env.STRIPE_PUBLISHABLE_KEY;
      }
    });

    it('allows Sections.AI when the workspace has a credential', async () => {
      aiCredentialService.hasCredential.mockResolvedValue(true);
      delete process.env.OPENAI_API_KEY;
      const ability = await ask();
      expect(ability.can(AuthorizationActions.Create, Sections.AI)).toBe(true);
      expect(aiCredentialService.hasCredential).toHaveBeenCalledTimes(1);
      expect(aiCredentialService.hasCredential).toHaveBeenCalledWith('org');
    });

    it('denies Sections.AI without a credential even when OPENAI_API_KEY is set', async () => {
      aiCredentialService.hasCredential.mockResolvedValue(false);
      process.env.OPENAI_API_KEY = 'sk-test';
      const ability = await ask();
      expect(ability.can(AuthorizationActions.Create, Sections.AI)).toBe(false);
    });

    it('does not look up the credential when AI is not requested', async () => {
      await service.check('org', new Date(), 'SUPERADMIN', [
        [AuthorizationActions.Create, Sections.ADMIN],
      ]);
      expect(aiCredentialService.hasCredential).not.toHaveBeenCalled();
    });

    it('looks up the credential once per check even when AI is requested twice', async () => {
      aiCredentialService.hasCredential.mockResolvedValue(true);
      await service.check('org', new Date(), 'SUPERADMIN', [
        [AuthorizationActions.Create, Sections.AI],
        [AuthorizationActions.Read, Sections.AI],
      ]);
      expect(aiCredentialService.hasCredential).toHaveBeenCalledTimes(1);
    });
  });

  describe('without billing', () => {
    it('still grants other sections', async () => {
      delete process.env.STRIPE_PUBLISHABLE_KEY;
      const ability = await service.check('org', new Date(), 'SUPERADMIN', [
        [AuthorizationActions.Create, Sections.WEBHOOKS],
      ]);
      expect(ability.can(AuthorizationActions.Create, Sections.WEBHOOKS)).toBe(
        true
      );
    });
  });
});
