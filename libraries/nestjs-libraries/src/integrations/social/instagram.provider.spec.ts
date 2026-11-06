import 'reflect-metadata';
import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const integration = { internalId: 'ig-1', profile: 'brand' } as any;

const pending = {
  type: 'graph.facebook.com',
  postType: 'single' as const,
  containers: ['container-1'],
  message: 'Launch day',
};

const blocked = () =>
  new BadBody(
    'instagram',
    '{"error":{"error_subcode":2207051}}',
    '{}',
    'Instagram blocked your request'
  );

// Only the Graph calls are replaced, finalizePost runs as is
const provider = (answer: (url: string) => any) => {
  const instance = new InstagramProvider();
  const fetched: string[] = [];
  instance.fetch = jest.fn(async (url: string) => {
    fetched.push(url);
    const response = answer(url);
    if (response instanceof Error) {
      throw response;
    }
    return { json: async () => response } as any;
  }) as any;
  return { instance, fetched };
};

describe('InstagramProvider.finalizePost after a blocked media_publish', () => {
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('completes with the media whose caption matches when the container was published', async () => {
    const { instance } = provider((url) => {
      if (url.includes('/media_publish')) return blocked();
      if (url.includes('/container-1?')) return { status_code: 'PUBLISHED' };
      if (url.includes('/ig-1/media?'))
        return {
          data: [
            { id: 'other-post', caption: 'Someone else' },
            { id: 'media-1', caption: 'Launch day ' },
          ],
        };
      if (url.includes('/media-1?'))
        return { permalink: 'https://instagram.com/p/1' };
      return {};
    });

    await expect(
      instance.finalizePost('token', pending, integration)
    ).resolves.toEqual({
      status: 'completed',
      postId: 'media-1',
      releaseURL: 'https://instagram.com/p/1',
    });
  });

  it('never takes another post as its own, the container stands in', async () => {
    const { instance, fetched } = provider((url) => {
      if (url.includes('/media_publish')) return blocked();
      if (url.includes('/container-1?')) return { status_code: 'PUBLISHED' };
      if (url.includes('/ig-1/media?'))
        return { data: [{ id: 'other-post', caption: 'Someone else' }] };
      return {};
    });

    await expect(
      instance.finalizePost('token', pending, integration)
    ).resolves.toEqual({
      status: 'completed',
      postId: 'container-1',
      releaseURL: 'https://www.instagram.com/brand',
    });
    expect(fetched.some((u) => u.includes('fields=permalink'))).toBe(false);
  });

  it('does not match a caption-less post when the post has no caption', async () => {
    const { instance } = provider((url) => {
      if (url.includes('/media_publish')) return blocked();
      if (url.includes('/container-1?')) return { status_code: 'PUBLISHED' };
      if (url.includes('/ig-1/media?')) return { data: [{ id: 'other-post' }] };
      return {};
    });

    await expect(
      instance.finalizePost('token', { ...pending, message: '' }, integration)
    ).resolves.toMatchObject({ status: 'completed', postId: 'container-1' });
  });

  it('still completes a published post when the media lookup fails', async () => {
    const { instance } = provider((url) => {
      if (url.includes('/media_publish')) return blocked();
      if (url.includes('/container-1?')) return { status_code: 'PUBLISHED' };
      if (url.includes('/ig-1/media?')) return new Error('network');
      return {};
    });

    await expect(
      instance.finalizePost('token', pending, integration)
    ).resolves.toMatchObject({ status: 'completed', postId: 'container-1' });
  });

  it('rethrows the original error when the container was not published', async () => {
    const error = blocked();
    const { instance } = provider((url) => {
      if (url.includes('/media_publish')) return error;
      if (url.includes('/container-1?')) return { status_code: 'FINISHED' };
      return {};
    });

    await expect(
      instance.finalizePost('token', pending, integration)
    ).rejects.toBe(error);
  });

  it('rethrows other media_publish errors without probing', async () => {
    const error = new BadBody(
      'instagram',
      '{}',
      '{}',
      'Instagram detected spam'
    );
    const { instance, fetched } = provider((url) =>
      url.includes('/media_publish') ? error : {}
    );

    await expect(
      instance.finalizePost('token', pending, integration)
    ).rejects.toBe(error);
    expect(fetched).toHaveLength(1);
  });
});
