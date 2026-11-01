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
      isUnderPrefix(
        '/integrations/social-connect/x',
        '/integrations/social-connect'
      )
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

describe('PoliciesGuard channel limit', () => {
  class Handlers {
    @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
    channel() {}
  }

  const deny = async (offer: unknown) => {
    const extraChannelsOffer =
      offer instanceof Error
        ? jest.fn().mockRejectedValue(offer)
        : jest.fn().mockResolvedValue(offer);
    const guard = new PoliciesGuard(new Reflector(), {
      check: jest.fn().mockResolvedValue({ can: () => false }),
      extraChannelsOffer,
    } as any);
    const org = {
      id: 'o',
      createdAt: new Date(),
      paymentId: 'cus_1',
      users: [{ role: 'ADMIN' }],
    };
    const error = await guard
      .canActivate({
        getHandler: () => Handlers.prototype.channel,
        switchToHttp: () => ({
          getRequest: () => ({
            path: '/integrations/social/x',
            query: {},
            org,
          }),
        }),
      } as any)
      .catch((e) => e);
    return { response: error.getResponse(), extraChannelsOffer, org };
  };

  it('adds the extra channels offer to a denied channel', async () => {
    const offer = {
      plan: 'Ultimate',
      totalChannels: 100,
      price: 1,
      period: 'MONTHLY',
    };
    const { response, extraChannelsOffer, org } = await deny(offer);

    expect(extraChannelsOffer).toHaveBeenCalledWith(org);
    expect(response).toEqual({
      section: Sections.CHANNEL,
      action: AuthorizationActions.Create,
      extraChannels: offer,
    });
  });

  it('falls back to the plain 402 when the offer lookup fails', async () => {
    const { response } = await deny(new Error('db down'));
    expect(response).toEqual({
      section: Sections.CHANNEL,
      action: AuthorizationActions.Create,
    });
  });

  it('leaves it out when there is no offer', async () => {
    const { response } = await deny(null);
    expect(response).toEqual({
      section: Sections.CHANNEL,
      action: AuthorizationActions.Create,
    });
  });
});
