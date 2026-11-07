# Rolling out the subscription status change

`Organization.isTrailing` used to be stored as "any Stripe status but
`active`", so a paid workspace whose renewal Stripe was retrying (`past_due`)
was treated as a trial: trial caps, "not available in trial mode" for clipping
and some videos, no extra channels, trial onboarding emails, and an "End trial"
prompt on a plan that has no trial. A subscription that ended never cleared it.

This release stores the provider's own status on the plan and derives the flag
from it:

| Stripe status | Before | After |
|---|---|---|
| `trialing` | plan, trial | plan, trial |
| `active` | plan | plan |
| `past_due`, a renewal of a plan that paid before | plan, **trial** | plan, not a trial (Stripe's retries are the grace period; the failed-renewal email still goes out from `invoice.payment_failed`) |
| `past_due`, the first charge after the trial (the period started at `trial_end`) | plan, trial | plan, still a trial while Stripe retries: it has never paid |
| `paused` | plan, **trial** | dropped to FREE, like `unpaid` (comes back on resume) |
| `incomplete` | not stored | not stored |
| `unpaid`, `canceled`, `incomplete_expired` | dropped to FREE, flag left set | dropped to FREE, flag cleared |

New columns: `Subscription.status`, `Subscription.trialEndsAt`,
`Subscription.currentPeriodEnd`, all nullable, no index. Every webhook write
fills them from the subscription it re-reads from Stripe. Rows stored before
this release keep `null` until a webhook or the sync below touches them, and
every reader treats `null` as before.

One deploy, then one command. Rolling back takes one manual step, see §7.

App store (RevenueCat) trials now also get the trial post caps on the networks
paid per post, like a Stripe trial: before, the RevenueCat provider could not
say whether a subscription was trialing, so those caps never applied to them.

---

## 1. Back up

Take the usual database backup before the deploy (`backup-postiz`). Nothing
here is destructive, it is there in case the sync has to be undone.

## 2. Read the schema diff before `db push` runs it

The container entrypoint runs `prisma db push` on every start, without
`--accept-data-loss`. Read what it will run first:

```bash
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel libraries/nestjs-libraries/src/database/prisma/schema.prisma --script
```

Expect only this, three nullable columns with no default (no table rewrite, no
lock worth mentioning):

```sql
ALTER TABLE "Subscription" ADD COLUMN "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN "status" TEXT,
ADD COLUMN "trialEndsAt" TIMESTAMP(3);
```

Anything else in the output (a `DROP`, an `ALTER ... TYPE`) means the branch
is not what was reviewed: stop.

## 3. Deploy

Release as usual: staging first, click through Billing on a trial workspace
and on a paid one, then production.

From now on every Stripe webhook stores the status, and a past_due workspace
that paid before stops being a trial as soon as its next webhook arrives.

## 4. Dry run

The release image wraps the command as `sync-subscription-status`, the same
way it wraps `backfill-secrets`:

```bash
docker exec -i postdelegate-postiz-postiz-1 sync-subscription-status --dry-run
```

For every Stripe-billed plan (a workspace with a `cus_` customer, not lifetime)
it reads the customer's subscriptions from Stripe, about ten a second, picks
the current one the way the webhooks do, and reports what it would write. Read
the `done` line:

- `updated`: plans it would write, `unchanged`: already right,
- `skipped`: plans an admin set (no Stripe subscription behind them),
- `endedTrials`: workspaces with no subscription left that are still marked
  as trialing, which it would clear,
- `needsAttention`: workspaces whose live Stripe subscription grants no plan
  (`unpaid`, `paused`, `canceled`, or none at all), each listed above the `done`
  line with its status. The sync never acts on them: no tier, channel or
  subscription is changed or deleted. Look each one up in Stripe; normally its
  webhook was missed, and replaying the latest `customer.subscription.*` event
  from the Stripe dashboard applies it,
- `failed`: workspaces Stripe could not be read for, or whose plan could not
  be stored (a database error), listed as `not read`. Never modified.

It prints counts and workspace ids only, never a key or a customer id.

## 5. Real run

```bash
docker exec -i postdelegate-postiz-postiz-1 sync-subscription-status
```

Idempotent, so it can be re-run. Every write is a compare-and-swap: a webhook
that stores the plan while the sync runs wins, and the row counts as
`skippedChanged` (the webhook already stored the status). It exits 2 when
anything was `needsAttention`, `failed` or `skippedChanged`, 0 when everything
is synced. A second run should show `updated: 0`.

## 6. Verify

```sql
-- Stripe plans still without a status: only lifetime and admin plans
SELECT count(*) FROM "Subscription" s JOIN "Organization" o ON o.id = s."organizationId"
  WHERE s.provider = 'stripe' AND s."deletedAt" IS NULL AND s."isLifetime" = false
    AND o."paymentId" LIKE 'cus\_%' AND s.identifier NOT LIKE 'admin\_%'
    AND s.status IS NULL;

-- a trial flag on neither a trialing subscription nor a first charge being
-- retried: should be 0
SELECT count(*) FROM "Organization" o JOIN "Subscription" s ON s."organizationId" = o.id
  WHERE o."isTrailing" = true AND s.status IS NOT NULL
    AND s.status NOT IN ('trialing', 'past_due');
```

RevenueCat plans are not synced from here: their next webhook or app sync
stores the status, and until then their flag was already right (it was always
set from the store's trial alone).

## 7. Rolling back

The previous release does not know the three columns, so the `prisma db push`
it runs at start wants to drop them, refuses without `--accept-data-loss`, and
the container does not start. Drop them by hand first, then deploy the
previous image:

```sql
ALTER TABLE "Subscription" DROP COLUMN "status", DROP COLUMN "trialEndsAt", DROP COLUMN "currentPeriodEnd";
```

Nothing else depends on them, and they can be filled again with the sync after
rolling forward. The previous release goes back to marking every status but
`active` as a trial on the next webhook of each workspace; flags the sync
cleared stay cleared until then.
