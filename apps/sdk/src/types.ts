/**
 * Request and response types of the PostDelegate public API
 * (`{baseUrl}/public/v1`). They mirror the DTOs used by the backend.
 */

export type PostType = 'draft' | 'schedule' | 'now' | 'update';

/** A media file that was uploaded to PostDelegate (see `upload`). */
export interface MediaItem {
  id: string;
  path: string;
  alt?: string;
  thumbnail?: string;
}

/** One message of a post. The first item is the post, the rest are comments/thread items. */
export interface PostValue {
  content: string;
  /** Media for this message, from `upload()` / `uploadFromUrl()`. Defaults to none. */
  image?: MediaItem[];
  /** Id of an existing post item, only when editing. */
  id?: string;
  /** Delay in seconds before this thread item is published. */
  delay?: number;
}

/** The content of a post for a single channel. */
export interface PostItem {
  integration: { id: string };
  value: PostValue[];
  /**
   * Channel specific settings, for example `{ title: '...' }`. `__type` is set by the
   * server from the channel, so you never need to pass it.
   */
  settings?: Record<string, unknown>;
  /** Group id, only when editing an existing post. */
  group?: string;
}

export interface PostTag {
  value: string;
  label: string;
}

export interface CreatePostBody {
  /**
   * `draft` saves a draft, `schedule` queues the post for `date`,
   * `now` publishes immediately, `update` edits an existing post.
   */
  type: PostType;
  /** ISO 8601 date-time. Defaults to the current time. */
  date?: string;
  /** Convert links to short links. Defaults to `false`. */
  shortLink?: boolean;
  /** Defaults to no tags. */
  tags?: PostTag[];
  posts: PostItem[];
  /** Only for `update`: confirm re-publishing an already published post. */
  republish?: boolean;
  order?: string;
  inter?: number;
}

export interface CreatePostResult {
  postId: string;
  integration: string;
}

export interface GetPostsFilters {
  /** ISO 8601 date-time, start of the range. */
  startDate: string;
  /** ISO 8601 date-time, end of the range. */
  endDate: string;
  /** Only posts of channels in this group (customer id), see `groups()`. */
  customer?: string;
}

export type PostState = 'QUEUE' | 'PUBLISHED' | 'ERROR' | 'DRAFT' | (string & {});

export interface Post {
  id: string;
  content: string;
  publishDate: string;
  releaseURL: string | null;
  releaseId: string | null;
  state: PostState;
  error: string | null;
  intervalInDays: number | null;
  group: string;
  creationMethod: string;
  settings: string | null;
  tags: { tag: { id?: string; name: string; color?: string } }[];
  integration: {
    id: string;
    providerIdentifier: string;
    name: string;
    picture: string | null;
  };
}

export interface PostListResponse {
  posts: Post[];
}

export interface Integration {
  id: string;
  name: string;
  /** Provider identifier, for example `x`, `linkedin`, `instagram`. */
  identifier: string;
  picture: string | null;
  disabled: boolean;
  profile: string | null;
  customer?: { id: string; name: string };
}

export interface Group {
  id: string;
  name: string;
}

export interface Media {
  id: string;
  name: string;
  originalName: string | null;
  path: string;
  thumbnail?: string | null;
  alt?: string | null;
  status?: string;
}

export interface UploadOptions {
  /** Ask PostDelegate to normalize the file (video/image processing) after upload. */
  adjust?: boolean;
}

export interface MediaListFilters {
  /** Page number, starting at 1. */
  page?: number;
  search?: string;
}

export interface MediaListResponse {
  pages: number;
  results: (Pick<Media, 'id' | 'name' | 'originalName' | 'path'> & { createdAt: string })[];
}

export interface MeResponse {
  organization: { id: string; name: string };
  /** `null` when authenticating with an API key (it belongs to the whole organization). */
  user: { id: string; name: string; picture: string | null } | null;
}

export interface FindSlotResponse {
  date: string;
}

export interface IntegrationSettingsResponse {
  output: {
    rules: string;
    maxLength: number;
    settings: unknown;
    tools: unknown[];
  };
}

export interface PostDelegateOptions {
  /** API base URL without `/public/v1`. Defaults to https://app.postdelegate.com/api */
  baseUrl?: string;
  /** Custom fetch implementation (defaults to the global `fetch`, Node 18+). */
  fetch?: typeof fetch;
  /** Value of the `User-Agent` header. */
  userAgent?: string;
}
