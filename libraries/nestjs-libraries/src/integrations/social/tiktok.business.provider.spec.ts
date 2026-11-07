import { TiktokBusinessProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.business.provider';

describe('TiktokBusinessProvider published labels', () => {
  it('describes an inbox upload instead of calling it published', () => {
    const instance = new TiktokBusinessProvider();
    const upload = { content_posting_method: 'UPLOAD' } as const;
    expect(instance.publishedLabel(upload)).toBe('Sent to TikTok inbox');
    expect(instance.publishedLinkLabel(upload)).toBe('Open TikTok inbox');
    expect(
      instance.publishedLinkLabel({ content_posting_method: 'DIRECT_POST' })
    ).toBeUndefined();
  });
});
