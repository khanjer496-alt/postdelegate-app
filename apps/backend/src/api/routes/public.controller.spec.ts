// the controller imports provider / upload / auth modules that are not under test
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/track/track.service', () => ({
  TrackService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/agent/agent.graph.insert.service', () => ({
  AgentGraphInsertService: class {},
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
      {} as any,
      { getPostsRecursively } as any,
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
  });
});
