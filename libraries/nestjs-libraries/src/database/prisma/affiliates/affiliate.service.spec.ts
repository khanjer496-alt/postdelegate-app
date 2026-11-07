import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AffiliateService } from './affiliate.service';
import { buildAffiliateCookieValue } from '@gitroom/helpers/affiliate/affiliate.cookie';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-30T12:00:00Z');

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
  });

const makeRepository = () => ({
  getProfileByUserId: jest.fn(),
  getProfileByCode: jest.fn(),
  createProfile: jest.fn(),
  setCustomCode: jest.fn(),
  updatePayoutEmail: jest.fn(),
  isUserInOrganization: jest.fn().mockResolvedValue(false),
  attributeOrganization: jest.fn().mockResolvedValue(true),
  getOrganizationReferralByPaymentId: jest.fn(),
  getCommissionByInvoice: jest.fn().mockResolvedValue(null),
  setFirstPaidAt: jest.fn().mockResolvedValue(undefined),
  createCommission: jest.fn(async (data) => ({ id: 'c1', ...data })),
  updateCommissionReversal: jest.fn(async (id, reversedCents, status) => ({
    id,
    reversedCents,
    status,
  })),
  listPayableCommissions: jest.fn(),
  getProfilesWithUser: jest.fn(),
  markPaid: jest.fn(),
  countReferredOrganizations: jest.fn().mockResolvedValue(0),
  countPayingOrganizations: jest.fn().mockResolvedValue(0),
  sumPending: jest.fn(),
  sumByStatus: jest.fn(),
  sumReversed: jest.fn().mockResolvedValue(0),
  listCommissions: jest.fn().mockResolvedValue([]),
  getOrganizationNames: jest.fn().mockResolvedValue([]),
});

const setup = () => {
  const repository = makeRepository();
  const service = new AffiliateService(repository as any);
  return { service, repository };
};

const ENV = [
  'AFFILIATE_COMMISSION_PERCENT',
  'AFFILIATE_COMMISSION_MONTHS',
  'AFFILIATE_HOLD_DAYS',
  'AFFILIATE_COOKIE_DAYS',
  'AFFILIATE_MIN_PAYOUT_USD',
];

beforeEach(() => {
  ENV.forEach((name) => delete process.env[name]);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('affiliate code generation', () => {
  it('returns the profile that already exists', async () => {
    const { service, repository } = setup();
    repository.getProfileByUserId.mockResolvedValue({ id: 'p1', code: 'abc23' });

    expect(await service.getOrCreateProfile('u1')).toEqual({
      id: 'p1',
      code: 'abc23',
    });
    expect(repository.createProfile).not.toHaveBeenCalled();
  });

  it('creates a short URL-safe code without ambiguous characters', async () => {
    const { service, repository } = setup();
    repository.getProfileByUserId.mockResolvedValue(null);
    repository.createProfile.mockImplementation(async (userId, code) => ({
      id: 'p1',
      userId,
      code,
    }));

    for (let i = 0; i < 50; i += 1) {
      await service.getOrCreateProfile('u1');
    }

    for (const [, code] of repository.createProfile.mock.calls) {
      expect(code).toMatch(/^[a-hj-km-np-z2-9]{8}$/);
    }
  });

  it('draws a new code when the generated one is taken', async () => {
    const { service, repository } = setup();
    repository.getProfileByUserId.mockResolvedValue(null);
    repository.createProfile
      .mockRejectedValueOnce(uniqueViolation())
      .mockImplementation(async (userId, code) => ({ id: 'p1', userId, code }));

    const profile = await service.getOrCreateProfile('u1');

    expect(repository.createProfile).toHaveBeenCalledTimes(2);
    expect(profile.id).toBe('p1');
  });

  it('uses the profile of a parallel request of the same user', async () => {
    const { service, repository } = setup();
    repository.getProfileByUserId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'p9', code: 'zzzzzzzz' });
    repository.createProfile.mockRejectedValueOnce(uniqueViolation());

    expect(await service.getOrCreateProfile('u1')).toEqual({
      id: 'p9',
      code: 'zzzzzzzz',
    });
  });

  it('does not hide errors that are not collisions', async () => {
    const { service, repository } = setup();
    repository.getProfileByUserId.mockResolvedValue(null);
    repository.createProfile.mockRejectedValue(new Error('db down'));

    await expect(service.getOrCreateProfile('u1')).rejects.toThrow('db down');
  });
});

describe('custom code', () => {
  const profile = { id: 'p1', userId: 'u1', code: 'abc23', customCodeSet: false };

  const withProfile = (over: Record<string, unknown> = {}) => {
    const ctx = setup();
    ctx.repository.getProfileByUserId.mockResolvedValue({ ...profile, ...over });
    ctx.repository.getProfileByCode.mockResolvedValue(null);
    ctx.repository.setCustomCode.mockResolvedValue(true);
    return ctx;
  };

  it('stores the code lowercase', async () => {
    const { service, repository } = withProfile();

    expect(await service.setCustomCode('u1', '  My-Brand ')).toEqual({
      code: 'my-brand',
    });
    expect(repository.setCustomCode).toHaveBeenCalledWith('u1', 'my-brand');
  });

  it.each(['ab', 'a'.repeat(25), 'bad_code', '-leading', 'sp ace', ''])(
    'rejects the invalid code %p',
    async (code) => {
      const { service, repository } = withProfile();

      await expect(service.setCustomCode('u1', code)).rejects.toBeInstanceOf(
        HttpException
      );
      expect(repository.setCustomCode).not.toHaveBeenCalled();
    }
  );

  it('rejects reserved words', async () => {
    const { service } = withProfile();
    await expect(service.setCustomCode('u1', 'Admin')).rejects.toBeInstanceOf(
      HttpException
    );
  });

  it('rejects a code that is taken', async () => {
    const { service, repository } = withProfile();
    repository.getProfileByCode.mockResolvedValue({ id: 'p2' });

    await expect(service.setCustomCode('u1', 'taken')).rejects.toThrow(
      'This code is not available'
    );
    expect(repository.setCustomCode).not.toHaveBeenCalled();
  });

  it('rejects a code that is taken in the instant between check and save', async () => {
    const { service, repository } = withProfile();
    repository.setCustomCode.mockRejectedValue(uniqueViolation());

    await expect(service.setCustomCode('u1', 'taken')).rejects.toThrow(
      'This code is not available'
    );
  });

  it('allows the custom code only once', async () => {
    const { service, repository } = withProfile({ customCodeSet: true });

    await expect(service.setCustomCode('u1', 'another')).rejects.toThrow(
      'already chosen'
    );
    expect(repository.setCustomCode).not.toHaveBeenCalled();
  });

  it('allows the custom code only once under concurrent requests', async () => {
    const { service, repository } = withProfile();
    repository.setCustomCode.mockResolvedValue(false);

    await expect(service.setCustomCode('u1', 'another')).rejects.toThrow(
      'already chosen'
    );
  });
});

describe('payout email', () => {
  it('stores and clears the email', async () => {
    const { service, repository } = setup();
    repository.getProfileByUserId.mockResolvedValue({ id: 'p1' });
    repository.updatePayoutEmail.mockImplementation(async (_u, email) => ({
      payoutEmail: email,
    }));

    expect(await service.updatePayoutEmail('u1', ' me@example.com ')).toEqual({
      payoutEmail: 'me@example.com',
    });
    expect(await service.updatePayoutEmail('u1', '')).toEqual({
      payoutEmail: null,
    });
  });
});

describe('referral attribution', () => {
  const referrer = {
    id: 'p1',
    userId: 'referrer-user',
    code: 'friend',
    user: { id: 'referrer-user', email: 'friend@gmail.com' },
  };

  const attribute = async (
    over: {
      cookie?: string;
      code?: string;
      userId?: string;
      email?: string;
      referrer?: any;
      configure?: (repository: ReturnType<typeof makeRepository>) => void;
    } = {}
  ) => {
    const { service, repository } = setup();
    repository.getProfileByCode.mockResolvedValue(
      'referrer' in over ? over.referrer : referrer
    );
    over.configure?.(repository);
    const result = await service.attributeOrganization({
      organizationId: 'org-new',
      userId: over.userId || 'new-user',
      email: over.email || 'new@example.com',
      cookie:
        'cookie' in over
          ? over.cookie
          : buildAffiliateCookieValue('friend', Date.now() - DAY),
      code: over.code,
    });
    return { result, repository };
  };

  it('attaches the referrer of a valid cookie to the new organization', async () => {
    const { result, repository } = await attribute();

    expect(result).toBe(true);
    expect(repository.getProfileByCode).toHaveBeenCalledWith('friend');
    expect(repository.attributeOrganization).toHaveBeenCalledWith(
      'org-new',
      'p1',
      'friend'
    );
  });

  it('ignores a registration without a cookie', async () => {
    const { result, repository } = await attribute({ cookie: undefined });

    expect(result).toBe(false);
    expect(repository.attributeOrganization).not.toHaveBeenCalled();
  });

  it('ignores an expired cookie', async () => {
    const { result, repository } = await attribute({
      cookie: buildAffiliateCookieValue('friend', Date.now() - 61 * DAY),
    });

    expect(result).toBe(false);
    expect(repository.getProfileByCode).not.toHaveBeenCalled();
    expect(repository.attributeOrganization).not.toHaveBeenCalled();
  });

  it('follows AFFILIATE_COOKIE_DAYS', async () => {
    process.env.AFFILIATE_COOKIE_DAYS = '10';
    const { result } = await attribute({
      cookie: buildAffiliateCookieValue('friend', Date.now() - 11 * DAY),
    });
    expect(result).toBe(false);
  });

  it('uses the code sent with the sign-up when there is no cookie', async () => {
    const { result, repository } = await attribute({
      cookie: undefined,
      code: 'Friend',
    });

    expect(result).toBe(true);
    expect(repository.getProfileByCode).toHaveBeenCalledWith('friend');
    expect(repository.attributeOrganization).toHaveBeenCalledWith(
      'org-new',
      'p1',
      'friend'
    );
  });

  it('keeps the first touch of a valid cookie over the sign-up code', async () => {
    const { repository } = await attribute({ code: 'someone-else' });
    expect(repository.getProfileByCode).toHaveBeenCalledWith('friend');
  });

  it('falls back to the sign-up code when the cookie expired', async () => {
    const { repository } = await attribute({
      cookie: buildAffiliateCookieValue('old-one', Date.now() - 61 * DAY),
      code: 'friend',
    });
    expect(repository.getProfileByCode).toHaveBeenCalledWith('friend');
  });

  it.each(['', 'ab', 'bad code', '-nope', 'x'.repeat(30)])(
    'ignores the malformed sign-up code %p',
    async (code) => {
      const { result, repository } = await attribute({
        cookie: undefined,
        code,
      });
      expect(result).toBe(false);
      expect(repository.getProfileByCode).not.toHaveBeenCalled();
    }
  );

  it('ignores a garbage cookie', async () => {
    const { result } = await attribute({ cookie: 'friend' });
    expect(result).toBe(false);
  });

  it('ignores a code that does not exist', async () => {
    const { result, repository } = await attribute({ referrer: null });

    expect(result).toBe(false);
    expect(repository.attributeOrganization).not.toHaveBeenCalled();
  });

  it('blocks a self-referral by the same user', async () => {
    const { result, repository } = await attribute({
      userId: 'referrer-user',
      email: 'someone@else.com',
    });

    expect(result).toBe(false);
    expect(repository.attributeOrganization).not.toHaveBeenCalled();
  });

  it('blocks the same mailbox written with a plus tag', async () => {
    const { result } = await attribute({ email: 'Friend+promo@gmail.com' });
    expect(result).toBe(false);
  });

  it('allows another person on the same email domain', async () => {
    const { result, repository } = await attribute({
      email: 'colleague@gmail.com',
    });

    expect(result).toBe(true);
    expect(repository.attributeOrganization).toHaveBeenCalled();
  });

  it('blocks a referrer who is a member of the new organization', async () => {
    const { result, repository } = await attribute({
      configure: (r) => r.isUserInOrganization.mockResolvedValue(true),
    });

    expect(repository.isUserInOrganization).toHaveBeenCalledWith(
      'referrer-user',
      'org-new'
    );
    expect(result).toBe(false);
    expect(repository.attributeOrganization).not.toHaveBeenCalled();
  });

  it('keeps the first referrer, the update only touches unattributed organizations', async () => {
    const { result } = await attribute({
      configure: (r) => r.attributeOrganization.mockResolvedValue(false),
    });
    expect(result).toBe(false);
  });

  it('never fails the registration', async () => {
    const { result } = await attribute({
      configure: (r) =>
        r.getProfileByCode.mockRejectedValue(new Error('db down')),
    });
    expect(result).toBe(false);
  });
});

describe('commissions', () => {
  const invoice = (over: Record<string, unknown> = {}) => ({
    invoiceId: 'in_1',
    customerId: 'cus_1',
    amountPaidCents: 2900,
    totalCents: 2900,
    taxCents: 0,
    currency: 'usd',
    paidAt: new Date('2026-10-01T00:00:00Z'),
    ...over,
  });

  const record = async (
    over: Record<string, unknown> = {},
    organization: any = {
      id: 'org1',
      referredByAffiliateId: 'p1',
      referralFirstPaidAt: null,
    }
  ) => {
    const { service, repository } = setup();
    repository.getOrganizationReferralByPaymentId.mockResolvedValue(
      organization
    );
    const result = await service.recordInvoicePayment(invoice(over) as any);
    return { result, repository };
  };

  it('takes 30 percent of the paid amount by default', async () => {
    const { result, repository } = await record();

    expect(repository.createCommission).toHaveBeenCalledWith({
      affiliateId: 'p1',
      organizationId: 'org1',
      stripeInvoiceId: 'in_1',
      currency: 'usd',
      invoiceNetCents: 2900,
      percent: 30,
      amountCents: 870,
      invoicePaidAt: new Date('2026-10-01T00:00:00Z'),
    });
    expect(result).toMatchObject({ amountCents: 870 });
  });

  it('follows AFFILIATE_COMMISSION_PERCENT and rounds down', async () => {
    process.env.AFFILIATE_COMMISSION_PERCENT = '25';
    const { repository } = await record({
      amountPaidCents: 1900,
      totalCents: 1900,
    });

    expect(repository.createCommission.mock.calls[0][0].amountCents).toBe(475);

    process.env.AFFILIATE_COMMISSION_PERCENT = '33';
    const second = await record({ amountPaidCents: 1900, totalCents: 1900 });
    expect(second.repository.createCommission.mock.calls[0][0].amountCents).toBe(
      627
    );
  });

  it('excludes the tax of the invoice', async () => {
    const { repository } = await record({
      amountPaidCents: 2900,
      totalCents: 2900,
      taxCents: 500,
    });

    const [data] = repository.createCommission.mock.calls[0];
    expect(data.invoiceNetCents).toBe(2400);
    expect(data.amountCents).toBe(720);
  });

  it('excludes the tax share of a partially paid invoice', async () => {
    const { repository } = await record({
      amountPaidCents: 1000,
      totalCents: 2000,
      taxCents: 400,
    });

    expect(repository.createCommission.mock.calls[0][0].invoiceNetCents).toBe(
      800
    );
  });

  it('is idempotent on the invoice id', async () => {
    const { service, repository } = setup();
    repository.getOrganizationReferralByPaymentId.mockResolvedValue({
      id: 'org1',
      referredByAffiliateId: 'p1',
      referralFirstPaidAt: new Date('2026-10-01T00:00:00Z'),
    });
    repository.getCommissionByInvoice.mockResolvedValue({
      id: 'c-existing',
      stripeInvoiceId: 'in_1',
    });

    const result = await service.recordInvoicePayment(invoice() as any);

    expect(result).toEqual({ id: 'c-existing', stripeInvoiceId: 'in_1' });
    expect(repository.createCommission).not.toHaveBeenCalled();
  });

  it('leaves the uniqueness of the row to the repository on a race', async () => {
    const { repository } = await record();
    expect(repository.createCommission).toHaveBeenCalledTimes(1);
    expect(repository.createCommission.mock.calls[0][0].stripeInvoiceId).toBe(
      'in_1'
    );
  });

  it('ignores organizations that were not referred', async () => {
    const { result, repository } = await record(
      {},
      { id: 'org1', referredByAffiliateId: null, referralFirstPaidAt: null }
    );
    expect(result).toBeNull();
    expect(repository.createCommission).not.toHaveBeenCalled();
  });

  it('ignores customers that belong to no organization', async () => {
    const { result } = await record({}, null);
    expect(result).toBeNull();
  });

  it('ignores trial invoices of zero and non dollar payments', async () => {
    expect((await record({ amountPaidCents: 0, totalCents: 0 })).result).toBeNull();
    expect((await record({ currency: 'eur' })).result).toBeNull();
  });

  it('starts the window at the first paid invoice', async () => {
    const { repository } = await record();

    expect(repository.setFirstPaidAt).toHaveBeenCalledWith(
      'org1',
      new Date('2026-10-01T00:00:00Z')
    );
  });

  it('pays commission on every invoice inside the window', async () => {
    const { result, repository } = await record(
      { paidAt: new Date('2027-09-30T00:00:00Z') },
      {
        id: 'org1',
        referredByAffiliateId: 'p1',
        referralFirstPaidAt: new Date('2026-10-01T00:00:00Z'),
      }
    );

    expect(result).not.toBeNull();
    expect(repository.setFirstPaidAt).not.toHaveBeenCalled();
  });

  it('stops after the commission months', async () => {
    const { result, repository } = await record(
      { paidAt: new Date('2027-10-01T00:00:00Z') },
      {
        id: 'org1',
        referredByAffiliateId: 'p1',
        referralFirstPaidAt: new Date('2026-10-01T00:00:00Z'),
      }
    );

    expect(result).toBeNull();
    expect(repository.createCommission).not.toHaveBeenCalled();
  });

  it('follows AFFILIATE_COMMISSION_MONTHS', async () => {
    process.env.AFFILIATE_COMMISSION_MONTHS = '3';
    const { result } = await record(
      { paidAt: new Date('2027-01-02T00:00:00Z') },
      {
        id: 'org1',
        referredByAffiliateId: 'p1',
        referralFirstPaidAt: new Date('2026-10-01T00:00:00Z'),
      }
    );
    expect(result).toBeNull();
  });

  it('moves the window start back when an earlier invoice arrives late', async () => {
    const { repository } = await record(
      { paidAt: new Date('2026-09-01T00:00:00Z') },
      {
        id: 'org1',
        referredByAffiliateId: 'p1',
        referralFirstPaidAt: new Date('2026-10-01T00:00:00Z'),
      }
    );

    expect(repository.setFirstPaidAt).toHaveBeenCalledWith(
      'org1',
      new Date('2026-09-01T00:00:00Z')
    );
  });
});

describe('refunds and chargebacks', () => {
  const reverse = async (
    reversal: { reversedCents: number; chargedCents: number },
    commission: Record<string, unknown> = {}
  ) => {
    const { service, repository } = setup();
    repository.getCommissionByInvoice.mockResolvedValue({
      id: 'c1',
      amountCents: 870,
      reversedCents: 0,
      status: 'PENDING',
      ...commission,
    });
    const result = await service.reverseCommission({
      invoiceId: 'in_1',
      ...reversal,
    });
    return { result, repository };
  };

  it('reverses the whole commission on a full refund', async () => {
    const { repository } = await reverse({
      reversedCents: 2900,
      chargedCents: 2900,
    });

    expect(repository.updateCommissionReversal).toHaveBeenCalledWith(
      'c1',
      870,
      'REVERSED'
    );
  });

  it('reverses in proportion on a partial refund', async () => {
    const { repository } = await reverse({
      reversedCents: 1450,
      chargedCents: 2900,
    });

    expect(repository.updateCommissionReversal).toHaveBeenCalledWith(
      'c1',
      435,
      'PENDING'
    );
  });

  it('tops up when a second refund raises the cumulative amount', async () => {
    const { repository } = await reverse(
      { reversedCents: 2900, chargedCents: 2900 },
      { reversedCents: 435 }
    );

    expect(repository.updateCommissionReversal).toHaveBeenCalledWith(
      'c1',
      870,
      'REVERSED'
    );
  });

  it('does nothing when the same refund is delivered twice', async () => {
    const { repository, result } = await reverse(
      { reversedCents: 1450, chargedCents: 2900 },
      { reversedCents: 435 }
    );

    expect(repository.updateCommissionReversal).not.toHaveBeenCalled();
    expect(result).toMatchObject({ reversedCents: 435 });
  });

  it('never reverses more than the commission', async () => {
    const { repository } = await reverse({
      reversedCents: 9000,
      chargedCents: 2900,
    });

    expect(repository.updateCommissionReversal).toHaveBeenCalledWith(
      'c1',
      870,
      'REVERSED'
    );
  });

  it('keeps a paid commission paid and records the clawback', async () => {
    const { repository } = await reverse(
      { reversedCents: 2900, chargedCents: 2900 },
      { status: 'PAID' }
    );

    expect(repository.updateCommissionReversal).toHaveBeenCalledWith(
      'c1',
      870,
      'PAID'
    );
  });

  it('ignores invoices without a commission', async () => {
    const { service, repository } = setup();
    repository.getCommissionByInvoice.mockResolvedValue(null);

    expect(
      await service.reverseCommission({
        invoiceId: 'in_x',
        reversedCents: 100,
        chargedCents: 100,
      })
    ).toBeNull();
    expect(repository.updateCommissionReversal).not.toHaveBeenCalled();
  });
});

describe('derived commission status', () => {
  const { service } = setup();
  const row = (over: Record<string, unknown> = {}) => ({
    status: 'PENDING' as any,
    invoicePaidAt: new Date('2026-10-01T00:00:00Z'),
    amountCents: 870,
    reversedCents: 0,
    ...over,
  });

  it('is pending during the hold period', () => {
    expect(
      service.deriveStatus(row(), new Date('2026-10-30T23:59:59Z'))
    ).toBe('PENDING');
  });

  it('is approved once the hold period passed', () => {
    expect(
      service.deriveStatus(row(), new Date('2026-10-31T00:00:00Z'))
    ).toBe('APPROVED');
  });

  it('follows AFFILIATE_HOLD_DAYS', () => {
    process.env.AFFILIATE_HOLD_DAYS = '7';
    expect(service.deriveStatus(row(), new Date('2026-10-09T00:00:00Z'))).toBe(
      'APPROVED'
    );
    delete process.env.AFFILIATE_HOLD_DAYS;
  });

  it('keeps paid and reversed rows', () => {
    const later = new Date('2027-01-01T00:00:00Z');
    expect(service.deriveStatus(row({ status: 'PAID' }), later)).toBe('PAID');
    expect(service.deriveStatus(row({ status: 'REVERSED' }), later)).toBe(
      'REVERSED'
    );
    expect(service.deriveStatus(row({ reversedCents: 870 }), later)).toBe(
      'REVERSED'
    );
  });

  it('stays approved after a partial reversal', () => {
    expect(
      service.deriveStatus(
        row({ reversedCents: 100 }),
        new Date('2026-12-01T00:00:00Z')
      )
    ).toBe('APPROVED');
  });
});

describe('overview', () => {
  it('sums by status, anonymises customers and builds the links', async () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    const { service, repository } = setup();
    repository.getProfileByUserId.mockResolvedValue({
      id: 'p1',
      code: 'friend',
      customCodeSet: false,
      payoutEmail: null,
    });
    repository.sumPending.mockResolvedValue({
      onHold: { amountCents: 1000, reversedCents: 100 },
      approved: { amountCents: 2000, reversedCents: null },
    });
    repository.sumByStatus.mockResolvedValue({
      amountCents: 500,
      reversedCents: 0,
    });
    repository.sumReversed.mockResolvedValue(100);
    repository.listCommissions.mockResolvedValue([
      {
        id: 'c1',
        organizationId: 'org1',
        invoicePaidAt: new Date('2020-01-01T00:00:00Z'),
        amountCents: 870,
        reversedCents: 0,
        currency: 'usd',
        status: 'PENDING',
      },
    ]);
    repository.getOrganizationNames.mockResolvedValue([
      { id: 'org1', name: 'Acme Corp' },
    ]);

    const overview = await service.getOverview('u1');

    expect(overview.stats).toMatchObject({
      pendingCents: 900,
      approvedCents: 2000,
      paidCents: 500,
      reversedCents: 100,
    });
    expect(overview.commissions[0]).toMatchObject({
      organization: 'Ac***',
      status: 'APPROVED',
    });
    expect(JSON.stringify(overview.commissions)).not.toContain('Acme');
    expect(overview.links).toEqual({
      landing: 'https://postdelegate.com/?ref=friend',
      register: 'https://app.example.com/auth?ref=friend',
    });
    expect(overview.terms).toEqual({
      commissionPercent: 30,
      commissionMonths: 12,
      holdDays: 30,
      cookieDays: 60,
      minPayoutUsd: 50,
    });
  });
});

describe('payouts', () => {
  it('groups approved unpaid commissions per affiliate, net of reversals', async () => {
    const { service, repository } = setup();
    repository.listPayableCommissions.mockResolvedValue([
      { id: 'c1', affiliateId: 'p1', amountCents: 3000, reversedCents: 0 },
      { id: 'c2', affiliateId: 'p1', amountCents: 3000, reversedCents: 1000 },
      { id: 'c3', affiliateId: 'p2', amountCents: 1000, reversedCents: 0 },
    ]);
    repository.getProfilesWithUser.mockResolvedValue([
      {
        id: 'p2',
        code: 'two',
        payoutEmail: null,
        user: { email: 'two@example.com' },
      },
      {
        id: 'p1',
        code: 'one',
        payoutEmail: 'pay@example.com',
        user: { email: 'one@example.com' },
      },
    ]);

    expect(await service.listPayouts()).toEqual([
      {
        affiliateId: 'p1',
        code: 'one',
        userEmail: 'one@example.com',
        payoutEmail: 'pay@example.com',
        commissions: 2,
        totalCents: 5000,
        currency: 'usd',
        meetsMinimum: true,
      },
      {
        affiliateId: 'p2',
        code: 'two',
        userEmail: 'two@example.com',
        payoutEmail: null,
        commissions: 1,
        totalCents: 1000,
        currency: 'usd',
        meetsMinimum: false,
      },
    ]);
  });

  it('marks the commissions paid when the total matches', async () => {
    const { service, repository } = setup();
    repository.listPayableCommissions.mockResolvedValue([
      { id: 'c1', affiliateId: 'p1', amountCents: 3000, reversedCents: 0 },
      { id: 'c2', affiliateId: 'p1', amountCents: 3000, reversedCents: 1000 },
    ]);
    repository.markPaid.mockResolvedValue(2);

    expect(await service.markPaid('p1', 5000, ' PP-123 ')).toEqual({
      paid: 2,
      totalCents: 5000,
    });
    expect(repository.markPaid).toHaveBeenCalledWith(['c1', 'c2'], 'PP-123');
  });

  it('refuses when the payable total changed since the admin looked', async () => {
    const { service, repository } = setup();
    repository.listPayableCommissions.mockResolvedValue([
      { id: 'c1', affiliateId: 'p1', amountCents: 3000, reversedCents: 0 },
    ]);

    await expect(service.markPaid('p1', 5000)).rejects.toMatchObject({
      status: 409,
    });
    expect(repository.markPaid).not.toHaveBeenCalled();
  });

  it('refuses when nothing is payable', async () => {
    const { service, repository } = setup();
    repository.listPayableCommissions.mockResolvedValue([]);

    await expect(service.markPaid('p1', 100)).rejects.toMatchObject({
      status: 409,
    });
  });
});
