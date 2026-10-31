import { Ability, AbilityBuilder, AbilityClass } from '@casl/ability';
import { Injectable } from '@nestjs/common';
import {
  isAiAvailable,
  pricing,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import dayjs from 'dayjs';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { AuthorizationActions, Sections } from './permission.exception.class';

export type AppAbility = Ability<[AuthorizationActions, Sections]>;

@Injectable()
export class PermissionsService {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _postsService: PostsService,
    private _integrationService: IntegrationService,
    private _webhooksService: WebhooksService
  ) {}
  async getPackageOptions(orgId: string) {
    const subscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(orgId);

    const tier =
      subscription?.subscriptionTier ||
      (!process.env.STRIPE_PUBLISHABLE_KEY ? 'PRO' : 'FREE');

    const { channel, ...all } = pricing[tier];
    return {
      subscription,
      options: {
        ...all,
        ...{ channel: tier === 'FREE' ? channel : -10 },
      },
    };
  }

  async check(
    orgId: string,
    created_at: Date,
    permission: 'USER' | 'ADMIN' | 'SUPERADMIN',
    requestedPermission: Array<[AuthorizationActions, Sections]>,
    refreshChannelId?: string
  ) {
    const { can, build } = new AbilityBuilder<
      Ability<[AuthorizationActions, Sections]>
    >(Ability as AbilityClass<AppAbility>);

    // Role sections are about who the member is, never about the plan, so they
    // are decided the same way with or without billing
    const isAdmin = ['ADMIN', 'SUPERADMIN'].includes(permission);

    if (
      requestedPermission.length === 0 ||
      !process.env.STRIPE_PUBLISHABLE_KEY
    ) {
      // Without billing there are no plan limits or quotas to enforce
      for (const [action, section] of requestedPermission) {
        if (section === Sections.ADMIN && !isAdmin) {
          continue;
        }
        // without billing everyone gets the top tier, but AI still needs a provider key
        if (section === Sections.AI && !isAiAvailable(pricing.ULTIMATE)) {
          continue;
        }
        can(action, section);
      }
      return build({
        detectSubjectType: (item) =>
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          item.constructor,
      });
    }

    const { subscription, options } = await this.getPackageOptions(orgId);
    for (const [action, section] of requestedPermission) {
      // check for the amount of channels
      if (section === Sections.CHANNEL) {
        // Refreshing an existing channel doesn't add a new one, so skip the limit check
        // but only if the channel actually belongs to this org
        if (refreshChannelId) {
          const existingIntegration =
            await this._integrationService.getIntegrationByInternalId(
              orgId,
              refreshChannelId
            );
          if (existingIntegration) {
            can(action, section);
            continue;
          }
        }

        const totalChannels = (
          await this._integrationService.getIntegrationsList(orgId)
        ).filter((f) => !f.refreshNeeded).length;

        if (
          (options.channel && options.channel > totalChannels) ||
          (subscription?.totalChannels || 0) > totalChannels
        ) {
          can(action, section);
          continue;
        }
      }

      if (section === Sections.WEBHOOKS) {
        const totalWebhooks = await this._webhooksService.getTotal(orgId);
        if (totalWebhooks < options.webhooks) {
          can(AuthorizationActions.Create, section);
          continue;
        }
      }

      // check for posts per month
      if (section === Sections.POSTS_PER_MONTH) {
        const createdAt =
          (await this._subscriptionService.getSubscription(orgId))?.createdAt ||
          created_at;
        const totalMonthPast = Math.abs(
          dayjs(createdAt).diff(dayjs(), 'month')
        );
        const checkFrom = dayjs(createdAt).add(totalMonthPast, 'month');
        const count = await this._postsService.countPostsFromDay(
          orgId,
          checkFrom.toDate()
        );

        if (count < options.posts_per_month) {
          can(action, section);
          continue;
        }
      }

      if (section === Sections.TEAM_MEMBERS && options.team_members) {
        can(action, section);
        continue;
      }

      if (section === Sections.ADMIN && isAdmin) {
        can(action, section);
        continue;
      }

      if (
        section === Sections.COMMUNITY_FEATURES &&
        options.community_features
      ) {
        can(action, section);
        continue;
      }

      if (
        section === Sections.FEATURED_BY_GITROOM &&
        options.featured_by_gitroom
      ) {
        can(action, section);
        continue;
      }

      if (section === Sections.AI && isAiAvailable(options)) {
        can(action, section);
        continue;
      }

      if (
        section === Sections.IMPORT_FROM_CHANNELS &&
        options.import_from_channels
      ) {
        can(action, section);
      }
    }

    return build({
      detectSubjectType: (item) =>
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        item.constructor,
    });
  }
}
