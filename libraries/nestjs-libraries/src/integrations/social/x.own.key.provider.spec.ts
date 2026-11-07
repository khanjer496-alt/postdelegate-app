const get = jest.fn();
const constructed: any[] = [];
jest.mock('twitter-api-v2', () => ({
  TwitterApi: class {
    v2 = { get };
    constructor(tokens: any) {
      constructed.push(tokens);
    }
  },
}));

import { XOwnKeyProvider } from '@gitroom/nestjs-libraries/integrations/social/x.own.key.provider';
import { XProvider } from '@gitroom/nestjs-libraries/integrations/social/x.provider';

const code = (fields: Record<string, string>) =>
  Buffer.from(JSON.stringify(fields)).toString('base64');

const keys = {
  apiKey: 'app-key',
  apiKeySecret: 'app-secret',
  accessToken: '123-user-token',
  accessTokenSecret: 'user-secret',
};

describe('XOwnKeyProvider', () => {
  const env = { ...process.env };
  beforeEach(() => {
    get.mockReset();
    constructed.length = 0;
    process.env.X_API_KEY = 'shared-key';
    process.env.X_API_SECRET = 'shared-secret';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  const connect = (fields = keys) =>
    new XOwnKeyProvider().authenticate({
      code: code(fields),
      codeVerifier: 'none',
    });

  it('checks the keys against the customer app, never the shared one', async () => {
    get.mockResolvedValue({
      headers: { 'x-access-level': 'read-write' },
      data: {
        data: {
          id: 42,
          username: 'brand',
          name: 'Brand',
          verified: true,
          profile_image_url: 'https://pbs.twimg.com/a.jpg',
        },
      },
    });

    const auth = await connect();

    expect(constructed[0]).toEqual({
      appKey: 'app-key',
      appSecret: 'app-secret',
      accessToken: '123-user-token',
      accessSecret: 'user-secret',
    });
    expect(get).toHaveBeenCalledWith(
      'users/me',
      expect.anything(),
      { fullResponse: true }
    );
    expect(auth).toMatchObject({
      id: '42',
      username: 'brand',
      accessToken: '123-user-token:user-secret:app-key:app-secret',
      additionalSettings: [expect.objectContaining({ value: true })],
    });
  });

  it('posts with the app carried in the channel token', () => {
    const provider = new XOwnKeyProvider() as any;
    expect(
      provider.appCredentials('123-user-token:user-secret:app-key:app-secret')
    ).toEqual({ appKey: 'app-key', appSecret: 'app-secret' });
  });

  it('keeps the shared X app on the env keys, whatever the token holds', () => {
    const shared = new XProvider() as any;
    expect(shared.appCredentials('token:secret')).toEqual({
      appKey: 'shared-key',
      appSecret: 'shared-secret',
    });
    expect(shared.appCredentials('a:b:other-key:other-secret')).toEqual({
      appKey: 'shared-key',
      appSecret: 'shared-secret',
    });
    expect(shared.appCredentials()).toEqual({
      appKey: 'shared-key',
      appSecret: 'shared-secret',
    });
  });

  it('explains wrong keys in plain words', async () => {
    get.mockRejectedValue(
      Object.assign(new Error('Request failed with code 401'), { code: 401 })
    );
    expect(await connect()).toBe(
      'X did not accept these keys. Check that the API Key, API Key Secret, Access Token and Access Token Secret are copied in full and come from the same X app'
    );
  });

  it('refuses keys without write permission', async () => {
    get.mockResolvedValue({
      headers: { 'x-access-level': 'read' },
      data: { data: { id: 1, username: 'brand', name: 'Brand' } },
    });
    expect(await connect()).toMatch(/^These keys can only read/);
  });

  it('refuses a value that cannot be stored in the token', async () => {
    expect(await connect({ ...keys, apiKey: 'a:b' })).toMatch(/^Fill in/);
    expect(get).not.toHaveBeenCalled();
  });

  it('asks for four fields in the connect modal', async () => {
    const fields = await new XOwnKeyProvider().customFields();
    expect(fields.map((f) => f.key)).toEqual([
      'apiKey',
      'apiKeySecret',
      'accessToken',
      'accessTokenSecret',
    ]);
  });
});
