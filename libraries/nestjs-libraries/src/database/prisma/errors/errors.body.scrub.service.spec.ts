import {
  ErrorBodyScrubService,
  TOKEN_LIKE_PATTERNS,
} from '@gitroom/nestjs-libraries/database/prisma/errors/errors.body.scrub.service';
import { auditErrorBody } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.audit.body';

// Stands in for ErrorBodyScrubRepository: holds the Errors rows and applies the
// same compare-and-swap the real updateMany does, so "the row changed under us"
// is real behaviour here rather than a mocked branch.
const repositoryFake = (
  errors: { id: string; body: string; message?: string }[] = [],
  posts: { id: string; error: string | null }[] = []
) => {
  const rows = errors.map((row) => ({ message: '', ...row }));
  const repository = {
    page: jest.fn(async (take: number, cursor?: string) =>
      rows
        .filter((row) => !cursor || row.id > cursor)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, take)
        .map(({ id, body }) => ({ id, body }))
    ),
    replace: jest.fn(async (id: string, previousBody: string, body: string) => {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row || row.body !== previousBody) return { count: 0 };
      row.body = body;
      return { count: 1 };
    }),
    countErrorMessagesContaining: jest.fn(
      async (pattern: string) =>
        rows.filter((row) => row.message.includes(pattern)).length
    ),
    countPostErrorsContaining: jest.fn(
      async (pattern: string) =>
        posts.filter((post) => (post.error ?? '').includes(pattern)).length
    ),
  };
  return { rows, posts, repository };
};

const leakingBody = (id: string) =>
  JSON.stringify([
    {
      id,
      content: 'hello',
      integration: {
        id: 'int-1',
        name: 'X account',
        providerIdentifier: 'x',
        token: 'access-secret',
        refreshToken: 'refresh-secret',
      },
      submittedForOrder: { id: 'o-1' },
    },
  ]);

describe('ErrorBodyScrubService', () => {
  it('rewrites a stored body through the allowlist', async () => {
    const { repository, rows } = repositoryFake([
      { id: 'e-1', body: leakingBody('p-1') },
    ]);

    const { bodies } = await new ErrorBodyScrubService(repository as any).run();

    expect(rows[0].body).toBe(auditErrorBody(leakingBody('p-1')));
    expect(rows[0].body).not.toContain('secret');
    expect(rows[0].body).not.toContain('submittedForOrder');
    expect(bodies).toEqual({
      dryRun: false,
      scanned: 1,
      updated: 1,
      unchanged: 0,
      skippedChanged: 0,
    });
  });

  it('leaves an allowlisted body and the column default alone', async () => {
    const { repository } = repositoryFake([
      { id: 'e-1', body: auditErrorBody(leakingBody('p-1')) },
      { id: 'e-2', body: '{}' },
    ]);

    const { bodies } = await new ErrorBodyScrubService(repository as any).run();

    expect(bodies.unchanged).toBe(2);
    expect(bodies.updated).toBe(0);
    expect(repository.replace).not.toHaveBeenCalled();
  });

  it('is idempotent: a second run changes nothing', async () => {
    const { repository, rows } = repositoryFake([
      { id: 'e-1', body: leakingBody('p-1') },
      { id: 'e-2', body: 'not json at all' },
    ]);
    const service = new ErrorBodyScrubService(repository as any);

    await service.run();
    const afterFirst = rows.map((row) => ({ ...row }));
    const { bodies } = await service.run();

    expect(rows).toEqual(afterFirst);
    expect(rows[1].body).toBe('{}');
    expect(bodies.updated).toBe(0);
    expect(bodies.unchanged).toBe(2);
  });

  it('writes nothing in a dry run but reports what it would write', async () => {
    const { repository, rows } = repositoryFake([
      { id: 'e-1', body: leakingBody('p-1') },
    ]);

    const { bodies } = await new ErrorBodyScrubService(repository as any).run({
      dryRun: true,
    });

    expect(rows[0].body).toBe(leakingBody('p-1'));
    expect(bodies.updated).toBe(1);
    expect(bodies.dryRun).toBe(true);
    expect(repository.replace).not.toHaveBeenCalled();
  });

  it('skips a row that changed while the batch was in flight', async () => {
    const { repository, rows } = repositoryFake([
      { id: 'e-1', body: leakingBody('p-1') },
    ]);
    repository.page = jest.fn(async () => {
      // the row the scrub reads is already stale
      rows[0].body = leakingBody('p-2');
      return [{ id: 'e-1', body: leakingBody('p-1') }];
    }) as any;

    const { bodies } = await new ErrorBodyScrubService(repository as any).run();

    expect(bodies.skippedChanged).toBe(1);
    expect(bodies.updated).toBe(0);
    expect(rows[0].body).toBe(leakingBody('p-2'));
  });

  it('pages by id with a cursor until a short page', async () => {
    const { repository, rows } = repositoryFake(
      ['e-1', 'e-2', 'e-3', 'e-4', 'e-5'].map((id) => ({
        id,
        body: leakingBody(id),
      }))
    );
    const progress: number[] = [];

    const { bodies } = await new ErrorBodyScrubService(repository as any).run({
      batchSize: 2,
      onProgress: (report) => progress.push(report.scanned),
    });

    expect(repository.page.mock.calls.map(([, cursor]) => cursor)).toEqual([
      undefined,
      'e-2',
      'e-4',
    ]);
    expect(progress).toEqual([2, 4, 5]);
    expect(bodies.updated).toBe(5);
    expect(rows.every((row) => !row.body.includes('secret'))).toBe(true);
  });

  it('counts token-like Errors.message and Post.error rows without touching them', async () => {
    const message = '{"headers":{"Authorization":"Bearer abc"}}';
    const { repository, rows, posts } = repositoryFake(
      [{ id: 'e-1', body: '{}', message }],
      [
        { id: 'p-1', error: 'https://x?access_token=abc' },
        { id: 'p-2', error: null },
      ]
    );

    const { tokenLike } = await new ErrorBodyScrubService(
      repository as any
    ).run();

    expect(Object.keys(tokenLike!['Errors.message'])).toEqual(
      TOKEN_LIKE_PATTERNS
    );
    expect(tokenLike!['Errors.message']['Bearer ']).toBe(1);
    expect(tokenLike!['Post.error']['access_token=']).toBe(1);
    expect(tokenLike!['Post.error']['Bearer ']).toBe(0);
    expect(rows[0].message).toBe(message);
    expect(posts[0].error).toBe('https://x?access_token=abc');
  });

  it('keeps a completed rewrite when the token-like counts fail', async () => {
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { repository, rows } = repositoryFake([
      { id: 'e-1', body: leakingBody('p-1') },
    ]);
    repository.countPostErrorsContaining = jest.fn(async () => {
      throw new Error('canceling statement due to statement timeout');
    });

    const { bodies, tokenLike } = await new ErrorBodyScrubService(
      repository as any
    ).run();

    expect(bodies.updated).toBe(1);
    expect(rows[0].body).not.toContain('secret');
    expect(tokenLike).toBeNull();
    expect(error).toHaveBeenCalledWith('token-like counts unavailable');
    error.mockRestore();
  });

  it('reports counts, never a value', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { repository } = repositoryFake(
      [{ id: 'e-1', body: leakingBody('p-1'), message: 'Bearer abc' }],
      [{ id: 'p-1', error: 'ya29.abc' }]
    );

    const report = await new ErrorBodyScrubService(repository as any).run();

    expect(JSON.stringify(report)).not.toContain('secret');
    expect(JSON.stringify(report)).not.toContain('abc');
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });
});
