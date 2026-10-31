// the real services pull in every social provider, the spec only needs the shape
jest.mock('@gitroom/nestjs-libraries/database/prisma/errors/errors.service', () => ({ ErrorsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service', () => ({ AdminStatsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/affiliates/affiliate.service', () => ({ AffiliateService: class {} }));

import { AdminController } from './admin.controller';
import { AffiliatesController } from './affiliates.controller';

const affiliateService = {
  getOverview: jest.fn().mockResolvedValue({ code: 'abc23' }),
  setCustomCode: jest.fn().mockResolvedValue({ code: 'mine' }),
  updatePayoutEmail: jest.fn().mockResolvedValue({ payoutEmail: null }),
  listPayouts: jest.fn().mockResolvedValue([{ affiliateId: 'p1' }]),
  markPaid: jest.fn().mockResolvedValue({ paid: 1, totalCents: 5000 }),
};

describe('AffiliatesController', () => {
  const controller = new AffiliatesController(affiliateService as any);
  const user: any = { id: 'u1' };

  beforeEach(() => jest.clearAllMocks());

  it('only ever acts on the signed in user', async () => {
    await controller.getOverview(user);
    await controller.setCode(user, { code: 'mine' });
    await controller.setPayout(user, { payoutEmail: 'me@example.com' });

    expect(affiliateService.getOverview).toHaveBeenCalledWith('u1');
    expect(affiliateService.setCustomCode).toHaveBeenCalledWith('u1', 'mine');
    expect(affiliateService.updatePayoutEmail).toHaveBeenCalledWith(
      'u1',
      'me@example.com'
    );
  });
});

describe('AdminController affiliate payouts authorization', () => {
  const controller = new AdminController({} as any, {} as any, affiliateService as any);
  const admin: any = { id: 'a1', isSuperAdmin: true };
  const regular: any = { id: 'u1', isSuperAdmin: false };

  beforeEach(() => jest.clearAllMocks());

  it('lists the payouts for a super admin', async () => {
    expect(await controller.listAffiliatePayouts(admin)).toEqual([
      { affiliateId: 'p1' },
    ]);
  });

  it('marks as paid for a super admin', async () => {
    await controller.markAffiliatePaid(admin, 'p1', {
      expectedAmountCents: 5000,
      reference: 'PP-1',
    });

    expect(affiliateService.markPaid).toHaveBeenCalledWith('p1', 5000, 'PP-1');
  });

  it('refuses a regular user before touching any data', async () => {
    await expect(controller.listAffiliatePayouts(regular)).rejects.toThrow(
      'Unauthorized'
    );
    await expect(
      controller.markAffiliatePaid(regular, 'p1', { expectedAmountCents: 5000 })
    ).rejects.toThrow('Unauthorized');

    expect(affiliateService.listPayouts).not.toHaveBeenCalled();
    expect(affiliateService.markPaid).not.toHaveBeenCalled();
  });

  it('refuses a missing user', async () => {
    await expect(
      controller.listAffiliatePayouts(undefined as any)
    ).rejects.toThrow('Unauthorized');
  });
});
