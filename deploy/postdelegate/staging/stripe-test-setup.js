#!/usr/bin/env node
// Stripe TEST-mode setup for staging: the plan prices (same lookup_keys and
// amounts as production), the webhook endpoint and the billing portal
// configuration. Refuses anything but an sk_test_ key, so it can never touch
// live billing. Safe to run again: existing prices are kept, the webhook and
// portal configuration are only created when missing.
//
// Run inside the release image with staging's env (see STAGING.md):
//   docker run --rm --env-file /etc/postiz/staging.env \
//     -v /path/stripe-test-setup.js:/setup.js:ro -v /root/stripe-out:/out \
//     -e NODE_PATH=/app/node_modules --entrypoint node <image> /setup.js /out
// It writes /out/STRIPE_SIGNING_KEY (0600, the webhook secret, never printed)
// and /out/STRIPE_PORTAL_CONFIGURATION, and prints only object ids.
'use strict';
const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');

const key = process.env.STRIPE_SECRET_KEY || '';
if (!key.startsWith('sk_test_')) {
  console.error('STRIPE_SECRET_KEY must be a test-mode key (sk_test_...)');
  process.exit(2);
}
const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: stripe-test-setup.js <out-dir>');
  process.exit(2);
}
const frontend = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
if (!frontend.startsWith('https://staging.')) {
  console.error(`FRONTEND_URL must be the staging URL, got "${frontend}"`);
  process.exit(2);
}

const stripe = new Stripe(key);

// Mirrors the live prices (amounts in cents, USD)
const PLANS = [
  { plan: 'starter', name: 'Starter', month: 1900, year: 18000 },
  { plan: 'team', name: 'Team', month: 2900, year: 27600 },
  { plan: 'pro', name: 'Pro', month: 3900, year: 37200 },
  { plan: 'ultimate', name: 'Ultimate', month: 7900, year: 75600 },
  { plan: 'extra_channel', name: 'Extra channel', month: 100, year: 960 },
];

const WEBHOOK_EVENTS = [
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'charge.refunded',
  'charge.dispute.created',
];

const writeSecret = (name, value) => {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, value, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
};

(async () => {
  for (const p of PLANS) {
    let product;
    for (const interval of ['month', 'year']) {
      const lookupKey = `postdelegate_${p.plan}_${interval}`;
      const existing = await stripe.prices.list({
        lookup_keys: [lookupKey],
        active: true,
      });
      if (existing.data[0]) {
        console.log(`price ${lookupKey} exists ${existing.data[0].id}`);
        product = product || existing.data[0].product;
        continue;
      }
      if (!product) {
        product = (
          await stripe.products.create({
            name: p.name,
            metadata: { app: 'postdelegate', plan: p.plan },
          })
        ).id;
      }
      const price = await stripe.prices.create({
        product,
        currency: 'usd',
        unit_amount: p[interval],
        recurring: { interval },
        lookup_key: lookupKey,
        metadata: { plan: p.plan, plan_name: p.name, interval },
      });
      console.log(`price ${lookupKey} created ${price.id}`);
    }
  }

  const webhookUrl = `${frontend}/api/stripe`;
  const hooks = await stripe.webhookEndpoints.list({ limit: 100 });
  const hook = hooks.data.find((h) => h.url === webhookUrl);
  if (hook) {
    console.log(
      `webhook ${hook.id} exists; its secret cannot be read again, delete it in the Dashboard and rerun to get a new one`
    );
  } else {
    const created = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: WEBHOOK_EVENTS,
      description: 'PostDelegate staging',
    });
    writeSecret('STRIPE_SIGNING_KEY', created.secret);
    console.log(`webhook ${created.id} created, secret written`);
  }

  const portals = await stripe.billingPortal.configurations.list({
    active: true,
    limit: 100,
  });
  let portal = portals.data.find((c) => c.metadata?.app === 'postdelegate');
  if (!portal) {
    portal = await stripe.billingPortal.configurations.create({
      name: 'PostDelegate staging',
      business_profile: {
        headline: 'Manage your PostDelegate plan',
        privacy_policy_url: `${frontend}/legal/privacy`,
        terms_of_service_url: `${frontend}/legal/terms`,
      },
      default_return_url: `${frontend}/billing`,
      features: {
        customer_update: {
          enabled: true,
          allowed_updates: ['name', 'email', 'address', 'tax_id'],
        },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: {
          enabled: true,
          mode: 'at_period_end',
          proration_behavior: 'none',
          cancellation_reason: {
            enabled: true,
            options: [
              'too_expensive',
              'missing_features',
              'switched_service',
              'unused',
              'too_complex',
              'other',
            ],
          },
        },
      },
      metadata: { app: 'postdelegate' },
    });
    console.log(`portal configuration ${portal.id} created`);
  } else {
    console.log(`portal configuration ${portal.id} exists`);
  }
  fs.writeFileSync(path.join(outDir, 'STRIPE_PORTAL_CONFIGURATION'), portal.id, {
    mode: 0o600,
  });
})().catch((e) => {
  // Stripe errors carry no key; print the message only
  console.error('stripe setup failed:', e?.message || String(e));
  process.exit(1);
});
