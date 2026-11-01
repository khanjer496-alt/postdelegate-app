export interface PricingInnerInterface {
  current: string;
  // customer-facing name, the key (STANDARD) stays the stored tier
  label?: string;
  // Stripe lookup_key slug: postdelegate_<slug>_<month|year>
  slug?: string;
  month_price: number;
  year_price: number;
  channel?: number;
  // channels bought on top of `channel`, per channel, as one more Stripe
  // subscription item whose quantity is the number of extra channels
  // (lookup_key postdelegate_extra_channel_<month|year>). A tier without
  // them can't add channels beyond `channel`
  extra_channel_month_price?: number;
  extra_channel_year_price?: number;
  posts_per_month: number;
  // a monthly cap on the posts of one network, keyed by provider identifier,
  // for networks whose API is paid per post. A network that isn't listed only
  // counts toward posts_per_month
  provider_posts_per_month?: Record<string, number>;
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
    provider_posts_per_month: { x: 0 },
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
    provider_posts_per_month: { x: 30 },
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
    provider_posts_per_month: { x: 100 },
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
    provider_posts_per_month: { x: 300 },
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
    extra_channel_month_price: 1,
    extra_channel_year_price: 9.6,
    posts_per_month: 1000000,
    provider_posts_per_month: { x: 1000 },
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

// networks some plan caps a month, their published posts are counted
export const isCappedProvider = (providerIdentifier: string) =>
  Object.values(pricing).some(
    (plan) => plan.provider_posts_per_month?.[providerIdentifier] !== undefined
  );

// the most extra channels one subscription can hold, on top of the tier's
export const MAX_EXTRA_CHANNELS = 900;

export const allowsExtraChannels = (tier?: string | null) =>
  !!tier && !!pricing[tier]?.extra_channel_month_price;

// the channel limit stored on the subscription: the tier's channels plus the
// extra channels bought, which only count on a tier that sells them
export const totalChannelsOf = (tier: string, extraChannels = 0) =>
  (pricing[tier]?.channel || 0) +
  (allowsExtraChannels(tier)
    ? Math.min(MAX_EXTRA_CHANNELS, Math.max(0, Math.floor(extraChannels || 0)))
    : 0);
