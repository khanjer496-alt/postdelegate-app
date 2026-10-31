// the service builds LLM clients and pulls in the posts stack at import time
jest.mock('@langchain/openai', () => ({
  ChatOpenAI: class {},
  DallEAPIWrapper: class {},
}));
jest.mock('@langchain/langgraph', () => ({
  END: 'END',
  START: 'START',
  StateGraph: class {},
}));
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
