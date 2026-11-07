import { existsSync, readFileSync, statSync } from 'fs';
import { basename } from 'path';
import PostDelegate, {
  PostDelegateError,
  type CreatePostBody,
  type MediaItem,
} from '@postdelegate/node';
import { ParsedValues } from './args';
import {
  configPath,
  deleteConfig,
  readConfig,
  resolveCredentials,
  writeConfig,
  DEFAULT_API_URL,
} from './config';
import { postsTable, renderTable, textToHtml } from './output';

export class CliError extends Error {
  constructor(message: string, public readonly exitCode = 1) {
    super(message);
  }
}

export interface Context {
  env: Record<string, string | undefined>;
  homedir: string;
  version: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Reads a secret from the user (hidden on a terminal, first line of stdin otherwise). */
  readSecret: (prompt: string) => Promise<string>;
  fetch?: typeof fetch;
  now?: () => Date;
}

type Command = (
  ctx: Context,
  values: ParsedValues,
  positionals: string[]
) => Promise<void>;

function emit(ctx: Context, values: ParsedValues, data: unknown, human: string) {
  ctx.stdout((values.json ? JSON.stringify(data, null, 2) : human) + '\n');
}

function credentials(ctx: Context, values: ParsedValues) {
  return resolveCredentials({
    flags: { apiKey: values['api-key'], apiUrl: values['api-url'] },
    env: ctx.env,
    config: readConfig(configPath(ctx.env, ctx.homedir)),
  });
}

function createClient(ctx: Context, apiKey: string, apiUrl: string) {
  return new PostDelegate(apiKey, {
    baseUrl: apiUrl,
    fetch: ctx.fetch,
    userAgent: `postdelegate-cli/${ctx.version}`,
  });
}

function authedClient(ctx: Context, values: ParsedValues) {
  const creds = credentials(ctx, values);
  if (!creds.apiKey) {
    throw new CliError(
      'Not logged in. Run "postdelegate login" or set POSTDELEGATE_API_KEY',
      3
    );
  }
  return { client: createClient(ctx, creds.apiKey, creds.apiUrl), creds };
}

/** Turns SDK and network errors into messages without ever echoing the key. */
async function call<T>(apiUrl: string, request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (err) {
    if (err instanceof PostDelegateError) {
      if (err.status === 401) {
        throw new CliError(
          `Authentication failed: ${err.message}. Run "postdelegate login" with a valid API key`,
          3
        );
      }
      throw new CliError(`${err.message} (HTTP ${err.status})`);
    }
    const reason = (err as { cause?: { code?: string; message?: string } })
      ?.cause;
    throw new CliError(
      `Could not reach ${apiUrl}: ${
        reason?.code || reason?.message || (err as Error).message
      }`
    );
  }
}

function parseDate(value: string, flag: string, endOfDay = false): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly && endOfDay ? `${value}T23:59:59.999Z` : value);
  if (Number.isNaN(date.getTime())) {
    throw new CliError(
      `Invalid date for --${flag}: "${value}". Use an ISO date like 2026-12-01 or 2026-12-01T09:30:00Z`,
      2
    );
  }
  return date.toISOString();
}

function readJsonSetting(value: string): Record<string, unknown> {
  const raw = value.startsWith('@')
    ? readFileOrFail(value.slice(1))
    : value;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // handled below
  }
  throw new CliError('--settings must be a JSON object, or @path/to/file.json', 2);
}

function readFileOrFail(path: string): string {
  if (!existsSync(path)) {
    throw new CliError(`File not found: ${path}`, 2);
  }
  return readFileSync(path, 'utf8');
}

function isUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

async function uploadSource(
  client: PostDelegate,
  apiUrl: string,
  source: string
) {
  if (isUrl(source)) {
    return call(apiUrl, client.uploadFromUrl(source));
  }
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new CliError(`File not found: ${source}`, 2);
  }
  return call(apiUrl, client.upload(readFileSync(source), basename(source)));
}

const login: Command = async (ctx, values) => {
  const path = configPath(ctx.env, ctx.homedir);
  const stored = readConfig(path);
  const apiKey = (
    values['api-key'] ||
    ctx.env.POSTDELEGATE_API_KEY ||
    (await ctx.readSecret('PostDelegate API key (Settings > Agents / Dev): '))
  )?.trim();
  if (!apiKey) {
    throw new CliError(
      'No API key provided. Pass it on stdin, set POSTDELEGATE_API_KEY, or use --api-key',
      2
    );
  }
  const apiUrl = (
    values['api-url'] ||
    ctx.env.POSTDELEGATE_API_URL ||
    stored.apiUrl ||
    DEFAULT_API_URL
  ).replace(/\/+$/, '');

  let organization: string | undefined;
  if (!values['no-verify']) {
    const me = await call(apiUrl, createClient(ctx, apiKey, apiUrl).me());
    organization = me.organization.name;
  }

  writeConfig(path, { apiKey, apiUrl });
  emit(
    ctx,
    values,
    { loggedIn: true, organization: organization ?? null, apiUrl, configPath: path },
    `Logged in${organization ? ` to ${organization}` : ''} (${apiUrl}). Saved to ${path}`
  );
};

const logout: Command = async (ctx, values) => {
  const path = configPath(ctx.env, ctx.homedir);
  const removed = deleteConfig(path);
  const envSet = !!ctx.env.POSTDELEGATE_API_KEY;
  emit(
    ctx,
    values,
    { loggedOut: removed, envKeyStillSet: envSet },
    (removed ? `Removed ${path}` : 'No saved credentials found') +
      (envSet ? '\nPOSTDELEGATE_API_KEY is still set in your environment' : '')
  );
};

const whoami: Command = async (ctx, values) => {
  const { client, creds } = authedClient(ctx, values);
  const me = await call(creds.apiUrl, client.me());
  emit(
    ctx,
    values,
    {
      organization: me.organization,
      user: me.user,
      apiUrl: creds.apiUrl,
      keySource: creds.keySource,
    },
    [
      `Organization: ${me.organization.name} (${me.organization.id})`,
      ...(me.user ? [`User:         ${me.user.name}`] : []),
      `API URL:      ${creds.apiUrl}`,
      `API key from: ${creds.keySource}`,
    ].join('\n')
  );
};

const channels: Command = async (ctx, values) => {
  const { client, creds } = authedClient(ctx, values);
  const list = await call(creds.apiUrl, client.integrations(values.group));
  emit(
    ctx,
    values,
    list,
    list.length
      ? renderTable(
          ['ID', 'PLATFORM', 'NAME', 'STATUS', 'GROUP'],
          list.map((channel) => [
            channel.id,
            channel.identifier,
            channel.name,
            channel.disabled ? 'disabled' : 'active',
            channel.customer?.name || '',
          ])
        )
      : 'No channels connected. Connect one in the app first.'
  );
};

const postsList: Command = async (ctx, values) => {
  const { client, creds } = authedClient(ctx, values);
  const now = (ctx.now || (() => new Date()))();
  const day = 24 * 60 * 60 * 1000;
  const startDate = values.from
    ? parseDate(values.from, 'from')
    : new Date(now.getTime() - 7 * day).toISOString();
  const endDate = values.to
    ? parseDate(values.to, 'to', true)
    : new Date(now.getTime() + 30 * day).toISOString();

  const { posts } = await call(
    creds.apiUrl,
    client.postList({ startDate, endDate, customer: values.customer })
  );
  emit(
    ctx,
    values,
    posts,
    posts.length ? postsTable(posts) : 'No posts in this date range.'
  );
};

const postsCreate: Command = async (ctx, values) => {
  const channelIds: string[] = values.channel || [];
  const texts: string[] = values.text || [];
  const mediaSources: string[] = values.media || [];

  if (!channelIds.length) {
    throw new CliError('At least one --channel <id> is required (see "postdelegate channels")', 2);
  }
  if (!texts.length && !mediaSources.length) {
    throw new CliError('Provide --text and/or --media', 2);
  }
  if (values.draft && values.schedule) {
    throw new CliError('Use either --draft or --schedule, not both', 2);
  }
  if (!values.draft && !values.schedule) {
    throw new CliError(
      'Choose when to post: --schedule <ISO date|now> or --draft',
      2
    );
  }

  const type: CreatePostBody['type'] = values.draft
    ? 'draft'
    : values.schedule === 'now'
    ? 'now'
    : 'schedule';
  const date =
    type === 'schedule'
      ? parseDate(values.schedule, 'schedule')
      : (ctx.now || (() => new Date()))().toISOString();
  const settings = values.settings ? readJsonSetting(values.settings) : undefined;

  let media: MediaItem[] = [];
  let client: PostDelegate | undefined;
  let apiUrl = DEFAULT_API_URL;
  if (!values['dry-run']) {
    const authed = authedClient(ctx, values);
    client = authed.client;
    apiUrl = authed.creds.apiUrl;
    for (const source of mediaSources) {
      const uploaded = await uploadSource(client, apiUrl, source);
      media.push({ id: uploaded.id, path: uploaded.path });
    }
  } else {
    media = mediaSources.map((source) => ({ id: '(uploaded on send)', path: source }));
  }

  const body: CreatePostBody & { creationMethod: 'CLI' } = {
    type,
    date,
    shortLink: !!values['short-links'],
    tags: [],
    creationMethod: 'CLI',
    posts: channelIds.map((id) => ({
      integration: { id },
      value: (texts.length ? texts : ['']).map((text, i) => ({
        content: values.html ? text : textToHtml(text),
        image: i === 0 ? media : [],
      })),
      ...(settings ? { settings } : {}),
    })),
  };

  if (!client) {
    emit(ctx, values, body, `Dry run, nothing sent. Request body:\n${JSON.stringify(body, null, 2)}`);
    return;
  }

  const result = await call(apiUrl, client.post(body));
  const action =
    type === 'draft' ? 'Saved draft' : type === 'now' ? 'Publishing' : `Scheduled for ${date}`;
  emit(
    ctx,
    values,
    result,
    `${action} on ${result.length} channel(s)\n` +
      renderTable(
        ['POST ID', 'CHANNEL'],
        result.map((item) => [item.postId, item.integration])
      )
  );
};

const postsDelete: Command = async (ctx, values, [id]) => {
  const { client, creds } = authedClient(ctx, values);
  await call(creds.apiUrl, client.deletePost(id));
  emit(ctx, values, { deleted: id }, `Deleted post ${id}`);
};

const upload: Command = async (ctx, values, [source]) => {
  const { client, creds } = authedClient(ctx, values);
  const media = await uploadSource(client, creds.apiUrl, source);
  emit(ctx, values, media, `Uploaded ${source}\nid:   ${media.id}\npath: ${media.path}`);
};

export const HANDLERS: Record<string, Command> = {
  login,
  logout,
  whoami,
  channels,
  'posts list': postsList,
  'posts create': postsCreate,
  'posts delete': postsDelete,
  upload,
};
