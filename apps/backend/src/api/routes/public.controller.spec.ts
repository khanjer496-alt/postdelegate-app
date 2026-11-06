// the controller imports provider / upload / auth modules that are not under test
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({
  TrackService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto', () => ({
  OnlyURL: class {},
}));
jest.mock('@gitroom/nestjs-libraries/dtos/comments/add.comment.dto', () => ({
  CreatePublicCommentDto: class {},
}));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({ AuthService: {} }));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing',
  () => ({ pricing: {} })
);

import { PublicController } from '@gitroom/backend/api/routes/public.controller';

describe('PublicController.getPreview', () => {
  it('only exposes the fields the preview page renders', async () => {
    const getPostsRecursively = jest.fn().mockResolvedValue([
      {
        id: 'p-1',
        organizationId: 'org-A',
        integrationId: 'int-1',
        group: 'secret-group',
        batchId: 'batch-1',
        settings: '{"token":"x"}',
        state: 'PUBLISHED',
        releaseURL: 'https://x.com/acme/status/1',
        error: 'boom',
        lastMessageId: 'm-1',
        submittedForOrganizationId: 'org-B',
        publishDate: new Date('2026-01-01T00:00:00Z'),
        creationMethod: 'API',
        content: '<p>hi</p>',
        image: '[]',
        childrenPost: [],
        tags: [],
        integration: {
          id: 'int-1',
          name: 'Acme',
          picture: 'pic.png',
          providerIdentifier: 'x',
          profile: 'acme',
          token: 'oauth-token',
          refreshToken: 'oauth-refresh',
        },
      },
    ]);
    const controller = new PublicController(
      {} as any,
      { getPostsRecursively, publicPostLink: jest.fn() } as any,
      {} as any
    );

    const [preview] = (await controller.getPreview('p-1')) as any[];

    expect(preview).not.toHaveProperty('group');
    expect(Object.keys(preview).sort()).toEqual(
      [
        'content',
        'creationMethod',
        'id',
        'image',
        'integration',
        'organizationId',
        'publishDate',
      ].sort()
    );
    expect(Object.keys(preview.integration).sort()).toEqual(
      ['id', 'name', 'picture', 'profile', 'providerIdentifier'].sort()
    );

    expect(preview).not.toHaveProperty('publishedLink');
  });
});

describe('PublicController.getPreview published link', () => {
  const integration = {
    id: 'int-1',
    name: 'Acme',
    picture: 'pic.png',
    providerIdentifier: 'x',
    profile: 'acme',
    token: 'oauth-token',
  };

  const row = (overrides: any = {}) => ({
    id: 'p-1',
    organizationId: 'org-A',
    publishDate: new Date('2026-01-01T00:00:00Z'),
    creationMethod: 'API',
    content: '<p>hi</p>',
    image: '[]',
    state: 'PUBLISHED',
    releaseURL: 'https://x.com/acme/status/1',
    settings: '{}',
    childrenPost: [],
    integration,
    ...overrides,
  });

  const make = (posts: any[], link: any) => {
    const publicPostLink = jest.fn().mockResolvedValue(link);
    const controller = new PublicController(
      {} as any,
      {
        getPostsRecursively: jest.fn().mockResolvedValue(posts),
        publicPostLink,
      } as any,
      {} as any
    );
    return { controller, publicPostLink };
  };

  it('links the post when the service vouches for the URL', async () => {
    const { controller, publicPostLink } = make(
      [row()],
      'https://x.com/acme/status/1'
    );

    const [preview] = (await controller.getPreview('p-1')) as any[];

    expect(preview.publishedLink).toBe('https://x.com/acme/status/1');
    // the decision is the service's, made from the whole stored row
    expect(publicPostLink).toHaveBeenCalledWith(
      expect.objectContaining({ releaseURL: 'https://x.com/acme/status/1' })
    );
  });

  it('never links a release URL the service kept private', async () => {
    const { controller } = make(
      [
        row({
          releaseURL: 'https://www.tiktok.com/messages?lang=en#7300000000',
        }),
      ],
      undefined
    );

    const [preview] = (await controller.getPreview('p-1')) as any[];

    expect(preview).not.toHaveProperty('publishedLink');
    // the raw stored URL never leaves either
    expect(JSON.stringify(preview)).not.toContain('tiktok.com');
  });

  it('judges a thread on the channel of its first post', async () => {
    // getPostsRecursively returns the integration only for the first post,
    // so without this the rest of a thread could never be linked
    const { controller, publicPostLink } = make(
      [row(), row({ id: 'p-2', integration: undefined })],
      'https://x.com/acme/status/1'
    );

    const [first, second] = (await controller.getPreview('p-1')) as any[];

    expect(publicPostLink).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'p-2', integration })
    );
    expect(first.publishedLink).toBe('https://x.com/acme/status/1');
    expect(second.publishedLink).toBe('https://x.com/acme/status/1');
    // a post of a thread still carries no channel of its own in the response
    expect(second).not.toHaveProperty('integration');
  });
});
