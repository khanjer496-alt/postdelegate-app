import { HttpException, HttpStatus } from '@nestjs/common';

export enum Sections {
  CHANNEL = 'channel',
  POSTS_PER_MONTH = 'posts_per_month',
  PROVIDER_POSTS_PER_MONTH = 'provider_posts_per_month',
  VIDEOS_PER_MONTH = 'videos_per_month',
  CLIPPING_MINUTES = 'clipping_minutes',
  TEAM_MEMBERS = 'team_members',
  COMMUNITY_FEATURES = 'community_features',
  FEATURED_BY_GITROOM = 'featured_by_gitroom',
  AI = 'ai',
  IMPORT_FROM_CHANNELS = 'import_from_channels',
  ADMIN = 'admin',
  WEBHOOKS = 'webhooks',
  ANALYTICS_REPORTS = 'analytics_reports',
}

export enum AuthorizationActions {
  Create = 'create',
  Read = 'read',
  Update = 'update',
  Delete = 'delete',
}

export interface ExtraChannelsOffer {
  plan: string;
  totalChannels: number;
  price: number;
  period: 'MONTHLY' | 'YEARLY';
}

export class SubscriptionException extends HttpException {
  // message: the text the customer reads, for a limit whose wording depends on
  // the plan and the network (the section alone can't say it)
  // extraChannels: a full plan that can buy channels instead of upgrading
  constructor(message: {
    section: Sections;
    action: AuthorizationActions;
    message?: string;
    extraChannels?: ExtraChannelsOffer;
  }) {
    super(message, HttpStatus.PAYMENT_REQUIRED);
  }
}
