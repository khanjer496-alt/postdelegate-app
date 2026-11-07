import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from './cli';
import type { Context } from './commands';

type Call = { url: string; init: RequestInit };

function setup(
  responses: Array<{ status?: number; body?: unknown } | Error>,
  env: Record<string, string | undefined> = {}
) {
  const dir = mkdtempSync(join(tmpdir(), 'pdz-cli-'));
  const calls: Call[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const queue = [...responses];

  const fetchMock = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    const { status = 200, body = {} } = next || {};
    return new Response(body === null ? null : JSON.stringify(body), { status });
  });

  const ctx: Context = {
    env: { XDG_CONFIG_HOME: join(dir, 'cfg'), ...env },
    homedir: dir,
    version: '9.9.9',
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    readSecret: async () => 'typed-key',
    fetch: fetchMock as unknown as typeof fetch,
    now: () => new Date('2026-12-01T10:00:00.000Z'),
  };

  return {
    ctx,
    dir,
    calls,
    out: () => out.join(''),
    err: () => err.join(''),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const withKey = { POSTDELEGATE_API_KEY: 'test-key' };

describe('cli', () => {
  let t: ReturnType<typeof setup>;
  afterEach(() => t?.cleanup());

  it('prints the version and help', async () => {
    t = setup([]);
    expect(await run(['--version'], t.ctx)).toBe(0);
    expect(t.out()).toBe('9.9.9\n');
    expect(await run(['help'], t.ctx)).toBe(0);
    expect(t.out()).toContain('posts create');
  });

  it('lists channels with the Authorization header and the default URL', async () => {
    t = setup(
      [
        {
          body: [
            { id: 'c1', name: 'My X', identifier: 'x', disabled: false, picture: null, profile: 'me' },
          ],
        },
      ],
      withKey
    );
    expect(await run(['channels'], t.ctx)).toBe(0);
    expect(t.calls[0].url).toBe('https://app.postdelegate.com/api/public/v1/integrations');
    expect(t.calls[0].init.method).toBe('GET');
    const headers = t.calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('test-key');
    expect(headers['User-Agent']).toBe('postdelegate-cli/9.9.9');
    expect(t.out()).toMatch(/c1\s+x\s+My X\s+active/);
  });

  it('prints raw JSON with --json and passes --group', async () => {
    t = setup([{ body: [{ id: 'c1' }] }], withKey);
    expect(await run(['channels', '--json', '--group', 'g1', '--api-url', 'http://localhost:5000/api/'], t.ctx)).toBe(0);
    expect(t.calls[0].url).toBe('http://localhost:5000/api/public/v1/integrations?group=g1');
    expect(JSON.parse(t.out())).toEqual([{ id: 'c1' }]);
  });

  it('maps a 401 to exit code 3 without printing the key', async () => {
    t = setup([{ status: 401, body: { msg: 'Invalid API key' } }], { POSTDELEGATE_API_KEY: 'super-secret-key' });
    expect(await run(['channels'], t.ctx)).toBe(3);
    expect(t.err()).toContain('Invalid API key');
    expect(t.out() + t.err()).not.toContain('super-secret-key');
  });

  it('exits 3 when no key is configured, without calling the API', async () => {
    t = setup([]);
    expect(await run(['channels'], t.ctx)).toBe(3);
    expect(t.calls).toHaveLength(0);
    expect(t.err()).toContain('postdelegate login');
  });

  it('reports network failures and unknown errors with exit code 1', async () => {
    t = setup([Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })], withKey);
    expect(await run(['channels'], t.ctx)).toBe(1);
    expect(t.err()).toContain('Could not reach https://app.postdelegate.com/api: ENOTFOUND');
  });

  it('emits JSON errors on stderr with --json', async () => {
    t = setup([{ status: 400, body: { message: 'bad', name: 'X' } }], withKey);
    expect(await run(['channels', '--json'], t.ctx)).toBe(1);
    expect(JSON.parse(t.err())).toEqual({ error: { message: 'X: bad (HTTP 400)', exitCode: 1 } });
  });

  it('lists posts for a date range using startDate/endDate', async () => {
    t = setup(
      [
        {
          body: {
            posts: [
              {
                id: 'p1',
                content: '<p>Hello &amp; welcome</p>',
                publishDate: '2026-12-02T09:00:00.000Z',
                state: 'QUEUE',
                integration: { id: 'c1', providerIdentifier: 'x', name: 'My X', picture: null },
              },
            ],
          },
        },
      ],
      withKey
    );
    expect(await run(['posts', 'list', '--from', '2026-12-01', '--to', '2026-12-31'], t.ctx)).toBe(0);
    const url = new URL(t.calls[0].url);
    expect(url.pathname).toBe('/api/public/v1/posts');
    expect(url.searchParams.get('startDate')).toBe('2026-12-01T00:00:00.000Z');
    expect(url.searchParams.get('endDate')).toBe('2026-12-31T23:59:59.999Z');
    expect(t.out()).toContain('Hello & welcome');
    expect(t.out()).toContain('x/My X');
  });

  it('defaults the posts list window around now and validates dates', async () => {
    t = setup([{ body: { posts: [] } }], withKey);
    expect(await run(['posts', 'list'], t.ctx)).toBe(0);
    const url = new URL(t.calls[0].url);
    expect(url.searchParams.get('startDate')).toBe('2026-11-24T10:00:00.000Z');
    expect(url.searchParams.get('endDate')).toBe('2026-12-31T10:00:00.000Z');
    expect(t.out()).toContain('No posts');
    expect(await run(['posts', 'list', '--from', 'tomorrow'], t.ctx)).toBe(2);
  });

  it('builds a scheduled post request for several channels', async () => {
    t = setup(
      [{ body: [{ postId: 'p1', integration: 'c1' }, { postId: 'p2', integration: 'c2' }] }],
      withKey
    );
    const code = await run(
      [
        'posts', 'create',
        '--channel', 'c1', '--channel', 'c2',
        '--text', 'Line one\nline two\n\nSecond <b>paragraph</b>',
        '--text', 'A reply',
        '--schedule', '2026-12-05T09:30:00Z',
        '--settings', '{"title":"Hi"}',
      ],
      t.ctx
    );
    expect(code).toBe(0);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].url).toBe('https://app.postdelegate.com/api/public/v1/posts');
    expect(t.calls[0].init.method).toBe('POST');
    expect((t.calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const body = JSON.parse(t.calls[0].init.body as string);
    expect(body).toMatchObject({
      type: 'schedule',
      date: '2026-12-05T09:30:00.000Z',
      shortLink: false,
      tags: [],
      creationMethod: 'CLI',
    });
    expect(body.posts).toHaveLength(2);
    expect(body.posts[0]).toEqual({
      integration: { id: 'c1' },
      settings: { title: 'Hi' },
      value: [
        { content: '<p>Line one<br>line two</p><p>Second &lt;b&gt;paragraph&lt;/b&gt;</p>', image: [] },
        { content: '<p>A reply</p>', image: [] },
      ],
    });
    expect(t.out()).toContain('Scheduled for 2026-12-05T09:30:00.000Z on 2 channel(s)');
  });

  it('creates drafts and publishes now', async () => {
    t = setup([{ body: [] }, { body: [] }], withKey);
    expect(await run(['posts', 'create', '--channel', 'c1', '--text', 'hi', '--draft'], t.ctx)).toBe(0);
    expect(await run(['posts', 'create', '--channel', 'c1', '--text', 'hi', '--schedule', 'now', '--html'], t.ctx)).toBe(0);
    const draft = JSON.parse(t.calls[0].init.body as string);
    const now = JSON.parse(t.calls[1].init.body as string);
    expect(draft.type).toBe('draft');
    expect(now.type).toBe('now');
    expect(now.date).toBe('2026-12-01T10:00:00.000Z');
    expect(now.posts[0].value[0].content).toBe('hi');
  });

  it('uploads local files and urls before creating the post', async () => {
    t = setup(
      [
        { body: { id: 'm1', name: 'a.png', path: 'https://cdn.test/a.png' } },
        { body: { id: 'm2', name: 'b.png', path: 'https://cdn.test/b.png' } },
        { body: [{ postId: 'p1', integration: 'c1' }] },
      ],
      withKey
    );
    const file = join(t.dir, 'a.png');
    writeFileSync(file, Buffer.from([1, 2, 3]));

    expect(
      await run(
        ['posts', 'create', '--channel', 'c1', '--text', 'pic', '--media', file, '--media', 'https://x.test/b.png', '--draft'],
        t.ctx
      )
    ).toBe(0);

    expect(t.calls[0].url).toBe('https://app.postdelegate.com/api/public/v1/upload');
    const form = t.calls[0].init.body as FormData;
    const sent = form.get('file') as File;
    expect(sent.name).toBe('a.png');
    expect(sent.type).toBe('image/png');
    expect((t.calls[0].init.headers as Record<string, string>)['Content-Type']).toBeUndefined();

    expect(t.calls[1].url).toBe('https://app.postdelegate.com/api/public/v1/upload-from-url');
    expect(JSON.parse(t.calls[1].init.body as string)).toEqual({ url: 'https://x.test/b.png' });

    const body = JSON.parse(t.calls[2].init.body as string);
    expect(body.posts[0].value[0].image).toEqual([
      { id: 'm1', path: 'https://cdn.test/a.png' },
      { id: 'm2', path: 'https://cdn.test/b.png' },
    ]);
  });

  it('supports --dry-run without any request', async () => {
    t = setup([]);
    expect(await run(['posts', 'create', '--channel', 'c1', '--text', 'hi', '--draft', '--dry-run', '--json'], t.ctx)).toBe(0);
    expect(t.calls).toHaveLength(0);
    expect(JSON.parse(t.out()).posts[0].integration.id).toBe('c1');
  });

  it.each([
    [['posts', 'create', '--text', 'hi', '--draft'], 'channel'],
    [['posts', 'create', '--channel', 'c1', '--draft'], '--text'],
    [['posts', 'create', '--channel', 'c1', '--text', 'hi'], 'Choose when'],
    [['posts', 'create', '--channel', 'c1', '--text', 'hi', '--draft', '--schedule', 'now'], 'not both'],
    [['posts', 'create', '--channel', 'c1', '--text', 'hi', '--schedule', 'soon'], 'Invalid date'],
    [['posts', 'create', '--channel', 'c1', '--text', 'hi', '--draft', '--settings', '[1]'], '--settings'],
  ])('rejects invalid create arguments %j with exit code 2', async (argv, message) => {
    t = setup([], withKey);
    expect(await run(argv, t.ctx)).toBe(2);
    expect(t.err()).toContain(message);
    expect(t.calls).toHaveLength(0);
  });

  it('deletes a post', async () => {
    t = setup([{ body: { id: 'p1' } }], withKey);
    expect(await run(['posts', 'delete', 'p1'], t.ctx)).toBe(0);
    expect(t.calls[0].url).toBe('https://app.postdelegate.com/api/public/v1/posts/p1');
    expect(t.calls[0].init.method).toBe('DELETE');
    expect(t.out()).toContain('Deleted post p1');
  });

  it('uploads a file', async () => {
    t = setup([{ body: { id: 'm1', name: 'x.mp4', path: 'https://cdn.test/x.mp4' } }], withKey);
    const file = join(t.dir, 'clip.mp4');
    writeFileSync(file, 'data');
    expect(await run(['upload', file, '--json'], t.ctx)).toBe(0);
    const sent = (t.calls[0].init.body as FormData).get('file') as File;
    expect(sent.type).toBe('video/mp4');
    expect(JSON.parse(t.out()).id).toBe('m1');
    expect(await run(['upload', join(t.dir, 'missing.png')], t.ctx)).toBe(2);
  });

  describe('login and logout', () => {
    it('verifies the key and stores it with 0600 permissions', async () => {
      t = setup([{ body: { organization: { id: 'o1', name: 'Acme' }, user: null } }]);
      expect(await run(['login', '--api-url', 'https://self.test/api'], t.ctx)).toBe(0);
      expect(t.calls[0].url).toBe('https://self.test/api/public/v1/me');
      expect((t.calls[0].init.headers as Record<string, string>).Authorization).toBe('typed-key');

      const path = join(t.dir, 'cfg', 'postdelegate', 'config.json');
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ apiKey: 'typed-key', apiUrl: 'https://self.test/api' });
      if (process.platform !== 'win32') {
        expect(statSync(path).mode & 0o777).toBe(0o600);
      }
      expect(t.out()).toContain('Logged in to Acme');
      expect(t.out()).not.toContain('typed-key');

      // later commands use the saved key and URL
      t.calls.length = 0;
      const next = setup([{ body: { organization: { id: 'o1', name: 'Acme' }, user: null } }]);
      next.ctx.env = t.ctx.env;
      expect(await run(['whoami'], next.ctx)).toBe(0);
      expect(next.calls[0].url).toBe('https://self.test/api/public/v1/me');
      expect((next.calls[0].init.headers as Record<string, string>).Authorization).toBe('typed-key');
      expect(next.out()).toContain('API key from: config');
      next.cleanup();

      expect(await run(['logout'], t.ctx)).toBe(0);
      expect(await run(['whoami'], t.ctx)).toBe(3);
    });

    it('does not save a key the API rejects', async () => {
      t = setup([{ status: 401, body: { msg: 'Invalid API key' } }]);
      expect(await run(['login', '--api-key', 'bad'], t.ctx)).toBe(3);
      expect(await run(['logout'], t.ctx)).toBe(0);
      expect(t.out()).toContain('No saved credentials');
    });

    it('reads the key from POSTDELEGATE_API_KEY', async () => {
      t = setup([{ body: { organization: { id: 'o', name: 'N' }, user: null } }], { POSTDELEGATE_API_KEY: 'env-key' });
      expect(await run(['login'], t.ctx)).toBe(0);
      expect(JSON.parse(readFileSync(join(t.dir, 'cfg', 'postdelegate', 'config.json'), 'utf8')).apiKey).toBe('env-key');
    });
  });
});
