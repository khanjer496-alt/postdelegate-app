import { Injectable } from '@nestjs/common';
import { AffiliateCommissionStatus } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export interface CreateCommissionParams {
  affiliateId: string;
  organizationId: string;
  stripeInvoiceId: string;
  currency: string;
  invoiceNetCents: number;
  percent: number;
  amountCents: number;
  invoicePaidAt: Date;
}

@Injectable()
export class AffiliateRepository {
  constructor(
    private _profile: PrismaRepository<'affiliateProfile'>,
    private _commission: PrismaRepository<'affiliateCommission'>,
    private _organization: PrismaRepository<'organization'>,
    private _userOrganization: PrismaRepository<'userOrganization'>
  ) {}

  getProfileByUserId(userId: string) {
    return this._profile.model.affiliateProfile.findUnique({
      where: { userId },
    });
  }

  getProfileByCode(code: string) {
    return this._profile.model.affiliateProfile.findUnique({
      where: { code },
      include: { user: { select: { id: true, email: true } } },
    });
  }

  createProfile(userId: string, code: string) {
    return this._profile.model.affiliateProfile.create({
      data: { userId, code },
    });
  }

  // The vanity code can be set only once, the condition keeps two concurrent
  // requests from both winning
  async setCustomCode(userId: string, code: string) {
    const { count } = await this._profile.model.affiliateProfile.updateMany({
      where: { userId, customCodeSet: false },
      data: { code, customCodeSet: true },
    });
    return count === 1;
  }

  updatePayoutEmail(userId: string, payoutEmail: string | null) {
    return this._profile.model.affiliateProfile.update({
      where: { userId },
      data: { payoutEmail },
    });
  }

  getOrganizationReferral(organizationId: string) {
    return this._organization.model.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        referredByAffiliateId: true,
        referralFirstPaidAt: true,
      },
    });
  }

  getOrganizationReferralByPaymentId(paymentId: string) {
    return this._organization.model.organization.findFirst({
      where: { paymentId },
      select: {
        id: true,
        referredByAffiliateId: true,
        referralFirstPaidAt: true,
      },
    });
  }

  isUserInOrganization(userId: string, organizationId: string) {
    return this._userOrganization.model.userOrganization
      .findFirst({
        where: { userId, organizationId },
        select: { id: true },
      })
      .then((row) => !!row);
  }

  // First touch wins: an organization that already has a referrer is never
  // touched again
  async attributeOrganization(
    organizationId: string,
    affiliateId: string,
    code: string
  ) {
    const { count } = await this._organization.model.organization.updateMany({
      where: { id: organizationId, referredByAffiliateId: null },
      data: {
        referredByAffiliateId: affiliateId,
        referralCode: code,
        referredAt: new Date(),
      },
    });
    return count === 1;
  }

  // The commission window starts at the earliest paid invoice
  async setFirstPaidAt(organizationId: string, paidAt: Date) {
    await this._organization.model.organization.updateMany({
      where: {
        id: organizationId,
        OR: [
          { referralFirstPaidAt: null },
          { referralFirstPaidAt: { gt: paidAt } },
        ],
      },
      data: { referralFirstPaidAt: paidAt },
    });
  }

  getCommissionByInvoice(stripeInvoiceId: string) {
    return this._commission.model.affiliateCommission.findUnique({
      where: { stripeInvoiceId },
    });
  }

  // Unique on the Stripe invoice id, a retried webhook finds the row it made
  createCommission(data: CreateCommissionParams) {
    return this._commission.model.affiliateCommission.upsert({
      where: { stripeInvoiceId: data.stripeInvoiceId },
      create: data,
      update: {},
    });
  }

  updateCommissionReversal(
    id: string,
    reversedCents: number,
    status: AffiliateCommissionStatus
  ) {
    return this._commission.model.affiliateCommission.update({
      where: { id },
      data: { reversedCents, status },
    });
  }

  countReferredOrganizations(affiliateId: string) {
    return this._organization.model.organization.count({
      where: { referredByAffiliateId: affiliateId },
    });
  }

  countPayingOrganizations(affiliateId: string) {
    return this._organization.model.organization.count({
      where: {
        referredByAffiliateId: affiliateId,
        referralFirstPaidAt: { not: null },
      },
    });
  }

  // Sums of the pending rows that are still on hold (paid after the cutoff)
  // or already approved (paid on or before it)
  async sumPending(affiliateId: string, holdCutoff: Date) {
    const sum = (invoicePaidAt: { gt: Date } | { lte: Date }) =>
      this._commission.model.affiliateCommission.aggregate({
        where: {
          affiliateId,
          status: AffiliateCommissionStatus.PENDING,
          invoicePaidAt,
        },
        _sum: { amountCents: true, reversedCents: true },
      });

    const [onHold, approved] = await Promise.all([
      sum({ gt: holdCutoff }),
      sum({ lte: holdCutoff }),
    ]);
    return { onHold: onHold._sum, approved: approved._sum };
  }

  async sumByStatus(affiliateId: string, status: AffiliateCommissionStatus) {
    const result = await this._commission.model.affiliateCommission.aggregate({
      where: { affiliateId, status },
      _sum: { amountCents: true, reversedCents: true },
    });
    return result._sum;
  }

  async sumReversed(affiliateId: string) {
    const result = await this._commission.model.affiliateCommission.aggregate({
      where: { affiliateId },
      _sum: { reversedCents: true },
    });
    return result._sum.reversedCents || 0;
  }

  listCommissions(affiliateId: string, take: number) {
    return this._commission.model.affiliateCommission.findMany({
      where: { affiliateId },
      orderBy: { invoicePaidAt: 'desc' },
      take,
    });
  }

  getOrganizationNames(ids: string[]) {
    return this._organization.model.organization.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
  }

  // Unpaid commissions that left the hold period
  listPayableCommissions(holdCutoff: Date, affiliateId?: string) {
    return this._commission.model.affiliateCommission.findMany({
      where: {
        ...(affiliateId ? { affiliateId } : {}),
        status: AffiliateCommissionStatus.PENDING,
        invoicePaidAt: { lte: holdCutoff },
      },
      select: {
        id: true,
        affiliateId: true,
        amountCents: true,
        reversedCents: true,
      },
    });
  }

  getProfilesWithUser(ids: string[]) {
    return this._profile.model.affiliateProfile.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        code: true,
        payoutEmail: true,
        user: { select: { email: true } },
      },
    });
  }

  async markPaid(ids: string[], reference: string | null) {
    const { count } = await this._commission.model.affiliateCommission.updateMany(
      {
        where: { id: { in: ids }, status: AffiliateCommissionStatus.PENDING },
        data: {
          status: AffiliateCommissionStatus.PAID,
          paidAt: new Date(),
          paymentReference: reference,
        },
      }
    );
    return count;
  }
}
