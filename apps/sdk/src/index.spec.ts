import PostDelegate, { DEFAULT_BASE_URL, PostDelegateError } from './index';

function mockFetch(status = 200, body: unknown = {}) {
  const fn = jest.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(body === null ? null : typeof body === 'string' ? body : JSON.stringify(body), { status })
  );
  return fn;
}

const make = (fn: ReturnType<typeof mockFetch>, base?: string) =>
  new PostDelegate('key-1', { fetch: fn as unknown as typeof fetch, baseUrl: base });

describe('PostDelegate SDK', () => {
  it('uses the production API by default and accepts a string base URL', () => {
    expect(DEFAULT_BASE_URL).toBe('https://app.postdelegate.com/api');
    expect(() => new PostDelegate('')).toThrow('API key is required');
  });

  it('sends the key in the Authorization header on the /public/v1 path', async () => {
    const fn = mockFetch(200, [{ id: 'c1' }]);
    expect(await make(fn).integrations()).toEqual([{ id: 'c1' }]);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('https://app.postdelegate.com/api/public/v1/integrations');
    expect((init.headers as Record<string, string>).Authorization).toBe('key-1');
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^postdelegate-node\//);
  });

  it('supports a custom base URL (trailing slashes removed) and group filter', async () => {
    const fn = mockFetch(200, []);
    await make(fn, 'https://self.test/api//').integrations('g 1');
    expect(fn.mock.calls[0][0]).toBe('https://self.test/api/public/v1/integrations?group=g+1');
  });

  it('fills in the fields the API requires when creating a post', async () => {
    const fn = mockFetch(200, [{ postId: 'p1', integration: 'c1' }]);
    await make(fn).post({
      type: 'now',
      posts: [{ integration: { id: 'c1' }, value: [{ content: '<p>hi</p>' }] }],
    });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('https://app.postdelegate.com/api/public/v1/posts');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.shortLink).toBe(false);
    expect(body.tags).toEqual([]);
    expect(new Date(body.date).toString()).not.toBe('Invalid Date');
    expect(body.posts[0].value[0].image).toEqual([]);
  });

  it('lists posts with startDate, endDate and customer', async () => {
    const fn = mockFetch(200, { posts: [] });
    await make(fn).postList({ startDate: '2026-01-01T00:00:00Z', endDate: '2026-02-01T00:00:00Z', customer: 'g1' });
    const url = new URL(fn.mock.calls[0][0]);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      startDate: '2026-01-01T00:00:00Z',
      endDate: '2026-02-01T00:00:00Z',
      customer: 'g1',
    });
  });

  it('uploads with a real filename and content type, and sends adjust', async () => {
    const fn = mockFetch(200, { id: 'm1' });
    await make(fn).upload(Buffer.from('abc'), 'photo.PNG', { adjust: true });
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('https://app.postdelegate.com/api/public/v1/upload');
    const form = init.body as FormData;
    const file = form.get('file') as File;
    expect(file.name).toBe('photo.PNG');
    expect(file.type).toBe('image/png');
    expect(form.get('adjust')).toBe('true');
  });

  it('still accepts a bare extension for upload', async () => {
    const fn = mockFetch(200, { id: 'm1' });
    await make(fn).upload(new Uint8Array([1]), 'mp4');
    const file = (fn.mock.calls[0][1].body as FormData).get('file') as File;
    expect(file.name).toBe('upload.mp4');
    expect(file.type).toBe('video/mp4');
  });

  it('calls the remaining routes with the right method and path', async () => {
    const fn = mockFetch(200, {});
    const client = make(fn);
    await client.uploadFromUrl('https://x.test/a.png', { adjust: true });
    await client.deletePost('p/1');
    await client.deletePostByGroup('g1');
    await client.changePostStatus('p1', 'draft');
    await client.getMedia({ page: 2, search: 'cat' });
    await client.mediaStatus('m1');
    await client.groups();
    await client.integrationSettings('c1');
    await client.findSlot('c1');
    await client.me();
    await client.isConnected();
    await client.notifications();
    await client.analytics('c1', 30);
    await client.postAnalytics('p1');

    const calls = fn.mock.calls.map(([url, init]) => `${init.method} ${url.replace('https://app.postdelegate.com/api/public/v1', '')}`);
    expect(calls).toEqual([
      'POST /upload-from-url',
      'DELETE /posts/p%2F1',
      'DELETE /posts/group/g1',
      'PUT /posts/p1/status',
      'GET /media?page=2&search=cat',
      'GET /media/m1/status',
      'GET /groups',
      'GET /integration-settings/c1',
      'GET /find-slot/c1',
      'GET /me',
      'GET /is-connected',
      'GET /notifications?page=0',
      'GET /analytics/c1?date=30',
      'GET /analytics/post/p1?date=7',
    ]);
    expect(JSON.parse(fn.mock.calls[0][1].body as string)).toEqual({ url: 'https://x.test/a.png', adjust: true });
    expect(JSON.parse(fn.mock.calls[3][1].body as string)).toEqual({ status: 'draft' });
  });

  it('throws PostDelegateError with the server message and status', async () => {
    await expect(make(mockFetch(401, { msg: 'Invalid API key' })).me()).rejects.toMatchObject({
      name: 'PostDelegateError',
      message: 'Invalid API key',
      status: 401,
    });
    await expect(make(mockFetch(400, { message: 'too long', name: 'X' })).me()).rejects.toThrow('X: too long');
    await expect(make(mockFetch(400, { message: ['a', 'b'] })).me()).rejects.toThrow('a, b');
    const err = await make(mockFetch(502, 'Bad gateway')).me().catch((e) => e);
    expect(err).toBeInstanceOf(PostDelegateError);
    expect(err.message).toBe('Bad gateway');
  });

  it('returns null for an empty body (delete)', async () => {
    expect(await make(mockFetch(200, null)).deletePost('p1')).toBeNull();
  });
});
