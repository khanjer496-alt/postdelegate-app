export interface PricingInnerInterface {
  current: string;
  // customer-facing name, the key (STANDARD) stays the stored tier
  label?: string;
  // Stripe lookup_key slug: postdelegate_<slug>_<month|year>
  slug?: string;
  month_price: number;
  year_price: number;
  channel?: number;
  posts_per_month: number;
  team_members: boolean;
  community_features: boolean;
  featured_by_gitroom: boolean;
  ai: boolean;
  import_from_channels: boolean;
  image_generator?: boolean;
  image_generation_count: number;
  generate_videos: number;
  clipping_minutes: number;
  public_api: boolean;
  webhooks: number;
  autoPost: boolean;
  // scheduled analytics emails and the white-label PDF report
  analytics_reports: boolean;
}
export interface PricingInterface {
  [key: string]: PricingInnerInterface;
}
export const pricing: PricingInterface = {
  FREE: {
    current: 'FREE',
    month_price: 0,
    year_price: 0,
    channel: 0,
    image_generation_count: 0,
    posts_per_month: 0,
    team_members: false,
    community_features: false,
    featured_by_gitroom: false,
    ai: false,
    import_from_channels: false,
    image_generator: false,
    public_api: false,
    webhooks: 0,
    autoPost: false,
    generate_videos: 0,
    clipping_minutes: 0,
    analytics_reports: false,
  },
  STANDARD: {
    current: 'STANDARD',
    label: 'Starter',
    slug: 'starter',
    month_price: 19,
    year_price: 180,
    channel: 5,
    posts_per_month: 1000000,
    image_generation_count: 0,
    team_members: false,
    ai: false,
    community_features: false,
    featured_by_gitroom: false,
    import_from_channels: true,
    image_generator: false,
    public_api: true,
    webhooks: 2,
    autoPost: false,
    generate_videos: 0,
    clipping_minutes: 0,
    analytics_reports: false,
  },
  TEAM: {
    current: 'TEAM',
    label: 'Team',
    slug: 'team',
    month_price: 29,
    year_price: 276,
    channel: 10,
    posts_per_month: 1000000,
    image_generation_count: 0,
    community_features: true,
    team_members: true,
    featured_by_gitroom: true,
    ai: false,
    import_from_channels: true,
    image_generator: false,
    public_api: true,
    webhooks: 10,
    autoPost: true,
    generate_videos: 0,
    clipping_minutes: 0,
    analytics_reports: false,
  },
  PRO: {
    current: 'PRO',
    label: 'Pro',
    slug: 'pro',
    month_price: 39,
    year_price: 372,
    channel: 30,
    posts_per_month: 1000000,
    image_generation_count: 0,
    community_features: true,
    team_members: true,
    featured_by_gitroom: true,
    ai: false,
    import_from_channels: true,
    image_generator: false,
    public_api: true,
    webhooks: 30,
    autoPost: true,
    generate_videos: 0,
    clipping_minutes: 0,
    analytics_reports: true,
  },
  ULTIMATE: {
    current: 'ULTIMATE',
    label: 'Ultimate',
    slug: 'ultimate',
    month_price: 79,
    year_price: 756,
    channel: 100,
    posts_per_month: 1000000,
    image_generation_count: 0,
    community_features: true,
    team_members: true,
    featured_by_gitroom: true,
    ai: false,
    import_from_channels: true,
    image_generator: false,
    public_api: true,
    webhooks: 10000,
    autoPost: true,
    generate_videos: 0,
    clipping_minutes: 0,
    analytics_reports: true,
  },
};
