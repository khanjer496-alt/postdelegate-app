import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';

const setup = () => {
  const repository = {
    createDynamicApp: jest.fn(async (data: any) => ({
      ...data,
      name: data.name,
      createdAt: new Date(),
    })),
    deleteStaleDynamicApps: jest.fn().mockResolvedValue(undefined),
  };
  return { service: new OAuthService(repository as any), repository };
};

const register = (redirect_uris: string[]) =>
  setup().service.registerDynamicClient({ redirect_uris } as any);

describe('OAuthService.registerDynamicClient redirect_uris', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.JWT_SECRET = 'unit-test-secret';
    process.env.DCR_VERIFIED_DOMAINS = 'claude.ai,chatgpt.com';
  });
  afterAll(() => {
    process.env = env;
  });

  it.each([
    'http://localhost:8080/callback',
    'http://127.0.0.1:33418/cb',
    'http://[::1]:5000/cb',
    'https://claude.ai/api/mcp/auth_callback',
    'https://sub.chatgpt.com/cb',
    'cursor://anysphere.cursor-mcp/oauth/callback',
    'vscode://ms-vscode.mcp/callback',
    'vscode-insiders://ms-vscode.mcp/callback',
    'windsurf://codeium.windsurf/callback',
    'claude://callback',
    'com.example.app:/oauth2redirect',
    'io.github.my-app.client://cb',
  ])('accepts %s', async (uri) => {
    await expect(register([uri])).resolves.toMatchObject({
      redirect_uris: [uri],
    });
  });

  it.each([
    'myapp://callback',
    'evil://steal',
    'zoom://join',
    'ms-word:open',
  ])('rejects the unknown private-use scheme %s', async (uri) => {
    await expect(register([uri])).rejects.toMatchObject({
      response: { error: 'invalid_redirect_uri' },
    });
  });

  it('rejects an unknown scheme even when it is not the first uri', async () => {
    await expect(
      register(['http://localhost:1/cb', 'custom-scheme://cb'])
    ).rejects.toMatchObject({ response: { error: 'invalid_redirect_uri' } });
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'http://example.com/cb',
    'https://evil.example.org/cb',
    'not a url',
  ])('keeps rejecting %s', async (uri) => {
    await expect(register([uri])).rejects.toMatchObject({
      response: { error: 'invalid_redirect_uri' },
    });
  });

  it('matches the known schemes case-insensitively and exactly', async () => {
    await expect(register(['Cursor://x/cb'])).resolves.toBeTruthy();
    // a known name as a prefix of another scheme is not enough
    await expect(register(['cursorx://x/cb'])).rejects.toMatchObject({
      response: { error: 'invalid_redirect_uri' },
    });
    await expect(register(['claude-evil://cb'])).rejects.toMatchObject({
      response: { error: 'invalid_redirect_uri' },
    });
  });
});
