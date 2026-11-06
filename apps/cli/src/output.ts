import { COMMANDS } from './args';
import type { Post } from '@postdelegate/node';

export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => (row[i] || '').length))
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (cell || '').padEnd(widths[i]))
      .join('  ')
      .trimEnd();
  return [line(headers), ...rows.map(line)].join('\n');
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** Post content is stored as HTML, show it as one line of text. */
export function htmlToText(html: string, max = 70): string {
  const text = html
    .replace(/<(br|\/p|\/li|\/h[1-3])\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity])
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Plain text to the HTML the editor stores: blank line = paragraph, newline = <br>. */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim() !== '')
    .map(
      (paragraph) =>
        `<p>${paragraph
          .trim()
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>')}</p>`
    )
    .join('');
}

export function postsTable(posts: Post[]): string {
  const sorted = [...posts].sort((a, b) =>
    a.publishDate.localeCompare(b.publishDate)
  );
  return renderTable(
    ['ID', 'DATE (UTC)', 'STATE', 'CHANNEL', 'CONTENT'],
    sorted.map((post) => [
      post.id,
      post.publishDate.replace('T', ' ').slice(0, 16),
      post.state,
      `${post.integration.providerIdentifier}/${post.integration.name}`,
      htmlToText(post.content),
    ])
  );
}

export function helpText(version: string, topic?: string): string {
  if (topic && COMMANDS[topic]) {
    const def = COMMANDS[topic];
    return `${def.summary}\n\nUsage:\n  ${def.usage}\n`;
  }
  if (topic === 'posts') {
    return [
      'Manage posts',
      '',
      'Usage:',
      `  ${COMMANDS['posts list'].usage}`,
      `  ${COMMANDS['posts create'].usage}`,
      `  ${COMMANDS['posts delete'].usage}`,
      '',
    ].join('\n');
  }

  const rows = [
    ['login', COMMANDS.login.summary],
    ['logout', COMMANDS.logout.summary],
    ['whoami', COMMANDS.whoami.summary],
    ['channels', COMMANDS.channels.summary],
    ['posts list', COMMANDS['posts list'].summary],
    ['posts create', COMMANDS['posts create'].summary],
    ['posts delete', COMMANDS['posts delete'].summary],
    ['upload', COMMANDS.upload.summary],
    ['help [command]', 'Show help'],
  ];
  return [
    `PostDelegate CLI ${version}`,
    '',
    'Usage:',
    '  postdelegate <command> [options]',
    '',
    'Commands:',
    renderTable(['', ''], rows)
      .split('\n')
      .slice(1)
      .map((row) => `  ${row}`)
      .join('\n'),
    '',
    'Global options:',
    '  --json            Print machine-readable JSON',
    '  --api-url <url>   API base URL (default: https://app.postdelegate.com/api)',
    '  --api-key <key>   API key (prefer "login" or POSTDELEGATE_API_KEY)',
    '  -h, --help        Show help',
    '  -v, --version     Show version',
    '',
    'Environment:',
    '  POSTDELEGATE_API_KEY   API key, overrides the saved one',
    '  POSTDELEGATE_API_URL   API base URL, overrides the saved one',
    '',
    'Exit codes: 0 ok, 1 error, 2 usage error, 3 authentication failed',
    '',
    'Get an API key in the app: Settings > Agents / Dev (https://app.postdelegate.com).',
    '',
  ].join('\n');
}
