import Stripe from 'stripe';
import { BadRequestException } from '@nestjs/common';
import { Organization, User } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { SubscriptionProviderState } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { BillingSubscribeDto } from '@gitroom/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import { escape, groupBy } from 'lodash';
import {
  allowsExtraChannels,
  isBiggerPlan,
  MAX_EXTRA_CHANNELS,
  pricing,
  totalChannelsOf,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { AffiliateService } from '@gitroom/nestjs-libraries/database/prisma/affiliates/affiliate.service';
import {
  emptyGrowthStats,
  PaymentGrowthPlan,
  PaymentGrowthStats,
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

// Extra channels on top of a tier's channels are one more item on the same
// subscription, priced per channel, its quantity the number of channels
const EXTRA_CHANNEL_LOOKUP_KEY = 'postdelegate_extra_channel';

export const isExtraChannelItem = (item?: Stripe.SubscriptionItem | null) =>
  !!item?.price?.lookup_key?.startsWith(`${EXTRA_CHANNEL_LOOKUP_KEY}_`);

// The extra channels a subscription pays for, 0 without the item. Reads the
// subscription as given, so a webhook can never fail on it
export const extraChannelsOf = (subscription?: Stripe.Subscription | null) =>
  subscription?.items?.data?.find(isExtraChannelItem)?.quantity || 0;

// The item of the plan itself, never the extra channels
export const planItemOf = (subscription?: Stripe.Subscription | null) =>
  subscription?.items?.data?.find((item) => !isExtraChannelItem(item)) ||
  subscription?.items?.data?.[0];

// The period the subscription is really billed on (every item shares it),
// the metadata only when the plan item has no interval
const billedPeriodOf = (
  subscription: Stripe.Subscription,
  fallback?: string
) => {
  const interval = planItemOf(subscription)?.price?.recurring?.interval;
  return (
    interval === 'year' ? 'YEARLY' : interval === 'month' ? 'MONTHLY' : fallback
  ) as 'MONTHLY' | 'YEARLY';
};

// Every extra channel price id: the ones on the subscriptions and the ones
// behind the lookup_keys now. A failed lookup keeps the subscriptions' ones
export async function extraChannelPriceIds(
  client: Stripe,
  subscriptions: Stripe.Subscription[]
) {
  const ids = new Set(
    subscriptions
      .flatMap((subscription) => subscription.items?.data || [])
      .filter(isExtraChannelItem)
      .map((item) => item.price.id)
  );
  try {
    const { data } = await client.prices.list({
      lookup_keys: [
        `${EXTRA_CHANNEL_LOOKUP_KEY}_month`,
        `${EXTRA_CHANNEL_LOOKUP_KEY}_year`,
      ],
    });
    data.forEach((price) => ids.add(price.id));
  } catch (err) {
    console.error('stripe_extra_channel_prices_failed', err);
  }
  return ids;
}

// An invoice whose every line is an extra channel price (adding channels
// mid-period), so not a payment of the plan itself
export const isExtraChannelsOnlyInvoice = (
  invoice: Stripe.Invoice,
  extraChannelPrices: Set<string>
) => {
  const lines = invoice.lines?.data || [];
  return (
    lines.length > 0 &&
    lines.every((line) => {
      const price = line.pricing?.price_details?.price;
      const id = typeof price === 'string' ? price : price?.id;
      return !!id && extraChannelPrices.has(id);
    })
  );
};

// The Stripe products of the paid plans, from their prices' lookup_keys
// (postdelegate_<slug>_<month|year>), so a coupon can leave extra channels
// out. Empty when no plan price has a lookup_key
export async function planProductIds(client: Stripe) {
  const lookupKeys = Object.values(pricing)
    .filter((plan) => plan.slug)
    .flatMap((plan) => [
      `postdelegate_${plan.slug}_month`,
      `postdelegate_${plan.slug}_year`,
    ]);
  const { data } = await client.prices.list({
    lookup_keys: lookupKeys,
    active: true,
    limit: 100,
  });
  return [
    ...new Set(
      data.map((price) =>
        typeof price.product === 'string' ? price.product : price.product.id
      )
    ),
  ];
}

// The per channel price of a tier by its lookup_key
// (postdelegate_extra_channel_<month|year>). Unlike the tier prices it is
// never found by name or created from code: without it (or with another
// amount) extra channels are not offered
export async function resolveExtraChannelPrice(
  client: Stripe,
  billing: string,
  period: 'MONTHLY' | 'YEARLY'
): Promise<Stripe.Price | null> {
  const priceData = pricing[billing];
  const amount =
    period === 'MONTHLY'
      ? priceData?.extra_channel_month_price
      : priceData?.extra_channel_year_price;
  if (!amount) {
    return null;
  }

  const interval = period === 'MONTHLY' ? 'month' : 'year';
  const lookupKey = `${EXTRA_CHANNEL_LOOKUP_KEY}_${interval}`;
  const unitAmount = Math.round(amount * 100);
  const { data } = await client.prices.list({
    lookup_keys: [lookupKey],
    active: true,
  });
  const found = data[0];
  if (
    found &&
    found.unit_amount === unitAmount &&
    found.recurring?.interval === interval
  ) {
    return found;
  }

  console.warn('stripe_extra_channel_price_unusable', {
    lookup_key: lookupKey,
    found: !!found,
    expected_amount: unitAmount,
    found_amount: found?.unit_amount,
  });
  return null;
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

// Subscription statuses that must not keep granting a paid tier. paused is
// a subscription Stripe stopped billing (a trial that ended without a card
// on a pause end behavior): no payment, no plan. Unlike canceled it can be
// resumed, and its updated event then stores the plan again
const NOT_ENTITLED_STATUSES: Stripe.Subscription.Status[] = [
  'unpaid',
  'canceled',
  'incomplete_expired',
  'paused',
];

// Statuses after which a subscription never comes back: a late or replayed
// created/updated event for it must not store the plan again
const ENDED_STATUSES: Stripe.Subscription.Status[] = [
  'canceled',
  'incomplete_expired',
];

// Organization.paymentId is a Stripe customer, except on plans an admin set
// before (a member's user id was stored there) - those have no customer and
// must never reach Stripe
export const stripeCustomerOf = (paymentId?: string | null) =>
  paymentId?.startsWith('cus_') ? paymentId : undefined;

export const TRIAL_DAYS = 7;

// A subscription that is still running or being retried: never one that
// ended or whose first payment never went through
const isLiveSubscription = (subscription: Stripe.Subscription) =>
  subscription.status !== 'canceled' &&
  subscription.status !== 'incomplete' &&
  subscription.status !== 'incomplete_expired';

// What the stored plan keeps of the subscription as Stripe has it now: its
// raw status, the end of its trial and of the period being paid
export const subscriptionStateOf = (
  subscription: Stripe.Subscription
): SubscriptionProviderState => {
  const periodEnd = planItemOf(subscription)?.current_period_end;
  return {
    status: subscription.status,
    trialEndsAt: subscription.trial_end
      ? new Date(subscription.trial_end * 1000)
      : null,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
  };
};

// In a trial for the workspace: Stripe has it trialing, or the first charge
// after the trial failed and Stripe is retrying it (past_due in the period
// that started when the trial ended), so it has never paid. A past_due
// renewal of a subscription that paid before is a paid plan being retried
export const isTrialOf = (subscription: Stripe.Subscription) =>
  subscription.status === 'trialing' ||
  (subscription.status === 'past_due' &&
    !!subscription.trial_end &&
    planItemOf(subscription)?.current_period_start ===
      subscription.trial_end);

// The subscription a customer's plan follows, picked like the webhooks pick
// it: a live one (getLiveSubscriptions) that still grants the plan
// (deleteSubscription's survivor), the one the stored plan came from first.
// Without one it is the subscription that stopped granting it, or none.
// `entitled`: whether that subscription still grants a plan
export const currentSubscriptionOf = (
  subscriptions: Stripe.Subscription[],
  uniqueId?: string | null
) => {
  const live = subscriptions.filter(isLiveSubscription);
  const entitled = live.filter(
    (f) => !NOT_ENTITLED_STATUSES.includes(f.status)
  );
  const current =
    entitled.find((f) => !!uniqueId && f.metadata?.uniqueId === uniqueId) ||
    entitled[0];
  if (current) {
    return { subscription: current, entitled: true };
  }
  return { subscription: live[0] || subscriptions[0], entitled: false };
};

// Every subscription of a customer as Stripe has it now. For the status sync
// (sync-subscription-status), which runs outside the API without the
// StripeService and its dependencies
export const customerSubscriptionsOf = async (customer: string) =>
  (
    await stripe.subscriptions.list({
      customer,
      status: 'all',
      limit: 100,
    })
  ).data;

const DECLINED_EXTRA_CHANNELS =
  'We could not charge your card. Update your payment method and try again.';

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

// The Stripe subscriptions of the admin growth stats are listed at most once
// per 5 minutes, reloading the stats page reads them from memory
const GROWTH_CACHE_MS = 5 * 60 * 1000;

// A trial that ended without paying: canceled during the trial, or canceled
// by Stripe when it ended (no card, or set to cancel at the trial end)
const isExpiredTrial = (subscription: Stripe.Subscription) =>
  !!subscription.trial_end &&
  !!subscription.ended_at &&
  subscription.ended_at - subscription.trial_end < 3600;

// Stripe charges the subscription default first, then the customer default.
// Reads the customer expanded on the subscription unless one is given
const hasCardOf = (
  subscription: Stripe.Subscription,
  customer:
    | string
    | Stripe.Customer
    | Stripe.DeletedCustomer = subscription.customer
) => {
  if (subscription.default_payment_method || subscription.default_source) {
    return true;
  }
  if (!customer || typeof customer === 'string' || customer.deleted) {
    return false;
  }
  const { invoice_settings, default_source } = customer as Stripe.Customer;
  return !!(invoice_settings?.default_payment_method || default_source);
};

// What the subscription brings in a month, minor units: every item's price
// times its quantity (a yearly price / 12), less the discounts still running
// on the subscription. Discounts come off the plan only, like the admin
// coupons limited to the plan products: extra channels keep their price
export const monthlyAmountOf = (
  subscription: Stripe.Subscription,
  now = Date.now() / 1000
) => {
  const monthsOf = (item?: Stripe.SubscriptionItem) =>
    (item?.price?.recurring?.interval === 'year' ? 12 : 1) *
    (item?.price?.recurring?.interval_count || 1);
  const monthlyOf = (item?: Stripe.SubscriptionItem) =>
    item?.price?.recurring
      ? ((item.price.unit_amount || 0) * (item.quantity ?? 1)) / monthsOf(item)
      : 0;

  const planItem = planItemOf(subscription);
  let plan = monthlyOf(planItem);
  for (const discount of subscription.discounts || []) {
    if (typeof discount === 'string' || (discount.end && discount.end <= now)) {
      continue;
    }
    const coupon = discount.source?.coupon;
    if (!coupon || typeof coupon === 'string') {
      continue;
    }
    if (coupon.percent_off) {
      plan = plan * (1 - coupon.percent_off / 100);
    } else if (coupon.amount_off) {
      // taken off every invoice, so a yearly invoice spreads it over 12 months
      plan = Math.max(0, plan - coupon.amount_off / monthsOf(planItem));
    }
  }

  const extras = (subscription.items?.data || [])
    .filter((item) => item !== planItem)
    .reduce((sum, item) => sum + monthlyOf(item), 0);

  return Math.round(Math.max(0, plan) + extras);
};

// The admin growth numbers from every subscription of the app (already
// filtered on metadata.service). Trials are told apart by trial_start /
// trial_end. Paying is active only (paid), a failing payment (past_due /
// unpaid) is counted on its own and not in the revenue
export const growthStatsOf = (
  subscriptions: Stripe.Subscription[],
  from: Date,
  to: Date,
  now = Date.now() / 1000
): PaymentGrowthStats => {
  const start = from.getTime() / 1000;
  const end = to.getTime() / 1000;
  const inRange = (time?: number | null) =>
    !!time && time >= start && time <= end;

  const stats = emptyGrowthStats(true);
  const plans = new Map<string, PaymentGrowthPlan>();

  for (const subscription of subscriptions) {
    // created and canceled right away by the app itself (a duplicate
    // checkout), never a trial or a customer
    if (
      subscription.ended_at &&
      subscription.ended_at - subscription.created < 300
    ) {
      continue;
    }
    stats.currency = stats.currency || subscription.currency || null;
    const expired = isExpiredTrial(subscription);

    if (subscription.trial_start && inRange(subscription.trial_start)) {
      stats.trialsStarted++;
    }

    if (subscription.status === 'trialing') {
      stats.trialsRunning++;
      if (hasCardOf(subscription)) {
        stats.trialsRunningWithCard++;
      }
    }

    if (expired && inRange(subscription.ended_at)) {
      stats.trialsExpired++;
    }

    if (
      !expired &&
      subscription.status === 'active' &&
      subscription.trial_end &&
      subscription.trial_end <= now &&
      inRange(subscription.trial_end)
    ) {
      stats.trialsConverted++;
    }

    // ended in the range, not a trial running out
    if (
      !expired &&
      subscription.status === 'canceled' &&
      inRange(subscription.ended_at)
    ) {
      stats.cancellations++;
    }

    if (
      subscription.status === 'past_due' ||
      subscription.status === 'unpaid'
    ) {
      stats.paymentFailing++;
    }

    if (subscription.status === 'active') {
      if (subscription.cancel_at_period_end || subscription.cancel_at) {
        stats.cancelling++;
      }
      const tier = subscription.metadata?.billing || 'UNKNOWN';
      const period = billedPeriodOf(
        subscription,
        subscription.metadata?.period
      );
      const mrr = monthlyAmountOf(subscription, now);
      const key = `${tier}_${period}`;
      const plan = plans.get(key) || { tier, period, count: 0, mrr: 0 };
      plan.count++;
      plan.mrr += mrr;
      plans.set(key, plan);
      stats.paying++;
      stats.mrr += mrr;
    }
  }

  const order = Object.keys(pricing);
  stats.payingByPlan = [...plans.values()].sort(
    (a, b) =>
      (order.indexOf(a.tier) + 1 || order.length + 1) -
        (order.indexOf(b.tier) + 1 || order.length + 1) ||
      a.period.localeCompare(b.period)
  );

  return stats;
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
      case 'invoice.payment_failed':
        return this.paymentFailed(event);
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
        // the card that was just tried, not whichever the list returns first
        await stripe.paymentMethods.detach(latestMethod.id);
        await stripe.subscriptions.cancel(event.data.object.id as string);
        return false;
      }

      await stripe.paymentIntents.cancel(paymentIntent.id as string);
      return true;
    } catch (err) {
      try {
        await stripe.paymentMethods.detach(latestMethod.id);
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

    const current = await this.currentSubscription(event.data.object);
    // ended since the event was sent, its deleted event handles it
    if (NOT_ENTITLED_STATUSES.includes(current.status)) {
      return { ok: true };
    }
    const currentPlan = (current.metadata || {}) as Partial<
      typeof event.data.object.metadata & {
        billing: 'STANDARD' | 'PRO';
        period: 'MONTHLY' | 'YEARLY';
      }
    >;

    const result = await this._subscriptionService.createOrUpdateSubscription(
      STRIPE_PROVIDER,
      isTrialOf(current),
      currentPlan.uniqueId || uniqueId,
      event.data.object.customer as string,
      totalChannelsOf(currentPlan.billing || billing, extraChannelsOf(current)),
      currentPlan.billing || billing,
      currentPlan.period || period,
      current.cancel_at,
      undefined,
      undefined,
      subscriptionStateOf(current)
    );
    // not stored: Stripe sends the event again, the notices go out then
    if (result?.retry) {
      return result;
    }

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
    const { uniqueId, billing, period } = event.data.object.metadata as {
      billing: 'STANDARD' | 'PRO';
      period: 'MONTHLY' | 'YEARLY';
      uniqueId: string;
    };

    const check = await this.checkValidCard(event);
    if (!check) {
      return { ok: false };
    }

    const fresh = await this.liveSubscription(event.data.object.id);
    const current = fresh || event.data.object;
    // A late or replayed update of a subscription that has ended since: its
    // deleted event already removed the plan, storing it again would bring a
    // canceled plan back
    if (ENDED_STATUSES.includes(current.status)) {
      return { ok: true };
    }
    // Stripe keeps past_due while it retries a failed renewal (the grace
    // period), but unpaid / paused mean no payment. Only the subscription as
    // it is now decides: a late or retried event can say unpaid of one that
    // has paid since, so without the re-read Stripe sends it again instead
    if (NOT_ENTITLED_STATUSES.includes(current.status)) {
      return fresh ? this.deleteSubscription(event) : { retry: true };
    }
    const currentPlan = (current.metadata || {}) as Partial<
      typeof event.data.object.metadata & {
        billing: 'STANDARD' | 'PRO';
        period: 'MONTHLY' | 'YEARLY';
      }
    >;

    return this._subscriptionService.createOrUpdateSubscription(
      STRIPE_PROVIDER,
      isTrialOf(current),
      currentPlan.uniqueId || uniqueId,
      event.data.object.customer as string,
      totalChannelsOf(currentPlan.billing || billing, extraChannelsOf(current)),
      currentPlan.billing || billing,
      currentPlan.period || period,
      current.cancel_at,
      undefined,
      undefined,
      subscriptionStateOf(current)
    );
  }

  async deleteSubscription(
    event:
      | Stripe.CustomerSubscriptionDeletedEvent
      | Stripe.CustomerSubscriptionUpdatedEvent
  ) {
    const customer = event.data.object.customer as string;
    // nothing is written before this read: a failed one asks Stripe for the
    // event again instead of throwing
    let live: Stripe.Subscription[];
    try {
      live = await this.getLiveSubscriptions(customer);
    } catch (err) {
      console.error('stripe_subscription_list_failed', {
        stripe_event_type: event.type,
        stripe_event_id: event.id,
        stripe_subscription_id: event.data.object.id,
        err,
      });
      return { retry: true };
    }
    const [survivor] = live.filter(
      (f) =>
        f.id !== event.data.object.id &&
        !NOT_ENTITLED_STATUSES.includes(f.status)
    );
    if (!survivor) {
      const deleted = await this._subscriptionService.deleteSubscription(
        customer,
        STRIPE_PROVIDER
      );
      // not applied: Stripe sends the event again
      if (deleted?.retry) {
        return deleted;
      }
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
      isTrialOf(survivor),
      uniqueId,
      customer,
      // the survivor comes from a fresh list, not from the event
      totalChannelsOf(billing, extraChannelsOf(survivor)),
      billing,
      period,
      survivor.cancel_at,
      undefined,
      undefined,
      subscriptionStateOf(survivor)
    );
  }

  // Stripe sends it 3 days before the trial ends. A trial without a card is
  // canceled when it ends, so ask the workspace to add one. It never fails the
  // webhook, a retry would send the reminder twice.
  // A renewal that could not be charged. Stripe retries on its own schedule
  // and eventually cancels the subscription, which arrives here as
  // customer.subscription.deleted - but the customer heard nothing in between,
  // so an expired card looked like the plan disappearing by itself. One notice
  // per failed attempt, which is Stripe's cadence (about four over two weeks).
  async paymentFailed(event: Stripe.InvoicePaymentFailedEvent) {
    try {
      // A retried event can be days old, so act on the invoice as it is now:
      // the card may have worked since, and alarming them then is worse than
      // saying nothing.
      const invoice = await stripe.invoices.retrieve(
        event.data.object.id as string
      );
      if (invoice.status !== 'open' && invoice.status !== 'uncollectible') {
        return { ok: true };
      }

      const org = await this._organizationService.getOrgByCustomerId(
        invoice.customer as string
      );
      if (!org) {
        return { ok: true };
      }

      const retriesAt = invoice.next_payment_attempt;
      await this.notifyBilling(
        org.id,
        'Your payment did not go through',
        retriesAt
          ? `We could not charge the card on file for your PostDelegate plan. We will try again on ${dayjs
              .unix(retriesAt)
              .format(
                'MMMM D, YYYY'
              )}. To avoid any interruption, update your card in Settings > Billing (${
              process.env.FRONTEND_URL
            }/billing).`
          : `We could not charge the card on file for your PostDelegate plan, and that was the last attempt, so the plan will be cancelled and your workspace paused. Add a working card in Settings > Billing (${
              process.env.FRONTEND_URL
            }/billing) to keep it.`,
        'Update card'
      );
    } catch (err) {
      console.error('stripe_payment_failed_notice_failed', {
        stripe_event_id: event.id,
        stripe_invoice_id: event.data.object.id,
        err,
      });
    }
    return { ok: true };
  }

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

      const needsCard = await this.needsPaymentMethod(subscription);
      // a trial with a card is charged when it ends, the admins are told when
      // and where to change or cancel first (not when it is already canceled)
      const charges =
        !needsCard &&
        subscription.status === 'trialing' &&
        !subscription.cancel_at_period_end &&
        !subscription.cancel_at;
      if (!needsCard && !charges) {
        return { ok: true };
      }

      const org = await this._organizationService.getOrgByCustomerId(
        subscription.customer as string
      );
      if (!org) {
        return { ok: true };
      }

      if (charges) {
        const plan = pricing[subscription.metadata?.billing || '']?.label;
        await this.notifyBilling(
          org.id,
          'Your free trial ends soon',
          `Your PostDelegate free trial ends on ${dayjs
            .unix(subscription.trial_end!)
            .format('MMMM D, YYYY')}, and the card on file will then be charged for your ${
            plan ? `${escape(plan)} ` : ''
          }plan. Billing shows the amount. To change or cancel your plan before then, open Settings > Billing (${
            process.env.FRONTEND_URL
          }/billing).`,
          'Manage billing'
        );
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
    if (hasCardOf(subscription)) {
      return true;
    }
    if (typeof subscription.customer !== 'string') {
      return false;
    }

    return hasCardOf(
      subscription,
      await stripe.customers.retrieve(subscription.customer)
    );
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

  // A workspace whose paymentId is not a Stripe customer (a plan an admin set
  // before) gets a real one the first time it goes through checkout
  async createOrGetCustomer(organization: Organization) {
    const existing = stripeCustomerOf(organization.paymentId);
    if (existing) {
      return existing;
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

    // Stripe has no upcoming invoice for a trial without a card, it cancels
    // at the end instead (invoice-upcoming-none): nothing is charged today. A
    // bigger plan needs the card first (subscribe), a smaller one is charged
    // its price when the trial ends
    const trialing = currentUserSubscription.data[0];
    if (
      trialing &&
      isCardlessTrial(trialing) &&
      !(await this.hasPaymentMethod(trialing))
    ) {
      return isBiggerPlan(
        trialing.metadata?.billing ||
          (await this._subscriptionService.getSubscription(organizationId))
            ?.subscriptionTier,
        body.billing
      )
        ? { price: 0, needsPaymentMethod: true }
        : {
            price: 0,
            trialEndPrice:
              pricing[body.billing][
                body.period === 'YEARLY' ? 'year_price' : 'month_price'
              ],
          };
    }

    const extraChannelItems = await this.extraChannelItemsForPlan(
      currentUserSubscription?.data?.[0],
      body
    );
    if (!extraChannelItems) {
      // the change is refused (subscribe), there is no price to show
      return {};
    }

    try {
      const price = await stripe.invoices.createPreview({
        customer,
        subscription: currentUserSubscription?.data?.[0]?.id,
        subscription_details: {
          proration_behavior: 'always_invoice',
          items: [
            {
              id: planItemOf(currentUserSubscription?.data?.[0])?.id,
              price: findPrice?.id!,
              quantity: 1,
            },
            ...extraChannelItems,
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
    const org = await this._organizationService.getOrgById(organizationId);
    const customer = stripeCustomerOf(org?.paymentId);
    if (!customer) {
      return { data: [] as Stripe.Subscription[] };
    }
    return stripe.subscriptions.list({
      customer,
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
    ).data.filter(isLiveSubscription);
  }

  // `intent` says what the customer asked for, and every subscription of the
  // workspace follows it. Without it (older clients) the first subscription
  // decides, as the route always toggled
  async setToCancel(
    organizationId: string,
    intent?: 'cancel' | 'reactivate'
  ) {
    const id = makeId(10);
    const org = await this._organizationService.getOrgById(organizationId);
    // never creates a customer: without one there is nothing to cancel
    const customer = stripeCustomerOf(org?.paymentId);
    const subscriptions = await this.getLiveSubscriptions(customer);

    const sub = subscriptions[0];

    if (!sub || !customer) {
      throw new BadRequestException('No active subscription found');
    }

    const reactivate = intent
      ? intent === 'reactivate'
      : !!sub.cancel_at_period_end;

    // Un-cancelling removes the cancel on each subscription that has one:
    // at the period end, or on an explicit date (only an explicit intent
    // clears that one, the old toggle never saw it)
    if (reactivate) {
      let cancel_at: number | null = null;
      for (const s of subscriptions) {
        const updated = s.cancel_at_period_end
          ? await stripe.subscriptions.update(s.id, {
              cancel_at_period_end: false,
              metadata: { service: 'gitroom', id },
            })
          : intent && s.cancel_at
          ? await stripe.subscriptions.update(s.id, {
              cancel_at: '',
              metadata: { service: 'gitroom', id },
            })
          : s;
        cancel_at = cancel_at || updated.cancel_at;
      }
      await this._subscriptionService.updateCancelAt(organizationId, cancel_at);

      return {
        id,
        action: 'reactivate' as const,
        cancel_at: cancel_at ? new Date(cancel_at * 1000) : undefined,
      };
    }

    // Check if the latest invoice has a failed payment. The open invoice of a
    // pending update (extra channels waiting for 3D Secure or a new card) is
    // not one: the subscription itself is paid
    const latestInvoice = sub.latest_invoice as Stripe.Invoice | null;
    const hasFailedPayment =
      sub.status === 'past_due' ||
      (!sub.pending_update &&
        (latestInvoice?.status === 'open' ||
          latestInvoice?.status === 'uncollectible'));

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
        action: 'cancel' as const,
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
      action: 'cancel' as const,
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
    // a plan an admin set has no Stripe customer, nothing to cancel there
    const customer = stripeCustomerOf(org?.paymentId);
    if (!customer) {
      return;
    }

    const subscriptions = await stripe.subscriptions.list({
      customer,
      status: 'all',
      limit: 100,
    });

    for (const subscription of subscriptions.data.filter(
      (f) => f.status !== 'canceled'
    )) {
      await stripe.subscriptions.cancel(subscription.id);
    }

    await this._subscriptionService.deleteSubscription(
      customer,
      STRIPE_PROVIDER
    );
  }

  // A subscription Stripe still has in its trial, read live: the stored
  // isTrailing can lag behind a webhook that has not arrived yet
  override async isTrialing(organizationId: string) {
    const live = await this.getLiveSubscriptions(
      await this.getCustomerByOrganizationId(organizationId)
    );
    return (
      live.some((f) => f.status === 'trialing') &&
      !live.some((f) => f.status === 'active')
    );
  }

  // the workspace's Stripe customer, undefined when it has none
  async getCustomerByOrganizationId(organizationId: string) {
    const org = await this._organizationService.getOrgById(organizationId);
    return stripeCustomerOf(org?.paymentId);
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

  // The site analytics read the visit a checkout came from on the session
  // (the subscription gets the whole body), nothing is added without one
  private checkoutSessionMetadata(body: BillingSubscribeDto) {
    const metadata = {
      ...(body.datafast_session_id && body.datafast_visitor_id
        ? {
            datafast_visitor_id: body.datafast_visitor_id,
            datafast_session_id: body.datafast_session_id,
          }
        : {}),
      ...(body.pulse_vid ? { pulse_vid: body.pulse_vid } : {}),
    };
    return Object.keys(metadata).length ? { metadata } : {};
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

    const isUtm = body.utm ? `&utm_source=${encodeURIComponent(body.utm)}` : '';
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
      ...this.checkoutSessionMetadata(body),
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
    const isUtm = body.utm ? `&utm_source=${encodeURIComponent(body.utm)}` : '';

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
      ...this.checkoutSessionMetadata(body),
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
    if (!customer) {
      throw new BadRequestException(
        'There is no billing account for this workspace yet'
      );
    }
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
    if (!customer) {
      throw new BadRequestException(
        'There is no billing account for this workspace yet'
      );
    }
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
    if (!customer) {
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
    const customer = stripeCustomerOf(organization.paymentId);
    if (!customer) {
      throw new Error('The workspace has no Stripe customer');
    }
    const list = (
      await stripe.subscriptions.list({
        customer,
      })
    ).data;

    const trialing = list.find((f) => f.status === 'trialing');
    if (!trialing) {
      if (!list[0]) {
        throw new Error('The workspace has no subscription');
      }
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
    const customer = stripeCustomerOf(organization.paymentId);
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

    if (!currentUserSubscription.data) {
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
    const customer = stripeCustomerOf(organization.paymentId);
    const check = await this.checkDiscount(organization);
    if (!check || !customer) {
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
    if (!currentUserSubscription.data) {
      return false;
    }

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

    // A trial without a card moves to a bigger plan once a card is added:
    // the plan change keeps the trial, so the bigger plan's limits would come
    // free until the trial ends and Stripe cancels it. With a card the first
    // payment, at the end of the trial, is the bigger plan's price
    const trialing = currentUserSubscription.data[0];
    if (
      trialing &&
      isCardlessTrial(trialing) &&
      isBiggerPlan(
        trialing.metadata?.billing || getCurrentSubscriptions.subscriptionTier,
        body.billing
      ) &&
      !(await this.hasPaymentMethod(trialing))
    ) {
      return { needsPaymentMethod: true };
    }

    // outside the try: a missing extra channel price is not a card problem
    const extraChannelItems = await this.extraChannelItemsForPlan(
      currentUserSubscription.data[0],
      body
    );
    if (!extraChannelItems) {
      return {
        error:
          'Your extra channels cannot move to this billing period right now. Remove them first, or contact support.',
      };
    }

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
            id: planItemOf(currentUserSubscription.data[0])!.id,
            price: findPrice!.id,
            quantity: 1,
          },
          ...extraChannelItems,
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

  // Webhooks can arrive late or be replayed: the subscription is read again,
  // on every tier, and the stored plan (tier, period, status, cancel date,
  // extra channels) follows it as it is now - a subscription.updated sent
  // before a cancellation must not bring the canceled plan back.
  // Never throws: a failed read keeps the event's subscription
  private async currentSubscription(subscription: Stripe.Subscription) {
    return (await this.liveSubscription(subscription.id)) || subscription;
  }

  // The subscription as Stripe has it now, undefined when it cannot be read.
  // Never throws
  private async liveSubscription(id: string) {
    try {
      const fresh = await stripe.subscriptions.retrieve(id);
      return fresh?.id ? fresh : undefined;
    } catch (err) {
      console.error('stripe_subscription_refetch_failed', {
        stripe_subscription_id: id,
        err,
      });
      return undefined;
    }
  }

  // What a plan change does to the extra channels item: a plan without extra
  // channels drops it, a new billing period moves it to that period's price
  // (Stripe needs every item on one interval), otherwise it stays as it is
  private async extraChannelItemsForPlan(
    subscription: Stripe.Subscription | undefined,
    body: BillingSubscribeDto
  ): Promise<Stripe.SubscriptionUpdateParams.Item[] | null> {
    const item = subscription?.items?.data?.find(isExtraChannelItem);
    if (!item) {
      return [];
    }

    if (!allowsExtraChannels(body.billing)) {
      return [{ id: item.id, deleted: true }];
    }

    const interval = body.period === 'MONTHLY' ? 'month' : 'year';
    if (item.price?.recurring?.interval === interval) {
      return [];
    }

    const price = await resolveExtraChannelPrice(
      stripe,
      body.billing,
      body.period
    ).catch((err) => {
      console.error('stripe_extra_channel_price_failed', err);
      return null;
    });
    // null: the extra channels can't follow the plan to this period
    return price
      ? [{ id: item.id, price: price.id, quantity: item.quantity }]
      : null;
  }

  // The subscription extra channels are bought on: the active or trialing
  // one, like a plan change
  private async getExtraChannelsSubscription(organizationId: string) {
    const current =
      await this._subscriptionService.getSubscriptionByOrganizationId(
        organizationId
      );
    if (
      !current ||
      current.provider !== STRIPE_PROVIDER ||
      current.isLifetime ||
      !allowsExtraChannels(current.subscriptionTier)
    ) {
      return null;
    }

    const org = await this._organizationService.getOrgById(organizationId);
    const [subscription] = (
      await this.getLiveSubscriptions(stripeCustomerOf(org?.paymentId))
    ).filter((f) => f.status === 'active' || f.status === 'trialing');

    return { current, subscription };
  }

  async getExtraChannels(organizationId: string) {
    const found = await this.getExtraChannelsSubscription(organizationId);
    if (!found?.subscription) {
      return { available: false };
    }

    const { current, subscription } = found;
    const billing = subscription.metadata?.billing || current.subscriptionTier;
    const period = billedPeriodOf(
      subscription,
      subscription.metadata?.period || current.period
    );
    const price = await resolveExtraChannelPrice(stripe, billing, period);
    if (!price) {
      return { available: false };
    }

    return {
      available: true,
      trialing: subscription.status === 'trialing',
      extraChannels: extraChannelsOf(subscription),
      includedChannels: pricing[billing].channel || 0,
      activeChannels: await this._subscriptionService.getActiveChannelsCount(
        organizationId
      ),
      unitPrice: price.unit_amount! / 100,
      period,
      max: MAX_EXTRA_CHANNELS,
    };
  }

  // Sets the extra channels to a quantity, prorated like a plan change. The
  // quantity is the target, so sending the same one twice changes nothing.
  // A trial adds them once it converts, an unpaid subscription once it's paid
  async setExtraChannels(organizationId: string, extraChannels: number) {
    const found = await this.getExtraChannelsSubscription(organizationId);
    if (!found) {
      throw new BadRequestException(
        'Extra channels are only available on the Ultimate plan.'
      );
    }

    let { subscription } = found;
    if (!subscription) {
      throw new BadRequestException('No active subscription found.');
    }

    if (subscription.status === 'trialing') {
      throw new BadRequestException(
        'Extra channels can be added once your trial ends. Finish the trial on the Billing page to add them now.'
      );
    }

    const { uniqueId, billing } = subscription.metadata as {
      billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE';
      uniqueId: string;
    };
    // the price follows the real interval, the stored period follows the
    // metadata like the webhooks do
    const period = billedPeriodOf(subscription, subscription.metadata?.period);
    const storedPeriod = (subscription.metadata?.period || period) as
      | 'MONTHLY'
      | 'YEARLY';
    if (!allowsExtraChannels(billing) || !period) {
      throw new BadRequestException(
        'Extra channels are only available on the Ultimate plan.'
      );
    }

    const customer = subscription.customer as string;
    const item = subscription.items.data.find(isExtraChannelItem);
    const currentExtra = extraChannelsOf(subscription);

    // an earlier change still waits for its payment. The same quantity
    // finishes that one instead of stacking a second invoice; a declined one,
    // or one for another quantity, is voided and this request starts fresh
    if (subscription.pending_update) {
      const pendingExtra = (
        subscription.pending_update.subscription_items || []
      ).find(isExtraChannelItem)?.quantity;
      if (pendingExtra === extraChannels) {
        const pending = await this.pendingExtraChannels(
          subscription.id,
          currentExtra
        );
        if (pending) {
          return pending;
        }
      } else {
        await this.voidPendingInvoice(subscription.id, false);
      }
      subscription = await stripe.subscriptions.retrieve(subscription.id, {
        expand: ['latest_invoice'],
      });
      if (subscription.pending_update) {
        throw new BadRequestException(
          pendingExtra === extraChannels
            ? DECLINED_EXTRA_CHANNELS
            : `Finish the pending payment for ${pendingExtra} extra channels first, then change the number again.`
        );
      }
    }

    if (extraChannels < currentExtra) {
      const activeChannels =
        await this._subscriptionService.getActiveChannelsCount(organizationId);
      const limit = totalChannelsOf(billing, extraChannels);
      if (activeChannels > limit) {
        throw new BadRequestException(
          `You have ${activeChannels} active channels, so you need at least ${
            activeChannels - (pricing[billing].channel || 0)
          } extra channels. Disconnect or disable ${
            activeChannels - limit
          } channels first, then lower your extra channels.`
        );
      }
    }

    let updated = subscription;
    if (extraChannels !== currentExtra) {
      const price = item
        ? null
        : await resolveExtraChannelPrice(stripe, billing, period);
      if (!item && !price) {
        throw new BadRequestException(
          'Extra channels are not available right now. Please contact support.'
        );
      }

      const adding = extraChannels > currentExtra;
      const latestInvoice = subscription.latest_invoice as
        | Stripe.Invoice
        | string
        | null;
      updated = await stripe.subscriptions.update(
        subscription.id,
        {
          proration_behavior: 'always_invoice',
          // a charge that fails or needs 3D Secure leaves the quantity as it
          // was until it is paid
          ...(adding ? { payment_behavior: 'pending_if_incomplete' } : {}),
          items: [
            item
              ? extraChannels
                ? { id: item.id, quantity: extraChannels }
                : { id: item.id, deleted: true }
              : { price: price!.id, quantity: extraChannels },
          ],
        },
        {
          // a double click sends the same change twice, the same change
          // after another one is a new invoice and so a new key
          idempotencyKey: `extra-channels-${subscription.id}-${
            typeof latestInvoice === 'string'
              ? latestInvoice
              : latestInvoice?.id || 'none'
          }-${currentExtra}-${extraChannels}`,
        }
      );

      if (updated.pending_update) {
        const pending = await this.pendingExtraChannels(
          subscription.id,
          currentExtra
        );
        if (!pending) {
          throw new BadRequestException(DECLINED_EXTRA_CHANNELS);
        }
        return pending;
      }
    }

    await this._subscriptionService.createOrUpdateSubscription(
      STRIPE_PROVIDER,
      isTrialOf(updated),
      uniqueId,
      customer,
      totalChannelsOf(billing, extraChannelsOf(updated)),
      billing,
      storedPeriod,
      updated.cancel_at,
      undefined,
      undefined,
      subscriptionStateOf(updated)
    );

    return {
      extraChannels: extraChannelsOf(updated),
      requiresAction: false,
    };
  }

  // A change that applies once its invoice is paid: the 3D Secure step to
  // finish, or still processing. The webhook stores the new limit once the
  // payment goes through. A declined card gives null, after its invoice is
  // voided so the next attempt doesn't wait for the update to expire
  private async pendingExtraChannels(
    subscriptionId: string,
    extraChannels: number
  ) {
    try {
      const action = await this.getRequiredActionFromSubscription(
        subscriptionId
      );
      return { extraChannels, pending: true, ...action };
    } catch (err) {
      await this.voidPendingInvoice(subscriptionId, true);
      return null;
    }
  }

  // Voids the open invoice of a pending update, which discards the pending
  // update with it: only when its payment needs a new payment method, or
  // (onlyDeclined false) also when it waits for 3D Secure
  private async voidPendingInvoice(
    subscriptionId: string,
    onlyDeclined: boolean
  ) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['latest_invoice'],
      });
      const invoice = subscription.latest_invoice as Stripe.Invoice | null;
      if (!subscription.pending_update || invoice?.status !== 'open') {
        return;
      }
      const { payments } = await stripe.invoices.retrieve(invoice.id!, {
        expand: ['payments.data.payment.payment_intent'],
      });
      const voidable = payments?.data.some(
        (p) =>
          typeof p.payment.payment_intent === 'object' &&
          (p.payment.payment_intent?.status === 'requires_payment_method' ||
            (!onlyDeclined &&
              (p.payment.payment_intent?.status === 'requires_action' ||
                p.payment.payment_intent?.status === 'requires_confirmation')))
      );
      if (voidable) {
        await stripe.invoices.voidInvoice(invoice.id!);
      }
    } catch (err) {
      console.error('stripe_extra_channels_void_failed', {
        stripe_subscription_id: subscriptionId,
        err,
      });
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
      // _fbc / _fbp only exist when the pixel ran, which waits for the
      // analytics choice in the cookie banner, so no consent means no event
      const { userId, fbc, fbp } = metadata || {};
      if (!userId || (!fbc && !fbp)) {
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
    const customer = stripeCustomerOf(org?.paymentId);
    if (!customer) {
      return [];
    }

    const charges = await stripe.charges.list({
      customer,
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
    if (!stripeCustomerOf(org?.paymentId)) {
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
    const customer = stripeCustomerOf(org?.paymentId);
    if (!customer) {
      throw new Error('No payment customer found for this organization');
    }

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
          customer: stripeCustomerOf(org?.paymentId)!,
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

    // the plans only, extra channels keep their price
    const ownProduct = planItemOf(stripeSubscription)?.price?.product;
    const planProducts = [
      ...new Set([
        ...(await planProductIds(stripe)),
        ...(ownProduct
          ? [typeof ownProduct === 'string' ? ownProduct : ownProduct.id]
          : []),
      ]),
    ];
    const coupon = await stripe.coupons.create({
      name: `Admin coupon for ${org!.name}`,
      ...(body.type === 'percentage'
        ? { percent_off: body.value }
        : { amount_off: Math.round(body.value * 100), currency: 'usd' }),
      ...(body.months === 1
        ? { duration: 'once' }
        : { duration: 'repeating', duration_in_months: body.months }),
      ...(planProducts.length
        ? { applies_to: { products: planProducts } }
        : {}),
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

  // the load itself is kept, so requests arriving while it pages through
  // Stripe wait for it instead of starting their own
  private _growthSubscriptions: {
    at: number;
    data: Promise<Stripe.Subscription[]>;
  } | null = null;

  private getAppSubscriptions() {
    if (
      this._growthSubscriptions &&
      Date.now() - this._growthSubscriptions.at < GROWTH_CACHE_MS
    ) {
      return this._growthSubscriptions.data;
    }

    const data = this.listAppSubscriptions().catch((err) => {
      this._growthSubscriptions = null;
      throw err;
    });
    this._growthSubscriptions = { at: Date.now(), data };
    return data;
  }

  // Every subscription of this app, paged through 100 at a time. Other
  // products share the Stripe account, only metadata.service gitroom is ours
  private async listAppSubscriptions() {
    const data: Stripe.Subscription[] = [];
    let startingAfter: string | undefined;
    do {
      const page = await stripe.subscriptions.list({
        status: 'all',
        limit: 100,
        expand: ['data.customer', 'data.discounts.source.coupon'],
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      data.push(...page.data.filter((f) => f.metadata?.service === 'gitroom'));
      startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
    } while (startingAfter);

    return data;
  }

  override async getGrowthStats(from: Date, to: Date) {
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return emptyGrowthStats();
    }
    return growthStatsOf(await this.getAppSubscriptions(), from, to);
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

      const result =
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
      // another redeem of the same code won the race, or the write failed
      if (result?.retry || result?.codeUsed) {
        return {
          success: false,
        };
      }
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
