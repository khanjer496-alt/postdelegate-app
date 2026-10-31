// the service pulls in the posts stack at import time. The LLM clients record
// what they were built with, and the chat model answers the structured prompt
// with a fixed post content
const openAiModels: { chat: any[]; dalle: any[] } = { chat: [], dalle: [] };
jest.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    constructor(options: any) {
      openAiModels.chat.push(options);
    }
    withStructuredOutput() {
      return async () => ({ socialMediaPostContent: 'generated post' });
    }
  },
  DallEAPIWrapper: class {
    constructor(options: any) {
      openAiModels.dalle.push(options);
    }
  },
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service',
  () => ({ AiCredentialService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository',
  () => ({ AutopostRepository: class {} })
);
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));
jest.mock('@gitroom/nestjs-libraries/dtos/autopost/autopost.dto', () => ({
  AutopostDto: class {},
}));

import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';

const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
<item><title>a</title><link>https://example.com/a</link>
<pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate>
<description>first</description></item></channel></rss>`;

describe('AutopostService SSRF hardening', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  const service = new AutopostService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

  beforeEach(() => {
    delete process.env.DISABLE_SSRF_PROTECTION;
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('reads the feed through the safe fetch and parses the body', async () => {
    fetchMock.mockResolvedValue(new Response(rss));

    const result = await service.loadXML('https://8.8.8.8/feed.xml');

    expect(result).toMatchObject({ success: true, url: 'https://example.com/a' });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('does not follow a feed redirect to an internal address', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://169.254.169.254/latest/meta-data' },
      })
    );

    expect(await service.loadXML('https://8.8.8.8/feed.xml')).toEqual({
      success: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not fetch an item link that points to an internal address', async () => {
    expect(await service.loadUrl('http://127.0.0.1:8080/secret')).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches a public item link through the safe fetch', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html><body><p>hello</p></body></html>')
    );

    expect(await service.loadUrl('http://8.8.8.8/article')).toContain('hello');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });
});

describe('AutopostService workspace key', () => {
  let autopostsRepository: { getAutopost: jest.Mock; updateUrl: jest.Mock };
  let integrationService: { getIntegrationsList: jest.Mock };
  let postsService: { findFreeDateTime: jest.Mock; createPost: jest.Mock };
  let aiCredentialService: {
    hasCredential: jest.Mock;
    getOpenAiKey: jest.Mock;
  };
  let service: AutopostService;

  const autopost = (flags: { generateContent: boolean; addPicture: boolean }) => ({
    id: 'autopost-1',
    organizationId: 'org-1',
    active: true,
    url: 'https://8.8.8.8/feed.xml',
    lastUrl: null,
    integrations: '[]',
    content: 'fixed content',
    ...flags,
  });

  beforeEach(() => {
    openAiModels.chat = [];
    openAiModels.dalle = [];
    autopostsRepository = {
      getAutopost: jest.fn(),
      updateUrl: jest.fn().mockResolvedValue(undefined),
    };
    integrationService = {
      getIntegrationsList: jest.fn().mockResolvedValue([
        { id: 'int-1', organizationId: 'org-1', providerIdentifier: 'x' },
      ]),
    };
    postsService = {
      findFreeDateTime: jest.fn().mockResolvedValue('2026-11-01T10:00:00'),
      createPost: jest.fn().mockResolvedValue(undefined),
    };
    aiCredentialService = {
      hasCredential: jest.fn(),
      getOpenAiKey: jest.fn(),
    };
    service = new AutopostService(
      autopostsRepository as any,
      {} as any,
      integrationService as any,
      postsService as any,
      aiCredentialService as any
    );
    jest.spyOn(service, 'loadXML').mockResolvedValue({
      success: true,
      date: 'Mon, 01 Jan 2026 00:00:00 GMT',
      url: 'https://example.com/a',
      description: 'first',
    });
  });

  it('autopost skips the run without posting when AI is needed and the workspace has no key', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    autopostsRepository.getAutopost.mockResolvedValue(
      autopost({ generateContent: true, addPicture: false })
    );
    aiCredentialService.hasCredential.mockResolvedValue(false);

    await expect(service.startAutopost('autopost-1')).resolves.toBeUndefined();

    expect(aiCredentialService.hasCredential).toHaveBeenCalledWith('org-1');
    expect(aiCredentialService.getOpenAiKey).not.toHaveBeenCalled();
    expect(postsService.createPost).not.toHaveBeenCalled();
    expect(autopostsRepository.updateUrl).not.toHaveBeenCalled();
    expect(openAiModels.chat).toHaveLength(0);
    expect(openAiModels.dalle).toHaveLength(0);
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it('autopost skips the run when only a picture is asked for and the workspace has no key', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    autopostsRepository.getAutopost.mockResolvedValue(
      autopost({ generateContent: false, addPicture: true })
    );
    aiCredentialService.hasCredential.mockResolvedValue(false);

    await expect(service.startAutopost('autopost-1')).resolves.toBeUndefined();

    expect(postsService.createPost).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('autopost without AI steps does not need a key', async () => {
    autopostsRepository.getAutopost.mockResolvedValue(
      autopost({ generateContent: false, addPicture: false })
    );

    await service.startAutopost('autopost-1');

    expect(aiCredentialService.hasCredential).not.toHaveBeenCalled();
    expect(aiCredentialService.getOpenAiKey).not.toHaveBeenCalled();
    expect(openAiModels.chat).toHaveLength(0);
    expect(openAiModels.dalle).toHaveLength(0);
    expect(postsService.createPost).toHaveBeenCalledTimes(1);
    expect(
      postsService.createPost.mock.calls[0][1].posts[0].value[0].content
    ).toBe('fixed content\n\nhttps://example.com/a');
    expect(autopostsRepository.updateUrl).toHaveBeenCalledWith(
      'autopost-1',
      'https://example.com/a'
    );
  });

  it('autopost builds its models from the workspace key', async () => {
    autopostsRepository.getAutopost.mockResolvedValue(
      autopost({ generateContent: true, addPicture: false })
    );
    aiCredentialService.hasCredential.mockResolvedValue(true);
    aiCredentialService.getOpenAiKey.mockResolvedValue('sk-org-key');

    await service.startAutopost('autopost-1');

    expect(aiCredentialService.getOpenAiKey).toHaveBeenCalledWith('org-1');
    expect(openAiModels.chat).toEqual([
      { apiKey: 'sk-org-key', model: 'gpt-4.1', temperature: 0.7 },
    ]);
    expect(openAiModels.dalle).toEqual([
      { apiKey: 'sk-org-key', model: 'chatgpt-image-latest' },
    ]);
    expect(
      postsService.createPost.mock.calls[0][1].posts[0].value[0].content
    ).toBe('generated post\n\nhttps://example.com/a');
  });
});
