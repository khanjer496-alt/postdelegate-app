import { countLength, textSlicer } from '@gitroom/helpers/utils/count.length';

describe('countLength', () => {
  const text = 'Read https://example.com/a/very/long/path/that/x/shortens 🎉';

  it('counts a variant of X the way X does', () => {
    expect(countLength('x-own-key', text)).toBe(countLength('x', text));
    expect(countLength('x', text)).not.toBe(text.length);
  });

  it('slices a variant of X on the X weights', () => {
    const long = 'é'.repeat(300);
    expect(textSlicer('x-own-key', 280, long)).toEqual(
      textSlicer('x', 280, long)
    );
  });

  it('keeps plain length for other networks', () => {
    expect(countLength('linkedin-page', text)).toBe(text.length);
  });
});
