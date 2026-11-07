import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';

const makeRepo = () => {
  const post = {
    findFirst: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockImplementation(async ({ where }: any) => ({
      id: where.id,
    })),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    update: jest.fn(),
  };
  const tags = { update: jest.fn().mockResolvedValue({}) };
  const repo = new PostsRepository(
    { model: { post } } as any,
    {} as any,
    {} as any,
    { model: { tags } } as any,
    { model: { tagsPosts: { deleteMany: jest.fn() } } } as any,
    {} as any,
    {} as any
  );
  return { repo, post, tags };
};

const body = (extra: Record<string, any> = {}) =>
  ({
    integration: { id: 'int-1' },
    settings: {},
    value: [{ id: 'p-1', content: 'hello', image: [] }],
    ...extra,
  } as any);

describe('PostsRepository.createOrUpdatePost tenant scoping', () => {
  it('scopes the previous post lookup and the group sweep to the organization', async () => {
    const { repo, post } = makeRepo();

    await repo.createOrUpdatePost(
      'schedule',
      'org-A',
      '2026-01-01T00:00:00',
      body({ group: 'victim-group' }),
      [],
      'API' as any
    );

    const lookup = post.findFirst.mock.calls.find(
      ([args]: any) => args.where.parentPostId === null
    )![0];
    expect(lookup.where).toMatchObject({
      group: 'victim-group',
      organizationId: 'org-A',
    });

    expect(post.updateMany).toHaveBeenCalledTimes(1);
    expect(post.updateMany.mock.calls[0][0].where).toMatchObject({
      group: 'victim-group',
      organizationId: 'org-A',
      deletedAt: null,
    });
  });

  it('scopes the keepGroup sweep to the organization', async () => {
    const { repo, post } = makeRepo();
    // the group already belongs to the caller's organization
    post.findFirst.mockResolvedValue({ id: 'own' });

    await repo.createOrUpdatePost(
      'update',
      'org-A',
      '2026-01-01T00:00:00',
      body({ group: 'own-group' }),
      [],
      'API' as any,
      undefined,
      true
    );

    expect(post.updateMany).toHaveBeenCalledTimes(1);
    expect(post.updateMany.mock.calls[0][0].where).toMatchObject({
      group: 'own-group',
      organizationId: 'org-A',
      id: { notIn: ['p-1'] },
    });
  });

  it('does not adopt a group of another organization with keepGroup', async () => {
    const { repo, post } = makeRepo();
    // nothing in org-A carries the supplied group
    post.findFirst.mockResolvedValue(null);

    await repo.createOrUpdatePost(
      'update',
      'org-A',
      '2026-01-01T00:00:00',
      body({ group: 'victim-group' }),
      [],
      'API' as any,
      undefined,
      true
    );

    const upsert = post.upsert.mock.calls[0][0];
    expect(upsert.create.group).not.toBe('victim-group');
    expect(upsert.update.group).not.toBe('victim-group');
    for (const [args] of post.updateMany.mock.calls) {
      expect(args.where.organizationId).toBe('org-A');
    }
  });
});

describe('PostsRepository.editTag', () => {
  it('only edits a tag of the caller organization', async () => {
    const { repo, tags } = makeRepo();

    await repo.editTag('tag-1', 'org-A', { name: 'n', color: '#fff' } as any);

    expect(tags.update.mock.calls[0][0].where).toEqual({
      id: 'tag-1',
      orgId: 'org-A',
    });
  });
});

describe('PostsRepository integration credentials', () => {
  const { randomBytes } = require('crypto');
  const {
    TokenEncryption,
  } = require('@gitroom/nestjs-libraries/database/prisma/integrations/token.encryption');
  const env = { ...process.env };

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    TokenEncryption.reset();
  });
  afterAll(() => {
    process.env = env;
    TokenEncryption.reset();
  });

  const withIntegration = () => ({
    id: 'p-1',
    integration: {
      id: 'int-1',
      token: TokenEncryption.encrypt('access'),
      refreshToken: TokenEncryption.encrypt('refresh'),
    },
  });
  const makePostRepo = (post: any) => {
    const model = {
      findUnique: jest.fn().mockResolvedValue(post),
      findMany: jest.fn().mockResolvedValue([post]),
    };
    return new PostsRepository(
      { model: { post: model } } as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any
    );
  };

  it('getPostById returns the integration with plaintext tokens', async () => {
    const post: any = await makePostRepo(withIntegration()).getPostById('p-1', 'org');
    expect(post.integration).toMatchObject({ token: 'access', refreshToken: 'refresh' });
  });

  it('getPost with the integration returns plaintext tokens', async () => {
    const post: any = await makePostRepo(withIntegration()).getPost('p-1', true, 'org');
    expect(post.integration).toMatchObject({ token: 'access', refreshToken: 'refresh' });
  });

  it('getPostsByGroup returns plaintext tokens', async () => {
    const posts: any[] = await makePostRepo(withIntegration()).getPostsByGroup('org', 'g');
    expect(posts[0].integration).toMatchObject({ token: 'access', refreshToken: 'refresh' });
  });

  it('a missing post stays missing and legacy plaintext is untouched', async () => {
    expect(await makePostRepo(null).getPostById('x')).toBeNull();
    const legacy = { id: 'p', integration: { token: 'plain', refreshToken: null } };
    const post: any = await makePostRepo(legacy).getPostById('p');
    expect(post.integration.token).toBe('plain');
  });
});

describe('PostsRepository.getAccountPostingDates', () => {
  it('reads the published (and queued) top-level posts of one network account', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([{ publishDate: new Date('2026-11-02T10:00:00Z') }]);
    const repo = new PostsRepository(
      { model: { post: { findMany } } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    const from = new Date('2026-11-01T12:00:00Z');
    const until = new Date('2026-11-03T12:00:00Z');

    await expect(
      repo.getAccountPostingDates('reddit', 'u1', from, until, true, ['p-1'])
    ).resolves.toEqual([new Date('2026-11-02T10:00:00Z')]);
    expect(findMany.mock.calls[0][0]).toEqual({
      where: {
        parentPostId: null,
        publishDate: { gte: from, lt: until },
        integration: { providerIdentifier: 'reddit', internalId: 'u1' },
        OR: [{ state: 'PUBLISHED' }, { state: 'QUEUE', deletedAt: null }],
        id: { notIn: ['p-1'] },
      },
      select: { publishDate: true },
      orderBy: { publishDate: 'asc' },
    });

    await repo.getAccountPostingDates('reddit', 'u1', from, until, false);
    expect(findMany.mock.calls[1][0].where.OR).toEqual([
      { state: 'PUBLISHED' },
    ]);
    expect(findMany.mock.calls[1][0].where.id).toBeUndefined();
  });
});

describe('PostsRepository channel-state scoping', () => {
  const makeFindMany = () => {
    const post = { findMany: jest.fn().mockResolvedValue([]) };
    const repo = new PostsRepository(
      { model: { post } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    return { repo, post };
  };

  const ready = {
    deletedAt: null,
    disabled: false,
    inBetweenSteps: false,
    refreshNeeded: false,
  };

  it('only looks at channels a post can still go out on', async () => {
    const { repo, post } = makeFindMany();
    await repo.searchForMissingThreeHoursPosts();
    expect(post.findMany.mock.calls[0][0].where.integration).toEqual(ready);
  });

  // this one used to leave deletedAt out, so it returned the old posts of
  // channels the customer had already removed
  it('leaves out the old posts of a removed channel', async () => {
    const { repo, post } = makeFindMany();
    await repo.getOldPosts('org-1', '2026-01-01');
    expect(post.findMany.mock.calls[0][0].where.integration).toEqual(ready);
  });
});

describe('PostsRepository state writes', () => {
  const makeStateRepo = (matched = 1) => {
    const row = {
      id: 'p-1',
      integrationId: 'int-1',
      organizationId: 'org-1',
      state: 'QUEUE',
    };
    const tx = {
      post: {
        findUnique: jest.fn().mockResolvedValue(row),
        updateMany: jest.fn().mockResolvedValue({ count: matched }),
      },
      integration: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ providerIdentifier: 'x' }),
      },
      errors: { create: jest.fn().mockResolvedValue({}) },
    };
    const transaction = {
      model: { $transaction: jest.fn((cb: any) => cb(tx)) },
    };
    const post = { findFirst: jest.fn().mockResolvedValue(null) };
    const repo = new PostsRepository(
      { model: { post } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      transaction as any,
      {} as any
    );
    return { repo, tx, post };
  };

  it('changeStateIf writes only while the post is in an expected state', async () => {
    const { repo, tx } = makeStateRepo();

    await expect(
      repo.changeStateIf('p-1', ['QUEUE'], 'ERROR', 'boom')
    ).resolves.toMatchObject({ id: 'p-1' });

    const [args] = tx.post.updateMany.mock.calls[0];
    expect(args.where).toMatchObject({
      id: 'p-1',
      AND: [{ state: { in: ['QUEUE'] } }, { integrationId: 'int-1' }],
      deletedAt: null,
    });
    expect(args.data).toEqual({ state: 'ERROR', error: 'boom' });
  });

  it('changeStateIf is a no-op for a post that moved on or is gone', async () => {
    const { repo, tx } = makeStateRepo(0);

    await expect(
      repo.changeStateIf('p-1', ['QUEUE'], 'ERROR', 'boom', [{ id: 'p-1' }])
    ).resolves.toBeNull();
    expect(tx.errors.create).not.toHaveBeenCalled();
  });

  it('changeStateIf reports a retried write that already landed, without writing again', async () => {
    const { repo, tx, post } = makeStateRepo(0);
    post.findFirst.mockResolvedValue({ id: 'p-1' });

    await expect(
      repo.changeStateIf('p-1', ['QUEUE'], 'ERROR', 'boom')
    ).resolves.toEqual({ id: 'p-1' });
    expect(post.findFirst.mock.calls[0][0].where).toEqual({
      id: 'p-1',
      state: 'ERROR',
      error: 'boom',
      deletedAt: null,
      integration: { deletedAt: null },
    });
    expect(tx.errors.create).not.toHaveBeenCalled();
  });

  it('changeStateIf lets a database failure through, so the activity retries', async () => {
    const { repo, tx } = makeStateRepo();
    tx.post.updateMany.mockRejectedValue(new Error('db down'));

    await expect(
      repo.changeStateIf('p-1', ['QUEUE'], 'ERROR', 'boom')
    ).rejects.toThrow('db down');
  });

  it('changeStateIf keeps the release of a post that went out', async () => {
    const { repo, tx } = makeStateRepo();

    await repo.changeStateIf('p-1', ['QUEUE'], 'ERROR', 'unconfirmed', undefined, {
      releaseId: 'x-1',
      releaseURL: 'https://x.com/1',
    });

    expect(tx.post.updateMany.mock.calls[0][0].data).toEqual({
      state: 'ERROR',
      error: 'unconfirmed',
      releaseId: 'x-1',
      releaseURL: 'https://x.com/1',
    });
  });

  it('never stores the integration credentials in the error log', async () => {
    const { repo, tx } = makeStateRepo();

    await repo.changeState('p-1', 'ERROR', 'boom', [
      {
        id: 'p-1',
        content: 'hello',
        accessToken: 'leak',
        submittedForOrder: { id: 'o-1', seller: { apiKey: 'order-secret' } },
        integration: {
          id: 'int-1',
          name: 'X account',
          providerIdentifier: 'x',
          token: 'access-secret',
          refreshToken: 'refresh-secret',
          customInstanceDetails: 'client-secret',
        },
      },
    ]);

    const { body } = tx.errors.create.mock.calls[0][0].data;
    expect(JSON.parse(body)).toEqual([
      {
        id: 'p-1',
        content: 'hello',
        integration: { id: 'int-1', name: 'X account', providerIdentifier: 'x' },
      },
    ]);
    expect(body).not.toContain('secret');
    expect(body).not.toContain('leak');
  });

  it('applies the same allowlist to the child posts of a thread', async () => {
    const { repo, tx } = makeStateRepo();

    await repo.changeState('p-1', 'ERROR', 'boom', [
      {
        id: 'p-1',
        content: 'first',
        childrenPost: [
          {
            id: 'p-2',
            content: 'second',
            parentPostId: 'p-1',
            integration: { id: 'int-1', token: 'child-secret' },
          },
        ],
      },
    ]);

    const { body } = tx.errors.create.mock.calls[0][0].data;
    expect(JSON.parse(body)).toEqual([
      {
        id: 'p-1',
        content: 'first',
        childrenPost: [
          {
            id: 'p-2',
            parentPostId: 'p-1',
            content: 'second',
            integration: { id: 'int-1' },
          },
        ],
      },
    ]);
  });

  it('allowlists a body handed over as a JSON string, and drops one it cannot read', async () => {
    const { repo, tx } = makeStateRepo();

    await repo.changeState(
      'p-1',
      'ERROR',
      'boom',
      JSON.stringify([{ id: 'p-1', integration: { token: 'string-secret' } }])
    );
    await repo.changeState('p-1', 'ERROR', 'boom', 'token=not-json-secret');

    const [first, second] = tx.errors.create.mock.calls.map(
      ([args]: any) => args.data.body
    );
    expect(JSON.parse(first)).toEqual([{ id: 'p-1', integration: {} }]);
    expect(second).toBe('{}');
  });

  it('allowlists the stored bodies the debug export reads', async () => {
    const errors = {
      findMany: jest.fn().mockResolvedValue([
        {
          message: 'boom',
          platform: 'x',
          body: JSON.stringify([
            { id: 'p-1', integration: { id: 'int-1', token: 'old-secret' } },
          ]),
          createdAt: new Date(0),
        },
      ]),
    };
    const repo = new PostsRepository(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { model: { errors } } as any,
      {} as any,
      {} as any
    );

    const [row] = await repo.getErrorsByPostIds(['p-1']);

    expect(errors.findMany.mock.calls[0][0].select).toEqual({
      message: true,
      platform: true,
      body: true,
      createdAt: true,
    });
    expect(JSON.parse(row.body)).toEqual([
      { id: 'p-1', integration: { id: 'int-1' } },
    ]);
  });

  it('allowlists the stored bodies the debug timeline reads', async () => {
    const { repo, post } = makeStateRepo();
    post.findFirst.mockResolvedValue({
      id: 'p-1',
      errors: [
        {
          id: 'e-1',
          body: JSON.stringify([{ id: 'p-1', integration: { token: 'old-secret' } }]),
        },
      ],
    });

    const timeline = await repo.getPostTimeline('p-1', 'org-1');

    expect(timeline!.errors[0].body).not.toContain('secret');
    expect(JSON.parse(timeline!.errors[0].body)).toEqual([
      { id: 'p-1', integration: {} },
    ]);
  });

  it('clears the last error when a post is queued again or moved to draft', async () => {
    const { repo, tx } = makeStateRepo();

    await repo.changeState('p-1', 'QUEUE');
    await repo.changeState('p-1', 'DRAFT');
    await repo.changeState('p-1', 'ERROR');

    expect(tx.post.updateMany.mock.calls.map(([args]: any) => args.data)).toEqual([
      { state: 'QUEUE', error: null },
      { state: 'DRAFT', error: null },
      { state: 'ERROR' },
    ]);
  });

  it('updatePost clears the error of an earlier attempt', async () => {
    const { repo, tx } = makeStateRepo();

    await repo.updatePost('p-1', 'x-1', 'https://x.com/1');

    expect(tx.post.updateMany.mock.calls[0][0].data).toEqual({
      state: 'PUBLISHED',
      releaseURL: 'https://x.com/1',
      releaseId: 'x-1',
      error: null,
    });
  });
});

describe('PostsRepository state and date of a thread', () => {
  const makeThreadRepo = () => {
    const post = {
      findFirst: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation(async ({ where }: any) => ({
        id: where.id,
      })),
      update: jest.fn().mockResolvedValue({
        id: 'p-1',
        group: 'g-1',
        integrationId: 'int-1',
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    };
    const transaction = {
      model: { $transaction: jest.fn((run: any) => run({ post })) },
    };
    const repo = new PostsRepository(
      { model: { post } } as any,
      {} as any,
      {} as any,
      { model: { tags: { findMany: jest.fn() } } } as any,
      { model: { tagsPosts: { deleteMany: jest.fn() } } } as any,
      {} as any,
      transaction as any,
      {} as any
    );
    return { repo, post, transaction };
  };

  it('a reschedule moves the comments with the main post and clears the old attempt', async () => {
    const { repo, post, transaction } = makeThreadRepo();
    await repo.changeDate('org-1', 'p-1', '2030-01-01T10:00:00', false, 'schedule');

    expect(transaction.model.$transaction).toHaveBeenCalledTimes(1);
    const [{ where, data }] = post.update.mock.calls[0];
    expect(where).toEqual({ organizationId: 'org-1', id: 'p-1' });
    expect(data).toMatchObject({
      state: 'QUEUE',
      error: null,
      releaseId: null,
      releaseURL: null,
    });
    const [{ where: comments, data: commentData }] = post.updateMany.mock.calls[0];
    expect(comments).toEqual({
      organizationId: 'org-1',
      group: 'g-1',
      integrationId: 'int-1',
      deletedAt: null,
      id: { not: 'p-1' },
    });
    expect(commentData).toEqual(data);
  });

  it('moving the date only keeps the state, the release and the error', async () => {
    const { repo, post } = makeThreadRepo();
    await repo.changeDate('org-1', 'p-1', '2030-01-01T10:00:00', false, 'update');
    const [{ data }] = post.update.mock.calls[0];
    expect(Object.keys(data)).toEqual(['publishDate']);
    expect(post.updateMany.mock.calls[0][0].data).toEqual(data);
  });

  it('a status change moves the whole thread of the channel', async () => {
    const { repo, post } = makeThreadRepo();
    await repo.changeGroupState(
      'org-1',
      { group: 'g-1', integrationId: 'int-1' },
      'QUEUE'
    );
    expect(post.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        group: 'g-1',
        integrationId: 'int-1',
        deletedAt: null,
        integration: { deletedAt: null },
        // published since it was read: left alone
        state: { not: 'PUBLISHED' },
      },
      data: { state: 'QUEUE', error: null, releaseId: null, releaseURL: null },
    });

    await repo.changeGroupState(
      'org-1',
      { group: 'g-1', integrationId: 'int-1' },
      'DRAFT'
    );
    expect(post.updateMany.mock.calls[1][0].data).toEqual({
      state: 'DRAFT',
      error: null,
    });

    // republish: a published post is what is meant
    await repo.changeGroupState(
      'org-1',
      { group: 'g-1', integrationId: 'int-1' },
      'QUEUE',
      true
    );
    expect(post.updateMany.mock.calls[2][0].where).not.toHaveProperty('state');
  });

  it('a status change of a post that is gone fails', async () => {
    const { repo, post } = makeThreadRepo();
    post.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      repo.changeGroupState('org-1', { group: 'g-1', integrationId: 'int-1' }, 'QUEUE')
    ).rejects.toThrow('Post is no longer available.');
  });

  it('a save that queues a post again clears the old attempt, an update keeps it', async () => {
    const { repo, post } = makeThreadRepo();
    await repo.createOrUpdatePost(
      'schedule',
      'org-1',
      '2030-01-01T10:00:00',
      body(),
      [],
      'API' as any
    );
    expect(post.upsert.mock.calls[0][0].update).toMatchObject({
      state: 'QUEUE',
      error: null,
      releaseId: null,
      releaseURL: null,
    });

    await repo.createOrUpdatePost(
      'draft',
      'org-1',
      '2030-01-01T10:00:00',
      body(),
      [],
      'API' as any
    );
    const draft = post.upsert.mock.calls[1][0].update;
    expect(draft).toMatchObject({ state: 'DRAFT', error: null });
    expect(draft).not.toHaveProperty('releaseURL');

    await repo.createOrUpdatePost(
      'update',
      'org-1',
      '2030-01-01T10:00:00',
      body(),
      [],
      'API' as any
    );
    const update = post.upsert.mock.calls[2][0].update;
    expect(update).not.toHaveProperty('state');
    expect(update).not.toHaveProperty('error');
    expect(update).not.toHaveProperty('releaseURL');
  });
});
