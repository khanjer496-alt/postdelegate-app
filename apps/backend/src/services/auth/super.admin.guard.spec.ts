jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);

import { HttpException, NotFoundException } from '@nestjs/common';
import { SuperAdminGuard } from '@gitroom/backend/services/auth/super.admin.guard';

const contextFor = (request: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  } as any);

describe('SuperAdminGuard', () => {
  const env = { ...process.env };
  let organizationService: { canUseSuperAdminApi: jest.Mock };
  let guard: SuperAdminGuard;

  beforeEach(() => {
    delete process.env.ENABLE_SUPER_ADMIN_API;
    organizationService = { canUseSuperAdminApi: jest.fn(async () => true) };
    guard = new SuperAdminGuard(organizationService as any);
  });
  afterAll(() => {
    process.env = env;
  });

  it('hides the operator routes (404) by default, even for a super admin key', async () => {
    await expect(
      guard.canActivate(contextFor({ authOrgId: 'org-1' }))
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(organizationService.canUseSuperAdminApi).not.toHaveBeenCalled();
  });

  it.each(['false', '1', 'TRUE', ''])(
    'keeps them hidden when ENABLE_SUPER_ADMIN_API is "%s"',
    async (value) => {
      process.env.ENABLE_SUPER_ADMIN_API = value;

      await expect(
        guard.canActivate(contextFor({ authOrgId: 'org-1' }))
      ).rejects.toBeInstanceOf(NotFoundException);
    }
  );

  describe('with ENABLE_SUPER_ADMIN_API=true', () => {
    beforeEach(() => {
      process.env.ENABLE_SUPER_ADMIN_API = 'true';
    });

    it('lets a super admin API key through', async () => {
      await expect(
        guard.canActivate(contextFor({ authOrgId: 'org-1' }))
      ).resolves.toBe(true);
      expect(organizationService.canUseSuperAdminApi).toHaveBeenCalledWith(
        'org-1'
      );
    });

    it('still refuses OAuth app tokens', async () => {
      const result = guard.canActivate(
        contextFor({ authOrgId: 'org-1', isOAuthApp: true })
      );

      await expect(result).rejects.toBeInstanceOf(HttpException);
      await expect(result).rejects.toMatchObject({ status: 403 });
    });

    it('still refuses a workspace without a super admin', async () => {
      organizationService.canUseSuperAdminApi.mockResolvedValue(false);

      await expect(
        guard.canActivate(contextFor({ authOrgId: 'org-1' }))
      ).rejects.toMatchObject({ status: 403 });
    });
  });
});
