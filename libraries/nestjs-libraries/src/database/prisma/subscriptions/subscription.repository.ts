import { Injectable } from '@nestjs/common';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import dayjs from 'dayjs';
import { Organization, Prisma } from '@prisma/client';

// What the payment provider says about a subscription right now, stored on
// the row as it comes: its own status (Stripe's trialing, active, past_due,
// paused...), when its trial ends and when the period being paid ends
export type SubscriptionProviderState = {
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
};

// A plan with no provider status (a lifetime code, an admin plan) stores none
const providerStateOf = (state?: SubscriptionProviderState) => ({
  status: state?.status ?? null,
  trialEndsAt: state?.trialEndsAt ?? null,
  currentPeriodEnd: state?.currentPeriodEnd ?? null,
});

// Thrown inside the status sync's transaction to roll back a half-done
// compare-and-swap, never outside this file
class ChangedSince extends Error {}

@Injectable()
export class SubscriptionRepository {
  constructor(
    private readonly _subscription: PrismaRepository<'subscription'>,
    private readonly _organization: PrismaRepository<'organization'>,
    private readonly _user: PrismaRepository<'user'>,
    private readonly _credits: PrismaRepository<'credits'>,
    private _usedCodes: PrismaRepository<'usedCodes'>,
    private _transaction: PrismaTransaction
  ) {}

  getUserAccount(userId: string) {
    return this._user.model.user.findFirst({
      where: {
        id: userId,
      },
      select: {
        account: true,
        connectedAccount: true,
      },
    });
  }

  getCode(code: string) {
    return this._usedCodes.model.usedCodes.findFirst({
      where: {
        code,
      },
    });
  }

  updateAccount(userId: string, account: string) {
    return this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        account,
      },
    });
  }

  getSubscriptionByOrganizationId(organizationId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        deletedAt: null,
      },
    });
  }

  updateConnectedStatus(account: string, accountCharges: boolean) {
    return this._user.model.user.updateMany({
      where: {
        account,
      },
      data: {
        connectedAccount: accountCharges,
      },
    });
  }

  getCustomerIdByOrgId(organizationId: string) {
    return this._organization.model.organization.findFirst({
      where: {
        id: organizationId,
      },
      select: {
        paymentId: true,
      },
    });
  }

  checkSubscription(organizationId: string, subscriptionId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        identifier: subscriptionId,
        deletedAt: null,
      },
    });
  }

  // a lifetime plan is never removed by a customer-keyed cancellation. A
  // workspace whose subscription ended is no longer in a trial: the flag is
  // cleared with it, only when a subscription was removed (a workspace that
  // never subscribed keeps the one it signed up with)
  deleteSubscriptionByCustomerId(customerId: string, provider: string) {
    return this._transaction.model.$transaction(async (tx) => {
      const deleted = await tx.subscription.deleteMany({
        where: {
          provider,
          isLifetime: false,
          organization: {
            paymentId: customerId,
          },
        },
      });
      if (deleted.count) {
        await tx.organization.updateMany({
          where: {
            paymentId: customerId,
          },
          data: {
            isTrailing: false,
          },
        });
      }
      return deleted;
    });
  }

  deleteSubscriptionByOrgId(organizationId: string, provider: string) {
    return this._transaction.model.$transaction(async (tx) => {
      const deleted = await tx.subscription.deleteMany({
        where: {
          organizationId,
          provider,
        },
      });
      if (deleted.count) {
        await tx.organization.update({
          where: {
            id: organizationId,
          },
          data: {
            isTrailing: false,
          },
          select: { id: true },
        });
      }
      return deleted;
    });
  }

  updateCustomerId(organizationId: string, customerId: string) {
    return this._organization.model.organization.update({
      where: {
        id: organizationId,
      },
      data: {
        paymentId: customerId,
      },
    });
  }

  updateCancelAt(organizationId: string, cancelAt: number | null) {
    return this._subscription.model.subscription.updateMany({
      where: {
        organizationId,
        deletedAt: null,
      },
      data: {
        cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
      },
    });
  }

  async getSubscriptionByOrgId(orgId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId: orgId,
      },
    });
  }

  async getSubscriptionByCustomerId(customerId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organization: {
          paymentId: customerId,
        },
      },
    });
  }

  async getOrganizationByCustomerId(customerId: string) {
    return this._organization.model.organization.findFirst({
      where: {
        paymentId: customerId,
      },
    });
  }

  async createOrUpdateSubscription(
    provider: string,
    isTrailing: boolean,
    identifier: string,
    customerId: string,
    totalChannels: number,
    billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    period: 'MONTHLY' | 'YEARLY',
    cancelAt: number | null,
    code?: string,
    org?: { id: string },
    state?: SubscriptionProviderState
  ) {
    const findOrg =
      org || (await this.getOrganizationByCustomerId(customerId))!;

    if (!findOrg) {
      return;
    }

    await this._subscription.model.subscription.upsert({
      where: {
        organizationId: findOrg.id,
        ...(!code && customerId
          ? {
              organization: {
                paymentId: customerId,
              },
            }
          : {}),
      },
      update: {
        subscriptionTier: billing,
        provider,
        totalChannels,
        period,
        identifier,
        isLifetime: !!code,
        cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
        ...providerStateOf(state),
        deletedAt: null,
      },
      create: {
        organizationId: findOrg.id,
        subscriptionTier: billing,
        provider,
        isLifetime: !!code,
        totalChannels,
        period,
        cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
        ...providerStateOf(state),
        identifier,
        deletedAt: null,
      },
    });

    await this._organization.model.organization.update({
      where: {
        id: findOrg.id,
      },
      data: {
        isTrailing,
        allowTrial: false,
      },
    });

    if (code) {
      await this._usedCodes.model.usedCodes.create({
        data: {
          code,
          orgId: findOrg.id,
        },
      });
    }
  }

  // A lifetime code is checked, spent and its plan written in one
  // serializable transaction: UsedCodes.code is not unique, so two concurrent
  // redeems of one code would otherwise both see it unused and both win. The
  // loser's transaction fails (serialization) or sees the code spent and
  // writes nothing. false: the code was already used
  async createOrUpdateLifetimeSubscription(
    provider: string,
    identifier: string,
    totalChannels: number,
    billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    period: 'MONTHLY' | 'YEARLY',
    code: string,
    organizationId: string
  ) {
    return this._transaction.model.$transaction(
      async (tx) => {
        const used = await tx.usedCodes.findFirst({
          where: { code },
          select: { id: true },
        });
        if (used) {
          return false;
        }

        await tx.subscription.upsert({
          where: {
            organizationId,
          },
          update: {
            subscriptionTier: billing,
            provider,
            totalChannels,
            period,
            identifier,
            isLifetime: true,
            cancelAt: null,
            ...providerStateOf(),
            deletedAt: null,
          },
          create: {
            organizationId,
            subscriptionTier: billing,
            provider,
            isLifetime: true,
            totalChannels,
            period,
            cancelAt: null,
            ...providerStateOf(),
            identifier,
            deletedAt: null,
          },
        });

        await tx.organization.update({
          where: {
            id: organizationId,
          },
          data: {
            isTrailing: false,
            allowTrial: false,
          },
          select: { id: true },
        });

        await tx.usedCodes.create({
          data: {
            code,
            orgId: organizationId,
          },
          select: { id: true },
        });

        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  getSubscriptionByIdentifier(identifier: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        identifier,
        deletedAt: null,
      },
      include: {
        organization: true,
      },
    });
  }

  getSubscription(organizationId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        deletedAt: null,
      },
    });
  }

  async getCreditsFrom(
    organizationId: string,
    from: dayjs.Dayjs,
    type = 'ai_images'
  ) {
    const load = await this._credits.model.credits.groupBy({
      by: ['organizationId'],
      where: {
        organizationId,
        type,
        createdAt: {
          gte: from.toDate(),
        },
      },
      _sum: {
        credits: true,
      },
    });

    return load?.[0]?._sum?.credits || 0;
  }

  async useCredit<T>(
    org: Organization,
    type = 'ai_images',
    func: () => Promise<T>
  ) {
    const data = await this._credits.model.credits.create({
      data: {
        organizationId: org.id,
        credits: 1,
        type,
      },
    });

    try {
      return await func();
    } catch (err) {
      await this._credits.model.credits.delete({
        where: {
          id: data.id,
        },
      });
      throw err;
    }
  }

  // The caller picks the id, so charging the same work twice is one row
  chargeCredits(
    id: string,
    organizationId: string,
    type: string,
    credits: number
  ) {
    return this._credits.model.credits.upsert({
      where: {
        id,
      },
      create: {
        id,
        organizationId,
        credits,
        type,
      },
      update: {},
      select: {
        id: true,
      },
    });
  }

  refundCredits(organizationId: string, id: string) {
    return this._credits.model.credits.deleteMany({
      where: {
        id,
        organizationId,
      },
    });
  }

  deleteCreditsFrom(organizationId: string, from: dayjs.Dayjs, type: string) {
    return this._credits.model.credits.deleteMany({
      where: {
        organizationId,
        type,
        createdAt: {
          gte: from.toDate(),
        },
      },
    });
  }

  // The plans the status sync (sync-subscription-status) walks: the ones
  // billed by `provider` on a Stripe customer, a page at a time in id order
  // so a run can resume. A lifetime plan has no subscription behind it
  getProviderSubscriptionsPage(
    provider: string,
    take: number,
    cursor?: string
  ) {
    return this._subscription.model.subscription.findMany({
      where: {
        provider,
        deletedAt: null,
        isLifetime: false,
        organization: {
          paymentId: {
            startsWith: 'cus_',
          },
        },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: {
        id: 'asc',
      },
      take,
      select: {
        id: true,
        organizationId: true,
        identifier: true,
        status: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
        updatedAt: true,
        organization: {
          select: {
            paymentId: true,
            isTrailing: true,
          },
        },
      },
    });
  }

  // Stores the provider state and the trial flag only while the plan and the
  // workspace still hold what the status sync read: a webhook that stored
  // the plan since (updatedAt moved) or changed the flag wins, and nothing is
  // written. Both are written or neither. false: changed since
  async setProviderStateIfUnchanged(
    subscription: { id: string; organizationId: string; updatedAt: Date },
    isTrailing: { from: boolean; to: boolean },
    state: SubscriptionProviderState
  ) {
    try {
      return await this._transaction.model.$transaction(async (tx) => {
        const plan = await tx.subscription.updateMany({
          where: {
            id: subscription.id,
            updatedAt: subscription.updatedAt,
          },
          data: providerStateOf(state),
        });
        if (!plan.count) {
          throw new ChangedSince();
        }
        const organization = await tx.organization.updateMany({
          where: {
            id: subscription.organizationId,
            isTrailing: isTrailing.from,
          },
          data: {
            isTrailing: isTrailing.to,
          },
        });
        if (!organization.count) {
          throw new ChangedSince();
        }
        return true;
      });
    } catch (err) {
      if (err instanceof ChangedSince) {
        return false;
      }
      throw err;
    }
  }

  // Workspaces still marked as trialing whose subscription ended before an
  // ended one cleared the flag: no subscription, and allowTrial off, which
  // only a stored subscription turns off (a workspace that never subscribed
  // keeps allowTrial and the flag it signed up with)
  private endedTrialFlags() {
    return {
      isTrailing: true,
      allowTrial: false,
      subscription: {
        is: null,
      },
    };
  }

  countEndedTrialFlags() {
    return this._organization.model.organization.count({
      where: this.endedTrialFlags(),
    });
  }

  // the filter is the compare-and-swap: a workspace that subscribed since
  // has a subscription and is left alone
  clearEndedTrialFlags() {
    return this._organization.model.organization.updateMany({
      where: this.endedTrialFlags(),
      data: {
        isTrailing: false,
      },
    });
  }

  setCustomerId(orgId: string, customerId: string) {
    return this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        paymentId: customerId,
      },
    });
  }
}
