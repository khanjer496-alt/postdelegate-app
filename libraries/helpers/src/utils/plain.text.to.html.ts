import { escape } from 'lodash';

// Plain text typed outside the editor (a CSV cell, an evergreen variant) as
// the editor's HTML: one paragraph per line, with the text escaped
export const plainTextToHtml = (text: string) =>
  (text || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => `<p>${escape(line)}</p>`)
    .join('');
