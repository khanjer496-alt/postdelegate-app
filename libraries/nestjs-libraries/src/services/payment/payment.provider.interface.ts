import { HttpException, Injectable } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { BillingSubscribeDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import { AdminApplyCouponDto } from '@gitroom/nestjs-libraries/dtos/billing/admin.apply.coupon.dto';

export type PaymentPlatform = 'web' | 'mobile';

// One row of the billing history, in a provider neutral shape
export interface PaymentInvoice {
  id: string;
  number: string | null;
  // pricing key and MONTHLY / YEARLY the invoice was for, when the provider knows it
  tier: string | null;
  period: string | null;
  description: string | null;
  // minor units (cents)
  amount: number;
  currency: string;
  // unix seconds
  created: number;
  periodEnd: number;
  status: 'paid' | 'pending' | 'failed' | 'void';
  downloadUrl: string | null;
  viewUrl: string | null;
}

// Paying subscriptions of one plan and billing period, for the admin stats
export interface PaymentGrowthPlan {
  // pricing key (STANDARD, TEAM, PRO, ULTIMATE)
  tier: string;
  period: 'MONTHLY' | 'YEARLY';
  count: number;
  // monthly revenue after discounts, minor units (cents)
  mrr: number;
}

// Trials and revenue of the whole app as the provider has them, for the
// admin stats. "In the range" counts use the from / to dates, the others are
// the state right now
export interface PaymentGrowthStats {
  supported: boolean;
  currency: string | null;
  // trials started in the range
  trialsStarted: number;
  // trials running now, and how many of them have a payment method
  trialsRunning: number;
  trialsRunningWithCard: number;
  // trials that ended in the range: became paid / ended without paying
  trialsConverted: number;
  trialsExpired: number;
  // paid subscriptions now (a 100% coupon pays $0), per plan and period
  paying: number;
  payingByPlan: PaymentGrowthPlan[];
  // monthly recurring revenue now (yearly / 12), minor units (cents)
  mrr: number;
  // paid subscriptions that ended in the range (trials ending are not counted)
  cancellations: number;
  // paid subscriptions set to cancel at the end of their period, now
  cancelling: number;
  // subscriptions whose payment is failing now (past_due / unpaid), left out
  // of paying and the revenue
  paymentFailing: number;
}

export const emptyGrowthStats = (supported = false): PaymentGrowthStats => ({
  supported,
  currency: null,
  trialsStarted: 0,
  trialsRunning: 0,
  trialsRunningWithCard: 0,
  trialsConverted: 0,
  trialsExpired: 0,
  paying: 0,
  payingByPlan: [],
  mrr: 0,
  cancellations: 0,
  cancelling: 0,
  paymentFailing: 0,
});

// Every billing use-case goes through this contract. Webhooks and `platform`
// are mandatory; everything else has a default that says "not supported on
// this platform" so a provider only implements what its platform offers
// (e.g. app stores have no hosted checkout / portal / coupons).
export abstract class PaymentProviderAbstract {
  // Where the subscription is bought / managed. An organization can only be
  // subscribed on one platform at a time, the other platform is blocked.
  abstract platform: PaymentPlatform;

  // Turn the raw webhook request into a trusted event (throw on bad signature / secret)
  abstract validateWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>
  ): Promise<any> | any;

  // Apply a validated webhook event to our subscriptions
  abstract processWebhook(event: any): Promise<any>;

  protected notSupported(): never {
    throw new HttpException(
      `This action is not supported on ${this.platform}`,
      400
    );
  }

  // --- subscription lifecycle -------------------------------------------

  // Whether the organization's subscription is in its free trial right now,
  // as the provider has it (the stored isTrailing is also set for a renewal
  // being retried). A provider that can't tell says no, so a limit built on
  // it falls back to the plan's
  async isTrialing(organizationId: string): Promise<boolean> {
    return false;
  }

  // Client initiated re-check of the organization subscription against the
  // provider (mobile app after purchase / restore)
  async syncSubscription(organizationId: string): Promise<{ active: boolean }> {
    return this.notSupported();
  }

  // Hosted checkout page
  async subscribe(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ): Promise<any> {
    return this.notSupported();
  }

  // Embedded checkout (client secret rendered inside our page)
  async embedded(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ): Promise<any> {
    return this.notSupported();
  }

  // Free trial that starts without a payment method
  async startTrial(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto
  ): Promise<any> {
    return this.notSupported();
  }

  // Price difference preview when switching plans
  async prorate(
    organizationId: string,
    body: BillingSubscribeDto
  ): Promise<any> {
    return this.notSupported();
  }

  // Channels bought on top of the tier's channels, for tiers that sell them
  async getExtraChannels(organizationId: string): Promise<any> {
    return { available: false };
  }

  // Set the number of extra channels (the target quantity, not a delta)
  async setExtraChannels(
    organizationId: string,
    extraChannels: number
  ): Promise<any> {
    return this.notSupported();
  }

  // Toggle cancel-at-period-end
  async setToCancel(organizationId: string): Promise<any> {
    return this.notSupported();
  }

  // Cancel everything right now (account deletion). Must not throw when the
  // provider has nothing to cancel server side.
  async cancelAllSubscriptions(organizationId: string): Promise<any> {
    return this.notSupported();
  }

  // Self-service portal (payment method / invoices)
  async portalLink(organizationId: string): Promise<{ url: string }> {
    return this.notSupported();
  }

  // Page where the customer adds the payment method a trial converts with
  async addPaymentMethodLink(organizationId: string): Promise<{ url: string }> {
    return this.notSupported();
  }

  // Billing history (invoices) of the organization
  async getInvoices(organizationId: string): Promise<PaymentInvoice[]> {
    return this.notSupported();
  }

  // Unix seconds of the next charge (the trial end while trialing), null when
  // unknown. needsPaymentMethod: a trial that ends unless a card is added.
  async getRenewalDate(organizationId: string): Promise<{
    renewsAt: number | null;
    trialing: boolean;
    needsPaymentMethod: boolean;
  }> {
    return { renewsAt: null, trialing: false, needsPaymentMethod: false };
  }

  // Post-checkout poll: is this subscription id active for the org
  async checkSubscription(
    organizationId: string,
    subscriptionId: string
  ): Promise<any> {
    return this.notSupported();
  }

  // Available plans / prices
  async getPackages(): Promise<any> {
    return this.notSupported();
  }

  // --- trial & discounts --------------------------------------------------

  async finishTrial(organization: Organization): Promise<any> {
    return this.notSupported();
  }

  async checkDiscount(organization: Organization): Promise<boolean> {
    return false;
  }

  async applyDiscount(organization: Organization): Promise<any> {
    return this.notSupported();
  }

  async lifetimeDeal(organizationId: string, code: string): Promise<any> {
    return this.notSupported();
  }

  // --- admin --------------------------------------------------------------

  async getCharges(organizationId: string): Promise<any> {
    return this.notSupported();
  }

  async refundCharges(
    organizationId: string,
    chargeIds: string[]
  ): Promise<any> {
    return this.notSupported();
  }

  async cancelSubscription(organizationId: string): Promise<any> {
    return this.notSupported();
  }

  async getCouponInfo(organizationId: string): Promise<any> {
    return this.notSupported();
  }

  async applyCoupon(
    organizationId: string,
    body: AdminApplyCouponDto
  ): Promise<any> {
    return this.notSupported();
  }

  async cancelCoupon(organizationId: string): Promise<any> {
    return this.notSupported();
  }

  // Trials, paying subscriptions and revenue of the whole app. A provider
  // that can't list them says so instead of throwing, so the stats page
  // still renders
  async getGrowthStats(from: Date, to: Date): Promise<PaymentGrowthStats> {
    return emptyGrowthStats();
  }

  // After a login swap, keep the provider's customer email in sync (no-op by default)
  async syncCustomerEmailsAfterSwitch(
    accounts: { id: string; email: string }[]
  ): Promise<void> {}
}

export interface PaymentProviderParams {
  provider: string;
}

export function PaymentProvider(params: PaymentProviderParams) {
  return function (target: any) {
    Injectable()(target);

    const existingMetadata =
      Reflect.getMetadata('payment-provider', PaymentProviderAbstract) || [];

    existingMetadata.push({ target, provider: params.provider });

    Reflect.defineMetadata(
      'payment-provider',
      existingMetadata,
      PaymentProviderAbstract
    );
  };
}
