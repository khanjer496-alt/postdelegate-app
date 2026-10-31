export interface ShareContext {
  /** Text the user selected on the page, if any. */
  selection?: string;
  title?: string;
  url?: string;
}

const clean = (value?: string) => (value || '').replace(/\r\n?/g, '\n').trim();

/**
 * Builds the pre-filled post text: selected text first (if any), then the
 * page title, then the URL. Blocks are separated by a blank line.
 */
export function composeText({ selection, title, url }: ShareContext): string {
  const quote = clean(selection);
  const pageTitle = clean(title);
  const link = clean(url);

  const blocks: string[] = [];
  if (quote) {
    blocks.push(quote);
  }

  // a selection that is the title (or the title repeats it) adds nothing
  const reference = [
    pageTitle && pageTitle !== quote ? pageTitle : '',
    link,
  ].filter(Boolean);
  if (reference.length) {
    blocks.push(reference.join('\n'));
  }

  return blocks.join('\n\n');
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * The PostDelegate API takes post content as HTML. Blank lines become
 * paragraphs, single newlines become line breaks.
 */
export function textToHtml(text: string): string {
  return clean(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Only http(s) pages can be shared as a link. */
export function isShareableUrl(url?: string): boolean {
  return !!url && /^https?:\/\//i.test(url);
}

/** The API downloads images itself and only accepts public https URLs. */
export function isUploadableImageUrl(url?: string): boolean {
  if (!url) {
    return false;
  }
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}
