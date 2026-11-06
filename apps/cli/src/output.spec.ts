import { htmlToText, renderTable, textToHtml } from './output';

describe('output helpers', () => {
  it('converts plain text to editor HTML and escapes markup', () => {
    expect(textToHtml('a & b')).toBe('<p>a &amp; b</p>');
    expect(textToHtml('one\ntwo\n\n\nthree')).toBe('<p>one<br>two</p><p>three</p>');
    expect(textToHtml('<script>x</script>')).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
    expect(textToHtml('  ')).toBe('');
  });

  it('turns stored HTML into one readable line', () => {
    expect(htmlToText('<p>Hello<br>world</p><p>&amp; more</p>')).toBe('Hello world & more');
    expect(htmlToText('<p>' + 'x'.repeat(100) + '</p>', 10)).toBe('xxxxxxxxx…');
  });

  it('aligns table columns', () => {
    expect(renderTable(['A', 'BB'], [['long', '1'], ['x', '22']])).toBe('A     BB\nlong  1\nx     22');
  });
});
