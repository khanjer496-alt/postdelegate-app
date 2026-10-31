import { NotFoundException } from '@nestjs/common';

// the service pulls in heavy provider / upload modules that are not under test
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({
  MediaService: class {},
}));
jest.mock('@gitroom/helpers/utils/sanitize.post.content', () => ({
  sanitizePostContent: (html: string) => html,
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn() },
}));

import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

const makeService = () => {
  const postRepository = {
    getPost: jest.fn(),
    createComment: jest.fn().mockResolvedValue({ id: 'c-1' }),
    updateImages: jest.fn(),
  };
  const mediaService = {
    getOrgMediaById: jest.fn(),
    getMediaById: jest.fn(),
  };
  const service = new PostsService(
    postRepository as any,
    {} as any,
    {} as any,
    mediaService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  return { service, postRepository, mediaService };
};

describe('PostsService.createPublicComment organization binding', () => {
  const body = { content: 'nice' } as any;

  it('rejects a comment on a post of another organization', async () => {
    const { service, postRepository } = makeService();
    postRepository.getPost.mockResolvedValue({
      id: 'p-1',
      organizationId: 'org-B',
      content: 'x',
      childrenPost: [],
    });

    await expect(
      service.createPublicComment('p-1', body, 'user-1', '1.1.1.1', 'org-A')
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(postRepository.createComment).not.toHaveBeenCalled();
  });

  it('accepts a comment on a post of the caller organization', async () => {
    const { service, postRepository } = makeService();
    postRepository.getPost.mockResolvedValue({
      id: 'p-1',
      organizationId: 'org-A',
      content: 'x',
      childrenPost: [],
    });

    await service.createPublicComment('p-1', body, 'user-1', '1.1.1.1', 'org-A');

    expect(postRepository.createComment).toHaveBeenCalledWith(
      'org-A',
      'user-1',
      'p-1',
      'nice',
      expect.anything()
    );
  });

  it('keeps the public comment flow open to any shared post', async () => {
    const { service, postRepository } = makeService();
    postRepository.getPost.mockResolvedValue({
      id: 'p-1',
      organizationId: 'org-B',
      content: 'x',
      childrenPost: [],
    });

    await service.createPublicComment(
      'p-1',
      { content: 'hi', displayName: 'Guest' } as any,
      null,
      '1.1.1.1'
    );

    expect(postRepository.createComment).toHaveBeenCalledTimes(1);
  });
});

describe('PostsService.updateMedia organization scoping', () => {
  it('resolves media only inside the organization of the post', async () => {
    const { service, mediaService } = makeService();
    mediaService.getOrgMediaById.mockResolvedValue(null);

    const result = await service.updateMedia('post-1', 'org-A', [
      { id: 'foreign-media' },
    ]);

    expect(mediaService.getOrgMediaById).toHaveBeenCalledWith(
      'org-A',
      'foreign-media'
    );
    expect(mediaService.getMediaById).not.toHaveBeenCalled();
    // the foreign media is never attached
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('refreshes an already composed media from the same organization only', async () => {
    const { service, mediaService } = makeService();
    mediaService.getOrgMediaById.mockResolvedValue(null);

    await service.updateMedia('post-1', 'org-A', [
      { id: 'foreign-media', path: '/a.png', name: 'a.png' },
    ]);

    expect(mediaService.getOrgMediaById).toHaveBeenCalledWith(
      'org-A',
      'foreign-media'
    );
    expect(mediaService.getMediaById).not.toHaveBeenCalled();
  });
});
