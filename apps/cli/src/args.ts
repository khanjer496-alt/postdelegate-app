import { parseArgs } from 'util';

export class UsageError extends Error {}

type OptionSpec = Record<
  string,
  { type: 'string' | 'boolean'; multiple?: boolean; short?: string }
>;

export interface CommandDef {
  name: string;
  summary: string;
  usage: string;
  options: OptionSpec;
  minPositionals: number;
  maxPositionals: number;
}

export type ParsedValues = Record<string, any>;

export type ParsedCommand =
  | { kind: 'help'; topic?: string }
  | { kind: 'version' }
  | {
      kind: 'command';
      def: CommandDef;
      values: ParsedValues;
      positionals: string[];
    };

export const GLOBAL_OPTIONS: OptionSpec = {
  json: { type: 'boolean' },
  'api-url': { type: 'string' },
  'api-key': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

export const COMMANDS: Record<string, CommandDef> = {
  login: {
    name: 'login',
    summary: 'Save your API key (verified against the API)',
    usage:
      'postdelegate login [--api-key <key>] [--api-url <url>] [--no-verify]',
    options: { 'no-verify': { type: 'boolean' } },
    minPositionals: 0,
    maxPositionals: 0,
  },
  logout: {
    name: 'logout',
    summary: 'Remove the saved API key',
    usage: 'postdelegate logout',
    options: {},
    minPositionals: 0,
    maxPositionals: 0,
  },
  whoami: {
    name: 'whoami',
    summary: 'Show the account and API URL in use',
    usage: 'postdelegate whoami [--json]',
    options: {},
    minPositionals: 0,
    maxPositionals: 0,
  },
  channels: {
    name: 'channels',
    summary: 'List connected channels (integrations)',
    usage: 'postdelegate channels [--group <id>] [--json]',
    options: { group: { type: 'string' } },
    minPositionals: 0,
    maxPositionals: 0,
  },
  'posts list': {
    name: 'posts list',
    summary: 'List posts in a date range (default: last 7 days to next 30)',
    usage:
      'postdelegate posts list [--from <date>] [--to <date>] [--customer <id>] [--json]',
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      customer: { type: 'string' },
    },
    minPositionals: 0,
    maxPositionals: 0,
  },
  'posts create': {
    name: 'posts create',
    summary: 'Create, schedule or publish a post',
    usage:
      'postdelegate posts create --channel <id> [--channel <id> ...] --text <text> [--text <text> ...] ' +
      '[--media <file|url> ...] (--schedule <ISO date|now> | --draft) [--settings <json|@file>] ' +
      '[--html] [--short-links] [--dry-run] [--json]',
    options: {
      channel: { type: 'string', multiple: true },
      text: { type: 'string', multiple: true },
      media: { type: 'string', multiple: true },
      schedule: { type: 'string' },
      draft: { type: 'boolean' },
      settings: { type: 'string' },
      html: { type: 'boolean' },
      'short-links': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
    },
    minPositionals: 0,
    maxPositionals: 0,
  },
  'posts delete': {
    name: 'posts delete',
    summary: 'Delete a post (all channels created together)',
    usage: 'postdelegate posts delete <post-id> [--json]',
    options: {},
    minPositionals: 1,
    maxPositionals: 1,
  },
  upload: {
    name: 'upload',
    summary: 'Upload a local file or public URL to the media library',
    usage: 'postdelegate upload <file|url> [--json]',
    options: {},
    minPositionals: 1,
    maxPositionals: 1,
  },
};

const ALIASES: Record<string, string> = { integrations: 'channels' };

export function parseCommandLine(argv: string[]): ParsedCommand {
  const [first, ...rest] = argv;

  if (!first || first === 'help' || first === '--help' || first === '-h') {
    return { kind: 'help', topic: first === 'help' ? rest.join(' ') : undefined };
  }
  if (first === '--version' || first === '-v' || first === 'version') {
    return { kind: 'version' };
  }
  if (first.startsWith('-')) {
    throw new UsageError(
      `Unknown option ${first}. The command comes first: postdelegate <command> [options]`
    );
  }

  let name = ALIASES[first] || first;
  let args = rest;
  if (name === 'posts') {
    const [sub, ...afterSub] = rest;
    if (!sub || sub.startsWith('-')) {
      if (rest.includes('--help') || rest.includes('-h')) {
        return { kind: 'help', topic: 'posts' };
      }
      throw new UsageError('posts needs a subcommand: list, create or delete');
    }
    name = `posts ${sub}`;
    args = afterSub;
  }

  const def = COMMANDS[name];
  if (!def) {
    throw new UsageError(
      `Unknown command "${argv[0]}". Run "postdelegate help" for the list of commands`
    );
  }

  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: { ...GLOBAL_OPTIONS, ...def.options },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    throw new UsageError((err as Error).message.split('\n')[0]);
  }

  const values = parsed.values as ParsedValues;
  if (values.help) {
    return { kind: 'help', topic: def.name };
  }

  const positionals = parsed.positionals;
  if (
    positionals.length < def.minPositionals ||
    positionals.length > def.maxPositionals
  ) {
    throw new UsageError(`Wrong number of arguments. Usage: ${def.usage}`);
  }

  return { kind: 'command', def, values, positionals };
}
