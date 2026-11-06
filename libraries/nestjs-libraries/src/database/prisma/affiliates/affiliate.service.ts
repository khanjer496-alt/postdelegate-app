import { HttpException, Injectable } from '@nestjs/common';
import { AffiliateCommissionStatus, Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import { randomInt } from 'crypto';
import { AffiliateRepository } from '@gitroom/nestjs-libraries/database/prisma/affiliates/affiliate.repository';
import { getAffiliateConfig } from '@gitroom/nestjs-libraries/database/prisma/affiliates/affiliate.config';
import {
  AFFILIATE_CODE_REGEX,
  parseAffiliateCookieValue,
  parseReferralCode,
} from '@gitroom/helpers/affiliate/affiliate.cookie';

// Without 0/o/1/l/i, a code can be read aloud and typed by hand
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const GENERATED_CODE_LENGTH = 8;
const COMMISSIONS_LIMIT = 100;

// Words that would look official or collide with routes
const RESERVED_CODES = [
  'admin',
  'api',
  'app',
  'auth',
  'billing',
  'support',
  'postdelegate',
  'postiz',
  'affiliate',
  'affiliates',
  'null',
  'undefined',
];

export type AffiliateCommissionDisplayStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'PAID'
  | 'REVERSED';

export interface InvoicePaymentFacts {
  invoiceId: string;
  customerId: string;
  amountPaidCents: number;
  totalCents: number;
  taxCents: number;
  currency: string;
  paidAt: Date;
}

export interface CommissionReversalFacts {
  invoiceId: string;
  reversedCents: number;
  chargedCents: number;
}

// The same mailbox written with a plus tag is still the same person
const mailbox = (email: string) => {
  const [local, domain] = (email || '').toLowerCase().split('@');
  return `${(local || '').split('+')[0]}@${domain || ''}`;
};

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

@Injectable()
export class AffiliateService {
  constructor(private _affiliateRepository: AffiliateRepository) {}

  private holdCutoff(now = new Date()) {
    return dayjs(now).subtract(getAffiliateConfig().holdDays, 'day').toDate();
  }

  // pending to approved is not stored, it follows from the invoice date
  deriveStatus(
    commission: {
      status: AffiliateCommissionStatus;
      invoicePaidAt: Date;
      amountCents: number;
      reversedCents: number;
    },
    now = new Date()
  ): AffiliateCommissionDisplayStatus {
    if (commission.status === AffiliateCommissionStatus.PAID) {
      return 'PAID';
    }
    if (
      commission.status === AffiliateCommissionStatus.REVERSED ||
      commission.reversedCents >= commission.amountCents
    ) {
      return 'REVERSED';
    }
    return commission.invoicePaidAt <= this.holdCutoff(now)
      ? 'APPROVED'
      : 'PENDING';
  }

  private generateCode() {
    let code = '';
    for (let i = 0; i < GENERATED_CODE_LENGTH; i += 1) {
      code += CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length));
    }
    return code;
  }

  // The profile and its code are created the first time the user opens the page
  async getOrCreateProfile(userId: string) {
    const existing = await this._affiliateRepository.getProfileByUserId(userId);
    if (existing) {
      return existing;
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await this._affiliateRepository.createProfile(
          userId,
          this.generateCode()
        );
      } catch (err) {
        if (!isUniqueViolation(err)) {
          throw err;
        }

        // two requests of the same user, or a code collision
        const created = await this._affiliateRepository.getProfileByUserId(
          userId
        );
        if (created) {
          return created;
        }
      }
    }

    throw new HttpException('Could not create the affiliate code', 500);
  }

  async setCustomCode(userId: string, rawCode: string) {
    const code = (rawCode || '').trim().toLowerCase();
    if (!AFFILIATE_CODE_REGEX.test(code) || RESERVED_CODES.includes(code)) {
      throw new HttpException('This code is not available', 400);
    }

    const profile = await this.getOrCreateProfile(userId);
    if (profile.customCodeSet) {
      throw new HttpException('The custom code was already chosen', 400);
    }

    if (await this._affiliateRepository.getProfileByCode(code)) {
      throw new HttpException('This code is not available', 400);
    }

    let updated: boolean;
    try {
      updated = await this._affiliateRepository.setCustomCode(userId, code);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new HttpException('This code is not available', 400);
      }
      throw err;
    }

    if (!updated) {
      throw new HttpException('The custom code was already chosen', 400);
    }

    return { code };
  }

  async updatePayoutEmail(userId: string, payoutEmail?: string) {
    await this.getOrCreateProfile(userId);
    const updated = await this._affiliateRepository.updatePayoutEmail(
      userId,
      payoutEmail ? payoutEmail.trim() : null
    );
    return { payoutEmail: updated.payoutEmail };
  }

  async getOverview(userId: string) {
    const config = getAffiliateConfig();
    const profile = await this.getOrCreateProfile(userId);
    const now = new Date();
    const cutoff = this.holdCutoff(now);

    const [signups, payingCustomers, pending, paid, reversedCents, rows] =
      await Promise.all([
        this._affiliateRepository.countReferredOrganizations(profile.id),
        this._affiliateRepository.countPayingOrganizations(profile.id),
        this._affiliateRepository.sumPending(profile.id, cutoff),
        this._affiliateRepository.sumByStatus(
          profile.id,
          AffiliateCommissionStatus.PAID
        ),
        this._affiliateRepository.sumReversed(profile.id),
        this._affiliateRepository.listCommissions(
          profile.id,
          COMMISSIONS_LIMIT
        ),
      ]);

    const net = (sum: {
      amountCents: number | null;
      reversedCents: number | null;
    }) => (sum.amountCents || 0) - (sum.reversedCents || 0);

    const organizations = await this._affiliateRepository.getOrganizationNames(
      rows.map((row) => row.organizationId)
    );
    const names = new Map(organizations.map((org) => [org.id, org.name]));

    return {
      code: profile.code,
      customCodeSet: profile.customCodeSet,
      payoutEmail: profile.payoutEmail,
      links: {
        landing: `${
          process.env.AFFILIATE_LINK_BASE_URL || 'https://postdelegate.com'
        }/?ref=${profile.code}`,
        register: `${process.env.FRONTEND_URL}/auth?ref=${profile.code}`,
      },
      terms: config,
      stats: {
        signups,
        payingCustomers,
        currency: 'usd',
        pendingCents: net(pending.onHold),
        approvedCents: net(pending.approved),
        paidCents: net(paid),
        reversedCents,
      },
      commissions: rows.map((row) => ({
        id: row.id,
        date: row.invoicePaidAt,
        organization: this.anonymise(names.get(row.organizationId)),
        amountCents: row.amountCents,
        reversedCents: row.reversedCents,
        currency: row.currency,
        status: this.deriveStatus(row, now),
      })),
    };
  }

  private anonymise(name?: string) {
    const letters = Array.from((name || '').trim()).slice(0, 2).join('');
    return letters ? `${letters}***` : '***';
  }

  // Attaches the referrer of the cookie to a freshly registered organization.
  // Never throws: a broken referral must not break a registration.
  async attributeOrganization(params: {
    organizationId: string;
    userId: string;
    email: string;
    cookie?: string;
    // the ?ref= code sent with the sign-up when there is no consented cookie
    code?: string;
  }) {
    try {
      const code =
        parseAffiliateCookieValue(
          params.cookie,
          getAffiliateConfig().cookieDays
        ) || parseReferralCode(params.code);
      if (!code) {
        return false;
      }

      const referrer = await this._affiliateRepository.getProfileByCode(code);
      if (!referrer) {
        return false;
      }

      if (
        referrer.userId === params.userId ||
        mailbox(referrer.user.email) === mailbox(params.email) ||
        (await this._affiliateRepository.isUserInOrganization(
          referrer.userId,
          params.organizationId
        ))
      ) {
        return false;
      }

      return await this._affiliateRepository.attributeOrganization(
        params.organizationId,
        referrer.id,
        referrer.code
      );
    } catch (err) {
      console.error(
        'affiliate_attribution_failed',
        { organization_id: params.organizationId },
        err
      );
      return false;
    }
  }

  // Idempotent on the invoice: a retried webhook returns the same commission
  async recordInvoicePayment(invoice: InvoicePaymentFacts) {
    if (invoice.amountPaidCents <= 0) {
      return null;
    }

    // plans are billed in dollars and so is the payout threshold
    if (invoice.currency.toLowerCase() !== 'usd') {
      return null;
    }

    const organization =
      await this._affiliateRepository.getOrganizationReferralByPaymentId(
        invoice.customerId
      );
    if (!organization?.referredByAffiliateId) {
      return null;
    }

    const existing = await this._affiliateRepository.getCommissionByInvoice(
      invoice.invoiceId
    );
    if (existing) {
      return existing;
    }

    const config = getAffiliateConfig();
    const firstPaidAt = organization.referralFirstPaidAt;
    const windowStart =
      !firstPaidAt || invoice.paidAt < firstPaidAt ? invoice.paidAt : firstPaidAt;
    if (windowStart !== firstPaidAt) {
      await this._affiliateRepository.setFirstPaidAt(
        organization.id,
        windowStart
      );
    }

    if (
      !dayjs(invoice.paidAt).isBefore(
        dayjs(windowStart).add(config.commissionMonths, 'month')
      )
    ) {
      return null;
    }

    const netCents = this.netOfTax(invoice);
    const amountCents = Math.floor((netCents * config.commissionPercent) / 100);
    if (amountCents <= 0) {
      return null;
    }

    return this._affiliateRepository.createCommission({
      affiliateId: organization.referredByAffiliateId,
      organizationId: organization.id,
      stripeInvoiceId: invoice.invoiceId,
      currency: invoice.currency.toLowerCase(),
      invoiceNetCents: netCents,
      percent: config.commissionPercent,
      amountCents,
      invoicePaidAt: invoice.paidAt,
    });
  }

  // What was really paid minus the tax share of the invoice
  private netOfTax(invoice: InvoicePaymentFacts) {
    if (invoice.totalCents <= 0 || invoice.taxCents <= 0) {
      return invoice.amountPaidCents;
    }

    const taxFree = Math.max(invoice.totalCents - invoice.taxCents, 0);
    return Math.min(
      invoice.amountPaidCents,
      Math.round((invoice.amountPaidCents * taxFree) / invoice.totalCents)
    );
  }

  // A refund or a chargeback takes back the same share of the commission as
  // of the payment. Reversals only grow, so a repeated event changes nothing.
  async reverseCommission(reversal: CommissionReversalFacts) {
    const commission = await this._affiliateRepository.getCommissionByInvoice(
      reversal.invoiceId
    );
    if (!commission || reversal.chargedCents <= 0) {
      return null;
    }

    const share = Math.min(reversal.reversedCents / reversal.chargedCents, 1);
    const reversedCents = Math.max(
      commission.reversedCents,
      Math.min(
        Math.round(commission.amountCents * share),
        commission.amountCents
      )
    );
    if (reversedCents === commission.reversedCents) {
      return commission;
    }

    // a commission that was already paid stays PAID, the clawback shows in
    // reversedCents
    const status =
      commission.status === AffiliateCommissionStatus.PENDING &&
      reversedCents >= commission.amountCents
        ? AffiliateCommissionStatus.REVERSED
        : commission.status;

    return this._affiliateRepository.updateCommissionReversal(
      commission.id,
      reversedCents,
      status
    );
  }

  // Super admin: approved and unpaid commissions per affiliate
  async listPayouts() {
    const config = getAffiliateConfig();
    const rows = await this._affiliateRepository.listPayableCommissions(
      this.holdCutoff()
    );

    const totals = new Map<string, { totalCents: number; count: number }>();
    for (const row of rows) {
      const current = totals.get(row.affiliateId) || {
        totalCents: 0,
        count: 0,
      };
      current.totalCents += row.amountCents - row.reversedCents;
      current.count += 1;
      totals.set(row.affiliateId, current);
    }

    const profiles = await this._affiliateRepository.getProfilesWithUser([
      ...totals.keys(),
    ]);

    return profiles
      .map((profile) => {
        const total = totals.get(profile.id)!;
        return {
          affiliateId: profile.id,
          code: profile.code,
          userEmail: profile.user.email,
          payoutEmail: profile.payoutEmail,
          commissions: total.count,
          totalCents: total.totalCents,
          currency: 'usd',
          meetsMinimum: total.totalCents >= config.minPayoutUsd * 100,
        };
      })
      .filter((row) => row.totalCents > 0)
      .sort((a, b) => b.totalCents - a.totalCents);
  }

  async markPaid(
    affiliateId: string,
    expectedAmountCents: number,
    reference?: string
  ) {
    const rows = await this._affiliateRepository.listPayableCommissions(
      this.holdCutoff(),
      affiliateId
    );
    const totalCents = rows.reduce(
      (sum, row) => sum + row.amountCents - row.reversedCents,
      0
    );

    if (!rows.length || totalCents !== expectedAmountCents) {
      throw new HttpException('The payable total changed, reload the list', 409);
    }

    const paid = await this._affiliateRepository.markPaid(
      rows.map((row) => row.id),
      reference?.trim() || null
    );
    return { paid, totalCents };
  }
}
