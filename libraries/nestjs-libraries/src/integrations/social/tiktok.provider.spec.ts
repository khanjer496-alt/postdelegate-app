jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator', () => ({
  isSafePublicHttpsUrl: jest.fn(async () => true),
}));

import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { TiktokProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';
import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { TikTokDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';

const creator = {
  creator_username: 'review_account',
  creator_nickname: 'Review Account',
  privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
  comment_disabled: false,
  duet_disabled: false,
  stitch_disabled: false,
  max_video_post_duration_sec: 60,
};

const settings = (overrides: Record<string, unknown> = {}) => ({
  __type: 'tiktok',
  content_posting_method: 'DIRECT_POST',
  privacy_level: 'PUBLIC_TO_EVERYONE',
  duet: false,
  stitch: false,
  comment: false,
  autoAddMusic: 'no',
  brand_content_toggle: false,
  brand_organic_toggle: false,
  disclose: false,
  music_usage_consent: true,
  creator_info_verified: true,
  ...overrides,
});

const post = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'post-1',
    message: 'Review clip',
    settings: settings(overrides),
    media: [{ type: 'video', path: 'https://media.example/review.mp4' }],
  } as any);

// Only the TikTok HTTP calls are replaced, the provider logic runs as is.
const provider = (creatorResponse: any) => {
  const instance = new TiktokProvider();
  const urls: string[] = [];
  instance.fetch = jest.fn(async (url: string) => {
    urls.push(url);
    if (typeof creatorResponse === 'function' && url.includes('creator_info')) {
      return creatorResponse();
    }
    return {
      json: async () =>
        url.includes('creator_info')
          ? creatorResponse
          : { data: { publish_id: 'v_pub_review' }, error: { code: 'ok' } },
    } as any;
  }) as any;
  const publish = (value: any) =>
    instance.postPending('channel', 'test-token', [value], {
      profile: 'review_account',
    } as any);
  return { instance, urls, publish };
};

const initCalls = (urls: string[]) =>
  urls.filter((url) => url.includes('/init/')).length;

const dtoErrors = (overrides: Record<string, unknown>) =>
  validateSync(Object.assign(new TikTokDto(), settings(overrides))).flatMap(
    (error) => Object.values(error.constraints || {})
  );

describe('TiktokProvider creator_info gate', () => {
  it('stops publishing when creator_info says the creator cannot post right now', async () => {
    const { urls, publish } = provider({
      data: {},
      error: { code: 'spam_risk_too_many_posts', message: 'limit' },
    });

    await expect(publish(post())).rejects.toThrow(/Try again later/);
    expect(initCalls(urls)).toBe(0);
  });

  it('keeps the account status message for a creator banned from posting', async () => {
    const { urls, publish } = provider({
      data: {},
      error: { code: 'spam_risk_user_banned_from_posting' },
    });

    await expect(publish(post())).rejects.toThrow(/Account banned from posting/);
    expect(initCalls(urls)).toBe(0);
  });

  it('stops publishing when the creator_info request itself is rejected', async () => {
    const { urls, publish } = provider(() => {
      throw new BadBody(
        'tiktok',
        JSON.stringify({ error: { code: 'spam_risk_too_many_posts' } }),
        '{}',
        'TikTok says your daily post limit reached, please try again tomorrow'
      );
    });

    await expect(publish(post())).rejects.toThrow(/try again tomorrow/);
    expect(initCalls(urls)).toBe(0);
  });

  it('starts the publish when creator_info allows the selected settings', async () => {
    const { urls, publish } = provider({ data: creator, error: { code: 'ok' } });

    const [result] = await publish(post());

    expect(result.status).toBe('pending');
    expect(initCalls(urls)).toBe(1);
  });

  it('refuses commercial disclosure without a brand choice', async () => {
    const { urls, publish } = provider({ data: creator, error: { code: 'ok' } });

    await expect(publish(post({ disclose: true }))).rejects.toThrow(
      'You need to indicate if your content promotes yourself, a third party, or both.'
    );
    expect(initCalls(urls)).toBe(0);
  });

  it('refuses private branded content', async () => {
    const { urls, publish } = provider({ data: creator, error: { code: 'ok' } });

    await expect(
      publish(
        post({
          disclose: true,
          brand_content_toggle: true,
          privacy_level: 'SELF_ONLY',
        })
      )
    ).rejects.toThrow('Branded content visibility cannot be set to private.');
    expect(initCalls(urls)).toBe(0);
  });
});

describe('TikTokDto commercial content rules', () => {
  it('rejects disclosure with neither Your brand nor Branded content', () => {
    expect(dtoErrors({ disclose: true })).toContain(
      'You need to indicate if your content promotes yourself, a third party, or both.'
    );
  });

  it('rejects branded content set to private', () => {
    expect(
      dtoErrors({
        disclose: true,
        brand_content_toggle: true,
        privacy_level: 'SELF_ONLY',
      })
    ).toContain('Branded content visibility cannot be set to private.');
  });

  it('accepts each valid disclosure choice', () => {
    expect(dtoErrors({ disclose: true, brand_organic_toggle: true })).toEqual(
      []
    );
    expect(
      dtoErrors({
        disclose: true,
        brand_organic_toggle: true,
        privacy_level: 'SELF_ONLY',
      })
    ).toEqual([]);
    expect(dtoErrors({ disclose: true, brand_content_toggle: true })).toEqual(
      []
    );
  });

  it('keeps inbox uploads free of the direct post rules', () => {
    expect(
      dtoErrors({
        content_posting_method: 'UPLOAD',
        disclose: true,
        privacy_level: undefined,
      })
    ).toEqual([]);
  });
});

describe('TiktokProvider recentPosts', () => {
  const listing = (response: any) => {
    const instance = new TiktokProvider();
    const calls: Array<{ url: string; options: any }> = [];
    instance.fetch = jest.fn(async (url: string, options: any) => {
      calls.push({ url, options });
      return { json: async () => response } as any;
    }) as any;
    return { instance, calls };
  };

  it('asks video/list for the stats fields and maps them to the generic type', async () => {
    const { instance, calls } = listing({
      data: {
        videos: [
          {
            id: 7301,
            title: '',
            video_description: '  Behind the scenes  ',
            cover_image_url: 'https://p16.tiktokcdn.com/cover.jpeg?x-expires=1',
            share_url:
              'https://www.tiktok.com/@review_account/video/7301?utm_source=x&client_key=secret',
            create_time: 1761900000,
            view_count: 1520,
            like_count: 87,
            comment_count: 0,
            share_count: 4,
          },
        ],
        has_more: false,
      },
      error: { code: 'ok' },
    });

    const posts = await instance.recentPosts('open-id', 'token', 20);

    expect(calls[0].url).toBe(
      'https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,cover_image_url,share_url,create_time,view_count,like_count,comment_count,share_count'
    );
    expect(calls[0].options.method).toBe('POST');
    expect(calls[0].options.headers.Authorization).toBe('Bearer token');
    expect(JSON.parse(calls[0].options.body)).toEqual({ max_count: 20 });
    expect(posts).toEqual([
      {
        id: '7301',
        title: 'Behind the scenes',
        thumbnailUrl: 'https://p16.tiktokcdn.com/cover.jpeg?x-expires=1',
        url: 'https://www.tiktok.com/@review_account/video/7301',
        publishedAt: new Date(1761900000 * 1000).toISOString(),
        views: 1520,
        likes: 87,
        comments: 0,
        shares: 4,
      },
    ]);
  });

  it('prefers the title, leaves out unreported counts and unsafe links', async () => {
    const { instance } = listing({
      data: {
        videos: [
          {
            id: '1',
            title: 'Launch day',
            video_description: 'long description',
            cover_image_url: 'http://insecure.example/cover.jpeg',
            share_url: 'javascript:alert(1)',
            create_time: 1761900000,
          },
          { title: 'no id is skipped' },
        ],
      },
      error: { code: 'ok' },
    });

    const [post, ...rest] = await instance.recentPosts('open-id', 'token', 20);

    expect(rest).toEqual([]);
    expect(post.title).toBe('Launch day');
    expect(post.thumbnailUrl).toBeUndefined();
    expect(post.url).toBeUndefined();
    expect(post.views).toBeUndefined();
    expect(post.likes).toBeUndefined();
    expect(post.comments).toBeUndefined();
    expect(post.shares).toBeUndefined();
  });

  it('leaves the date empty instead of 1970 when create_time is missing', async () => {
    const { instance } = listing({
      data: { videos: [{ id: '2', title: 'No date' }] },
      error: { code: 'ok' },
    });

    const [post] = await instance.recentPosts('open-id', 'token', 20);

    expect(post.publishedAt).toBe('');
  });

  it('caps the page size at the 20 videos TikTok allows', async () => {
    const { instance, calls } = listing({ data: { videos: [] }, error: { code: 'ok' } });

    expect(await instance.recentPosts('open-id', 'token', 50)).toEqual([]);
    expect(JSON.parse(calls[0].options.body)).toEqual({ max_count: 20 });
  });

  it('throws on a TikTok error instead of reporting an empty account', async () => {
    const { instance } = listing({
      data: {},
      error: { code: 'scope_not_authorized', message: 'video.list' },
    });

    await expect(
      instance.recentPosts('open-id', 'token', 20)
    ).rejects.toBeInstanceOf(BadBody);
  });
});

describe('TiktokProvider.publishedLabel', () => {
  it('labels an inbox upload instead of calling it published', () => {
    const instance = new TiktokProvider();
    expect(instance.publishedLabel({ content_posting_method: 'UPLOAD' })).toBe(
      'Sent to TikTok inbox'
    );
    expect(
      instance.publishedLabel({ content_posting_method: 'DIRECT_POST' })
    ).toBeUndefined();
    expect(instance.publishedLabel({})).toBeUndefined();
  });
});

describe('TiktokProvider.publishedLinkLabel', () => {
  it('names the link to an inbox upload', () => {
    const instance = new TiktokProvider();
    expect(
      instance.publishedLinkLabel({ content_posting_method: 'UPLOAD' })
    ).toBe('Open TikTok inbox');
    expect(
      instance.publishedLinkLabel({ content_posting_method: 'DIRECT_POST' })
    ).toBeUndefined();
  });
});
