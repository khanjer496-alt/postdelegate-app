jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));

import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { EnterpriseController } from './enterprise.controller';

describe('EnterpriseController tokens', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-secret';
  });

  const make = () => {
    const createMaxUser = jest.fn(async () => ({ created: true }));
    const controller = new EnterpriseController(
      {} as any,
      { createMaxUser } as any,
      {} as any,
      {} as any
    );
    return { controller, createMaxUser };
  };
  const claims = { id: 'ext-1', name: 'N', saasName: 'S', email: 'a@b.c' };

  it('creates a user for a token of the enterprise kind', async () => {
    const { controller, createMaxUser } = make();
    const params = AuthService.signTypedJWT('enterprise-user', claims);
    expect(await controller.createUser(params)).toEqual({ created: true });
    expect(createMaxUser).toHaveBeenCalled();
  });

  it('rejects session, invite and untyped tokens', async () => {
    const { controller, createMaxUser } = make();
    for (const params of [
      AuthService.signTypedJWT('session', claims),
      AuthService.signTypedJWT('invite', claims),
      AuthService.signJWT(claims),
    ]) {
      expect(await controller.createUser(params)).toEqual({ success: false });
    }
    expect(createMaxUser).not.toHaveBeenCalled();
  });
});
