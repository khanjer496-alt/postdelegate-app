jest.mock('./permissions.service', () => ({ PermissionsService: class {} }));

import { Reflector } from '@nestjs/core';
import { PoliciesGuard, isUnderPrefix } from './permissions.guard';
import { CheckPolicies } from './permissions.ability';
import { AuthorizationActions, Sections } from './permission.exception.class';

describe('isUnderPrefix', () => {
  it('matches whole segments from the start of the path', () => {
    expect(isUnderPrefix('/auth', '/auth')).toBe(true);
    expect(isUnderPrefix('/auth/login', '/auth')).toBe(true);
    expect(
      isUnderPrefix('/integrations/social-connect/x', '/integrations/social-connect')
    ).toBe(true);
  });

  it('does not match a path that merely contains or starts like the prefix', () => {
    expect(isUnderPrefix('/oauth/authorize', '/auth')).toBe(false);
    expect(isUnderPrefix('/authors', '/auth')).toBe(false);
    expect(isUnderPrefix('/billing/auth/cancel', '/auth')).toBe(false);
    expect(isUnderPrefix('/user/auth', '/auth')).toBe(false);
    expect(
      isUnderPrefix('/integrations/provider-x', '/integrations/provider')
    ).toBe(false);
    expect(
      isUnderPrefix('/foo/integrations/provider/1', '/integrations/provider')
    ).toBe(false);
  });
});

describe('PoliciesGuard', () => {
  class Handlers {
    @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
    admin() {}
  }

  const run = async (path: string) => {
    const check = jest.fn().mockResolvedValue({ can: () => false });
    const guard = new PoliciesGuard(new Reflector(), { check } as any);
    const context = {
      getHandler: () => Handlers.prototype.admin,
      switchToHttp: () => ({
        getRequest: () => ({
          path,
          query: {},
          org: { id: 'o', createdAt: new Date(), users: [{ role: 'USER' }] },
        }),
      }),
    } as any;
    return { result: guard.canActivate(context), check };
  };

  it('checks the policies of a path that only contains /auth', async () => {
    const { result, check } = await run('/oauth/authorize');
    await expect(result).rejects.toBeDefined();
    expect(check).toHaveBeenCalled();
  });

  it('skips them on the real /auth routes', async () => {
    const { result, check } = await run('/auth/login');
    await expect(result).resolves.toBe(true);
    expect(check).not.toHaveBeenCalled();
  });
});
