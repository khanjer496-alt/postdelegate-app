import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';

// what the composer saves: tiptap writes <p dir="auto"> and <h2 dir="auto">
const editorHtml =
  '<p dir="auto">Hello <strong>bold</strong> &amp; <u>under</u></p>' +
  '<p dir="auto"></p>' +
  '<h2 dir="auto">Title</h2>' +
  '<ul><li><p dir="auto">item</p></li></ul>' +
  '<p dir="auto"><a href="https://example.com">link</a></p>';

const published = (type: 'normal' | 'markdown' | 'none') =>
  stripHtmlValidation(type, editorHtml, true, false, false);

describe('stripHtmlValidation with the editor output', () => {
  // the providers on these editors (Discord, DEV.to, Medium, Hashnode, Whop
  // on markdown, Slack, Bluesky, Nostr and the rest on normal) never see a
  // paragraph tag, whatever attributes it carries
  it.each(['normal', 'markdown', 'none'] as const)(
    'leaves no tag of the %s editor behind',
    (type) => {
      expect(published(type)).not.toMatch(/<\/?(p|h2|ul|li|strong|u|a)\b/);
    }
  );

  it('keeps the paragraphs as lines for the normal editor', () => {
    expect(published('normal').split('\n')[0]).toContain('Hello');
    expect(published('normal')).toContain('\n- item');
  });

  it('writes markdown for the markdown editor', () => {
    expect(published('markdown')).toContain('**bold**');
    expect(published('markdown')).toContain('## Title');
    expect(published('markdown')).toContain('[link](https://example.com)');
  });
});
