import Stripe from 'stripe';
import { BadRequestException } from '@nestjs/common';
import { Organization, User } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { BillingSubscribeDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import { escape, groupBy } from 'lodash';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { AffiliateService } from '@gitroom/nestjs-libraries/database/prisma/affiliates/affiliate.service';
import {
  PaymentInvoice,
  PaymentPlatform,
  PaymentProvider,
  PaymentProviderAbstract,
} from '@gitroom/nestjs-libraries/services/payment/payment.provider.interface';

import { STRIPE_PROVIDER } from '@gitroom/nestjs-libraries/services/payment/payment.providers';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import dayjs from 'dayjs';
import { emailButton } from '@gitroom/nestjs-libraries/services/email.service';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_nothing');

// Resolve the Stripe price of a tier by its lookup_key (postdelegate_<slug>_<month|year>),
// falling back to finding/creating the product and price by name for accounts without them
export async function resolveTierPrice(
  client: Stripe,
  billing: string,
  period: 'MONTHLY' | 'YEARLY'
): Promise<Stripe.Price> {
  const priceData = pricing[billing];
  const interval = period === 'MONTHLY' ? 'month' : 'year';
  const unitAmount =
    (period === 'MONTHLY' ? priceData.month_price : priceData.year_price) * 100;

  if (priceData.slug) {
    const lookupKey = `postdelegate_${priceData.slug}_${interval}`;
    const byLookupKey = await client.prices.list({
      lookup_keys: [lookupKey],
      active: true,
    });
    const found = byLookupKey.data[0];
    if (found && found.unit_amount === unitAmount) {
      return found;
    }
    console.warn('stripe_lookup_key_price_unusable', {
      lookup_key: lookupKey,
      found: !!found,
      expected_amount: unitAmount,
      found_amount: found?.unit_amount,
    });
  }

  const allProducts = await client.products.list({
    active: true,
    expand: ['data.prices'],
  });

  const findProduct =
    allProducts.data.find(
      (product) => product.name.toUpperCase() === billing.toUpperCase()
    ) ||
    (await client.products.create({
      active: true,
      name: billing,
    }));

  const pricesList = await client.prices.list({
    active: true,
    product: findProduct!.id,
  });

  return (
    pricesList.data.find(
      (p) =>
        p?.recurring?.interval?.toLowerCase() === interval &&
        p?.unit_amount === unitAmount
    ) ||
    (await client.prices.create({
      active: true,
      product: findProduct!.id,
      currency: 'usd',
      nickname: billing + ' ' + period,
      unit_amount: unitAmount,
      recurring: {
        interval,
      },
    }))
  );
}

// Events that are not created by our own Stripe objects, so they carry no
// metadata.service. Invoices feed the pixel and the affiliate commissions, the
// charge events reverse commissions. Anything unrelated to a commission is
// ignored further down.
const EVENTS_WITHOUT_SERVICE_METADATA: string[] = [
  'invoice.payment_succeeded',
  'charge.refunded',
  'charge.dispute.created',
];

// Subscription statuses that must not keep granting a paid tier
const NOT_ENTITLED_STATUSES: Stripe.Subscription.Status[] = [
  'unpaid',
  'canceled',
  'incomplete_expired',
];

export const TRIAL_DAYS = 7;

// A trial started without a card is canceled by Stripe when it ends, unless a
// card was added before
export function isCardlessTrial(subscription: Stripe.Subscription) {
  return (
    subscription.status === 'trialing' &&
    subscription.trial_settings?.end_behavior?.missing_payment_method ===
      'cancel'
  );
}

const EMAIL_FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// What a card keeps going and what the plans cost, added to the trial ending
// reminder email. Prices come from the pricing config; with a discount on the
// subscription the list price would be wrong, so the plan line says so instead.
export const trialEndsSoonDetails = (
  tier: string | undefined,
  period: string | undefined,
  discounted: boolean,
  app = process.env.FRONTEND_URL || ''
) => {
  const plans = Object.values(pricing).filter(
    (plan) => plan.month_price > 0 && plan.label
  );
  const current = tier ? pricing[tier] : undefined;
  const yearly = period === 'YEARLY';
  const cell = `background:#f7f6fb;border:1px solid #e7e5ef;padding:10px 14px;font-family:${EMAIL_FONT}`;

  const html: string[] = [
    `<h2 class="pd-text" style="margin:28px 0 12px;font-family:${EMAIL_FONT};font-size:16px;font-weight:700;line-height:1.35;color:#0d0d0d">What a card keeps going</h2>`,
    `<ul style="margin:0 0 16px;padding-left:22px"><li style="margin:0 0 6px">Your connected channels stay on.</li><li style="margin:0 0 6px">Scheduled posts keep publishing at their planned times.</li></ul>`,
    `<p style="margin:0 0 16px">Without a card, publishing stops when the trial ends and your channels are switched off. Your posts and drafts are kept, so choosing a plan later picks up where you left off.</p>`,
  ];

  if (current?.label && current.month_price > 0) {
    html.push(
      discounted
        ? `<p style="margin:0 0 16px">Your <strong>${escape(
            current.label
          )}</strong> plan has a discount, so you'll pay less than the list price below. Billing shows the exact amount.</p>`
        : `<p style="margin:0 0 16px">Your plan is <strong>${escape(
            current.label
          )}</strong> at $${yearly ? current.year_price : current.month_price} a ${
            yearly ? 'year' : 'month'
          }.</p>`
    );
  }

  html.push(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;border-collapse:separate;border-spacing:0 6px">${plans
      .map(
        (plan) =>
          `<tr><td class="pd-item" style="${cell};border-right:0;border-radius:12px 0 0 12px;font-size:14px;font-weight:${
            plan.current === current?.current ? 700 : 400
          };color:#0d0d0d"><span class="pd-text">${escape(
            plan.label!
          )}</span></td><td class="pd-item" style="${cell};border-left:0;border-right:0;font-size:13px;color:#7a7a88"><span class="pd-muted">${
            plan.channel || 0
          } channels</span></td><td class="pd-item" align="right" style="${cell};border-left:0;border-radius:0 12px 12px 0;font-size:14px;color:#0d0d0d;white-space:nowrap"><span class="pd-text">$${
            plan.month_price
          } / month</span></td></tr>`
      )
      .join('')}</table>`,
    `<p class="pd-muted" style="margin:16px 0 0;font-family:${EMAIL_FONT};font-size:13px;line-height:1.6;color:#7a7a88">List prices in US dollars. Yearly billing costs less, and you can switch plans in <a href="${escape(
      `${app}/billing`
    )}" target="_blank">Billing</a> at any time.</p>`
  );

  return html.join('');
};

@PaymentProvider({ provider: STRIPE_PROVIDER })
export class StripeService extends PaymentProviderAbstract {
  platform: PaymentPlatform = 'web';

  constructor(
    private _subscriptionService: SubscriptionService,
    private _organizationService: OrganizationService,
    private _userService: UsersService,
    private _trackService: TrackService,
    private _affiliateService: AffiliateService,
    private _notificationService: NotificationService
  ) {
    super();
  }
  validateRequest(rawBody: Buffer, signature: string, endpointSecret: string) {
    return stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);
  }

  validateWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>
  ) {
    return this.validateRequest(
      rawBody,
      headers['stripe-signature'] as string,
      process.env.STRIPE_SIGNING_KEY
    );
  }

  async processWebhook(event: Stripe.Event) {
    // Maybe it comes from another stripe webhook
    if (
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      event?.data?.object?.metadata?.service !== 'gitroom' &&
      !EVENTS_WITHOUT_SERVICE_METADATA.includes(event.type)
    ) {
      return { ok: true };
    }

    switch (event.type) {
      case 'invoice.payment_succeeded':
        return this.paymentSucceeded(event);
      case 'customer.subscription.created':
        return this.createSubscription(event);
      case 'customer.subscription.updated':
        return this.updateSubscription(event);
      case 'customer.subscription.deleted':
        return this.deleteSubscription(event);
      case 'customer.subscription.trial_will_end':
        return this.trialWillEnd(event);
      case 'charge.refunded':
        return this.chargeRefunded(event);
      case 'charge.dispute.created':
        return this.chargeDisputed(event);
      default:
        return { ok: true };
    }
  }

  async checkValidCard(
    event:
      | Stripe.CustomerSubscriptionCreatedEvent
      | Stripe.CustomerSubscriptionUpdatedEvent
  ) {
    if (event.data.object.status === 'incomplete') {
      return false;
    }

    // only a trial needs the card checked, a paid subscription already charged it
    if (event.data.object.status !== 'trialing') {
      return true;
    }

    const getOrgFromCustomer =
      await this._organizationService.getOrgByCustomerId(
        event.data.object.customer as string
      );

    if (!getOrgFromCustomer?.allowTrial) {
      return true;
    }

    console.log('Checking card');

    const paymentMethods = await stripe.paymentMethods.list({
      customer: event.data.object.customer as string,
    });

    // find the last one created
    const latestMethod = paymentMethods.data.reduce(
      (prev, current) => {
        if (prev.created < current.created) {
          return current;
        }
        return prev;
      },
      { created: -100 } as Stripe.PaymentMethod
    );

    if (!latestMethod.id) {
      // A trial started without a card is fine, Stripe cancels it when it
      // ends unless a card was added by then
      return isCardlessTrial(event.data.object);
    }

    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 100,
        currency: 'usd',
        payment_method: latestMethod.id,
        customer: event.data.object.customer as string,
        off_session: true,
        capture_method: 'manual', // Authorize without capturing
        confirm: true, // Confirm the PaymentIntent
      });

      if (paymentIntent.status !== 'requires_capture') {
        console.error('Cant charge');
        await stripe.paymentMethods.detach(paymentMethods.data[0].id);
        await stripe.subscriptions.cancel(event.data.object.id as string);
        return false;
      }

      await stripe.paymentIntents.cancel(paymentIntent.id as string);
      return true;
    } catch (err) {
      try {
        await stripe.paymentMethods.detach(paymentMethods.data[0].id);
        await stripe.subscriptions.cancel(event.data.object.id as string);
      } catch (err) {
        /*dont do anything*/
      }
      return false;
    }
  }

  async createSubscription(event: Stripe.CustomerSubscriptionCreatedEvent) {
    const { uniqueId, billing, period } = event.data.object.metadata as {
      billing: 'STANDARD' | 'PRO';
      period: 'MONTHLY' | 'YEARLY';
      uniqueId: string;
    };

    const liveSubscriptions = await this.getLiveSubscriptions(
      event.data.object.customer as string
    );
    const isDuplicate = liveSubscriptions.some(
      (f) =>
        f.id !== event.data.object.id &&
        (f.created < event.data.object.created ||
          (f.created === event.data.object.created &&
            f.id < event.data.object.id))
    );
    if (isDuplicate) {
      if (liveSubscriptions.some((f) => f.id === event.data.object.id)) {
        await stripe.subscriptions.cancel(event.data.object.id);
      }
      console.log('stripe_duplicate_subscription_cancelled', {
        stripe_event_type: event.type,
        stripe_event_id: event.id,
        stripe_subscription_id: event.data.object.id,
      });
      return { ok: true };
    }

    try {
      const check = await this.checkValidCard(event);
      if (!check) {
        return { ok: false };
      }
    } catch (err) {
      return { ok: false };
    }

    const result = await this._subscriptionService.createOrUpdateSubscription(
      STRIPE_PROVIDER,
      event.data.object.status !== 'active',
      uniqueId,
      event.data.object.customer as string,
      pricing[billing].channel!,
      billing,
      period,
      event.data.object.cancel_at
    );

    if (isCardlessTrial(event.data.object)) {
      await this.notifyTrialStarted(event.data.object).catch((err) => {
        console.error('stripe_trial_started_notice_failed', err);
      });
    }

    if (event.data.object.status === 'trialing') {
      this.trackSubscription(
        event.data.object.metadata,
        event.data.object.id,
        TrackEnum.StartTrial,
        {
          value:
            pricing[billing][
              period === 'YEARLY' ? 'year_price' : 'month_price'
            ],
        }
      ).catch((err) => {});
    }

    return result;
  }
  async updateSubscription(event: Stripe.CustomerSubscriptionUpdatedEvent) {
    // Stripe keeps past_due while it retries a failed renewal (the grace period),
    // but unpaid / canceled / incomplete_expired mean the dunning is over
    if (NOT_ENTITLED_STATUSES.includes(event.data.object.status)) {
      return this.deleteSubscription(event);
    }

    const { uniqueId, billing, period } = event.data.object.metadata as {
      billing: 'STANDARD' | 'PRO';
      period: 'MONTHLY' | 'YEARLY';
      uniqueId: string;
    };

    const check = await this.checkValidCard(event);
    if (!check) {
      return { ok: false };
    }

    return this._subscriptionService.createOrUpdateSubscription(
      STRIPE_PROVIDER,
      event.data.object.status !== 'active',
      uniqueId,
      event.data.object.customer as string,
      pricing[billing].channel!,
      billing,
      period,
      event.data.object.cancel_at
    );
  }

  async deleteSubscription(
    event:
      | Stripe.CustomerSubscriptionDeletedEvent
      | Stripe.CustomerSubscriptionUpdatedEvent
  ) {
    const customer = event.data.object.customer as string;
    const [survivor] = (await this.getLiveSubscriptions(customer)).filter(
      (f) =>
        f.id !== event.data.object.id &&
        !NOT_ENTITLED_STATUSES.includes(f.status)
    );
    if (!survivor) {
      await this._subscriptionService.deleteSubscription(
        customer,
        STRIPE_PROVIDER
      );
      if (
        event.type === 'customer.subscription.deleted' &&
        this.isCardlessTrialEnded(event.data.object)
      ) {
        await this.notifyTrialEnded(customer).catch((err) => {
          console.error('stripe_trial_ended_notice_failed', err);
        });
      }
      return;
    }

    const { uniqueId, billing, period } = survivor.metadata as {
      billing: 'STANDARD' | 'PRO';
      period: 'MONTHLY' | 'YEARLY';
      uniqueId: string;
    };
    console.log('stripe_subscription_deleted_survivor_kept', {
      stripe_event_type: event.type,
      stripe_event_id: event.id,
      stripe_subscription_id: event.data.object.id,
      stripe_survivor_id: survivor.id,
      outcome: pricing[billing] && period ? 'resynced' : 'metadata_missing',
    });
    if (!pricing[billing] || !period) {
      return;
    }

    return this._subscriptionService.createOrUpdateSubscription(
      STRIPE_PROVIDER,
      survivor.status !== 'active',
      uniqueId,
      customer,
      pricing[billing].channel!,
      billing,
      period,
      survivor.cancel_at
    );
  }

  // Stripe sends it 3 days before the trial ends. A trial without a card is
  // canceled when it ends, so ask the workspace to add one. It never fails the
  // webhook, a retry would send the reminder twice.
  async trialWillEnd(event: Stripe.CustomerSubscriptionTrialWillEndEvent) {
    try {
      // A retried event can be days old, so act on the subscription as it is now
      const subscription = await stripe.subscriptions.retrieve(
        event.data.object.id
      );
      const discountAdded = await this.applyTrialDiscount(subscription).catch(
        (err) => {
          console.error('stripe_trial_discount_failed', {
            stripe_event_id: event.id,
            stripe_subscription_id: subscription.id,
            err,
          });
          return false;
        }
      );

      if (!(await this.needsPaymentMethod(subscription))) {
        return { ok: true };
      }

      const org = await this._organizationService.getOrgByCustomerId(
        subscription.customer as string
      );
      if (!org) {
        return { ok: true };
      }

      await this.notifyBilling(
        org.id,
        'Your free trial ends soon',
        `Your PostDelegate free trial ends on ${dayjs
          .unix(subscription.trial_end!)
          .format('MMMM D, YYYY')}. Add a card in Settings > Billing (${
          process.env.FRONTEND_URL
        }/billing) to keep your plan. Without a card, your workspace is paused until you choose a plan.`,
        'Add a card',
        // the email also says what a card keeps and what the plans cost
        trialEndsSoonDetails(
          subscription.metadata?.billing,
          subscription.metadata?.period,
          // the subscription was read before the promotion was added
          discountAdded || !!subscription.discounts?.length
        )
      );
    } catch (err) {
      console.error('stripe_trial_will_end_failed', {
        stripe_event_id: event.id,
        stripe_subscription_id: event.data.object.id,
        err,
      });
    }
    return { ok: true };
  }

  private async notifyTrialStarted(subscription: Stripe.Subscription) {
    const org = await this._organizationService.getOrgByCustomerId(
      subscription.customer as string
    );
    if (!org) {
      return;
    }

    await this.notifyBilling(
      org.id,
      'Your free trial has started',
      `Welcome to PostDelegate! Your ${TRIAL_DAYS}-day free trial runs until ${dayjs
        .unix(subscription.trial_end!)
        .format(
          'MMMM D, YYYY'
        )}, no credit card needed. To keep your plan after that, add a card any time in Settings > Billing (${
        process.env.FRONTEND_URL
      }/billing).`,
      'Open Billing'
    );
  }

  // Billing notices: in-app for the whole workspace, by email only to the
  // admins, who are the ones that can add a card or choose a plan
  private async notifyBilling(
    orgId: string,
    subject: string,
    message: string,
    action: string,
    emailDetails = ''
  ) {
    await this._notificationService.inAppNotification(orgId, subject, message);
    await this._notificationService.sendEmailsToOrgAdmins(
      orgId,
      subject,
      message +
        emailDetails +
        emailButton(`${process.env.FRONTEND_URL}/billing`, action)
    );
  }

  // Canceled by Stripe at the end of a trial that had no card, not a paid
  // subscription that started as one and was canceled later
  private isCardlessTrialEnded(subscription: Stripe.Subscription) {
    return (
      subscription.trial_settings?.end_behavior?.missing_payment_method ===
        'cancel' &&
      !!subscription.trial_end &&
      !!subscription.ended_at &&
      subscription.ended_at >= subscription.trial_end &&
      subscription.ended_at - subscription.trial_end < 3600
    );
  }

  private async notifyTrialEnded(customer: string) {
    const org = await this._organizationService.getOrgByCustomerId(customer);
    if (!org) {
      return;
    }

    await this.notifyBilling(
      org.id,
      'Your free trial has ended',
      `Your PostDelegate free trial has ended and your workspace is paused. Your posts are kept: choose a plan in Settings > Billing (${process.env.FRONTEND_URL}/billing) to switch your channels back on and pick up where you left off.`,
      'Choose a plan'
    );
  }

  // A trial without a card that is not being canceled anyway
  private async needsPaymentMethod(subscription: Stripe.Subscription) {
    return (
      isCardlessTrial(subscription) &&
      !subscription.cancel_at_period_end &&
      !subscription.cancel_at &&
      !(await this.hasPaymentMethod(subscription))
    );
  }

  // Stripe charges the subscription default first, then the customer default
  private async hasPaymentMethod(subscription: Stripe.Subscription) {
    if (subscription.default_payment_method || subscription.default_source) {
      return true;
    }

    const customer = await stripe.customers.retrieve(
      subscription.customer as string
    );
    if (customer.deleted) {
      return false;
    }
    const { invoice_settings, default_source } = customer as Stripe.Customer;
    return !!(invoice_settings?.default_payment_method || default_source);
  }

  // After a login swap, move each Stripe customer's email to the login that
  // now owns it. Owner-only so a member's switch can't rewrite a shared org's
  // billing email, deduped per customer, and skipping admin-granted
  // subscriptions (their paymentId is a user id, not a `cus_...` customer).
  async syncCustomerEmailsAfterSwitch(
    accounts: { id: string; email: string }[]
  ) {
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return;
    }
    const emailByCustomer = new Map<string, string>();
    for (const account of accounts) {
      const organizations = await this._organizationService.getOrgsByUserId(
        account.id
      );
      for (const org of organizations) {
        if (
          org.users?.[0]?.role === 'SUPERADMIN' &&
          org.paymentId?.startsWith('cus_') &&
          !emailByCustomer.has(org.paymentId)
        ) {
          emailByCustomer.set(org.paymentId, account.email);
        }
      }
    }
    await Promise.all(
      [...emailByCustomer].map(([customerId, email]) =>
        stripe.customers
          .update(customerId, {
            email: email.indexOf('@') > -1 ? email : `${email}@postdelegate.com`,
          })
          .catch(() => {})
      )
    );
  }

  async createOrGetCustomer(organization: Organization) {
    if (organization.paymentId) {
      return organization.paymentId;
    }

    const users = await this._organizationService.getTeam(organization.id);
    const customer = await stripe.customers.create({
      email:
        users.users[0].user.email.indexOf('@') > -1
          ? users.users[0].user.email
          : `${users.users[0].user.email}@postdelegate.com`,
      name: organization.name,
    });
    await this._subscriptionService.updateCustomerId(
      organization.id,
      customer.id
    );
    return customer.id;
  }

  async getPackages() {
    const products = await stripe.prices.list({
      active: true,
      expand: ['data.tiers', 'data.product'],
      lookup_keys: [
        'standard_monthly',
        'standard_yearly',
        'pro_monthly',
        'pro_yearly',
      ],
    });

    const productsList = groupBy(
      products.data.map((p) => ({
        name: (p.product as Stripe.Product)?.name,
        recurring: p?.recurring?.interval!,
        price: p?.tiers?.[0]?.unit_amount! / 100,
      })),
      'recurring'
    );

    return { ...productsList };
  }

  async prorate(organizationId: string, body: BillingSubscribeDto) {
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const findPrice = await resolveTierPrice(stripe, body.billing, body.period);

    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
        })
      ).data.filter((f) => f.status === 'active' || f.status === 'trialing'),
    };

    try {
      const price = await stripe.invoices.createPreview({
        customer,
        subscription: currentUserSubscription?.data?.[0]?.id,
        subscription_details: {
          proration_behavior: 'always_invoice',
          items: [
            {
              id: currentUserSubscription?.data?.[0]?.items?.data?.[0]?.id,
              price: findPrice?.id!,
              quantity: 1,
            },
          ],
        },
      });

      return {
        price: price?.amount_due ? price?.amount_due / 100 : 0,
      };
    } catch (err) {
      console.error('Error calculating proration:', err);
      return { price: 0 };
    }
  }

  async getCustomerSubscriptions(organizationId: string) {
    const org = (await this._organizationService.getOrgById(organizationId))!;
    const customer = org.paymentId;
    return stripe.subscriptions.list({
      customer: customer!,
      status: 'all',
    });
  }

  private async getLiveSubscriptions(customer?: string | null) {
    if (!customer || !customer.startsWith('cus_')) {
      return [];
    }

    return (
      await stripe.subscriptions.list({
        customer,
        status: 'all',
        expand: ['data.latest_invoice'],
      })
    ).data.filter(
      (f) =>
        f.status !== 'canceled' &&
        f.status !== 'incomplete' &&
        f.status !== 'incomplete_expired'
    );
  }

  async setToCancel(organizationId: string) {
    const id = makeId(10);
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const subscriptions = await this.getLiveSubscriptions(customer);

    const sub = subscriptions[0];

    if (!sub) {
      throw new BadRequestException('No active subscription found');
    }

    // If the user is toggling back (un-cancelling), just remove the cancel
    if (sub.cancel_at_period_end) {
      let cancel_at: number | null = null;
      for (const s of subscriptions) {
        const updated = await stripe.subscriptions.update(s.id, {
          cancel_at_period_end: false,
          metadata: { service: 'gitroom', id },
        });
        cancel_at = cancel_at || updated.cancel_at;
      }
      await this._subscriptionService.updateCancelAt(organizationId, cancel_at);

      return {
        id,
        cancel_at: cancel_at ? new Date(cancel_at * 1000) : undefined,
      };
    }

    // Check if the latest invoice has a failed payment
    const latestInvoice = sub.latest_invoice as Stripe.Invoice | null;
    const hasFailedPayment =
      sub.status === 'past_due' ||
      latestInvoice?.status === 'open' ||
      latestInvoice?.status === 'uncollectible';

    if (hasFailedPayment) {
      // Payment already failed — cancel immediately and delete subscription
      for (const s of subscriptions) {
        await stripe.subscriptions.cancel(s.id);
      }
      await this._subscriptionService.deleteSubscription(
        customer,
        STRIPE_PROVIDER
      );

      return {
        id,
        cancel_at: new Date(),
      };
    }

    // Payment succeeded — cancel at end of billing period
    let cancel_at: number | null = null;
    for (const s of subscriptions) {
      const updated = await stripe.subscriptions.update(s.id, {
        cancel_at_period_end: true,
        metadata: { service: 'gitroom', id },
      });
      if (updated.cancel_at && (!cancel_at || updated.cancel_at < cancel_at)) {
        cancel_at = updated.cancel_at;
      }
    }
    await this._subscriptionService.updateCancelAt(organizationId, cancel_at);

    return {
      id,
      cancel_at: cancel_at ? new Date(cancel_at * 1000) : undefined,
    };
  }

  async cancelAllSubscriptions(organizationId: string) {
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return;
    }
    // getOrgById must not filter deletedAt, this can run for an organization
    // that was already soft deleted by an account deletion
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) {
      return;
    }

    const subscriptions = await stripe.subscriptions.list({
      customer: org.paymentId,
      status: 'all',
      limit: 100,
    });

    for (const subscription of subscriptions.data.filter(
      (f) => f.status !== 'canceled'
    )) {
      await stripe.subscriptions.cancel(subscription.id);
    }

    await this._subscriptionService.deleteSubscription(
      org.paymentId,
      STRIPE_PROVIDER
    );
  }

  async getCustomerByOrganizationId(organizationId: string) {
    const org = (await this._organizationService.getOrgById(organizationId))!;
    return org.paymentId;
  }

  async createBillingPortalLink(customer: string) {
    return stripe.billingPortal.sessions.create({
      customer,
      return_url: process.env['FRONTEND_URL'] + '/billing',
      ...(process.env.STRIPE_PORTAL_CONFIGURATION
        ? { configuration: process.env.STRIPE_PORTAL_CONFIGURATION }
        : {}),
    });
  }

  // A promotion code marked autoapply: true on itself or its coupon
  private isAutoApplyPromotion(promoCode: Stripe.PromotionCode) {
    const coupon =
      typeof promoCode.promotion.coupon === 'string'
        ? null
        : promoCode.promotion.coupon;

    return (
      Object.assign({}, promoCode.metadata, coupon?.metadata)?.autoapply ===
      'true'
    );
  }

  /**
   * Find an active promotion code with autoapply: true metadata
   * Only returns codes that are active and not expired
   */
  private async findAutoApplyPromotion(): Promise<Stripe.PromotionCode | null> {
    try {
      const promotionCodes = await stripe.promotionCodes.list({
        active: true,
        limit: 100,
        expand: ['data.promotion.coupon'],
      });

      const now = Math.floor(Date.now() / 1000);

      for (const promoCode of promotionCodes.data) {
        const coupon =
          typeof promoCode.promotion.coupon === 'string'
            ? null
            : promoCode.promotion.coupon;

        if (!this.isAutoApplyPromotion(promoCode)) continue;

        // Check if the promotion code has expired
        if (promoCode.expires_at && promoCode.expires_at < now) continue;

        // Check if the coupon has expired (redeem_by)
        if (coupon?.redeem_by && coupon.redeem_by < now) continue;

        // Check if max redemptions reached
        if (
          promoCode.max_redemptions &&
          promoCode.times_redeemed >= promoCode.max_redemptions
        )
          continue;

        return promoCode;
      }

      return null;
    } catch (err) {
      console.error('Error finding auto-apply promotion code:', err);
      return null;
    }
  }

  // The promotion code string (not the ID) for frontend auto-apply
  private async findAutoApplyPromotionCode(): Promise<string | null> {
    return (await this.findAutoApplyPromotion())?.code || null;
  }

  // A monthly trial gets the auto-apply promotion the monthly checkout
  // pre-fills. It is added when the trial is about to convert, so a one-time
  // coupon is not used up by the $0 trial invoice.
  // True when it added the promotion
  private async applyTrialDiscount(subscription: Stripe.Subscription) {
    if (
      !isCardlessTrial(subscription) ||
      subscription.cancel_at_period_end ||
      subscription.cancel_at ||
      subscription.discounts?.length ||
      subscription.items.data[0]?.price?.recurring?.interval !== 'month'
    ) {
      return false;
    }

    const promotion = await this.findAutoApplyPromotion();
    if (!promotion) {
      return false;
    }

    await stripe.subscriptions.update(subscription.id, {
      discounts: [{ promotion_code: promotion.id }],
    });
    return true;
  }

  // The auto-apply promotion is for monthly plans only, so a switch to yearly
  // drops it and keeps any other discount. Undefined when nothing changes.
  private async discountsWithoutAutoApply(subscriptionId: string) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['discounts.promotion_code.promotion.coupon'],
    });
    const discounts = (subscription.discounts || []).filter(
      (discount): discount is Stripe.Discount => typeof discount !== 'string'
    );
    const kept = discounts.filter(
      (discount) =>
        !(
          typeof discount.promotion_code === 'object' &&
          discount.promotion_code &&
          this.isAutoApplyPromotion(discount.promotion_code)
        )
    );

    if (kept.length === discounts.length) {
      return undefined;
    }
    return kept.map((discount) => ({ discount: discount.id }));
  }

  // The billing email is the user who checks out, and the dub click id is
  // saved for the referral conversion
  private async updateCheckoutCustomer(
    customer: string,
    userId: string,
    body: BillingSubscribeDto
  ) {
    const user = await this._userService.getUserById(userId);

    try {
      await stripe.customers.update(customer, {
        email:
          user.email.indexOf('@') > -1
            ? user.email
            : `${user.email}@postdelegate.com`,
        ...(body.dub
          ? {
              metadata: {
                dubCustomerExternalId: userId,
                dubClickId: body.dub,
              },
            }
          : {}),
      });
    } catch (err) {}
  }

  private async createEmbeddedCheckout(
    ud: string,
    uniqueId: string,
    customer: string,
    body: BillingSubscribeDto,
    price: string,
    userId: string,
    allowTrial: boolean
  ) {
    await this.updateCheckoutCustomer(customer, userId, body);

    // Check for auto-apply promotion code (only for monthly plans)
    let autoApplyPromoCode: string | null = null;
    if (body.period === 'MONTHLY') {
      autoApplyPromoCode = await this.findAutoApplyPromotionCode();
    }

    const isUtm = body.utm ? `&utm_source=${body.utm}` : '';
    const { client_secret } = await stripe.checkout.sessions.create({
      ui_mode: 'custom',
      customer,
      return_url:
        process.env['FRONTEND_URL'] +
        `/launches?onboarding=true&trialStart=true&check=${uniqueId}${isUtm}`,
      mode: 'subscription',
      subscription_data: {
        ...(allowTrial ? { trial_period_days: TRIAL_DAYS } : {}),
        metadata: {
          service: 'gitroom',
          ...body,
          userId,
          uniqueId,
          ud,
        },
      },
      ...(body.datafast_session_id && body.datafast_visitor_id
        ? {
            metadata: {
              datafast_visitor_id: body.datafast_visitor_id,
              datafast_session_id: body.datafast_session_id,
            },
          }
        : {}),
      allow_promotion_codes: body.period === 'MONTHLY',
      line_items: [
        {
          price,
          quantity: 1,
        },
      ],
    });

    // Return auto-apply promo code for frontend to apply
    return {
      client_secret,
      ...(autoApplyPromoCode ? { auto_apply_coupon: autoApplyPromoCode } : {}),
    };
  }

  private async createCheckoutSession(
    ud: string,
    uniqueId: string,
    customer: string,
    body: BillingSubscribeDto,
    price: string,
    userId: string,
    allowTrial: boolean
  ) {
    const isUtm = body.utm ? `&utm_source=${body.utm}` : '';

    if (body.dub) {
      await stripe.customers.update(customer, {
        metadata: {
          dubCustomerExternalId: userId,
          dubClickId: body.dub,
        },
      });
    }

    const { url } = await stripe.checkout.sessions.create({
      customer,
      cancel_url: process.env['FRONTEND_URL'] + `/billing?cancel=true${isUtm}`,
      success_url:
        process.env['FRONTEND_URL'] +
        `/launches?onboarding=true&trialStart=true&check=${uniqueId}${isUtm}`,
      mode: 'subscription',
      subscription_data: {
        ...(allowTrial ? { trial_period_days: TRIAL_DAYS } : {}),
        metadata: {
          service: 'gitroom',
          ...body,
          userId,
          uniqueId,
          ud,
        },
      },
      allow_promotion_codes: body.period === 'MONTHLY',
      line_items: [
        {
          price,
          quantity: 1,
        },
      ],
    });

    return { url };
  }

  async portalLink(organizationId: string) {
    const customer = await this.getCustomerByOrganizationId(organizationId);
    return this.createBillingPortalLink(customer);
  }

  async getRenewalDate(organizationId: string) {
    const customer = await this.getCustomerByOrganizationId(organizationId);
    const [sub] = await this.getLiveSubscriptions(customer);
    const trialing = sub?.status === 'trialing';
    return {
      renewsAt:
        (trialing ? sub.trial_end : sub?.items.data[0]?.current_period_end) ||
        null,
      trialing,
      needsPaymentMethod: !!sub && (await this.needsPaymentMethod(sub)),
    };
  }

  // Straight to adding a card, it becomes the customer default so the trial
  // converts when it ends
  async addPaymentMethodLink(organizationId: string) {
    const customer = await this.getCustomerByOrganizationId(organizationId);
    return stripe.billingPortal.sessions.create({
      customer,
      return_url: process.env['FRONTEND_URL'] + '/billing',
      ...(process.env.STRIPE_PORTAL_CONFIGURATION
        ? { configuration: process.env.STRIPE_PORTAL_CONFIGURATION }
        : {}),
      flow_data: {
        type: 'payment_method_update',
        after_completion: {
          type: 'redirect',
          redirect: {
            return_url: process.env['FRONTEND_URL'] + '/billing?card=added',
          },
        },
      },
    });
  }

  async getInvoices(organizationId: string): Promise<PaymentInvoice[]> {
    const customer = await this.getCustomerByOrganizationId(organizationId);
    if (!customer || !customer.startsWith('cus_')) {
      return [];
    }

    const invoices = await stripe.invoices.list({
      customer,
      limit: 100,
    });

    return invoices.data
      .filter((invoice) => invoice.status !== 'draft')
      .map((invoice) => {
        // snapshot of the subscription metadata ({ billing, period }) when the invoice was finalized
        const metadata = invoice.parent?.subscription_details?.metadata;
        return {
          id: invoice.id,
          number: invoice.number,
          tier: metadata?.billing || null,
          period: metadata?.period || null,
          description: invoice.lines.data[0]?.description || null,
          amount: invoice.total,
          currency: invoice.currency,
          created: invoice.created,
          periodEnd: Math.max(
            invoice.period_end,
            ...invoice.lines.data.map((line) => line.period.end)
          ),
          // an open invoice that was already attempted is a failed charge waiting for a retry
          status:
            invoice.status === 'paid'
              ? 'paid'
              : invoice.status === 'void'
              ? 'void'
              : invoice.status === 'uncollectible' || invoice.attempted
              ? 'failed'
              : 'pending',
          downloadUrl: invoice.invoice_pdf || null,
          viewUrl: invoice.hosted_invoice_url || null,
        };
      });
  }

  async finishTrial(organization: Organization) {
    const list = (
      await stripe.subscriptions.list({
        customer: organization.paymentId,
      })
    ).data;

    const trialing = list.find((f) => f.status === 'trialing');
    if (!trialing) {
      const subscription = await stripe.subscriptions.retrieve(list[0].id, {
        expand: ['latest_invoice'],
      });
      const invoice = subscription.latest_invoice as Stripe.Invoice | null;
      if (invoice?.status === 'open' && invoice.id) {
        await stripe.invoices.pay(invoice.id).catch(() => {});
      }
      return this.getRequiredActionFromSubscription(list[0].id);
    }

    // Ending it now without a card would cancel it, a card is added first
    if (isCardlessTrial(trialing) && !(await this.hasPaymentMethod(trialing))) {
      throw new Error('The trial has no payment method');
    }

    await this.applyTrialDiscount(trialing).catch((err) => {
      console.error('stripe_trial_discount_failed', {
        stripe_subscription_id: trialing.id,
        err,
      });
    });

    await stripe.subscriptions.update(trialing.id, {
      trial_end: 'now',
    });

    return this.getRequiredActionFromSubscription(trialing.id);
  }

  private async getRequiredActionFromSubscription(subscriptionId: string) {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice'],
    });

    const latestInvoice = subscription.latest_invoice as Stripe.Invoice | null;
    const invoice = latestInvoice?.id
      ? await stripe.invoices.retrieve(latestInvoice.id, {
          expand: ['payments.data.payment.payment_intent'],
        })
      : null;
    const paymentIntent = invoice?.payments?.data
      .map((p) => p.payment.payment_intent)
      .find((p): p is Stripe.PaymentIntent => typeof p === 'object' && !!p);

    if (
      invoice?.status === 'open' &&
      paymentIntent &&
      (paymentIntent.status === 'requires_action' ||
        paymentIntent.status === 'requires_confirmation')
    ) {
      return {
        requiresAction: true,
        // Returning the client_secret to the paying customer's browser is Stripe's
        // intended flow: https://docs.stripe.com/api/payment_intents/object#payment_intent_object-client_secret
        clientSecret: paymentIntent.client_secret,
      };
    }

    // The update itself succeeds on a declined card, the subscription just
    // moves to past_due, so the failure is only visible here
    if (
      invoice?.status === 'open' &&
      paymentIntent?.status === 'requires_payment_method'
    ) {
      throw new Error('The subscription payment failed');
    }

    return { requiresAction: false };
  }

  async checkDiscount(organization: Organization) {
    const customer = organization.paymentId;
    if (!process.env.STRIPE_DISCOUNT_ID || !customer) {
      return false;
    }

    const list = await stripe.charges.list({
      customer,
      limit: 1,
    });

    if (!list.data.filter((f) => f.amount > 1000).length) {
      return false;
    }

    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
          expand: ['data.discounts'],
        })
      ).data.find((f) => f.status === 'active' || f.status === 'trialing'),
    };

    if (!currentUserSubscription) {
      return false;
    }

    if (
      currentUserSubscription.data?.items.data[0]?.price.recurring?.interval ===
        'year' ||
      currentUserSubscription.data?.discounts.length
    ) {
      return false;
    }

    return true;
  }

  async applyDiscount(organization: Organization) {
    const customer = organization.paymentId;
    const check = this.checkDiscount(organization);
    if (!check) {
      return false;
    }

    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
          expand: ['data.discounts'],
        })
      ).data.find((f) => f.status === 'active' || f.status === 'trialing'),
    };

    await stripe.subscriptions.update(currentUserSubscription.data.id, {
      discounts: [
        {
          coupon: process.env.STRIPE_DISCOUNT_ID!,
        },
      ],
    });

    return true;
  }

  async checkSubscription(organizationId: string, subscriptionId: string) {
    const orgValue = await this._subscriptionService.checkSubscription(
      organizationId,
      subscriptionId
    );

    if (orgValue) {
      return 2;
    }

    const getCustomerSubscriptions = await this.getCustomerSubscriptions(
      organizationId
    );
    if (getCustomerSubscriptions.data.length === 0) {
      return 0;
    }

    if (
      getCustomerSubscriptions.data.find(
        (p) => p.metadata.uniqueId === subscriptionId
      )?.canceled_at
    ) {
      return 1;
    }

    return 0;
  }

  async embedded(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ) {
    const id = makeId(10);
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    if ((await this.getLiveSubscriptions(customer)).length) {
      return { blocked: true };
    }
    const findPrice = await resolveTierPrice(stripe, body.billing, body.period);

    return this.createEmbeddedCheckout(
      uniqueId,
      id,
      customer,
      body,
      findPrice!.id,
      userId,
      allowTrial
    );
  }

  // The trial starts without a card. Stripe cancels it when it ends unless a
  // card was added before, then the workspace is back on FREE.
  async startTrial(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto
  ) {
    const id = makeId(10);
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    if ((await this.getLiveSubscriptions(customer)).length) {
      return { subscribed: true };
    }
    const findPrice = await resolveTierPrice(stripe, body.billing, body.period);
    await this.updateCheckoutCustomer(customer, userId, body);

    await stripe.subscriptions.create({
      customer,
      items: [{ price: findPrice!.id, quantity: 1 }],
      trial_period_days: TRIAL_DAYS,
      trial_settings: {
        end_behavior: { missing_payment_method: 'cancel' },
      },
      metadata: {
        service: 'gitroom',
        ...body,
        userId,
        uniqueId: id,
        ud: uniqueId,
      },
    });

    return { id };
  }

  async subscribe(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ) {
    const id = makeId(10);
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = await this.createOrGetCustomer(org!);
    const findPrice = await resolveTierPrice(stripe, body.billing, body.period);

    const getCurrentSubscriptions =
      await this._subscriptionService.getSubscription(organizationId);

    if (!getCurrentSubscriptions) {
      return this.createCheckoutSession(
        uniqueId,
        id,
        customer,
        body,
        findPrice!.id,
        userId,
        allowTrial
      );
    }

    const currentUserSubscription = {
      data: (
        await stripe.subscriptions.list({
          customer,
          status: 'all',
        })
      ).data.filter((f) => f.status === 'active' || f.status === 'trialing'),
    };

    try {
      const discounts =
        body.period === 'YEARLY'
          ? await this.discountsWithoutAutoApply(
              currentUserSubscription.data[0].id
            )
          : undefined;

      await stripe.subscriptions.update(currentUserSubscription.data[0].id, {
        ...(discounts ? { discounts: discounts.length ? discounts : '' } : {}),
        cancel_at_period_end: false,
        metadata: {
          service: 'gitroom',
          ...body,
          userId,
          id,
          ud: uniqueId,
        },
        proration_behavior: 'always_invoice',
        items: [
          {
            id: currentUserSubscription.data[0].items.data[0].id,
            price: findPrice!.id,
            quantity: 1,
          },
        ],
      });

      const action = await this.getRequiredActionFromSubscription(
        currentUserSubscription.data[0].id
      );
      if (action.requiresAction) {
        return { id, ...action };
      }

      return { id };
    } catch (err) {
      const { url } = await this.createBillingPortalLink(customer);
      return {
        portal: url,
      };
    }
  }

  async paymentSucceeded(event: Stripe.InvoicePaymentSucceededEvent) {
    // only feeds the Facebook pixel, it runs in the background so it can
    // never fail or slow down the webhook
    this.trackConversion(event.data.object).catch((err) => {});
    await this.recordAffiliateCommission(event.data.object);
    return { ok: true };
  }

  // A failure here is logged with the invoice id and never fails the webhook:
  // the subscription events are handled by the same endpoint and a failing
  // endpoint would stop all of them. The row is unique per invoice, so a
  // missed one can be replayed from the Stripe dashboard.
  private async recordAffiliateCommission(invoice: Stripe.Invoice) {
    try {
      const customerId =
        typeof invoice.customer === 'string'
          ? invoice.customer
          : invoice.customer?.id;
      if (!customerId) {
        return;
      }

      // the tax is part of the invoice total, only the rest is commissionable
      const taxCents = (invoice.total_taxes || []).reduce(
        (sum, tax) => sum + tax.amount,
        0
      );

      await this._affiliateService.recordInvoicePayment({
        invoiceId: invoice.id!,
        customerId,
        amountPaidCents: invoice.amount_paid,
        totalCents: invoice.total,
        taxCents,
        currency: invoice.currency,
        paidAt: new Date(
          (invoice.status_transitions?.paid_at || invoice.created) * 1000
        ),
      });
    } catch (err) {
      console.error(
        'affiliate_commission_failed',
        { stripe_invoice_id: invoice.id },
        err
      );
    }
  }

  // The invoice of a charge: older API versions put it on the charge, the
  // current ones on the invoice payment of the payment intent
  private async getInvoiceIdOfCharge(charge: Stripe.Charge) {
    const direct = (charge as any).invoice;
    if (direct) {
      return typeof direct === 'string' ? direct : direct.id;
    }

    const paymentIntent =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;
    if (!paymentIntent) {
      return null;
    }

    const payments = await stripe.invoicePayments.list({
      payment: { type: 'payment_intent', payment_intent: paymentIntent },
      limit: 1,
    });
    const invoice = payments.data[0]?.invoice;
    return (typeof invoice === 'string' ? invoice : invoice?.id) || null;
  }

  async chargeRefunded(event: Stripe.ChargeRefundedEvent) {
    try {
      const charge = event.data.object;
      const invoiceId = await this.getInvoiceIdOfCharge(charge);
      if (invoiceId) {
        // amount_refunded adds up all the refunds of the charge
        await this._affiliateService.reverseCommission({
          invoiceId,
          reversedCents: charge.amount_refunded,
          chargedCents: charge.amount,
        });
      }
    } catch (err) {
      console.error(
        'affiliate_refund_failed',
        { stripe_charge_id: event.data.object.id },
        err
      );
    }
    return { ok: true };
  }

  async chargeDisputed(event: Stripe.ChargeDisputeCreatedEvent) {
    try {
      const dispute = event.data.object;
      const charge = await stripe.charges.retrieve(
        typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id
      );
      const invoiceId = await this.getInvoiceIdOfCharge(charge);
      if (invoiceId) {
        await this._affiliateService.reverseCommission({
          invoiceId,
          reversedCents: dispute.amount,
          chargedCents: charge.amount,
        });
      }
    } catch (err) {
      console.error(
        'affiliate_dispute_failed',
        { stripe_dispute_id: event.data.object.id },
        err
      );
    }
    return { ok: true };
  }

  // The first charge of a subscription is the conversion: a trial that turned
  // into a paid plan, or a plan paid upfront. The $0 invoice that starts a
  // trial and the renewals are not tracked.
  private async trackConversion(invoice: Stripe.Invoice) {
    try {
      // webhook payloads follow the API version of the endpoint: parent is the
      // 2025-03-31+ shape, subscription the older one
      const subscriptionId =
        invoice.parent?.subscription_details?.subscription ||
        (invoice as any).subscription;
      if (!subscriptionId || invoice.amount_paid <= 0) {
        return;
      }

      // invoices of other services sharing the Stripe account stop here
      const subscription = await stripe.subscriptions.retrieve(
        typeof subscriptionId === 'string' ? subscriptionId : subscriptionId.id
      );
      if (
        subscription.metadata?.service !== 'gitroom' ||
        !subscription.metadata?.userId
      ) {
        return;
      }

      const paidInvoices = await stripe.invoices.list({
        subscription: subscription.id,
        status: 'paid',
        limit: 100,
      });
      const paidBefore = paidInvoices.data.some(
        (f) =>
          f.id !== invoice.id &&
          f.amount_paid > 0 &&
          (f.created < invoice.created ||
            (f.created === invoice.created && f.id < invoice.id))
      );
      if (paidBefore) {
        return;
      }

      await this.trackSubscription(
        subscription.metadata,
        invoice.id,
        TrackEnum.Purchase,
        {
          value: invoice.amount_paid / 100,
          currency: invoice.currency,
        }
      );
    } catch (err) {
      console.error(
        'stripe_pixel_conversion_failed',
        { stripe_invoice_id: invoice.id },
        err
      );
    }
  }

  // Facebook pixel event for the user who checked out the subscription.
  // Never throws, tracking must not affect billing.
  private async trackSubscription(
    metadata: Stripe.Metadata,
    eventId: string,
    tt: TrackEnum,
    additional: Record<string, any>
  ) {
    try {
      const { userId, fbc, fbp } = metadata || {};
      if (!userId) {
        return;
      }

      const user = await this._userService.getUserById(userId);
      if (!user) {
        return;
      }

      await this._trackService.track(
        eventId,
        user.ip,
        user.agent,
        tt,
        additional,
        fbc,
        user,
        fbp
      );
    } catch (err) {
      console.error(
        'stripe_pixel_event_failed',
        { stripe_object_id: eventId, event: TrackEnum[tt] },
        err
      );
    }
  }

  async getCharges(organizationId: string) {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) {
      return [];
    }

    const charges = await stripe.charges.list({
      customer: org.paymentId,
      limit: 100,
    });

    const chargeList = charges.data
      .filter((f) => f.status === 'succeeded')
      .map((charge) => ({
        id: charge.id,
        amount: charge.amount,
        currency: charge.currency,
        created: charge.created,
        status: charge.status,
        refunded: charge.refunded,
        amount_refunded: charge.amount_refunded,
        description: charge.description,
        receipt_url: charge.receipt_url || null,
        invoice: (charge as any).invoice || null,
      }));

    const invoiceIds = chargeList
      .map((c) => c.invoice)
      .filter((id): id is string => !!id && typeof id === 'string');

    const invoicePdfMap: Record<string, string> = {};
    for (const invoiceId of invoiceIds) {
      try {
        const inv = await stripe.invoices.retrieve(invoiceId);
        if (inv.invoice_pdf) {
          invoicePdfMap[invoiceId] = inv.invoice_pdf;
        }
      } catch {
        // ignore if invoice can't be fetched
      }
    }

    return chargeList.map((charge) => ({
      ...charge,
      invoice_pdf:
        charge.invoice && invoicePdfMap[charge.invoice as string]
          ? invoicePdfMap[charge.invoice as string]
          : null,
    }));
  }

  async refundCharges(organizationId: string, chargeIds: string[]) {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) {
      throw new Error('No payment customer found for this organization');
    }

    const refunded: string[] = [];
    const failed: string[] = [];

    for (const chargeId of chargeIds) {
      try {
        await stripe.refunds.create({ charge: chargeId });
        refunded.push(chargeId);
      } catch (err) {
        failed.push(chargeId);
      }
    }

    return { refunded, failed };
  }

  async cancelSubscription(organizationId: string) {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) {
      throw new Error('No payment customer found for this organization');
    }

    const customer = org.paymentId;

    const subscriptions = await this.getLiveSubscriptions(customer);

    if (!subscriptions.length) {
      throw new Error('No active subscription found');
    }

    for (const subscription of subscriptions) {
      await stripe.subscriptions.cancel(subscription.id);
    }
    await this._subscriptionService.deleteSubscription(
      customer,
      STRIPE_PROVIDER
    );

    return { cancelled: true };
  }

  private mapSubscriptionDiscounts(subscription?: Stripe.Subscription) {
    return (subscription?.discounts || [])
      .filter(
        (discount): discount is Stripe.Discount => typeof discount !== 'string'
      )
      .map((discount) => {
        const coupon =
          typeof discount.source?.coupon === 'string'
            ? null
            : discount.source?.coupon;
        return {
          type: coupon?.percent_off ? 'percentage' : 'amount',
          value: coupon?.percent_off || (coupon?.amount_off || 0) / 100,
          duration: coupon?.duration || 'once',
          durationInMonths: coupon?.duration_in_months || null,
          remainingMonths: discount.end
            ? Math.max(
                0,
                Math.ceil(
                  (discount.end - Date.now() / 1000) / (30 * 24 * 60 * 60)
                )
              )
            : null,
        };
      });
  }

  private async getActiveStripeSubscription(paymentId?: string | null) {
    if (!paymentId || !paymentId.startsWith('cus_')) {
      return undefined;
    }

    return (
      await stripe.subscriptions.list({
        customer: paymentId,
        status: 'all',
        expand: ['data.discounts.source.coupon'],
      })
    ).data.find((f) => f.status === 'active' || f.status === 'trialing');
  }

  async getCouponInfo(organizationId: string) {
    const org = await this._organizationService.getOrgById(organizationId);
    const subscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(
        organizationId
      );

    const stripeSubscription = await this.getActiveStripeSubscription(
      org?.paymentId
    );

    const coupons = this.mapSubscriptionDiscounts(stripeSubscription);
    const priceData = subscription
      ? pricing[subscription.subscriptionTier]
      : undefined;
    const monthlyPrice = priceData?.month_price || 0;

    let nextPayment: number | null = null;
    if (stripeSubscription) {
      try {
        const preview = await stripe.invoices.createPreview({
          customer: org!.paymentId!,
          subscription: stripeSubscription.id,
        });
        nextPayment = preview.total / 100;
      } catch (err) {
        /* no upcoming invoice */
      }
    }

    return {
      tier: subscription?.subscriptionTier || null,
      period: subscription?.period || null,
      isLifetime: !!subscription?.isLifetime,
      monthlyPrice,
      planPrice:
        subscription?.period === 'YEARLY'
          ? priceData?.year_price || 0
          : monthlyPrice,
      nextPayment,
      coupons,
      supported:
        !!subscription &&
        !!stripeSubscription &&
        subscription.period === 'MONTHLY' &&
        !subscription.isLifetime &&
        !coupons.length,
    };
  }

  async applyCoupon(
    organizationId: string,
    body: { type: string; value: number; months: number }
  ) {
    const info = await this.getCouponInfo(organizationId);
    if (!info.supported) {
      return {
        applied: false,
        reason: 'Applying a coupon is not supported for this user',
      };
    }

    if (
      body.type === 'percentage'
        ? body.value < 1 || body.value > 100
        : body.value < 1 || body.value > info.monthlyPrice
    ) {
      return { applied: false, reason: 'Invalid coupon value' };
    }

    const org = await this._organizationService.getOrgById(organizationId);
    const stripeSubscription = await this.getActiveStripeSubscription(
      org?.paymentId
    );

    if (!stripeSubscription) {
      return {
        applied: false,
        reason: 'No active subscription found for this customer',
      };
    }

    const coupon = await stripe.coupons.create({
      name: `Admin coupon for ${org!.name}`,
      ...(body.type === 'percentage'
        ? { percent_off: body.value }
        : { amount_off: Math.round(body.value * 100), currency: 'usd' }),
      ...(body.months === 1
        ? { duration: 'once' }
        : { duration: 'repeating', duration_in_months: body.months }),
      metadata: { service: 'gitroom', organizationId },
    });

    await stripe.subscriptions.update(stripeSubscription.id, {
      discounts: [
        {
          coupon: coupon.id,
        },
      ],
    });

    return { applied: true };
  }

  async cancelCoupon(organizationId: string) {
    const org = await this._organizationService.getOrgById(organizationId);
    const stripeSubscription = await this.getActiveStripeSubscription(
      org?.paymentId
    );

    if (!stripeSubscription) {
      return {
        cancelled: false,
        reason: 'No active subscription found for this customer',
      };
    }

    if (!stripeSubscription.discounts.length) {
      return {
        cancelled: false,
        reason: 'No coupon is applied to this subscription',
      };
    }

    await stripe.subscriptions.deleteDiscount(stripeSubscription.id);

    return { cancelled: true };
  }

  async chatbaseRefundPreview(organizationId: string) {
    const org = await this._organizationService.getOrgById(organizationId);
    if (!org?.paymentId) {
      return {
        eligible: false as const,
        reason: 'No payment customer found for this organization',
      };
    }

    const customer = org.paymentId;

    const subscriptions = (
      await stripe.subscriptions.list({
        customer,
        status: 'all',
      })
    ).data.filter((f) => f.status !== 'canceled');

    if (!subscriptions.length) {
      return {
        eligible: false as const,
        reason: 'No active subscription found for this customer',
      };
    }

    const charges = (
      await stripe.charges.list({
        customer,
        limit: 100,
      })
    ).data.filter((f) => f.status === 'succeeded');

    if (charges.some((f) => f.refunded || f.amount_refunded > 0)) {
      return {
        eligible: false as const,
        reason: 'A refund was already issued for this customer',
      };
    }

    // only refund a charge that was created by the active subscription,
    // never a one-off payment
    let lastCharge: (typeof charges)[number] | undefined = undefined;
    let chargeSubscription: (typeof subscriptions)[number] | undefined =
      undefined;

    for (const charge of charges) {
      const invoiceId = (charge as any).invoice;
      if (!invoiceId || typeof invoiceId !== 'string') {
        continue;
      }

      try {
        const invoice = await stripe.invoices.retrieve(invoiceId);
        const invoiceSubscription =
          invoice.parent?.subscription_details?.subscription;
        const subscriptionId =
          typeof invoiceSubscription === 'string'
            ? invoiceSubscription
            : invoiceSubscription?.id;

        chargeSubscription = subscriptions.find((f) => f.id === subscriptionId);

        if (chargeSubscription) {
          lastCharge = charge;
          break;
        }
      } catch {
        // ignore if invoice can't be fetched
      }
    }

    if (!lastCharge || !chargeSubscription) {
      return {
        eligible: false as const,
        reason: 'No subscription payment found for this customer',
      };
    }

    const sixtyDaysAgo = Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60;
    if (lastCharge.created < sixtyDaysAgo) {
      return {
        eligible: false as const,
        reason: 'The last subscription payment is older than 60 days',
      };
    }

    const interval =
      chargeSubscription.items?.data?.[0]?.price?.recurring?.interval;

    // maximum refund is one month worth of the subscription
    const amount =
      interval === 'year'
        ? Math.floor(lastCharge.amount / 12)
        : lastCharge.amount;

    const currentSubscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(
        organizationId
      );

    return {
      eligible: true as const,
      chargeId: lastCharge.id,
      amount: amount / 100,
      currency: lastCharge.currency,
      tier: currentSubscription?.subscriptionTier || null,
      period: currentSubscription?.period || null,
      subscriptionIds: subscriptions.map((f) => f.id),
    };
  }

  async chatbaseRefund(organizationId: string) {
    const preview = await this.chatbaseRefundPreview(organizationId);
    if (!preview.eligible) {
      return {
        refunded: false,
        reason: preview.reason,
      };
    }

    const org = await this._organizationService.getOrgById(organizationId);

    await stripe.refunds.create({
      charge: preview.chargeId,
      amount: Math.round(preview.amount * 100),
      metadata: {
        reason: 'chatbase_refund',
        organizationId,
      },
    });

    for (const subscriptionId of preview.subscriptionIds) {
      await stripe.subscriptions.cancel(subscriptionId);
    }

    if (preview.subscriptionIds.length) {
      await this._subscriptionService.deleteSubscription(
        org?.paymentId!,
        STRIPE_PROVIDER
      );
    }

    return {
      refunded: true,
      amount: preview.amount,
      currency: preview.currency,
      subscriptionCancelled: preview.subscriptionIds.length > 0,
    };
  }

  async lifetimeDeal(organizationId: string, code: string) {
    const getCurrentSubscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(
        organizationId
      );
    if (getCurrentSubscription && !getCurrentSubscription?.isLifetime) {
      throw new Error('You already have a non lifetime subscription');
    }

    try {
      const testCode = AuthService.fixedDecryption(code);
      const findCode = await this._subscriptionService.getCode(testCode);
      if (findCode) {
        return {
          success: false,
        };
      }

      const nextPackage = !getCurrentSubscription ? 'STANDARD' : 'PRO';
      const findPricing = pricing[nextPackage];

      await this._subscriptionService.createOrUpdateSubscription(
        STRIPE_PROVIDER,
        false,
        makeId(10),
        organizationId,
        getCurrentSubscription?.subscriptionTier === 'PRO'
          ? getCurrentSubscription.totalChannels + 5
          : findPricing.channel!,
        nextPackage,
        'MONTHLY',
        null,
        testCode,
        organizationId
      );
      return {
        success: true,
      };
    } catch (err) {
      console.log(err);
      return {
        success: false,
      };
    }
  }
}
