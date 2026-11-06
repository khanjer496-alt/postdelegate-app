import {
  AnalyticsData,
  AccountStats,
  AuthTokenDetails,
  PendingCheckResponse,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { Integration } from '@prisma/client';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { PinterestSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/pinterest.dto';
import FormData from 'form-data';
import { timer } from '@gitroom/helpers/utils/timer';
import {
  BadBody,
  RefreshToken,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { DashboardFunction } from '@gitroom/nestjs-libraries/integrations/dashboard.function.decorator';

// Apps with Pinterest Trial access may only create pins in the API sandbox,
// which has its own tokens, boards and pins - a production token is refused
// there and production boards don't exist there
// (https://developers.pinterest.com/docs/developer-tools/sandbox/).
// PINTEREST_SANDBOX=true sends every API call to the sandbox, the OAuth token
// exchange included, so connecting the channel stores a sandbox token. The
// authorization page (www.pinterest.com/oauth) is the same for both.
const PINTEREST_API = 'https://api.pinterest.com/v5';
const PINTEREST_SANDBOX_API = 'https://api-sandbox.pinterest.com/v5';

const isPinterestSandbox = () => process.env.PINTEREST_SANDBOX === 'true';

const pinterestApi = (path: string) =>
  `${isPinterestSandbox() ? PINTEREST_SANDBOX_API : PINTEREST_API}${path}`;

// Pinterest's own error text is shown to the user, never anything that could
// carry a credential.
const pinterestMessage = (message: string) =>
  message
    // pina_ access tokens, pinr refresh tokens
    .replace(/\bpin[ar][._-][A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 [redacted]')
    .replace(
      /"(access_token|refresh_token|client_secret)"\s*:\s*"[^"]*"/gi,
      '"$1":"[redacted]"'
    )
    .replace(
      /(access_token|refresh_token|client_secret|code)=[^&\s]+/gi,
      '$1=[redacted]'
    )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

// Travels through the workflow history between postPending, checkPostStatus
// and finalizePost - keep it small JSON (the media id and the pin content).
type PinterestPendingData = {
  mediaId: string; // empty for image-only pins (no asynchronous processing)
  message: string;
  settings: {
    link?: string;
    title?: string;
    dominant_color?: string;
    board: string;
  };
  imagePaths: string[];
  coverPath?: string;
  altText?: string; // absent in pending data created before it was sent
  // Arm -> confirm -> publish handshake (same as the Facebook story flow):
  // finalizePost arms without mutating, checkPostStatus witnesses, and only a
  // witnessed attempt runs the create - so a create that dies with an unknown
  // outcome is detected instead of run again (Pinterest has no idempotency
  // key).
  attempting?: boolean;
  confirmed?: boolean;
};

@Rules(
  'Pinterest requires at least one media, if posting a video, you must have two attachment, one for video, one for the cover picture, When posting a video, there can be only one, if posting images, there can be maximum 5'
)
export class PinterestProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'pinterest';
  name = 'Pinterest';
  isBetweenSteps = false;
  scopes = [
    'boards:read',
    // Pinterest requires this for POST /pins, including existing boards.
    'boards:write',
    'pins:read',
    'pins:write',
    'user_accounts:read',
  ];
  override maxConcurrentJob = 10; // Pinterest limits are per user

  // a pin page is public. Sandbox pins get no release URL at all
  isPublicReleaseURL(releaseURL: string) {
    return /^https:\/\/www\.pinterest\.com\/pin\/\d+\/?$/.test(releaseURL);
  }

  maxLength() {
    return 500;
  }

  dto = PinterestSettingsDto;

  override async checkValidity([firstItem]: Array<ValidityMedia[]>): Promise<
    string | true
  > {
    const isMp4 = firstItem?.find(
      (item) => (item?.path?.indexOf?.('mp4') ?? -1) > -1
    );
    const isPicture = firstItem?.find(
      (item) => (item?.path?.indexOf?.('mp4') ?? -1) === -1
    );
    if ((firstItem?.length ?? 0) === 0) {
      return 'Requires at least one media';
    }
    // Pinterest downloads the media itself, so it needs a full public URL
    if (
      firstItem?.some((item) => {
        try {
          return !['http:', 'https:'].includes(new URL(item?.path).protocol);
        } catch (err) {
          return true;
        }
      })
    ) {
      return 'Pinterest needs a public URL for every media item';
    }
    if (isPinterestSandbox() && isMp4) {
      return 'Video pins are not available while Pinterest runs in sandbox mode, please post images';
    }
    // only the first image's alt text is sent (as the pin's alt_text)
    if ((isPicture?.alt?.length ?? 0) > 500) {
      return 'Pinterest alt text can be at most 500 characters';
    }
    if ((firstItem?.length ?? 0) > 5) {
      return 'You can only have up to 5 media items';
    }
    if (isMp4 && firstItem?.length !== 2 && !isPicture) {
      return 'If posting a video you have to also include a cover image as second media';
    }
    if (isMp4 && (firstItem?.length ?? 0) > 2) {
      return 'If posting a video you can only have two media items';
    }

    if (
      (firstItem?.length ?? 0) > 1 &&
      firstItem?.every((p) => (p?.path?.indexOf?.('mp4') ?? -1) === -1)
    ) {
      const loadAll = await Promise.all(
        firstItem?.map((p) => this.getImageDimensions(p?.path)) ?? []
      );
      const checkAllTheSameWidthHeight = loadAll?.every((p, i, arr) => {
        return p?.width === arr?.[0]?.width && p?.height === arr?.[0]?.height;
      });
      if (!checkAllTheSameWidthHeight) {
        return 'Requires all images to have the same width and height';
      }
    }
    return true;
  }

  editor = 'normal' as const;

  // Pinterest answers errors as { code, message }
  public override handleErrors(
    body: string,
    status: number
  ):
    | {
        type: 'refresh-token' | 'bad-body' | 'retry';
        value: string;
      }
    | undefined {
    let error: { code?: unknown; message?: unknown } = {};
    try {
      const parsed = JSON.parse(body);
      error = parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      error = {};
    }

    if (body.indexOf('constraint: maxItems=5') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'You can upload a maximum of 5 images per post on Pinterest.',
      };
    }
    if (body.indexOf('Something went wrong on our end') > -1) {
      return {
        type: 'retry' as const,
        value:
          'Pinterest reported a temporary error on their side. Please try posting again.',
      };
    }
    if (body.indexOf('Unable to reach the URL') > -1) {
      return {
        type: 'retry' as const,
        value:
          'Pinterest was unable to reach the URL provided. Please check the link and try again.',
      };
    }
    if (
      body.indexOf("does not match '^") > -1 &&
      body.indexOf("d+$'") > -1
    ) {
      return {
        type: 'bad-body' as const,
        value:
          'The board ID must be a numeric string. Please check the board ID format.',
      };
    }
    if (body.indexOf('Board not found') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'The specified board was not found. Please check the board ID.',
      };
    }
    if (body.indexOf('You are not permitted to access that resource') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'The connected Pinterest account is not permitted to post to this board. Please check the board ID and that the account owns or can write to the board.',
      };
    }
    if (body.indexOf('cover_image_url or cover_image_content_type') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'When uploading a video, you must add also an image to be used as a cover image.',
      };
    }
    if (
      /Trial access may not create Pins/i.test(body) ||
      (error.code === 29 && status === 403)
    ) {
      return {
        type: 'bad-body' as const,
        value:
          'Pinterest only lets apps with Trial access create pins in its API sandbox, so the pin was not published. The Pinterest app needs Standard access to publish pins.',
      };
    }
    if (/consumer type is not supported/i.test(body)) {
      // a refresh can't fix this, it lasts until Pinterest approves the app
      return {
        type: 'bad-body' as const,
        value:
          'Pinterest has not approved API access for this app yet ("consumer type is not supported"), so it cannot post. Try again once Pinterest approves the app.',
      };
    }
    if (body.indexOf('PINNER_DATA_ACCESS_DENIED') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Pinterest refused this app access to the boards and pins of this account (PINNER_DATA_ACCESS_DENIED). Pinterest has to authorize the app for this account first.',
      };
    }

    // Anything else Pinterest refused: show its own reason instead of the
    // generic 'Unknown Error'. 401 stays unmapped so an expired token is still
    // refreshed, and 429 / 5xx keep the generic retries.
    if (
      status >= 400 &&
      status < 500 &&
      status !== 401 &&
      status !== 429 &&
      typeof error.code === 'number' &&
      typeof error.message === 'string' &&
      pinterestMessage(error.message)
    ) {
      return {
        type: 'bad-body' as const,
        value: `Pinterest rejected the request: ${pinterestMessage(
          error.message
        )}`,
      };
    }

    return undefined;
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    const { access_token, expires_in } = await (
      await fetch(pinterestApi('/oauth/token'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${process.env.PINTEREST_CLIENT_ID}:${process.env.PINTEREST_CLIENT_SECRET}`
          ).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: this.scopes.join(','),
          redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/pinterest`,
        }),
      })
    ).json();

    const { id, profile_image, username } = await (
      await fetch(pinterestApi('/user_account'), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    return {
      id: id,
      name: username,
      accessToken: access_token,
      refreshToken: refreshToken,
      expiresIn: expires_in,
      picture: profile_image || '',
      username,
    };
  }

  async generateAuthUrl() {
    const state = makeSecureId(6);
    return {
      url: `https://www.pinterest.com/oauth/?client_id=${
        process.env.PINTEREST_CLIENT_ID
      }&redirect_uri=${encodeURIComponent(
        `${process.env.FRONTEND_URL}/integrations/social/pinterest`
      )}&response_type=code&scope=${encodeURIComponent(
        this.scopes.join(',')
      )}&state=${state}`,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh: string;
  }) {
    const { access_token, refresh_token, expires_in, scope } = await (
      await fetch(pinterestApi('/oauth/token'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${process.env.PINTEREST_CLIENT_ID}:${process.env.PINTEREST_CLIENT_SECRET}`
          ).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: params.code,
          redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/pinterest`,
        }),
      })
    ).json();

    this.checkScopes(this.scopes, scope);

    const { id, profile_image, username } = await (
      await fetch(pinterestApi('/user_account'), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    return {
      id: id,
      name: username,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      picture: profile_image,
      username,
    };
  }

  @Tool({ description: 'List of boards', dataSchema: [] })
  async boards(accessToken: string) {
    // Follow the bookmark: the sandbox can answer an empty page with a
    // bookmark even when boards exist. this.fetch so an expired token is
    // refreshed and a refusal is an error, never an empty list.
    const items: any[] = [];
    let bookmark = '';
    for (let page = 0; page < 10; page++) {
      const { items: pageItems, bookmark: next } = await (
        await this.fetch(
          pinterestApi(
            `/boards?page_size=250${
              bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''
            }`
          ),
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        )
      ).json();

      items.push(...(pageItems || []));
      if (!next) {
        break;
      }
      bookmark = next;
    }

    return items.map((item: any) => ({
      name: item.name,
      id: item.id,
    }));
  }

  // Lets the composer create a board at any time - the only way to get one in
  // sandbox mode, as boards made on pinterest.com are production boards.
  // A refusal comes back as { error } with Pinterest's reason, as the
  // dashboard function route answers a bare `false` for a thrown error; an
  // expired token still throws so the route refreshes it.
  @DashboardFunction()
  async createBoard(
    accessToken: string,
    data: { name?: string }
  ): Promise<{ id: string; name: string } | { error: string }> {
    const name = typeof data?.name === 'string' ? data.name.trim() : '';
    if (!name) {
      return { error: 'Board name is required' };
    }
    if (name.length > 100) {
      return { error: 'Board name can be at most 100 characters' };
    }

    try {
      const { id, name: boardName } = await (
        await this.fetch(pinterestApi('/boards'), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name }),
        })
      ).json();

      return { id, name: boardName };
    } catch (err) {
      if (err instanceof BadBody) {
        // '' lets the composer show its own generic message
        return { error: err.message === 'Unknown Error' ? '' : err.message };
      }
      throw err;
    }
  }

  async postPending(
    id: string,
    accessToken: string,
    postDetails: PostDetails<PinterestSettingsDto>[]
  ): Promise<PostResponse[]> {
    let mediaId = '';
    const findMp4 = postDetails?.[0]?.media?.find((p) =>
      hasExtension(p.path, 'mp4')
    );
    const picture = postDetails?.[0]?.media?.find(
      (p) => !hasExtension(p.path, 'mp4')
    );

    // Upload the video now; the processing wait moves to checkPostStatus and
    // the pin itself is only created by finalizePost, so nothing here is
    // irreversible - a failure leaves only an orphaned media upload.
    if (findMp4) {
      const { upload_url, media_id, upload_parameters } = await (
        await this.fetch(pinterestApi('/media'), {
          method: 'POST',
          body: JSON.stringify({
            media_type: 'video',
          }),
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        })
      ).json();

      const { data } = await this.getSsrfSafeAxios().get(findMp4.path, {
        responseType: 'stream',
      });

      const formData = Object.keys(upload_parameters)
        .filter((f) => f)
        .reduce((acc, key) => {
          acc.append(key, upload_parameters[key]);
          return acc;
        }, new FormData());

      formData.append('file', data);
      await this.getSsrfSafeAxios().post(upload_url, formData);

      mediaId = media_id;
    }

    return [
      {
        id: postDetails?.[0]?.id,
        releaseURL: '',
        postId: '',
        status: 'pending',
        pendingData: {
          mediaId,
          message: postDetails?.[0]?.message,
          settings: {
            link: postDetails?.[0]?.settings.link,
            title: postDetails?.[0]?.settings.title,
            dominant_color: postDetails?.[0]?.settings.dominant_color,
            board: postDetails?.[0]?.settings.board,
          },
          imagePaths: (postDetails?.[0]?.media || []).map((m) => m.path),
          coverPath: picture?.path,
          ...(picture?.alt ? { altText: picture.alt } : {}),
        } as PinterestPendingData,
      },
    ];
  }

  override async checkPostStatus(
    accessToken: string,
    pendingData: PinterestPendingData,
    integration: Integration
  ): Promise<PendingCheckResponse> {
    // A confirmed create attempt died without reporting its result: Pinterest
    // gives no way to ask whether that pin was created, so never run the
    // create again - stop with an explicit warning instead.
    if (pendingData.attempting && pendingData.confirmed) {
      throw new BadBody(
        'pinterest',
        JSON.stringify({}),
        {} as any,
        'Pinterest may have already published this pin, please check your account before posting again to avoid duplicates'
      );
    }

    // witness the armed create so finalizePost knows the attempt is uniquely
    // accounted for before it mutates anything
    const witness = (): PendingCheckResponse =>
      pendingData.attempting && !pendingData.confirmed
        ? {
            status: 'ready',
            pendingData: { ...pendingData, confirmed: true },
          }
        : { status: 'ready', pendingData };

    // Image-only pins have no asynchronous processing step.
    if (!pendingData.mediaId) {
      return witness();
    }

    let mediafile: { status?: string };
    try {
      mediafile = await (
        await this.fetch(
          pinterestApi(`/media/${pendingData.mediaId}`),
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
          '',
          0,
          true
        )
      ).json();
    } catch (err) {
      if (err instanceof RefreshToken) {
        throw err;
      }

      // Transient status-check error: the media may finish processing just
      // fine, keep polling - if Pinterest stays broken the workflow exhausts
      // its checks and warns the user properly.
      return { status: 'pending', pendingData };
    }

    if (mediafile.status === 'failed') {
      throw new BadBody(
        'pinterest',
        JSON.stringify({}),
        {} as any,
        'The file is corrupted and cannot be uploaded'
      );
    }

    if (mediafile.status !== 'succeeded') {
      return { status: 'pending', pendingData };
    }

    return witness();
  }

  override async finalizePost(
    accessToken: string,
    pendingData: PinterestPendingData,
    integration: Integration
  ): Promise<PendingCheckResponse> {
    // Create with an arm -> confirm -> publish handshake: the create only runs
    // after checkPostStatus witnessed the intent, so a run that dies
    // mid-create is detectable and the pin is never published twice.
    if (!pendingData.attempting || !pendingData.confirmed) {
      // Image pins make no API call before the create, so an expired token
      // would 401 there and the refresh retry would hit the armed state as a
      // false duplicate: probe the token read-only before arming instead.
      await this.fetch(pinterestApi('/user_account'), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return {
        status: 'pending',
        pendingData: { ...pendingData, attempting: true, confirmed: false },
      };
    }

    const mapImages = (pendingData.imagePaths || []).map((path) => ({ path }));

    const { id: pId } = await (
      await this.fetch(pinterestApi('/pins'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...(pendingData.settings.link
            ? { link: pendingData.settings.link }
            : {}),
          ...(pendingData.settings.title
            ? { title: pendingData.settings.title }
            : {}),
          description: pendingData.message,
          ...(pendingData.altText ? { alt_text: pendingData.altText } : {}),
          ...(pendingData.settings.dominant_color
            ? { dominant_color: pendingData.settings.dominant_color }
            : {}),
          board_id: pendingData.settings.board,
          media_source: pendingData.mediaId
            ? {
                source_type: 'video_id',
                media_id: pendingData.mediaId,
                cover_image_url: pendingData.coverPath,
              }
            : mapImages?.length === 1
            ? {
                source_type: 'image_url',
                url: mapImages?.[0]?.path,
              }
            : {
                source_type: 'multiple_image_urls',
                items: mapImages.map((m) => ({
                  url: m.path,
                })),
              },
        }),
      })
    ).json();

    return {
      status: 'completed',
      postId: pId,
      // sandbox pins have no public page (only their creator sees them on
      // the profile), so they get no link
      releaseURL: isPinterestSandbox()
        ? ''
        : `https://www.pinterest.com/pin/${pId}`,
    };
  }

  // Old blocking behavior, kept for workflow versions before v1.0.6 that still
  // run and don't know how to resolve a `pending` response - they wait for the
  // processing and create the pin inside the activity like before.
  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<PinterestSettingsDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [response] = await this.postPending(id, accessToken, postDetails);

    let pendingData = response.pendingData;
    const started = Date.now();

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Cap below the 10-minute activity timeout of the old workflows using
      // this method: failing here is safe (the pin is only created once the
      // media is ready), timing the activity out is not - a retried activity
      // would upload and publish again.
      if (Date.now() - started > 8 * 60 * 1000) {
        throw new BadBody(
          'pinterest',
          JSON.stringify({}),
          {} as any,
          'The file took too long to process, please try again'
        );
      }

      const check = await this.checkPostStatus(
        accessToken,
        pendingData,
        integration
      );

      if (check.status === 'pending') {
        pendingData = check.pendingData;
        await timer(20000);
        continue;
      }

      const result =
        check.status === 'ready'
          ? await this.finalizePost(accessToken, check.pendingData, integration)
          : check;

      if (result.status === 'completed') {
        return [
          {
            id: response.id,
            postId: result.postId,
            releaseURL: result.releaseURL,
            status: 'success',
          },
        ];
      }

      // finalize only armed the handshake (nothing to wait for), loop straight
      // into the witnessing check
      pendingData = result.pendingData;
    }
  }

  async accountStats(id: string, accessToken: string): Promise<AccountStats> {
    const response = await fetch(pinterestApi('/user_account'), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Pinterest user_account returned ${response.status}`);
    }

    const { follower_count, following_count, pin_count } =
      await response.json();
    return {
      ...(typeof follower_count === 'number'
        ? { followers: follower_count }
        : {}),
      ...(typeof following_count === 'number'
        ? { following: following_count }
        : {}),
      ...(typeof pin_count === 'number' ? { posts: pin_count } : {}),
    };
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    // the sandbox has no analytics endpoints
    if (isPinterestSandbox()) {
      return [];
    }

    const until = dayjs().format('YYYY-MM-DD');
    // Pinterest analytics only cover the last 90 days (89 for a UTC safety margin)
    const since = dayjs()
      .subtract(Math.min(date, 89), 'day')
      .format('YYYY-MM-DD');

    const {
      all: { daily_metrics },
    } = await (
      await fetch(
        `https://api.pinterest.com/v5/user_account/analytics?start_date=${since}&end_date=${until}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      )
    ).json();

    return daily_metrics.reduce(
      (acc: any, item: any) => {
        if (typeof item.metrics.PIN_CLICK_RATE !== 'undefined') {
          acc[0].data.push({
            date: item.date,
            total: item.metrics.PIN_CLICK_RATE,
          });

          acc[1].data.push({
            date: item.date,
            total: item.metrics.IMPRESSION,
          });

          acc[2].data.push({
            date: item.date,
            total: item.metrics.PIN_CLICK,
          });

          acc[3].data.push({
            date: item.date,
            total: item.metrics.ENGAGEMENT,
          });

          acc[4].data.push({
            date: item.date,
            total: item.metrics.SAVE,
          });
        }

        return acc;
      },
      [
        { label: 'Pin click rate', data: [] as any[] },
        { label: 'Impressions', data: [] as any[] },
        { label: 'Pin Clicks', data: [] as any[] },
        { label: 'Engagement', data: [] as any[] },
        { label: 'Saves', data: [] as any[] },
      ]
    );
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    if (isPinterestSandbox()) {
      return [];
    }

    const today = dayjs().format('YYYY-MM-DD');
    // Pinterest only serves pin analytics for the last 90 days (89 for a UTC safety margin)
    const since = dayjs().subtract(89, 'day').format('YYYY-MM-DD');

    try {
      // Fetch pin analytics from Pinterest API
      const response = await fetch(
        `https://api.pinterest.com/v5/pins/${postId}/analytics?start_date=${since}&end_date=${today}&metric_types=IMPRESSION,PIN_CLICK,OUTBOUND_CLICK,SAVE`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const data = await response.json();

      if (!data || !data.all) {
        return [];
      }

      const result: AnalyticsData[] = [];
      const metrics = data.all;

      // The requested metric types are period metrics: Pinterest returns them
      // in summary_metrics, never in lifetime_metrics (that only ever carries
      // TOTAL_COMMENTS / TOTAL_REACTIONS).
      if (metrics.summary_metrics) {
        const summaryMetrics = metrics.summary_metrics;

        if (summaryMetrics.IMPRESSION !== undefined) {
          result.push({
            label: 'Impressions',
            percentageChange: 0,
            data: [{ total: String(summaryMetrics.IMPRESSION), date: today }],
          });
        }

        if (summaryMetrics.PIN_CLICK !== undefined) {
          result.push({
            label: 'Pin Clicks',
            percentageChange: 0,
            data: [{ total: String(summaryMetrics.PIN_CLICK), date: today }],
          });
        }

        if (summaryMetrics.OUTBOUND_CLICK !== undefined) {
          result.push({
            label: 'Outbound Clicks',
            percentageChange: 0,
            data: [
              { total: String(summaryMetrics.OUTBOUND_CLICK), date: today },
            ],
          });
        }

        if (summaryMetrics.SAVE !== undefined) {
          result.push({
            label: 'Saves',
            percentageChange: 0,
            data: [{ total: String(summaryMetrics.SAVE), date: today }],
          });
        }
      }

      return result;
    } catch (err) {
      console.error('Error fetching Pinterest post analytics:', err);
      return [];
    }
  }
}
