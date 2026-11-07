import { Injectable } from '@nestjs/common';
import {
  pricing,
  providerPostsLimitsOf,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import {
  SubscriptionProviderState,
  SubscriptionRepository,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { Organization } from '@prisma/client';
import dayjs from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { countPlanChannels } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.state';

type Tier = 'FREE' | 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE';

// What a subscription write tells the payment webhook that asked for it:
// `retry` - the plan could not be read or stored (a database error), the
// webhook answers non-2xx so the provider sends the event again (every step
// is safe to run twice); `codeUsed` - a lifetime code was redeemed by someone
// else first. Skipped events (unknown customer, a lifetime plan, another
// provider's plan) are not failures and return neither, and neither is a
// plan change that fails on what the event carries (an unknown plan in its
// metadata): it is logged and acknowledged, a retry would fail the same way
export type SubscriptionWriteResult =
  | { retry?: boolean; codeUsed?: boolean }
  | undefined;

// The plan month `at` falls in: k whole months after the anchor, both ends
// taken from the anchor, so months that clamp (an anchor on the 29th to 31st)
// leave no gap or overlap between one window and the next
export const planMonth = (anchor: Date, at: Date | string = new Date()) => {
  const start = dayjs(anchor);
  let k = Math.max(0, dayjs(at).diff(start, 'month'));
  while (k > 0 && dayjs(at).isBefore(start.add(k, 'month'))) {
    k--;
  }
  while (!dayjs(at).isBefore(start.add(k + 1, 'month'))) {
    k++;
  }
  return {
    from: start.add(k, 'month').toDate(),
    until: start.add(k + 1, 'month').toDate(),
  };
};

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly _subscriptionRepository: SubscriptionRepository,
    private readonly _integrationService: IntegrationService,
    private readonly _organizationService: OrganizationService
  ) {}

  getSubscriptionByOrganizationId(organizationId: string) {
    return this._subscriptionRepository.getSubscriptionByOrganizationId(
      organizationId
    );
  }

  useCredit<T>(
    organization: Organization,
    type = 'ai_images',
    func: () => Promise<T>
  ): Promise<T> {
    return this._subscriptionRepository.useCredit(organization, type, func);
  }

  getCode(code: string) {
    return this._subscriptionRepository.getCode(code);
  }

  // Customer-keyed flows must never touch a subscription owned by another provider
  private async isManagedBy(customerId: string, provider: string) {
    const current =
      await this._subscriptionRepository.getSubscriptionByCustomerId(
        customerId
      );
    return !current || current.provider === provider;
  }

  // Reached from payment webhooks: never throws. A lifetime plan is never
  // removed by a customer-keyed cancellation, like deleteSubscriptionByOrgId
  async deleteSubscription(
    customerId: string,
    provider: string
  ): Promise<{ count: number; retry?: boolean }> {
    try {
      const current =
        await this._subscriptionRepository.getSubscriptionByCustomerId(
          customerId
        );
      if (current && (current.provider !== provider || current.isLifetime)) {
        return { count: 0 };
      }
      await this.modifySubscription(
        customerId,
        pricing.FREE.channel || 0,
        'FREE'
      );
      return await this._subscriptionRepository.deleteSubscriptionByCustomerId(
        customerId,
        provider
      );
    } catch (err) {
      console.error('Error deleting subscription:', err);
      return { count: 0, retry: true };
    }
  }

  // Store-managed subscriptions (RevenueCat etc.) have no Stripe customer, they are keyed by org
  async deleteSubscriptionByOrgId(organizationId: string, provider: string) {
    const current = await this._subscriptionRepository.getSubscriptionByOrgId(
      organizationId
    );
    if (!current || current.provider !== provider || current.isLifetime) {
      return false;
    }

    await this.modifySubscriptionByOrg(
      organizationId,
      pricing.FREE.channel || 0,
      'FREE'
    );
    return this._subscriptionRepository.deleteSubscriptionByOrgId(
      organizationId,
      provider
    );
  }

  updateCustomerId(organizationId: string, customerId: string) {
    return this._subscriptionRepository.updateCustomerId(
      organizationId,
      customerId
    );
  }

  updateCancelAt(organizationId: string, cancelAt: number | null) {
    return this._subscriptionRepository.updateCancelAt(
      organizationId,
      cancelAt
    );
  }

  async checkSubscription(organizationId: string, subscriptionId: string) {
    return await this._subscriptionRepository.checkSubscription(
      organizationId,
      subscriptionId
    );
  }

  async modifySubscriptionByOrg(
    organizationId: string,
    totalChannels: number,
    billing: Tier
  ) {
    if (!organizationId) {
      return false;
    }

    const getCurrentSubscription =
      await this._subscriptionRepository.getSubscriptionByOrgId(organizationId);

    await this.applyPlanChange(
      organizationId,
      getCurrentSubscription,
      totalChannels,
      billing
    );

    return true;
  }

  async modifySubscription(
    customerId: string,
    totalChannels: number,
    billing: Tier
  ) {
    if (!customerId) {
      return false;
    }

    const getOrgByCustomerId =
      await this._subscriptionRepository.getOrganizationByCustomerId(
        customerId
      );

    const getCurrentSubscription =
      await this._subscriptionRepository.getSubscriptionByCustomerId(
        customerId
      );

    if (
      !getOrgByCustomerId ||
      (getCurrentSubscription && getCurrentSubscription?.isLifetime)
    ) {
      return false;
    }

    await this.applyPlanChange(
      getOrgByCustomerId.id,
      getCurrentSubscription,
      totalChannels,
      billing
    );

    return true;
  }

  // What moving from the `current` plan to `billing` does to the workspace:
  // channels over the new limit are locked (turned off, newest first),
  // channels a downgrade locked come back when the limit grew, as many as it
  // has room for, team members follow the plan, and a plan without AutoPost
  // stops it. Channels are counted with countPlanChannels, like every other
  // limit check
  private async applyPlanChange(
    organizationId: string,
    current: { subscriptionTier: Tier; totalChannels: number } | null,
    totalChannels: number,
    billing: Tier
  ) {
    const from = pricing[current?.subscriptionTier || 'FREE'];
    const to = pricing[billing];

    const activeChannels = countPlanChannels(
      await this._integrationService.getIntegrationsList(organizationId)
    );

    if (activeChannels > totalChannels) {
      await this._integrationService.disableIntegrations(
        organizationId,
        activeChannels - totalChannels
      );
    }

    // only the channels a downgrade locked (DISABLED_BY_PLAN) come back, and
    // only when the limit grew: a same-plan update or a renewal never turns a
    // channel on. As many come back as the new limit has room for next to the
    // channels already on, so a partial unlock is fine. One the customer
    // turned off, or one turned off before the reason was recorded, stays off
    if (
      billing !== 'FREE' &&
      totalChannels > (current?.totalChannels || 0) &&
      totalChannels > activeChannels
    ) {
      try {
        await this._integrationService.enablePlanLockedIntegrations(
          organizationId,
          totalChannels - activeChannels
        );
      } catch (err) {
        console.error(
          'Error enabling channels after subscription change:',
          err
        );
      }
    }

    if (from.team_members && !to.team_members) {
      await this._organizationService.disableOrEnableNonSuperAdminUsers(
        organizationId,
        true
      );
    }

    if (!from.team_members && to.team_members) {
      await this._organizationService.disableOrEnableNonSuperAdminUsers(
        organizationId,
        false
      );
    }

    if (billing === 'FREE') {
      await this._integrationService.changeActiveCron(organizationId);
    }
  }

  // Reached from payment webhooks: never throws, see SubscriptionWriteResult.
  // isTrailing: the provider has the subscription in its trial (Stripe:
  // isTrialOf, never a past_due renewal). `state`: the provider's own status
  // and dates, stored as they come; none for a plan without one (lifetime,
  // admin)
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
    org?: string,
    state?: SubscriptionProviderState
  ): Promise<SubscriptionWriteResult> {
    if (code) {
      return this.redeemLifetimeCode(
        provider,
        identifier,
        totalChannels,
        billing,
        period,
        code,
        org || customerId
      );
    }

    try {
      if (!(await this.isManagedBy(customerId, provider))) {
        return {};
      }
    } catch (e) {
      console.error('Error reading the subscription:', e);
      return { retry: true };
    }

    try {
      const load = await this.modifySubscription(
        customerId,
        totalChannels,
        billing
      );
      if (!load) {
        return {};
      }
    } catch (e) {
      console.error('Error modifying subscription:', e);
      return {};
    }

    try {
      await this._subscriptionRepository.createOrUpdateSubscription(
        provider,
        isTrailing,
        identifier,
        customerId,
        totalChannels,
        billing,
        period,
        cancelAt,
        undefined,
        org ? { id: org } : undefined,
        state
      );
      return undefined;
    } catch (e) {
      console.error('Error storing subscription:', e);
      return { retry: true };
    }
  }

  // The code is checked and spent in the same transaction as the plan is
  // written, so two redeems of one code can't both win. The workspace then
  // gets what any upgrade gives it (applyPlanChange): channels a downgrade
  // locked come back as far as the plan has room, team members are enabled
  private async redeemLifetimeCode(
    provider: string,
    identifier: string,
    totalChannels: number,
    billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    period: 'MONTHLY' | 'YEARLY',
    code: string,
    organizationId: string
  ): Promise<SubscriptionWriteResult> {
    let previous: { subscriptionTier: Tier; totalChannels: number } | null =
      null;
    try {
      previous = await this._subscriptionRepository.getSubscriptionByOrgId(
        organizationId
      );
      const redeemed =
        await this._subscriptionRepository.createOrUpdateLifetimeSubscription(
          provider,
          identifier,
          totalChannels,
          billing,
          period,
          code,
          organizationId
        );
      if (!redeemed) {
        return { codeUsed: true };
      }
    } catch (e) {
      console.error('Error redeeming lifetime code:', e);
      return { retry: true };
    }

    // the plan is already stored: a failure here is logged, the code is spent
    try {
      await this.applyPlanChange(
        organizationId,
        previous,
        totalChannels,
        billing
      );
    } catch (e) {
      console.error('Error applying the lifetime plan:', e);
    }
    return undefined;
  }

  // Reached from payment webhooks: never throws, see SubscriptionWriteResult
  // and createOrUpdateSubscription for isTrailing and `state`
  async createOrUpdateSubscriptionByOrg(
    isTrailing: boolean,
    organizationId: string,
    provider: string,
    identifier: string,
    totalChannels: number,
    billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    period: 'MONTHLY' | 'YEARLY',
    cancelAt: number | null,
    state?: SubscriptionProviderState
  ): Promise<SubscriptionWriteResult> {
    try {
      const current =
        await this._subscriptionRepository.getSubscriptionByOrgId(
          organizationId
        );
      if (current && (current.isLifetime || current.provider !== provider)) {
        return {};
      }
    } catch (e) {
      console.error('Error reading the subscription:', e);
      return { retry: true };
    }

    try {
      const load = await this.modifySubscriptionByOrg(
        organizationId,
        totalChannels,
        billing
      );
      if (!load) {
        return {};
      }
    } catch (e) {
      console.error('Error modifying subscription:', e);
      return {};
    }

    try {
      await this._subscriptionRepository.createOrUpdateSubscription(
        provider,
        isTrailing,
        identifier,
        '',
        totalChannels,
        billing,
        period,
        cancelAt,
        undefined,
        { id: organizationId },
        state
      );
      return undefined;
    } catch (e) {
      console.error('Error storing subscription:', e);
      return { retry: true };
    }
  }



  // Channels that count against the limit right now, the ones a lower limit
  // would disable (modifySubscription)
  async getActiveChannelsCount(organizationId: string) {
    return countPlanChannels(
      await this._integrationService.getIntegrationsList(organizationId)
    );
  }

  getSubscriptionByIdentifier(identifier: string) {
    return this._subscriptionRepository.getSubscriptionByIdentifier(identifier);
  }

  // For work that is metered (minutes) and outlives a single call, so it can't
  // be wrapped in useCredit: the caller picks the id, charging twice is one
  // row, and the same id refunds it on failure
  chargeCredits(
    id: string,
    organizationId: string,
    type: string,
    credits: number
  ) {
    return this._subscriptionRepository.chargeCredits(
      id,
      organizationId,
      type,
      credits
    );
  }

  refundCredits(organizationId: string, id: string) {
    return this._subscriptionRepository.refundCredits(organizationId, id);
  }

  async getSubscription(organizationId: string) {
    return this._subscriptionRepository.getSubscription(organizationId);
  }

  private currentPeriodStart(subscriptionCreatedAt: Date) {
    let date = dayjs(subscriptionCreatedAt);
    while (date.isBefore(dayjs())) {
      date = date.add(1, 'month');
    }

    return date.subtract(1, 'month');
  }

  async resetCredits(organizationId: string, type: string) {
    const subscription = await this._subscriptionRepository.getSubscription(
      organizationId
    );

    if (!subscription) {
      return null;
    }

    const { count } = await this._subscriptionRepository.deleteCreditsFrom(
      organizationId,
      this.currentPeriodStart(subscription.createdAt),
      type
    );

    return { deleted: count };
  }

  // The plan's monthly caps on single networks (provider_posts_per_month) and
  // the anchor of its months (planMonth), the subscription's start like
  // posts_per_month. A workspace marked isTrailing also gets the trial caps:
  // they only apply once the payment provider confirms the trial live (the
  // stored flag can lag behind a webhook still on its way). Without billing
  // there are no plans to cap
  async getProviderPostsLimits(organizationId: string) {
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return null;
    }

    const [subscription, organization] = await Promise.all([
      this._subscriptionRepository.getSubscriptionByOrganizationId(
        organizationId
      ),
      this._organizationService.getOrgById(organizationId),
    ]);
    const tier = subscription?.subscriptionTier || 'FREE';
    const maybeTrial = !!subscription && !!organization?.isTrailing;

    return {
      plan: pricing[tier].label || tier,
      limits: providerPostsLimitsOf(tier),
      ...(maybeTrial ? { trialLimits: providerPostsLimitsOf(tier, true) } : {}),
      // without a subscription every cap is 0, the month doesn't matter
      anchor: subscription?.createdAt || new Date(),
    };
  }

  async checkCredits(organization: Organization, checkType = 'ai_images') {
    // @ts-ignore
    const type = organization?.subscription?.subscriptionTier || 'FREE';

    if (type === 'FREE') {
      return { credits: 0 };
    }

    const checkFromMonth = this.currentPeriodStart(
      // @ts-ignore
      organization.subscription.createdAt
    );
    const imageGenerationCount =
      checkType === 'ai_images'
        ? pricing[type].image_generation_count
        : checkType === 'clipping_minutes'
        ? pricing[type].clipping_minutes
        : pricing[type].generate_videos;

    const totalUse = await this._subscriptionRepository.getCreditsFrom(
      organization.id,
      checkFromMonth,
      checkType
    );

    return {
      credits: imageGenerationCount - totalUse,
    };
  }

  // A plan a super admin sets, keyed by the workspace. It never touches
  // Organization.paymentId: that holds the workspace's Stripe customer, and
  // writing the admin's user id there broke every later Stripe call
  // (cancelling on account deletion, checkout). The `admin_` identifier tells
  // these plans apart from paid ones. A workspace on a lifetime plan or on
  // another provider's plan is left as it is, and the admin is told why
  async addSubscription(
    orgId: string,
    subscription: any,
    provider: string
  ): Promise<{ added: boolean; reason?: string }> {
    const current = await this._subscriptionRepository.getSubscriptionByOrgId(
      orgId
    );
    if (current?.isLifetime) {
      return {
        added: false,
        reason: 'This workspace has a lifetime plan, it was left as it is',
      };
    }
    if (current && current.provider !== provider) {
      return {
        added: false,
        reason: `This workspace's plan is managed by ${current.provider}, it was left as it is`,
      };
    }

    const result = await this.createOrUpdateSubscriptionByOrg(
      false,
      orgId,
      provider,
      `admin_${makeId(5)}`,
      pricing[subscription].channel!,
      subscription,
      'MONTHLY',
      null
    );
    if (result) {
      return {
        added: false,
        reason: 'The plan could not be saved, please try again',
      };
    }
    return { added: true };
  }
}
