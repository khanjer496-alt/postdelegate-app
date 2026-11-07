import { Injectable } from '@nestjs/common';
import { timer } from '@gitroom/helpers/utils/timer';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import {
  currentSubscriptionOf,
  customerSubscriptionsOf,
  isTrialOf,
  subscriptionStateOf,
} from '@gitroom/nestjs-libraries/services/stripe.service';
import { STRIPE_PROVIDER } from '@gitroom/nestjs-libraries/services/payment/payment.providers';

export interface SubscriptionStatusSyncReport {
  dryRun: boolean;
  scanned: number;
  // plans written, or that a dry run would write
  updated: number;
  // already holding what Stripe has
  unchanged: number;
  // a plan an admin set: no Stripe subscription behind it
  skipped: number;
  // stored by a webhook while the sync ran, left to it
  skippedChanged: number;
  // workspaces whose live subscription grants no plan (or that have none):
  // never acted on, the webhooks or a person decide
  needsAttention: { organizationId: string; status: string }[];
  // workspaces Stripe could not be read for or that could not be stored,
  // never modified
  failed: string[];
  // workspaces with no subscription anymore that were still marked as
  // trialing, cleared (or that a dry run would clear)
  endedTrials: number;
}

const sameDate = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

// Fills the provider status (Subscription.status, trialEndsAt,
// currentPeriodEnd) of the plans stored before it was kept, and sets
// Organization.isTrailing from it (isTrialOf): a trialing subscription, or
// one whose first charge after the trial is being retried. It used to be set
// for every status but active, a past_due renewal included.
// Then clears the flag of workspaces whose subscription ended, which a
// deleted subscription never did.
// Reads Stripe live for each customer, picks the subscription the way the
// webhooks do, and writes with compare-and-swap, so a webhook landing in
// between wins. It never changes a tier, a channel or deletes anything: a
// workspace whose live subscription no longer grants a plan is reported. It
// never logs a secret, only counts and workspace ids. Idempotent, it can be
// re-run.
@Injectable()
export class SubscriptionStatusSyncService {
  constructor(private _repository: SubscriptionRepository) {}

  async run(
    options: {
      batchSize?: number;
      dryRun?: boolean;
      // between two Stripe reads, well under its rate limit
      delayMs?: number;
      onProgress?: (report: SubscriptionStatusSyncReport) => void;
    } = {}
  ): Promise<SubscriptionStatusSyncReport> {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error(
        'STRIPE_SECRET_KEY is not set, there is no Stripe to read'
      );
    }

    const batchSize = Math.max(1, options.batchSize ?? 100);
    const delayMs = Math.max(0, options.delayMs ?? 100);
    const report: SubscriptionStatusSyncReport = {
      dryRun: !!options.dryRun,
      scanned: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      skippedChanged: 0,
      needsAttention: [],
      failed: [],
      endedTrials: 0,
    };

    let reads = 0;
    let cursor: string | undefined;
    for (;;) {
      const rows = await this._repository.getProviderSubscriptionsPage(
        STRIPE_PROVIDER,
        batchSize,
        cursor
      );
      for (const row of rows) {
        report.scanned++;
        if (row.identifier?.startsWith('admin_')) {
          report.skipped++;
          continue;
        }

        let live: ReturnType<typeof currentSubscriptionOf>;
        try {
          if (reads++ && delayMs) {
            await timer(delayMs);
          }
          live = currentSubscriptionOf(
            await customerSubscriptionsOf(row.organization.paymentId!),
            row.identifier
          );
        } catch (err) {
          report.failed.push(row.organizationId);
          // the workspace and Stripe's error code, never the request
          console.error(
            `organization ${row.organizationId}: Stripe could not be read (${
              (err as { code?: string })?.code || 'error'
            })`
          );
          continue;
        }

        if (!live.entitled) {
          report.needsAttention.push({
            organizationId: row.organizationId,
            status: live.subscription?.status || 'none',
          });
          continue;
        }

        const state = subscriptionStateOf(live.subscription);
        const isTrailing = isTrialOf(live.subscription);
        if (
          row.status === state.status &&
          sameDate(row.trialEndsAt, state.trialEndsAt) &&
          sameDate(row.currentPeriodEnd, state.currentPeriodEnd) &&
          row.organization.isTrailing === isTrailing
        ) {
          report.unchanged++;
          continue;
        }
        if (report.dryRun) {
          report.updated++;
          continue;
        }

        let written: boolean;
        try {
          written = await this._repository.setProviderStateIfUnchanged(
            row,
            { from: row.organization.isTrailing, to: isTrailing },
            state
          );
        } catch (err) {
          report.failed.push(row.organizationId);
          // the workspace only, never the query
          console.error(
            `organization ${row.organizationId}: could not be stored`
          );
          continue;
        }
        if (written) {
          report.updated++;
        } else {
          report.skippedChanged++;
        }
      }
      options.onProgress?.({ ...report });
      if (rows.length < batchSize) {
        break;
      }
      cursor = rows[rows.length - 1].id;
    }

    // a subscription that ended never cleared the flag before
    report.endedTrials = report.dryRun
      ? await this._repository.countEndedTrialFlags()
      : (await this._repository.clearEndedTrialFlags()).count;

    return report;
  }
}
