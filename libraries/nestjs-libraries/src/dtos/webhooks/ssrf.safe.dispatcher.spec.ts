import {
  readResponseText,
  ssrfSafeFetch,
} from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location } });

describe('ssrfSafeFetch', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    delete process.env.DISABLE_SSRF_PROTECTION;
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('never lets fetch follow redirects on its own and pins the dispatcher', async () => {
    fetchMock.mockResolvedValue(new Response('ok'));

    await ssrfSafeFetch('https://8.8.8.8/feed');

    const init = fetchMock.mock.calls[0][1];
    expect(init.redirect).toBe('manual');
    expect(init.dispatcher).toBeDefined();
  });

  it('blocks a redirect to a private address', async () => {
    fetchMock.mockResolvedValueOnce(
      redirect('https://169.254.169.254/latest/meta-data')
    );

    await expect(ssrfSafeFetch('https://8.8.8.8/feed')).rejects.toThrow(
      'Blocked URL'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks a redirect to loopback, including an IPv4-mapped IPv6 literal', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://127.0.0.1/admin'));
    await expect(ssrfSafeFetch('https://8.8.8.8/feed')).rejects.toThrow(
      'Blocked URL'
    );

    fetchMock.mockResolvedValueOnce(redirect('https://[::ffff:127.0.0.1]/'));
    await expect(ssrfSafeFetch('https://8.8.8.8/feed')).rejects.toThrow(
      'Blocked URL'
    );
  });

  it('blocks a downgrade to http unless the caller allows it', async () => {
    fetchMock.mockResolvedValueOnce(redirect('http://8.8.4.4/feed'));
    await expect(ssrfSafeFetch('https://8.8.8.8/feed')).rejects.toThrow(
      'Blocked URL'
    );

    fetchMock
      .mockResolvedValueOnce(redirect('http://8.8.4.4/feed'))
      .mockResolvedValueOnce(new Response('ok'));
    const response = await ssrfSafeFetch(
      'https://8.8.8.8/feed',
      {},
      { allowHttp: true }
    );
    expect(await response.text()).toBe('ok');
  });

  it('follows a safe redirect chain and turns a redirected POST into a GET', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('https://8.8.4.4/next'))
      .mockResolvedValueOnce(new Response('done'));

    const response = await ssrfSafeFetch('https://8.8.8.8/hook', {
      method: 'POST',
      body: '{"a":1}',
    });

    expect(await response.text()).toBe('done');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(fetchMock.mock.calls[1][0]).toBe('https://8.8.4.4/next');
    expect(fetchMock.mock.calls[1][1].method).toBe('GET');
    expect(fetchMock.mock.calls[1][1].body).toBeUndefined();
  });

  it('keeps method and body on a 307', async () => {
    fetchMock
      .mockResolvedValueOnce(redirect('https://8.8.4.4/next', 307))
      .mockResolvedValueOnce(new Response('done'));

    await ssrfSafeFetch('https://8.8.8.8/hook', {
      method: 'POST',
      body: '{"a":1}',
    });

    expect(fetchMock.mock.calls[1][1].method).toBe('POST');
    expect(fetchMock.mock.calls[1][1].body).toBe('{"a":1}');
  });

  it('gives up after too many redirects', async () => {
    fetchMock.mockImplementation(async () => redirect('https://8.8.4.4/loop'));

    await expect(ssrfSafeFetch('https://8.8.8.8/feed')).rejects.toThrow(
      'Too many redirects'
    );
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('rejects a private first hop without calling fetch', async () => {
    await expect(ssrfSafeFetch('https://10.0.0.5/feed')).rejects.toThrow(
      'Blocked URL'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('readResponseText', () => {
  it('returns the body when it fits', async () => {
    expect(await readResponseText(new Response('hello'), 100)).toBe('hello');
  });

  it('throws once the body grows past the limit', async () => {
    await expect(
      readResponseText(new Response('x'.repeat(50)), 10)
    ).rejects.toThrow('Response too large');
  });
});
