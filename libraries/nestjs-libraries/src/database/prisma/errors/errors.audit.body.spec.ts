import { auditErrorBody } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.audit.body';

// the shape the post workflows hand to changeState: a whole post row, with the
// decrypted integration and the relations Prisma included
const workflowPost = (extra: Record<string, unknown> = {}) => ({
  id: 'p-1',
  group: 'g-1',
  state: 'QUEUE',
  publishDate: '2026-11-01T10:00:00.000Z',
  organizationId: 'org-1',
  integrationId: 'int-1',
  parentPostId: null,
  content: '<p>hello</p>',
  settings: '{"__type":"x","who_can_reply_post":"everyone"}',
  image: JSON.stringify([
    { id: 'm-1', path: 'https://cdn/m-1.png', alt: 'a cat', signedUpload: 's' },
  ]),
  delay: 0,
  error: 'Bearer leaked-in-error',
  agentSource: 'API key',
  submittedForOrder: { id: 'o-1', buyer: { email: 'buyer@example.com' } },
  tags: [{ tag: { id: 't-1', name: 'news', orgId: 'org-1' } }],
  integration: {
    id: 'int-1',
    name: 'X account',
    providerIdentifier: 'x',
    internalId: '12345',
    token: 'access-secret',
    refreshToken: 'refresh-secret',
    customInstanceDetails: 'client-secret',
    organizationId: 'org-1',
  },
  ...extra,
});

describe('auditErrorBody', () => {
  it('keeps only the allowlisted post fields and names the channel', () => {
    const body = auditErrorBody([workflowPost()]);

    expect(JSON.parse(body)).toEqual([
      {
        id: 'p-1',
        group: 'g-1',
        state: 'QUEUE',
        publishDate: '2026-11-01T10:00:00.000Z',
        organizationId: 'org-1',
        integrationId: 'int-1',
        parentPostId: null,
        content: '<p>hello</p>',
        settings: '{"__type":"x","who_can_reply_post":"everyone"}',
        image: JSON.stringify([
          { id: 'm-1', path: 'https://cdn/m-1.png', alt: 'a cat' },
        ]),
        delay: 0,
        integration: { id: 'int-1', name: 'X account', providerIdentifier: 'x' },
      },
    ]);
    for (const value of [
      'secret',
      'leaked',
      'buyer@example.com',
      'signedUpload',
      '12345',
      'news',
    ]) {
      expect(body).not.toContain(value);
    }
  });

  it('drops a field it does not know, even one added to Post later', () => {
    const body = auditErrorBody([
      workflowPost({ someNewColumn: 'x', apiSecret: 'y', nested: { a: 1 } }),
    ]);

    const [post] = JSON.parse(body);
    expect(post).not.toHaveProperty('someNewColumn');
    expect(post).not.toHaveProperty('apiSecret');
    expect(post).not.toHaveProperty('nested');
  });

  it('never keeps an object where a plain value belongs', () => {
    const body = auditErrorBody([
      { id: 'p-1', content: { token: 'object-secret' }, delay: [1] },
    ]);

    expect(JSON.parse(body)).toEqual([{ id: 'p-1' }]);
  });

  it('applies the allowlist to child posts at every level', () => {
    const body = auditErrorBody([
      workflowPost({
        childrenPost: [
          workflowPost({
            id: 'p-2',
            parentPostId: 'p-1',
            childrenPost: [workflowPost({ id: 'p-3', parentPostId: 'p-2' })],
          }),
        ],
      }),
    ]);

    const [root] = JSON.parse(body);
    expect(root.childrenPost[0].id).toBe('p-2');
    expect(root.childrenPost[0].childrenPost[0].id).toBe('p-3');
    expect(root.childrenPost[0].childrenPost[0].integration).toEqual({
      id: 'int-1',
      name: 'X account',
      providerIdentifier: 'x',
    });
    expect(body).not.toContain('secret');
  });

  it('treats a JSON string body like the value it holds', () => {
    expect(auditErrorBody(JSON.stringify([workflowPost()]))).toBe(
      auditErrorBody([workflowPost()])
    );
  });

  it('replaces a body it cannot read with the column default', () => {
    expect(auditErrorBody('token=abc not json')).toBe('{}');
    expect(auditErrorBody(JSON.stringify('a string'))).toBe('{}');
    expect(auditErrorBody(42)).toBe('{}');
    expect(auditErrorBody(undefined)).toBe('{}');
    expect(auditErrorBody(null)).toBe('{}');
  });

  it('keeps the shape it was given: a list stays a list, a post stays a post', () => {
    expect(auditErrorBody('{}')).toBe('{}');
    expect(auditErrorBody('[]')).toBe('[]');
    expect(JSON.parse(auditErrorBody(workflowPost()))).toMatchObject({
      id: 'p-1',
      integration: { id: 'int-1' },
    });
  });

  it('writes dates as ISO strings and parsed settings as they are', () => {
    const body = auditErrorBody([
      {
        id: 'p-1',
        publishDate: new Date('2026-11-01T10:00:00.000Z'),
        settings: { __type: 'reddit', subreddit: [{ value: 'test' }] },
      },
    ]);

    expect(JSON.parse(body)).toEqual([
      {
        id: 'p-1',
        publishDate: '2026-11-01T10:00:00.000Z',
        settings: { __type: 'reddit', subreddit: [{ value: 'test' }] },
      },
    ]);
  });

  it('drops settings it cannot serialize, and keeps the rest of the post', () => {
    const body = auditErrorBody([
      { id: 'p-1', content: 'hello', settings: { count: BigInt(1) } },
    ]);

    expect(JSON.parse(body)).toEqual([{ id: 'p-1', content: 'hello' }]);
  });

  it('is idempotent: an allowlisted body comes back unchanged', () => {
    const once = auditErrorBody([
      workflowPost({ childrenPost: [workflowPost({ id: 'p-2' })] }),
    ]);

    expect(auditErrorBody(once)).toBe(once);
  });

  it('never throws, even on a post that refers back to itself', () => {
    const post: Record<string, unknown> = { id: 'p-1' };
    post.childrenPost = [post];

    expect(() => auditErrorBody([post])).not.toThrow();
  });
});
