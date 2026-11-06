import { composeText, isShareableUrl, isUploadableImageUrl, textToHtml } from './compose';

describe('composeText', () => {
  it('puts the selection first, then title and URL', () => {
    expect(
      composeText({
        selection: ' A great quote ',
        title: 'Article title',
        url: 'https://example.com/a',
      })
    ).toBe('A great quote\n\nArticle title\nhttps://example.com/a');
  });

  it('uses title and URL when nothing is selected', () => {
    expect(composeText({ title: 'Article title', url: 'https://example.com/a' })).toBe(
      'Article title\nhttps://example.com/a'
    );
  });

  it('skips a title that equals the selection', () => {
    expect(composeText({ selection: 'Same', title: 'Same', url: 'https://x.test' })).toBe(
      'Same\n\nhttps://x.test'
    );
  });

  it('handles missing parts and empty input', () => {
    expect(composeText({ url: 'https://x.test' })).toBe('https://x.test');
    expect(composeText({ selection: 'only text' })).toBe('only text');
    expect(composeText({})).toBe('');
    expect(composeText({ selection: '  ', title: '', url: '' })).toBe('');
  });

  it('normalizes windows line endings in selections', () => {
    expect(composeText({ selection: 'a\r\nb' })).toBe('a\nb');
  });
});

describe('textToHtml', () => {
  it('wraps paragraphs and keeps single line breaks', () => {
    expect(textToHtml('one\ntwo\n\nthree')).toBe('<p>one<br>two</p><p>three</p>');
  });

  it('escapes HTML so page text cannot inject markup', () => {
    expect(textToHtml('<script>alert("x")</script> & more')).toBe(
      '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more</p>'
    );
  });

  it('returns an empty string for blank text', () => {
    expect(textToHtml('  \n\n ')).toBe('');
  });
});

describe('url helpers', () => {
  it('only allows http(s) pages to be shared', () => {
    expect(isShareableUrl('https://a.test')).toBe(true);
    expect(isShareableUrl('http://a.test')).toBe(true);
    expect(isShareableUrl('chrome://extensions')).toBe(false);
    expect(isShareableUrl(undefined)).toBe(false);
  });

  it('only allows https images to be uploaded', () => {
    expect(isUploadableImageUrl('https://a.test/i.png')).toBe(true);
    expect(isUploadableImageUrl('http://a.test/i.png')).toBe(false);
    expect(isUploadableImageUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isUploadableImageUrl('not a url')).toBe(false);
    expect(isUploadableImageUrl('')).toBe(false);
  });
});
