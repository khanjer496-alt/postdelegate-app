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
