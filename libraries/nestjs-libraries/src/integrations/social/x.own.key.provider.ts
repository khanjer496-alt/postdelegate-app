import { TwitterApi, UserV2Result } from 'twitter-api-v2';
import { XProvider } from '@gitroom/nestjs-libraries/integrations/social/x.provider';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';

// No colon or space: the four values are stored joined by colons in the token
const keyValidation = `/^[^:\\s]+$/`;

// X through the customer's own developer app: they bring the app's keys and
// the account's OAuth 1.0a access token, and X bills their developer account.
// Posting, media and analytics are XProvider's, only the app differs, so the
// channel's token carries all four values:
// accessToken:accessSecret:appKey:appSecret
export class XOwnKeyProvider extends XProvider {
  override identifier = 'x-own-key';
  override name = 'X\n(Own API key)';
  override toolTip =
    'Posts through your own X developer app. X bills your developer account for the API use, and your plan does not cap these X posts.';

  protected override appCredentials(accessToken = '') {
    const [, , appKey, appSecret] = accessToken.split(':');
    return { appKey, appSecret };
  }

  async customFields() {
    return [
      {
        key: 'apiKey',
        label: 'API Key',
        validation: keyValidation,
        type: 'text' as const,
        hint: 'In developer.x.com create a Project and an App, then open the App. Under User authentication settings set App permissions to Read and write, then copy the API Key from Keys and tokens.',
      },
      {
        key: 'apiKeySecret',
        label: 'API Key Secret',
        validation: keyValidation,
        type: 'password' as const,
      },
      {
        key: 'accessToken',
        label: 'Access Token',
        validation: keyValidation,
        type: 'text' as const,
        hint: 'Generate the Access Token and Secret in Keys and tokens after setting Read and write. If you change the permissions later, generate them again.',
      },
      {
        key: 'accessTokenSecret',
        label: 'Access Token Secret',
        validation: keyValidation,
        type: 'password' as const,
        hint: 'X bills your own developer account for the posts and reads made with these keys.',
      },
    ];
  }

  override async generateAuthUrl() {
    const state = makeSecureId(6);
    return {
      url: state,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  override async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    let body: Record<string, string>;
    try {
      body = JSON.parse(Buffer.from(params.code, 'base64').toString());
    } catch (err) {
      return 'Invalid credentials';
    }

    const fields = [
      body?.accessToken,
      body?.accessTokenSecret,
      body?.apiKey,
      body?.apiKeySecret,
    ].map((value) => String(value || '').trim());

    if (fields.some((value) => !value || /[:\s]/.test(value))) {
      return 'Fill in the API Key, API Key Secret, Access Token and Access Token Secret of your X app';
    }

    const token = fields.join(':');
    const client = new TwitterApi({
      ...this.appCredentials(token),
      accessToken: fields[0],
      accessSecret: fields[1],
    });

    try {
      const { data, headers } = await client.v2.get<UserV2Result>(
        'users/me',
        { 'user.fields': 'username,verified,profile_image_url,name' },
        { fullResponse: true }
      );

      // X tells which permission the access token was issued with
      if (headers['x-access-level'] === 'read') {
        return 'These keys can only read. Set App permissions to Read and write in your X app, then generate the Access Token and Secret again and connect with the new ones';
      }

      const { username, verified, profile_image_url, name, id } = data.data;

      return {
        id: String(id),
        accessToken: token,
        name,
        refreshToken: '',
        expiresIn: 999999999,
        picture: profile_image_url || '',
        username,
        additionalSettings: [
          {
            title: 'Verified',
            description: 'Is this a verified user? (Premium)',
            type: 'checkbox' as const,
            value: !!verified,
          },
        ],
      };
    } catch (err: any) {
      // the error holds the signed request, so only the status is kept
      if (err?.code === 401) {
        return 'X did not accept these keys. Check that the API Key, API Key Secret, Access Token and Access Token Secret are copied in full and come from the same X app';
      }
      if (err?.code === 403) {
        return 'X refused these keys. Check that the app belongs to a Project in developer.x.com and that your developer account has API access';
      }
      if (err?.code === 429) {
        return 'X is rate limiting these keys, please try again in a few minutes';
      }
      return 'Could not check these keys with X, please try again';
    }
  }
}
