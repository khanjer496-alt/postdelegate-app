import { Integration } from '@prisma/client';

export interface ClientInformation {
  client_id: string;
  client_secret: string;
  instanceUrl: string;
}

// Private service/activity boundary. Credential updates must be persisted by
// that caller and must never be included in workflow results or API responses.
export type ProviderAuthorizationCredentials = {
  accessToken: string;
  refreshToken?: string | null;
  internalId: string;
  rootInternalId?: string | null;
};

export type ProviderAuthorizationGrant = {
  realm: string;
  subject: string;
};

export type ProviderAuthorizationCheck =
  | {
      status: 'valid';
      credentials?: {
        accessToken: string;
        refreshToken?: string;
        expiresIn?: number;
      };
      identity?: { name: string; profile?: string; picture?: string };
      grant?: ProviderAuthorizationGrant;
    }
  | { status: 'revoked' }
  | { status: 'unknown' };

export type ProviderAuthorizationRevocation =
  | { status: 'revoked' }
  | { status: 'unknown' };

// Only the notice is intended for presentation. The realm identifies the
// configured grant family; grouping still requires a verified grant descriptor.
export type ProviderAuthorizationPolicy = {
  deletionNotice: string;
  useRemoteAvatar?: boolean;
  bypassAnalyticsCache?: boolean;
  authorizationRealm: string;
};
export interface IAuthenticator {
  authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh?: string;
    },
    clientInformation?: ClientInformation
  ): Promise<AuthTokenDetails | string>;
  refreshToken(refreshToken: string): Promise<AuthTokenDetails>;
  reConnect?(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>>;
  generateAuthUrl(
    clientInformation?: ClientInformation
  ): Promise<GenerateAuthUrlResponse>;
  analytics?(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]>;
  postAnalytics?(
    integrationId: string,
    accessToken: string,
    postId: string,
    fromDate: number,
  ): Promise<AnalyticsData[]>;
  recentPosts?(
    integrationId: string,
    accessToken: string,
    limit: number
  ): Promise<RecentPostStat[]>; // Latest posts of the channel with their stats, newest first. Throws when the platform call fails (an empty array means no posts)
  recentPostsEmptyHint?: string; // Shown when recentPosts returns nothing, e.g. which posts the platform lists
  accountStats?(
    id: string,
    accessToken: string
  ): Promise<AccountStats>; // Current follower / following / post counts for the daily analytics history. Throws when the platform call fails
  postsStats?(
    id: string,
    accessToken: string,
    postIds: string[]
  ): Promise<Record<string, PostStats>>; // Stats of several posts in one call, used by the daily analytics history instead of one postAnalytics call per post. Throws when the platform call fails
  viewsMetric?: ViewsMetric; // Which analytics metric counts views, read by the daily view-gain charts (Analytics > Views), see ViewsMetric
  topViewedPosts?(
    id: string,
    accessToken: string,
    days: number,
    limit: number
  ): Promise<ViewedPost[]>; // The channel's posts with the most views gained in the last `days` days, most first, read live. For networks whose analytics may not be kept in the daily history. Throws when the platform call fails
  resolveReleaseId?(
    accessToken: string,
    releaseId: string,
    integration: Integration,
    settings: any,
    releaseURL: string
  ): Promise<
    | { postId: string; releaseURL: string }
    | { pending: true }
    | { unavailable: true }
    | undefined
  >; // Final id + URL to persist when the stored releaseId is still a publish id, pending when the platform has no final id yet, unavailable when the post will never get one, undefined when nothing to resolve
  releaseUrl?(
    accessToken: string,
    releaseId: string,
    integration: Integration
  ): Promise<string | undefined>; // URL of a post the user connected by hand
  changeNickname?(
    id: string,
    accessToken: string,
    name: string
  ): Promise<{ name: string }>;
  changeProfilePicture?(
    id: string,
    accessToken: string,
    url: string
  ): Promise<{ url: string }>;
  missing?(
    id: string,
    accessToken: string
  ): Promise<{ id: string; url: string }[]>;
}

export interface AnalyticsData {
  label: string;
  data: Array<{ total: string; date: string }>;
  percentageChange: number;
}

// A post read back from the platform for the channel analytics view. Counts
// the platform does not report are left out rather than set to 0.
export interface RecentPostStat {
  id: string;
  title: string;
  thumbnailUrl?: string;
  url?: string;
  publishedAt: string; // ISO 8601, empty when the platform does not say
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
}


// Normalised counts read by the daily analytics history. Counts the platform
// does not report are left out rather than set to 0.
export interface AccountStats {
  followers?: number;
  following?: number;
  posts?: number;
}

export interface PostStats {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
}

// Which analytics metric counts views, read by the daily view-gain charts
// (Analytics > Views). A provider without it shows as a network that does not
// share view counts.
export interface ViewsMetric {
  // label of the analytics() metric whose points are the channel's views per
  // day. Only for networks whose analytics() returns a daily series of views,
  // not a running total
  channel?: string;
  // days to move the dates of that series by, -1 where each point is dated
  // the end of its day (the start of the next one)
  channelDateOffset?: number;
  // labels of the postAnalytics() metrics that hold a post's lifetime views,
  // the first one reported wins. The daily analytics history keeps that count
  // and the daily gains are computed from it
  post?: string[];
}

// A post with the views it gained over a range, read live from the platform
export interface ViewedPost {
  id: string;
  views: number;
  title?: string;
  url?: string;
  publishedAt?: string; // ISO 8601
}

export type GenerateAuthUrlResponse = {
  url: string;
  codeVerifier: string;
  state: string;
};

export type AuthTokenDetails = {
  id: string;
  name: string;
  error?: string;
  accessToken: string; // The obtained access token
  refreshToken?: string; // The refresh token, if applicable
  expiresIn?: number; // The duration in seconds for which the access token is valid
  picture?: string;
  username: string;
  additionalSettings?: {
    title: string;
    description: string;
    type: 'checkbox' | 'text' | 'textarea';
    value: any;
    regex?: string;
  }[];
};

export interface ISocialMediaIntegration {
  post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]>; // Schedules a new post

  postPending?(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]>; // Like `post`, but may return a `pending` response the workflow resolves via checkPostStatus / finalizePost

  comment?(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]>; // Schedules a new post
}

export type PostResponse = {
  id: string; // The db internal id of the post
  postId: string; // The ID of the scheduled post returned by the platform
  releaseURL: string; // The URL of the post on the platform
  status: string; // Status of the operation or initial post status, 'pending' means the workflow must poll checkPostStatus
  pendingData?: any; // Opaque provider state used by checkPostStatus / finalizePost, never inspected by generic code
};

// Returned by checkPostStatus / finalizePost:
// 'pending' - the platform is still processing, poll again later
// 'ready' - processing is done, the workflow must call finalizePost to run the remaining mutations
// 'completed' - the post is fully published
//
// Contract: once finalizePost's mutations have actually gone through on the
// platform, checkPostStatus must return 'completed' - never 'ready' again -
// otherwise a finalizePost retry after an unknown-outcome failure would re-run
// the mutations and duplicate the post. The only exception: when finalizePost's
// mutation is idempotent (like setting a thumbnail), returning 'ready' again is
// allowed, since re-running it cannot duplicate anything.
export type PendingCheckResponse =
  | { status: 'pending'; pendingData: any }
  | { status: 'ready'; pendingData: any }
  | { status: 'completed'; postId: string; releaseURL: string };

export type PostDetails<T = any> = {
  id: string;
  message: string;
  settings: T;
  media?: MediaContent[];
  poll?: PollDetails;
};

export type PollDetails = {
  options: string[]; // Array of poll options
  duration: number; // Duration in hours for which the poll will be active
};

export type MediaContent = {
  type: 'image' | 'video'; // Type of the media content
  path: string;
  alt?: string;
  thumbnail?: string;
  thumbnailTimestamp?: number;
};

export type FetchPageInformationResult = {
  id: string;
  name: string;
  access_token: string;
  picture: string;
  username: string;
};

export interface SocialProvider
  extends IAuthenticator,
    ISocialMediaIntegration {
  identifier: string;
  authorizationPolicy?: ProviderAuthorizationPolicy;
  checkAuthorization?(
    credentials: ProviderAuthorizationCredentials
  ): Promise<ProviderAuthorizationCheck>;
  // Revokes the grant at the platform. With authorizationPolicy it is part of
  // the managed deletion lifecycle; without one it runs best effort when the
  // channel is deleted, and the stored tokens are deleted with the channel.
  revokeAuthorization?(
    credentials: ProviderAuthorizationCredentials
  ): Promise<ProviderAuthorizationRevocation>;
  // Providers with the same group (one Google project) share an account's
  // grant: revoking it for one channel ends it for every channel of that
  // account (same rootInternalId) in the group. The deleted channel's tokens
  // still go with it, but the grant is kept while another live channel of the
  // group uses the account. Undefined when it cannot be configured.
  authorizationGrantGroup?: string;
  getAuthorizationGrant?(
    credentials: ProviderAuthorizationCredentials
  ): Promise<ProviderAuthorizationGrant | undefined>;
  refreshWait?: boolean;
  // how many posts per channel the daily analytics history may read (ids sent
  // to postsStats, or postAnalytics calls), 25 when not set
  analyticsHistoryPostLimit?: number;
  convertToJPEG?: boolean;
  stripLinks?: () => boolean;
  refreshCron?: boolean;
  refreshErrorMessage?(err: any): string | undefined;
  // the calendar label of a published post when these settings did not make it
  // public, e.g. media sent to an inbox to finish in the app
  publishedLabel?(settings: any): string | undefined;
  // the label of the link to such a post, e.g. in the digest email
  publishedLinkLabel?(settings: any): string | undefined;
  // what lifts the plan's monthly cap on this network
  // (provider_posts_per_month), the end of the message shown at the cap
  planLimitHint?: string;
  // why a repeating or evergreen post can't go to this network while a plan
  // caps it a month, and what lifts that
  planRepeatHint?: string;
  // Platform rules on how often one connected account may publish: at most
  // perDay posts in any 24 hours, at least minSpacingMinutes apart. Checked
  // when a post is saved and again before it publishes
  postingLimits?: { perDay: number; minSpacingMinutes: number };
  dto?: any;
  maxLength: (additionalSettings?: any, settings?: any) => number;
  checkValidity(
    posts: Array<{ path: string; thumbnail?: string; alt?: string }[]>,
    settings: any,
    additionalSettings: any[],
    // each entry's text as the provider receives it when it publishes, in
    // the same order as `posts`
    texts?: string[]
  ): Promise<string | true>;
  checkPostStatus(
    accessToken: string,
    pendingData: any,
    integration: Integration
  ): Promise<PendingCheckResponse>;
  migrationMatch(
    auth: Pick<AuthTokenDetails, 'id' | 'username'>,
    integration: Integration
  ): boolean;
  finalizePost(
    accessToken: string,
    pendingData: any,
    integration: Integration
  ): Promise<PendingCheckResponse>;
  isWeb3?: boolean;
  isChromeExtension?: boolean;
  extensionCookies?: { name: string; domain: string }[];
  editor: 'none' | 'normal' | 'markdown' | 'html';
  inlineImages?: (settings?: any) => boolean;
  customFields?: () => Promise<
    {
      key: string;
      label: string;
      defaultValue?: string;
      validation: string;
      type: 'text' | 'password';
      hint?: string;
    }[]
  >;
  name: string;
  toolTip?: string;
  oneTimeToken?: boolean;
  isBetweenSteps: boolean;
  scopes: string[];
  externalUrl?: (
    url: string
  ) => Promise<{ client_id: string; client_secret: string }>;
  mention?: (
    token: string,
    data: { query: string },
    id: string,
    integration: Integration
  ) => Promise<
    | { id: string; label: string; image: string; doNotCache?: boolean }[]
    | { none: true }
  >;
  mentionFormat?(idOrHandle: string, name: string): string;
  fetchPageInformation?(
    accessToken: string,
    data: any
  ): Promise<FetchPageInformationResult>;
}
