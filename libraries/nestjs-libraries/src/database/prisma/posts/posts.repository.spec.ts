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
