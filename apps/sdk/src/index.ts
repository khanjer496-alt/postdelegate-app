import pkg from '../package.json';
import type {
  ChangePostStatusOptions,
  CreatePostBody,
  CreatePostResult,
  FindSlotResponse,
  GetPostsFilters,
  Group,
  Integration,
  IntegrationSettingsResponse,
  MeResponse,
  Media,
  MediaListFilters,
  MediaListResponse,
  PostDelegateOptions,
  PostListResponse,
  UploadOptions,
} from './types';

export * from './types';

export const DEFAULT_BASE_URL = 'https://app.postdelegate.com/api';

const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  pdf: 'application/pdf',
};

/** Thrown for every non-2xx response of the API. */
export class PostDelegateError extends Error {
  constructor(
    message: string,
    /** HTTP status code. */
    public readonly status: number,
    /** Parsed response body (JSON when possible, otherwise text). */
    public readonly body?: unknown
  ) {
    super(message);
    this.name = 'PostDelegateError';
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function toQueryString(obj: Query): string {
  const params = new URLSearchParams();
  Object.entries(obj).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  });
  return params.toString();
}

function errorMessage(body: unknown, fallback: string) {
  if (body && typeof body === 'object') {
    const { msg, message, name } = body as {
      msg?: unknown;
      message?: unknown;
      name?: unknown;
    };
    const value = msg ?? message;
    if (Array.isArray(value)) {
      return value.join(', ');
    }
    if (typeof value === 'string' && value) {
      // post validation errors name the channel type that rejected the post
      return typeof name === 'string' && name ? `${name}: ${value}` : value;
    }
  }
  return typeof body === 'string' && body ? body.slice(0, 200) : fallback;
}

/**
 * Client for the PostDelegate public API.
 *
 * ```ts
 * import PostDelegate from '@postdelegate/node';
 * const client = new PostDelegate(process.env.POSTDELEGATE_API_KEY!);
 * ```
 */
export class PostDelegate {
  private readonly _baseUrl: string;
  private readonly _fetch: typeof fetch;
  private readonly _userAgent: string;

  /**
   * @param _apiKey API key from Settings > Agents / Dev in the PostDelegate app.
   * @param baseUrlOrOptions API base URL (without `/public/v1`) or an options object.
   */
  constructor(
    private readonly _apiKey: string,
    baseUrlOrOptions: string | PostDelegateOptions = {}
  ) {
    const options =
      typeof baseUrlOrOptions === 'string'
        ? { baseUrl: baseUrlOrOptions }
        : baseUrlOrOptions;

    if (!_apiKey) {
      throw new Error('A PostDelegate API key is required');
    }

    this._baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this._fetch = options.fetch || ((...args) => fetch(...args));
    this._userAgent = options.userAgent || `postdelegate-node/${pkg.version}`;
  }

  private async request<T>(
    method: string,
    path: string,
    options: { query?: Query; json?: unknown; form?: FormData } = {}
  ): Promise<T> {
    const query = options.query ? toQueryString(options.query) : '';
    const headers: Record<string, string> = {
      Authorization: this._apiKey,
      Accept: 'application/json',
      'User-Agent': this._userAgent,
    };
    let body: string | FormData | undefined;

    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.form) {
      body = options.form;
    }

    const response = await this._fetch(
      `${this._baseUrl}/public/v1${path}${query ? `?${query}` : ''}`,
      { method, headers, body }
    );

    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // not JSON, keep the text
    }

    if (!response.ok) {
      throw new PostDelegateError(
        errorMessage(parsed, response.statusText || `HTTP ${response.status}`),
        response.status,
        parsed
      );
    }

    return parsed as T;
  }

  /**
   * Create, schedule or publish a post on one or more channels.
   * `date`, `shortLink` and `tags` are optional here, the API requires them so
   * the SDK fills in defaults.
   */
  post(body: CreatePostBody): Promise<CreatePostResult[]> {
    return this.request('POST', '/posts', {
      json: {
        ...body,
        date: body.date || new Date().toISOString(),
        shortLink: body.shortLink ?? false,
        tags: body.tags ?? [],
        posts: body.posts.map((post) => ({
          ...post,
          value: post.value.map((value) => ({
            ...value,
            image: value.image ?? [],
          })),
        })),
      },
    });
  }

  /** List posts scheduled or published between `startDate` and `endDate`. */
  postList(filters: GetPostsFilters): Promise<PostListResponse> {
    return this.request('GET', '/posts', { query: { ...filters } });
  }

  /**
   * Delete a post by id. The whole post group (all channels created
   * together) is removed.
   */
  deletePost(id: string): Promise<{ id: string } | null> {
    return this.request('DELETE', `/posts/${encodeURIComponent(id)}`);
  }

  /** Delete every post of a group id (the `group` field of a listed post). */
  deletePostByGroup(group: string): Promise<{ id: string } | null> {
    return this.request('DELETE', `/posts/group/${encodeURIComponent(group)}`);
  }

  /**
   * Move a not yet published post between `draft` and `schedule`. A published
   * post, or scheduling one being published right now, needs
   * `{ republish: true }`.
   */
  changePostStatus(
    id: string,
    status: 'draft' | 'schedule',
    options: ChangePostStatusOptions = {}
  ) {
    return this.request<unknown>(
      'PUT',
      `/posts/${encodeURIComponent(id)}/status`,
      { json: { status, ...(options.republish ? { republish: true } : {}) } }
    );
  }

  /**
   * Upload a file to the media library.
   *
   * @param file File contents.
   * @param filenameOrExtension A file name (`photo.png`) or just an extension (`png`),
   *   used to detect the content type.
   */
  upload(
    file: Buffer | Uint8Array | Blob,
    filenameOrExtension: string,
    options: UploadOptions = {}
  ): Promise<Media> {
    const hasName = filenameOrExtension.includes('.');
    const filename = hasName
      ? filenameOrExtension
      : `upload.${filenameOrExtension.replace(/^\./, '') || 'jpg'}`;
    const extension = filename.split('.').pop()!.toLowerCase();
    const type = MIME_TYPES[extension] || 'application/octet-stream';

    const form = new FormData();
    form.append(
      'file',
      file instanceof Blob ? file : new Blob([file as BlobPart], { type }),
      filename
    );
    if (options.adjust) {
      form.append('adjust', 'true');
    }

    return this.request('POST', '/upload', { form });
  }

  /** Make PostDelegate download a public https URL into the media library. */
  uploadFromUrl(url: string, options: UploadOptions = {}): Promise<Media> {
    return this.request('POST', '/upload-from-url', {
      json: { url, ...(options.adjust ? { adjust: true } : {}) },
    });
  }

  /** List media library files. */
  getMedia(filters: MediaListFilters = {}): Promise<MediaListResponse> {
    return this.request('GET', '/media', { query: { ...filters } });
  }

  /** Processing status of an uploaded media file. */
  mediaStatus(id: string) {
    return this.request<unknown>(
      'GET',
      `/media/${encodeURIComponent(id)}/status`
    );
  }

  /** List connected channels, optionally only those of a group (customer id). */
  integrations(group?: string): Promise<Integration[]> {
    return this.request('GET', '/integrations', { query: { group } });
  }

  /** List channel groups (customers). */
  groups(): Promise<Group[]> {
    return this.request('GET', '/groups');
  }

  /** Posting rules, max length and settings schema of a channel. */
  integrationSettings(id: string): Promise<IntegrationSettingsResponse> {
    return this.request(
      'GET',
      `/integration-settings/${encodeURIComponent(id)}`
    );
  }

  /** Next free posting slot of a channel. */
  findSlot(integrationId: string): Promise<FindSlotResponse> {
    return this.request(
      'GET',
      `/find-slot/${encodeURIComponent(integrationId)}`
    );
  }

  /** The organization (and user, for OAuth tokens) the key belongs to. */
  me(): Promise<MeResponse> {
    return this.request('GET', '/me');
  }

  /** Check that the API key is valid. */
  isConnected(): Promise<{ connected: boolean }> {
    return this.request('GET', '/is-connected');
  }

  /** In-app notifications, paginated starting at page 0. */
  notifications(page = 0) {
    return this.request<unknown>('GET', '/notifications', { query: { page } });
  }

  /** Analytics of a channel for the last `date` days. */
  analytics(integrationId: string, date: number | string = 7) {
    return this.request<unknown>(
      'GET',
      `/analytics/${encodeURIComponent(integrationId)}`,
      { query: { date } }
    );
  }

  /** Analytics of a single post for the last `date` days. */
  postAnalytics(postId: string, date: number | string = 7) {
    return this.request<unknown>(
      'GET',
      `/analytics/post/${encodeURIComponent(postId)}`,
      { query: { date } }
    );
  }
}

export default PostDelegate;
