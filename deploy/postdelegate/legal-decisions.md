# Owner decisions on the legal pages

The seven decisions the launch tracker was holding, decided on 6 November 2026,
with what each one changed. Three needed no change: the pages already said what
we decided. One cannot be finished without buying a service, and is the only
item here still open.

## 1. Refund window and the EU right to withdraw — CHANGED

**Decided (7 Nov 2026, owner: "match postiz"):** the voluntary refund is now
Postiz's own shape &mdash; **at most one month of the plan**, only if the last
charge was within **120 days**, **once per workspace, ever**, and on a yearly
plan that month is one twelfth of the yearly charge. We may refund more case by
case without that becoming a rule. The statutory right below is untouched and
is explicitly not capped by any of it.

Postiz publishes this in two places that do not agree on the window. Its docs
say "It must be less than 60 days old", "The amount is capped at one month of
your plan", "One refund per customer, ever" and "A yearly charge is refunded at
one twelfth". Its terms set a 120-day window, limit a refund to a maximum of
one month's subscription fee per account, and say charges for annual
subscriptions are not refundable. (Those last two are consistent with each
other - annual excluded outright, monthly capped - so the real conflict is 60
days against 120.)

We took the terms' window, because the terms are the governing document and 120
days is the more generous reading, and the docs' yearly handling, because
refunding one twelfth of a yearly charge is kinder than refunding nothing and
still inside the one-month cap. So this is Postiz's shape, slightly more
generous than their terms on yearly plans. Postiz also cancels the subscription
as part of the refund; ours says so too, and that the workspace moves to the
free limits when the refund is issued, because refunding a month and leaving
the month running is not what either of us means.

What this replaced (6 Nov, merged but never published - the live page was still
the 1 November version, which said only that fees were non-refundable): a full
refund of the first paid invoice within 14 days, once per workspace, monthly
and yearly alike. Because that wording never reached a customer, nothing
published was taken away; against the page it actually replaces, 7 November is
strictly more generous. That was mid-market &mdash;
more generous than Hootsuite, Later and Metricool, who publish no refund window
at all, and tighter than Buffer (7 days monthly, 30 annual) and SocialBee (30
days, both plan types) on annual plans. The one place it went beyond everyone
was refunding a *yearly* invoice in full rather than a month of it.

The limit is per workspace **and per email address**, borrowed from the trial
clause one paragraph up. Refunds are issued by hand in Stripe, where history is
per Stripe customer and not per workspace, so a per-workspace-only limit would
have been invisible to the person issuing the second one.

Note for anyone tightening this further: a one-month cap is not enforceable
against an EU, EEA or UK consumer inside the 14-day withdrawal window, who is
entitled to everything back. Postiz says as much in its own terms ("Nothing in
this Refund Policy limits any non-waivable refund or withdrawal rights"). We
set it out in full instead of relying on a carve-out sentence, because the old
wording ("non-refundable ... except where the law requires otherwise") pushed
every EU consumer into hunting for a right they already had.

**Also added:** the EU, EEA and UK consumer right to withdraw within 14 days,
written out, with the model form from Annex I(B) of the Consumer Rights
Directive.

The first draft said that asking us to start immediately meant a proportionate
charge for the days used. An Opus review caught that this is a right we could
not actually exercise: Art. 14(3) allows that charge only where the trader
obtained an **express** request under Art. 8(8), and a sentence inside accepted
terms is not one — it needs an affirmative step at checkout, which the sign-up
flow does not have. Without it, Art. 14(4)(a)(i) says the consumer bears no
cost at all. So rather than add a checkbox to the checkout to keep a few days'
fees, the clause now promises a **full refund on withdrawal**, which is what
the law would give anyway.

Two further corrections from that review: the right turns on the buyer's
capacity, not the plan they bought, so "consumer" is now defined in Art. 2(1)
terms instead of excluding "a business subscription"; and the clause says the
once-per-workspace limit under Refunds does not cap the statutory right.

A refund reverses the affiliate commission on that invoice, which the affiliate
terms already provided for.

## 2. Notice before a price change — NO CHANGE

**Decided: 30 days**, which `terms.html` already said ("at least 30 days'
notice, effective from your next renewal"). It is the common SaaS figure, it is
longer than a monthly billing cycle so a customer can always leave before
paying the new price, and nothing about the business argues for more.

## 3. How long billing records are kept — CHANGED

**Decided: 7 years** after the account or workspace closes, longer only where a
tax authority requires it or while a dispute or chargeback is unresolved.

The privacy policy said "as long as needed for tax, accounting and legal
obligations", which is not a retention period — it is a promise to decide
later, and Art. 13(2)(a) asks for the period or the criteria.

The first draft said "kept for 7 years" and lumped the affiliate commission
ledger in with invoices. The review caught that this contradicted our own code:
`erasure.decisions.ts` keeps `AffiliateCommission` with `scope: 'retain'`,
"never deleted", and keeps the affiliate profile so the ledger keeps its
foreign key. Nothing deletes anything at 7 years. The two are now separated and
each says what is true: invoices and Stripe identifiers for **at least** 7
years, deleted once no obligation or dispute requires them; the commission
ledger as a permanent financial record, which the affiliate terms already said,
with the payout email removed on erasure.

"7 years" is also no longer described as what our obligations require, since
several member states require longer (Germany and Italy 10, the Netherlands 7).
It is the period we have set, with the longer-where-required sentence carrying
the rest.

## 4. Art. 27 representative or a DPO — DECIDED, ONE PART OPEN

**Decided: no data protection officer.** Not required of us under Art. 37, and
the policy now says so. It deliberately does not publish the element-by-element
finding (no public authority, no large-scale special-category processing, no
systematic monitoring) that the first draft did: all three are true today, but
publishing them as a legal conclusion makes the policy false the day the
product adds audience analytics or social listening. Privacy mail goes to support@postdelegate.com. The policy
also now tells people they can complain to their own supervisory authority, or
the ICO in the UK, without coming to us first.

**Open: the EU and UK representatives must be appointed, and only Naser can do
it.** A US company with no EU establishment that offers a service to people in
the EU needs a representative in the EU under Art. 27, and a separate one in
the UK under the UK GDPR. There is no exemption we fit: the one in Art. 27(2)
is for occasional, low-risk processing, and a subscription product holding
social-account tokens is neither. It is a paid appointment (roughly
EUR 200-500 a year for each, from a service such as Prighter, DataRep or
VeraSafe) and it needs a signed mandate, so it cannot be done from here.

Nothing was written into the policy claiming a representative exists. The
paragraph to publish the day one is appointed, with the name and address filled
in, is:

> **Our representatives.** Nasida Apps LLC has no establishment in the EU or
> the UK. Under Article 27 of the GDPR our representative in the EU is
> <name, full address, email>, and under Article 27 of the UK GDPR our
> representative in the UK is <name, full address, email>. You may contact
> either of them, in place of us, about anything to do with the processing of
> your personal data. Contacting a representative does not affect your right to
> complain to a supervisory authority.

It belongs in section 17, next to the DPO paragraph, and the "What changed"
note at the top of the policy should say the representatives were appointed.

Until then we are offering the service to EU customers without a representative
in place. That is a real, if common, gap for a company this size, and it is the
one legal item that should close before paid EU sign-ups open.

## 5. Affiliate payouts — NO CHANGE

**Decided: monthly, by PayPal, above a USD 50 balance**, which
`affiliate-terms.html` already said, together with the roll-over of smaller
balances, payment in US dollars, who pays the provider's fees, and reversal on
refund or chargeback. Confirmed as written.

## 6. Skool — DECIDED: STAYS HIDDEN

Skool has no official public posting API. The provider in the codebase works
against endpoints that can change without notice, which is the wrong thing to
put in front of a paying customer at launch, and "coming soon" is a promise we
would not control the date of. It stays in `HIDDEN_PROVIDERS` with no date
attached; the one-line server change is to keep `skool` in that list in
`/opt/postiz/runtime.env`. Revisit if Skool publishes a real API.

## 7. The referral-consent text — APPROVED AS WRITTEN

The wording shipped in PR #96 and has been live since 2 November. Re-read on
6 November against what the code does: it asks before the referral cookie, the
saved campaign source or any analytics are stored; it says that rejecting still
lets an attribution happen if you sign up in that same visit, because the code
travels in the link rather than in storage; it names the `pd_consent` cookie
and its 6-month life; and it is honest that a referral cookie set before the
banner existed can still be used until it expires. That matches the
implementation, so it is approved unchanged.

## Not a decision, still Naser's: the Stripe brand icon and tax address

Stripe shows an orange "N" in the billing portal and some emails, and Stripe
Tax wants a head-office address before it can collect VAT or sales tax. Both
live in the Stripe dashboard behind his login.


## What the review changed, and one thing it found elsewhere

The Opus review of this change earned the pass three times over: the withdrawal
clause asserted a proportionate charge we had not earned the right to make, the
7-year retention claim contradicted the erasure code, and the in-app modal
shown when someone ends their trial early said "this payment is final and not
refundable" — the exact payment the new terms make refundable for 14 days,
contradicted at the moment of paying. That modal now points at the refund.

It also found that `legal-public/index.html` was a 26 October owner-review
draft, saying the policies were unverified and the registered address a
placeholder, sitting in the directory that is the Caddy `root` for every legal
route. It was unreachable only because each route matches an exact path. It has
moved to `legal-review-archive/`, outside what gets served, and the README note
that keeps it now says why.

Two things it raised that are not fixed here. The affiliate reversal the terms
promise depends on Stripe's `charge.refunded` event, which is documented in
`.env.example` but not in `deploy/postdelegate/runtime.env.example`, and
`chargeRefunded` swallows failures into `console.error` with no alert — so the
promise could quietly stop being true. And if mobile billing is ever switched
on, RevenueCat cannot refund through our own code at all, so the unqualified
refund promise and the "processed by Stripe" line in section 5 both need
revisiting before that.

Left alone deliberately: `site/src/pages/compare/postiz-vs-post-bridge.astro`
lists a competitor's 7-day refund under "where they win", which our 14 days now
beats. Correcting a factual claim about someone else's current policy means
checking that policy first, so it is a marketing follow-up, not a guess.
