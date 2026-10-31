import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'crypto';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { PostsImportRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.import.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { ImportPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/import.posts.dto';
import { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import { ApprovalActor } from '@gitroom/nestjs-libraries/database/prisma/approvals/approval.policy.service';
import { plainTextToHtml } from '@gitroom/helpers/utils/plain.text.to.html';

dayjs.extend(utc);
dayjs.extend(timezone);

export const IMPORT_ROW_LIMIT = 200;

// the template columns, with the other names people give them
const COLUMNS = {
  date: ['date', 'datetime', 'date_time', 'publish_date', 'scheduled_at', 'when'],
  timezone: ['timezone', 'time_zone', 'tz'],
  channels: ['channels', 'channel', 'accounts', 'account', 'integrations'],
  text: ['text', 'content', 'message', 'post', 'body', 'caption'],
  images: ['image_urls', 'image_url', 'images', 'image', 'media', 'media_urls'],
  settings: ['settings', 'options'],
  tags: ['tags', 'tag', 'campaign', 'campaigns', 'pillar'],
} as const;

type Column = keyof typeof COLUMNS;

export type ImportIssue = { field: string; message: string; hint?: string };

export type ImportChannel = {
  id: string;
  name: string;
  providerIdentifier: string;
  picture?: string | null;
  disabled?: boolean;
  refreshNeeded?: boolean;
  inBetweenSteps?: boolean;
};

export type ParsedImportRow = {
  row: number;
  date: string | null;
  timezone: string;
  channels: ImportChannel[];
  text: string;
  images: string[];
  settings: Record<string, any>;
  tags: string[];
  errors: ImportIssue[];
  warnings: string[];
};

// RFC 4180: quoted cells may hold the delimiter, line breaks and "" quotes.
// Rows that are empty are dropped.
export const parseCsv = (input: string, delimiter?: string): string[][] => {
  const text = (input || '').replace(/^﻿/, '');
  const sep = delimiter || detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && !field.trim()) {
      field = '';
      quoted = true;
      started = true;
      continue;
    }
    if (char === sep) {
      row.push(field);
      field = '';
      started = true;
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') {
        i++;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      started = false;
      continue;
    }
    field += char;
    started = true;
  }

  if (quoted) {
    throw new BadRequestException(
      'A quoted cell is never closed. Check that every " in the file has a closing ".'
    );
  }
  if (started || field) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
};

// a spreadsheet saved with a ";" or tab separator (common outside the US)
export const detectDelimiter = (text: string) => {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const count = (sep: string) => firstLine.split(sep).length - 1;
  if (count('\t') > count(',') && count('\t') >= count(';')) {
    return '\t';
  }
  return count(';') > count(',') ? ';' : ',';
};

// several channels, images or tags in one cell ("|", or ";" in a comma
// separated file); commas are never split, channel names can have them
const splitList = (value: string, delimiter: string) =>
  (value || '')
    .split(delimiter === ';' ? /[|\n]/ : /[|;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeHeader = (header: string) =>
  header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

export const mapHeader = (header: string[]) => {
  const map: Partial<Record<Column, number>> = {};
  header.forEach((cell, index) => {
    const name = normalizeHeader(cell);
    for (const [column, aliases] of Object.entries(COLUMNS)) {
      if (
        map[column as Column] === undefined &&
        (aliases as readonly string[]).includes(name)
      ) {
        map[column as Column] = index;
      }
    }
  });
  return map;
};

export const isValidTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (err) {
    return false;
  }
};

const DATE_FORMAT =
  /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

// "2026-11-03 09:30" in the row's timezone, or a full ISO date with an
// offset, which wins over the timezone. Returns the UTC date or null.
export const parseImportDate = (value: string, tz: string): Date | null => {
  const match = (value || '').trim().match(DATE_FORMAT);
  if (!match) {
    return null;
  }
  const [, y, mo, d, h, mi, s = '0', meridiem, offset] = match;
  let hour = +h;
  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return null;
    }
    hour = (hour % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  }
  const parts = [+y, +mo, +d, hour, +mi, +s];
  if (
    parts[1] < 1 ||
    parts[1] > 12 ||
    parts[2] < 1 ||
    parts[2] > 31 ||
    hour > 23 ||
    parts[4] > 59 ||
    parts[5] > 59
  ) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const local = `${y}-${pad(parts[1])}-${pad(parts[2])}T${pad(hour)}:${pad(
    parts[4]
  )}:${pad(parts[5])}`;

  const date = offset
    ? dayjs(
        `${local}${
          offset.toUpperCase() === 'Z'
            ? 'Z'
            : offset.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')
        }`
      )
    : dayjs.tz(local, tz);

  if (!date.isValid()) {
    return null;
  }
  // 2026-02-31 rolls over to March: refuse it instead
  const check = offset ? dayjs(local) : date.tz(tz);
  if (check.date() !== parts[2] || check.month() + 1 !== parts[1]) {
    return null;
  }
  return date.toDate();
};

const isImageUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch (err) {
    return false;
  }
};

// matches a cell value to one of the workspace channels: its id, its name or,
// when only one channel uses it, its network ("linkedin", "x")
export const resolveChannel = (
  value: string,
  channels: ImportChannel[]
): { channel?: ImportChannel; error?: ImportIssue } => {
  const wanted = value.trim().toLowerCase();
  const byId = channels.find((channel) => channel.id === value.trim());
  if (byId) {
    return { channel: byId };
  }
  const byName = channels.filter(
    (channel) => channel.name.trim().toLowerCase() === wanted
  );
  const byNetwork = channels.filter(
    (channel) => channel.providerIdentifier.toLowerCase() === wanted
  );
  const matches = byName.length ? byName : byNetwork;
  if (matches.length === 1) {
    return { channel: matches[0] };
  }
  if (matches.length > 1) {
    return {
      error: {
        field: 'channels',
        message: `More than one channel is called "${value}".`,
        hint: `Use the channel ID instead: ${matches
          .map((channel) => `${channel.name} (${channel.id})`)
          .join(', ')}.`,
      },
    };
  }
  return {
    error: {
      field: 'channels',
      message: `We couldn't find a channel called "${value}".`,
      hint: channels.length
        ? `Use one of: ${channels
            .slice(0, 10)
            .map((channel) => channel.name)
            .join(', ')}${channels.length > 10 ? ', …' : ''}.`
        : 'Connect a channel first, then import the file again.',
    },
  };
};

// One CSV row as a parsed row with the checks that need no other service
export const parseImportRow = (
  cells: string[],
  header: Partial<Record<Column, number>>,
  row: number,
  options: {
    timezone: string;
    delimiter: string;
    channels: ImportChannel[];
    tags: string[];
    now?: number;
  }
): ParsedImportRow => {
  const cell = (column: Column) =>
    header[column] === undefined ? '' : (cells[header[column]!] || '').trim();
  const errors: ImportIssue[] = [];
  const warnings: string[] = [];

  // timezone of the row, then of the import, then UTC
  const tzCell = cell('timezone');
  let tz = options.timezone;
  if (tzCell) {
    if (isValidTimezone(tzCell)) {
      tz = tzCell;
    } else {
      errors.push({
        field: 'timezone',
        message: `"${tzCell}" isn't a timezone we know.`,
        hint: 'Use a name like Europe/London or America/New_York, or leave it empty to use your timezone.',
      });
    }
  }

  const dateCell = cell('date');
  const date = dateCell ? parseImportDate(dateCell, tz) : null;
  if (!dateCell) {
    errors.push({
      field: 'date',
      message: 'The date is missing.',
      hint: 'Write it like 2026-11-03 09:30.',
    });
  } else if (!date) {
    errors.push({
      field: 'date',
      message: `"${dateCell}" isn't a date we can read.`,
      hint: 'Write it like 2026-11-03 09:30 (year-month-day, 24-hour time).',
    });
  } else if (date.getTime() <= (options.now ?? Date.now())) {
    errors.push({
      field: 'date',
      message: 'This date is in the past.',
      hint: 'Pick a future date and time.',
    });
  }

  const channels: ImportChannel[] = [];
  const channelCell = splitList(cell('channels'), options.delimiter);
  if (!channelCell.length) {
    errors.push({
      field: 'channels',
      message: 'No channel is set.',
      hint: 'Add one or more channel names, separated by |.',
    });
  }
  for (const value of channelCell) {
    const { channel, error } = resolveChannel(value, options.channels);
    if (error) {
      errors.push(error);
      continue;
    }
    if (!channel || channels.some((p) => p.id === channel.id)) {
      continue;
    }
    if (channel.disabled) {
      errors.push({
        field: 'channels',
        message: `${channel.name} is turned off.`,
        hint: 'Turn it on from the channel menu in the calendar, or remove it from this row.',
      });
      continue;
    }
    if (channel.inBetweenSteps) {
      errors.push({
        field: 'channels',
        message: `${channel.name} isn't fully connected yet.`,
        hint: 'Finish connecting it from the calendar, then import again.',
      });
      continue;
    }
    if (channel.refreshNeeded) {
      warnings.push(
        `${channel.name} needs to be reconnected before this post goes out.`
      );
    }
    channels.push(channel);
  }

  const images = splitList(cell('images'), options.delimiter);
  for (const image of images) {
    if (!isImageUrl(image)) {
      errors.push({
        field: 'image_urls',
        message: `"${image}" isn't a link to an image.`,
        hint: 'Use public links that start with https://.',
      });
    }
  }

  const text = cell('text');
  if (!text && !images.length) {
    errors.push({
      field: 'text',
      message: 'The post is empty.',
      hint: 'Add some text or an image link.',
    });
  }

  let settings: Record<string, any> = {};
  const settingsCell = cell('settings');
  if (settingsCell) {
    try {
      const parsed = JSON.parse(settingsCell);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      settings = parsed;
    } catch (err) {
      errors.push({
        field: 'settings',
        message: 'The settings are not valid JSON.',
        hint: 'Write them like {"title": "My video"}, or leave the cell empty.',
      });
    }
  }

  const known = new Map(options.tags.map((tag) => [tag.toLowerCase(), tag]));
  const tags: string[] = [];
  for (const tag of splitList(cell('tags'), options.delimiter)) {
    const match = known.get(tag.toLowerCase());
    if (match) {
      tags.push(match);
    } else {
      warnings.push(
        `There's no tag or campaign called "${tag}", so the post won't get it.`
      );
    }
  }

  return {
    row,
    date: date ? date.toISOString() : null,
    timezone: tz,
    channels,
    text,
    images,
    settings,
    tags,
    errors,
    warnings,
  };
};

// the unique key of an upload: same file and same default timezone
export const importHash = (csv: string, timezone: string) =>
  createHash('sha256')
    .update(`${timezone}\n${(csv || '').replace(/\r\n?/g, '\n').trim()}`)
    .digest('hex');

const errorMessage = (err: any): string => {
  if (err instanceof HttpException) {
    const response: any = err.getResponse();
    const message = response?.message ?? err.message;
    return Array.isArray(message) ? message.join('; ') : String(message);
  }
  return err?.message || 'Something went wrong';
};

@Injectable()
export class PostsImportService {
  constructor(
    private _postsService: PostsService,
    private _importRepository: PostsImportRepository,
    private _integrationService: IntegrationService,
    private _mediaService: MediaService
  ) {}

  private timezone(body: ImportPostsDto) {
    return body.timezone && isValidTimezone(body.timezone)
      ? body.timezone
      : 'UTC';
  }

  // the post request a row becomes, the same shape the composer sends
  private toCreatePost(
    row: ParsedImportRow,
    media: Array<{ id: string; path: string }>
  ) {
    return {
      type: 'schedule',
      shortLink: false,
      date: row.date!,
      tags: row.tags.map((tag) => ({ value: tag, label: tag })),
      posts: row.channels.map((channel) => ({
        integration: { id: channel.id },
        value: [
          {
            content: row.text ? plainTextToHtml(row.text) : '',
            image: media,
          },
        ],
        settings: { ...row.settings },
      })),
    } as unknown as CreatePostDto;
  }

  // the checks of POST /posts (validatePosts, then the DTO validation) for
  // one row, as row issues instead of a thrown error
  private async validateRow(orgId: string, row: ParsedImportRow) {
    const issues: ImportIssue[] = [];
    const request = this.toCreatePost(
      row,
      row.images.map((path, index) => ({ id: `csv-${index}`, path }))
    );

    try {
      const results = await this._postsService.validatePosts(
        orgId,
        request.posts as any,
        'schedule'
      );
      for (const result of results) {
        if (result.emptyContent) {
          issues.push({
            field: 'text',
            message: `${result.name}: the post is empty.`,
            hint: 'Add some text or an image link.',
          });
        }
        if (!result.valid) {
          issues.push({
            field: 'settings',
            message: `${result.name}: ${
              result.settingsError || 'some required settings are missing.'
            }`,
            hint: 'Add them in the settings column, like {"title": "My video"}. To give each channel different settings, put each channel on its own row.',
          });
        }
        if (result.errors !== true) {
          issues.push({
            field: 'image_urls',
            message: `${result.name}: ${result.errors}`,
            hint: 'Check the number and type of images this network accepts.',
          });
        }
        if (result.tooLong) {
          issues.push({
            field: 'text',
            message: `${result.name}: the text is longer than ${result.maximumCharacters} characters.`,
            hint: 'Shorten it, or put this channel on its own row with a shorter text.',
          });
        }
      }
    } catch (err) {
      issues.push({ field: 'channels', message: errorMessage(err) });
    }

    // the image links are checked once downloaded; here only the rest
    if (!issues.length) {
      try {
        await this._postsService.mapTypeToPost(
          this.toCreatePost(row, []),
          orgId
        );
      } catch (err) {
        issues.push({ field: 'settings', message: errorMessage(err) });
      }
    }

    return issues;
  }

  private async parse(orgId: string, body: ImportPostsDto) {
    const fileErrors: string[] = [];
    const delimiter = detectDelimiter(body.csv || '');
    const [header = [], ...rows] = parseCsv(body.csv, delimiter);
    const columns = mapHeader(header);

    const missing = (['date', 'channels', 'text'] as Column[]).filter(
      (column) => columns[column] === undefined
    );
    if (missing.length) {
      fileErrors.push(
        `The file needs ${missing
          .map((column) => `a "${column}" column`)
          .join(' and ')}. Download the template to see the format.`
      );
    }
    if (!rows.length && !missing.length) {
      fileErrors.push('The file has no posts in it.');
    }
    if (rows.length > IMPORT_ROW_LIMIT) {
      fileErrors.push(
        `The file has ${rows.length} posts. Import up to ${IMPORT_ROW_LIMIT} at a time by splitting it into smaller files.`
      );
    }

    if (fileErrors.length) {
      return { fileErrors, rows: [] as ParsedImportRow[] };
    }

    const [integrations, tags] = await Promise.all([
      this._integrationService.getIntegrationsList(orgId),
      this._postsService.getTags(orgId),
    ]);
    const channels: ImportChannel[] = integrations.map((integration) => ({
      id: integration.id,
      name: integration.name,
      providerIdentifier: integration.providerIdentifier,
      picture: integration.picture,
      disabled: integration.disabled,
      refreshNeeded: integration.refreshNeeded,
      inBetweenSteps: integration.inBetweenSteps,
    }));
    const timezone = this.timezone(body);

    const parsed: ParsedImportRow[] = [];
    for (const [index, cells] of rows.entries()) {
      const row = parseImportRow(cells, columns, index + 2, {
        timezone,
        delimiter,
        channels,
        tags: tags.map((tag) => tag.name),
      });
      if (!row.errors.length) {
        row.errors.push(...(await this.validateRow(orgId, row)));
      }
      parsed.push(row);
    }

    return { fileErrors, rows: parsed };
  }

  async preview(orgId: string, body: ImportPostsDto) {
    const { fileErrors, rows } = await this.parse(orgId, body);
    const valid = rows.filter((row) => !row.errors.length).length;
    return {
      limit: IMPORT_ROW_LIMIT,
      fileErrors,
      total: rows.length,
      valid,
      invalid: rows.length - valid,
      rows: rows.map((row) => ({
        row: row.row,
        date: row.date,
        timezone: row.timezone,
        channels: row.channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          identifier: channel.providerIdentifier,
          picture: channel.picture,
        })),
        text: row.text,
        images: row.images,
        tags: row.tags,
        errors: row.errors,
        warnings: row.warnings,
      })),
    };
  }

  // Creates the valid rows as scheduled posts. The same file (and timezone)
  // is only ever imported once: a second request returns the first result.
  // `remaining` is how many posts the plan still allows this month (null
  // for no limit); rows past it are skipped. `actor` is the member importing,
  // their rows wait for an approver like posts saved in the composer.
  async import(
    orgId: string,
    body: ImportPostsDto,
    remaining: number | null = null,
    actor?: ApprovalActor
  ) {
    const hash = importHash(body.csv, this.timezone(body));
    const claim = await this._importRepository.claim(orgId, hash);
    if (!claim.claimed) {
      if (claim.existing?.status === 'done' && claim.existing.result) {
        return { ...JSON.parse(claim.existing.result), alreadyImported: true };
      }
      throw new ConflictException(
        'This file is already being imported. Give it a minute, then check the calendar.'
      );
    }

    const results: Array<{
      row: number;
      status: 'created' | 'skipped' | 'failed';
      error?: string;
    }> = [];

    try {
      const { fileErrors, rows } = await this.parse(orgId, body);
      if (fileErrors.length) {
        throw new BadRequestException(fileErrors[0]);
      }

      // rows created by an earlier attempt that stopped half way
      const done = new Set<number>();
      try {
        for (const result of JSON.parse(claim.progress || '{}')?.rows || []) {
          if (result?.status === 'created') {
            done.add(result.row);
          }
        }
      } catch (err) {
        /** no progress **/
      }

      let posts = 0;
      for (const row of rows) {
        // already counted in the remaining quota
        if (done.has(row.row)) {
          results.push({ row: row.row, status: 'created' });
          continue;
        }
        if (row.errors.length) {
          results.push({
            row: row.row,
            status: 'skipped',
            error: row.errors[0].message,
          });
          continue;
        }
        if (remaining !== null && posts + row.channels.length > remaining) {
          results.push({
            row: row.row,
            status: 'skipped',
            error:
              "Your plan's monthly post limit is reached. Upgrade your plan or import the rest next month.",
          });
          continue;
        }
        try {
          // through the SSRF-protected media download, into the library
          const media: Array<{ id: string; path: string }> = [];
          for (const url of row.images) {
            try {
              const saved = await this._mediaService.uploadFromUrl(orgId, url);
              media.push({ id: saved.id, path: saved.path });
            } catch (err) {
              throw new BadRequestException(
                `We couldn't download the image ${url}. Check that the link is public.`
              );
            }
          }
          const request = await this._postsService.mapTypeToPost(
            this.toCreatePost(row, media),
            orgId
          );
          await this._postsService.createPost(
            orgId,
            request,
            'WEB',
            false,
            actor
          );
          posts += row.channels.length;
          results.push({ row: row.row, status: 'created' });
          // the progress keeps the claim fresh and survives a crash
          await this._importRepository.touch(
            orgId,
            hash,
            JSON.stringify({ rows: results })
          );
        } catch (err) {
          results.push({
            row: row.row,
            status: 'failed',
            error: errorMessage(err),
          });
        }
      }
    } catch (err) {
      // nothing was created yet, so the same file can be tried again
      if (!results.some((result) => result.status === 'created')) {
        await this._importRepository.release(orgId, hash);
        throw err;
      }
    }

    const summary = {
      created: results.filter((result) => result.status === 'created').length,
      skipped: results.filter((result) => result.status === 'skipped').length,
      failed: results.filter((result) => result.status === 'failed').length,
      rows: results,
    };

    if (!summary.created) {
      // nothing went in: let the user fix the file and send it again
      await this._importRepository.release(orgId, hash);
    } else {
      await this._importRepository.finish(orgId, hash, JSON.stringify(summary));
    }

    return summary;
  }
}
