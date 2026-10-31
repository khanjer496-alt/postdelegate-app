import {
  AnalyticsData,
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import FormData from 'form-data';
import {
  BadBody,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { DribbbleDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/dribbble.dto';
import mime from 'mime-types';
import { DiscordDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/discord.dto';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';
import sharp from 'sharp';

// Dribbble only accepts shots of exactly these sizes.
const SHOT_SIZES = [
  { width: 800, height: 600 },
  { width: 400, height: 300 },
];

export class DribbbleProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3; // Dribbble has moderate API limits
  identifier = 'dribbble';
  name = 'Dribbble';
  isBetweenSteps = false;
  scopes = ['public', 'upload'];
  editor = 'normal' as const;
  maxLength() {
    return 40000;
  }
  dto = DribbbleDto;

  override async checkValidity([firstItem]: Array<ValidityMedia[]>): Promise<
    string | true
  > {
    const isMp4 = firstItem?.find(
      (item) => (item?.path?.indexOf?.('mp4') ?? -1) > -1
    );
    if (firstItem?.length !== 1) {
      return 'Requires one item';
    }
    if (isMp4) {
      return 'Does not support mp4 files';
    }
    const details = await this.getImageDimensions(firstItem?.[0]?.path);
    if (this.isShotSize(details)) {
      return true;
    }
    // Other sizes are cropped to 4:3 when posting; animated GIFs can't be.
    if ((firstItem?.[0]?.path?.indexOf?.('.gif') ?? -1) > -1) {
      return 'GIFs must be exactly 400x300 or 800x600 px.';
    }
    if (details?.width < 400 || details?.height < 300) {
      return 'Image too small. Dribbble needs at least 400x300 px.';
    }
    return true;
  }

  private isShotSize(details?: { width: number; height: number }) {
    return SHOT_SIZES.some(
      (size) => details?.width === size.width && details?.height === size.height
    );
  }

  // Center-crop to the largest Dribbble size the image can fill.
  private async fitShotSize(image: Buffer) {
    const { width = 0, height = 0, format } = await sharp(image).metadata();
    if (format === 'gif' || this.isShotSize({ width, height })) {
      return image;
    }
    const target =
      SHOT_SIZES.find((size) => width >= size.width && height >= size.height) ||
      SHOT_SIZES[SHOT_SIZES.length - 1];
    return sharp(image)
      .resize(target.width, target.height, { fit: 'cover', position: 'centre' })
      .toBuffer();
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    const { access_token, expires_in } = await (
      await this.fetch('https://api-sandbox.pinterest.com/v5/oauth/token', {
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
          scope: `${this.scopes.join(',')}`,
          redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/pinterest`,
        }),
      })
    ).json();

    const { id, profile_image, username } = await (
      await this.fetch('https://api-sandbox.pinterest.com/v5/user_account', {
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

  @Tool({ description: 'Teams list', dataSchema: [] })
  async teams(accessToken: string) {
    const { teams } = await (
      await this.fetch('https://api.dribbble.com/v2/user', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
    ).json();

    return (
      teams?.map((team: any) => ({
        id: team.id,
        name: team.name,
      })) || []
    );
  }

  async generateAuthUrl() {
    const state = makeSecureId(6);
    return {
      url: `https://dribbble.com/oauth/authorize?client_id=${
        process.env.DRIBBBLE_CLIENT_ID
      }&redirect_uri=${encodeURIComponent(
        `${process.env.FRONTEND_URL}/integrations/social/dribbble`
      )}&response_type=code&scope=${this.scopes.join('+')}&state=${state}`,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh: string;
  }) {
    const { access_token, scope } = await (
      await this.fetch(
        `https://dribbble.com/oauth/token?client_id=${process.env.DRIBBBLE_CLIENT_ID}&client_secret=${process.env.DRIBBBLE_CLIENT_SECRET}&code=${params.code}&redirect_uri=${process.env.FRONTEND_URL}/integrations/social/dribbble`,
        {
          method: 'POST',
        }
      )
    ).json();

    this.checkScopes(this.scopes, scope);

    const { id, name, avatar_url, login } = await (
      await this.fetch('https://api.dribbble.com/v2/user', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    return {
      id: id,
      name,
      accessToken: access_token,
      refreshToken: '',
      expiresIn: 999999999,
      picture: avatar_url,
      username: login,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<DribbbleDto>[]
  ): Promise<PostResponse[]> {
    const { data } = await this.getSsrfSafeAxios().get(
      postDetails?.[0]?.media?.[0]?.path!,
      {
        responseType: 'arraybuffer',
      }
    );
    const image = await this.fitShotSize(Buffer.from(data));

    const slash = postDetails?.[0]?.media?.[0]?.path.split('/').at(-1);

    const formData = new FormData();
    formData.append('image', image, {
      filename: slash,
      contentType: mime.lookup(slash!) || '',
    });

    formData.append('title', postDetails[0].settings.title);
    formData.append('description', postDetails[0].message);

    let data2;
    try {
      data2 = await this.getSsrfSafeAxios().post(
        'https://api.dribbble.com/v2/shots',
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
    } catch (err: any) {
      const status = err?.response?.status;
      if (status >= 400 && status < 500 && status !== 429) {
        throw new BadBody(
          this.identifier,
          JSON.stringify(err?.response?.data ?? {}),
          '{}',
          err?.response?.data?.message ||
            `Dribbble rejected the shot with status ${status}`
        );
      }
      throw err;
    }

    const location = data2.headers['location'];
    const newId = location.split('/').at(-1);

    return [
      {
        id: postDetails?.[0]?.id,
        status: 'completed',
        postId: newId,
        releaseURL: `https://dribbble.com/shots/${newId}`,
      },
    ];
  }

  analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    return Promise.resolve([]);
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    // Dribbble doesn't provide detailed post-level analytics via their API
    return [];
  }
}
