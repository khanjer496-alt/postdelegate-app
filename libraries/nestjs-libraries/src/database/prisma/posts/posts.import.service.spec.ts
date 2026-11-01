import { BadRequestException, ConflictException } from '@nestjs/common';

// the service pulls in heavy provider / upload modules that are not under test
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({
  MediaService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);

import {
  IMPORT_ROW_LIMIT,
  PostsImportService,
  importHash,
  mapHeader,
  parseCsv,
  parseImportDate,
  parseImportRow,
  resolveChannel,
} from '@gitroom/nestjs-libraries/database/prisma/posts/posts.import.service';

const channels = [
  { id: 'int-x', name: 'Acme X', providerIdentifier: 'x' },
  { id: 'int-li', name: 'Acme', providerIdentifier: 'linkedin-page' },
  { id: 'int-li2', name: 'Acme', providerIdentifier: 'linkedin' },
  { id: 'int-off', name: 'Old Page', providerIdentifier: 'facebook', disabled: true },
  { id: 'int-re', name: 'Insta', providerIdentifier: 'instagram', refreshNeeded: true },
];
const now = new Date('2026-11-01T00:00:00.000Z').getTime();
const header = mapHeader([
  'Date',
  'Timezone',
  'Channels',
  'Text',
  'Image URLs',
  'Settings',
  'Tags',
]);
const row = (cells: string[]) =>
  parseImportRow(cells, header, 2, {
    timezone: 'UTC',
    delimiter: ',',
    channels,
    tags: ['Launch week'],
    now,
  });

describe('parseCsv', () => {
  it('reads quoted cells with commas, quotes and line breaks', () => {
    const csv =
      '﻿date,channels,text\r\n2026-11-03 09:30,Acme X,"Hello, ""world""\nsecond line"\r\n\r\n';
    expect(parseCsv(csv)).toEqual([
      ['date', 'channels', 'text'],
      ['2026-11-03 09:30', 'Acme X', 'Hello, "world"\nsecond line'],
    ]);
  });

  it('detects a semicolon separated file', () => {
    expect(parseCsv('date;channels;text\n2026-11-03 09:30;Acme X;a, b')).toEqual([
      ['date', 'channels', 'text'],
      ['2026-11-03 09:30', 'Acme X', 'a, b'],
    ]);
  });

  it('refuses a quote that is never closed', () => {
    expect(() => parseCsv('date,text\n2026,"open')).toThrow(BadRequestException);
  });

  it('maps the header aliases', () => {
    expect(mapHeader(['When', 'channel', 'Content', 'media'])).toEqual({
      date: 0,
      channels: 1,
      text: 2,
      images: 3,
    });
  });
});

describe('parseImportDate', () => {
  it('reads the local time of the timezone', () => {
    expect(parseImportDate('2026-11-03 09:30', 'America/New_York')?.toISOString()).toBe(
      '2026-11-03T14:30:00.000Z'
    );
    expect(parseImportDate('2026-07-03T09:30', 'Europe/London')?.toISOString()).toBe(
      '2026-07-03T08:30:00.000Z'
    );
  });

  it('lets an explicit offset win and reads am/pm', () => {
    expect(parseImportDate('2026-11-03 09:30+02:00', 'UTC')?.toISOString()).toBe(
      '2026-11-03T07:30:00.000Z'
    );
    expect(parseImportDate('2026-11-03 9:05 pm', 'UTC')?.toISOString()).toBe(
      '2026-11-03T21:05:00.000Z'
    );
  });

  it('refuses impossible or unreadable dates', () => {
    expect(parseImportDate('2026-02-31 10:00', 'UTC')).toBeNull();
    expect(parseImportDate('03/11/2026 10:00', 'UTC')).toBeNull();
    expect(parseImportDate('2026-11-03 25:00', 'UTC')).toBeNull();
  });
});

describe('parseImportRow', () => {
  it('parses a valid row', () => {
    const parsed = row([
      '2026-11-03 09:30',
      'Europe/Paris',
      'Acme X | int-li',
      'Hello',
      'https://cdn.example.com/a.png',
      '{"title":"Hi"}',
      'launch WEEK',
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.date).toBe('2026-11-03T08:30:00.000Z');
    expect(parsed.channels.map((c) => c.id)).toEqual(['int-x', 'int-li']);
    expect(parsed.settings).toEqual({ title: 'Hi' });
    expect(parsed.tags).toEqual(['Launch week']);
  });

  it('explains every problem with a hint', () => {
    const parsed = row([
      '2020-01-01 10:00',
      'Mars/Base',
      'Nope | Old Page',
      '',
      'ftp://x',
      '{broken',
      'Unknown',
    ]);
    const fields = parsed.errors.map((e) => e.field);
    expect(fields).toEqual(
      expect.arrayContaining(['timezone', 'date', 'channels', 'image_urls', 'settings'])
    );
    expect(parsed.errors.every((e) => e.message && e.hint)).toBe(true);
    expect(parsed.warnings.join(' ')).toContain('Unknown');
  });

  it('flags a channel that needs reconnecting as a warning only', () => {
    const parsed = row(['2026-11-03 09:30', '', 'Insta', 'Hi', '', '', '']);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings[0]).toContain('reconnected');
  });

  it('asks for the id when a channel name is ambiguous', () => {
    const { error } = resolveChannel('acme', channels);
    expect(error?.hint).toContain('int-li');
    expect(resolveChannel('x', channels).channel?.id).toBe('int-x');
  });
});

describe('PostsImportService', () => {
  const csv = (rows: string[]) =>
    ['date,channels,text,image_urls', ...rows].join('\n');

  const make = () => {
    const postsService = {
      getTags: jest.fn().mockResolvedValue([]),
      validatePosts: jest.fn().mockImplementation(async (_org, posts) =>
        posts.map(() => ({
          name: 'Acme X',
          valid: true,
          errors: true,
          emptyContent: false,
          tooLong: false,
          maximumCharacters: 280,
        }))
      ),
      mapTypeToPost: jest.fn().mockImplementation(async (body) => body),
      createPost: jest.fn().mockResolvedValue([{ postId: 'p-1' }]),
    };
    const repo = {
      claim: jest.fn().mockResolvedValue({ claimed: true, progress: null }),
      finish: jest.fn(),
      release: jest.fn(),
      touch: jest.fn(),
    };
    const integrations = {
      getIntegrationsList: jest.fn().mockResolvedValue(channels),
    };
    const media = {
      uploadFromUrl: jest
        .fn()
        .mockResolvedValue({ id: 'm-1', path: 'https://uploads.example.com/m.png' }),
    };
    const service = new PostsImportService(
      postsService as any,
      repo as any,
      integrations as any,
      media as any
    );
    return { service, postsService, repo, integrations, media };
  };

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date(now));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('previews with the post validation and maps its errors to the row', async () => {
    const { service, postsService } = make();
    postsService.validatePosts.mockResolvedValueOnce([
      {
        name: 'Acme X',
        valid: false,
        settingsError: 'Title is required',
        errors: true,
        emptyContent: false,
        tooLong: true,
        maximumCharacters: 280,
      },
    ]);
    const preview = await service.preview('org-1', {
      csv: csv(['2026-11-03 09:30,Acme X,Hello,', '2026-11-04 09:30,Acme X,Bye,']),
    });
    expect(preview.total).toBe(2);
    expect(preview.valid).toBe(1);
    expect(preview.rows[0].errors.map((e) => e.message)).toEqual([
      'Acme X: Title is required',
      'Acme X: the text is longer than 280 characters.',
    ]);
    // the media check runs on the links, before anything is downloaded
    expect(postsService.validatePosts.mock.calls[0][0]).toBe('org-1');
    // the row date, for the settings checked against the post time
    expect(postsService.validatePosts.mock.calls[0][4]).toBe(
      preview.rows[0].date
    );
  });

  it(`refuses more than ${IMPORT_ROW_LIMIT} rows and missing columns`, async () => {
    const { service } = make();
    const many = Array.from(
      { length: IMPORT_ROW_LIMIT + 1 },
      () => '2026-11-03 09:30,Acme X,Hi,'
    );
    expect((await service.preview('org-1', { csv: csv(many) })).fileErrors[0]).toContain(
      `${IMPORT_ROW_LIMIT + 1} posts`
    );
    expect(
      (await service.preview('org-1', { csv: 'date,text\n2026-11-03 09:30,hi' })).fileErrors[0]
    ).toContain('"channels"');
  });

  it('imports the valid rows once, downloading images safely', async () => {
    const { service, postsService, repo, media } = make();
    const result = await service.import('org-1', {
      csv: csv([
        '2026-11-03 09:30,Acme X,Hello,https://cdn.example.com/a.png',
        '2020-01-01 09:30,Acme X,Old,',
      ]),
      timezone: 'UTC',
    });
    expect(result).toMatchObject({ created: 1, skipped: 1, failed: 0 });
    expect(media.uploadFromUrl).toHaveBeenCalledWith(
      'org-1',
      'https://cdn.example.com/a.png'
    );
    const [org, body, method] = postsService.createPost.mock.calls[0];
    expect(org).toBe('org-1');
    expect(method).toBe('WEB');
    expect(body.type).toBe('schedule');
    expect(body.posts[0].value[0]).toEqual({
      content: '<p>Hello</p>',
      image: [{ id: 'm-1', path: 'https://uploads.example.com/m.png' }],
    });
    expect(repo.finish).toHaveBeenCalledWith(
      'org-1',
      importHash(
        csv([
          '2026-11-03 09:30,Acme X,Hello,https://cdn.example.com/a.png',
          '2020-01-01 09:30,Acme X,Old,',
        ]),
        'UTC'
      ),
      expect.any(String)
    );
  });

  it('saves the rows as the member importing, so approvals apply', async () => {
    const { service, postsService } = make();
    const actor = { type: 'user' as const, userId: 'u-1', role: 'USER' };
    await service.import(
      'org-1',
      { csv: csv(['2026-11-03 09:30,Acme X,Hello,']), timezone: 'UTC' },
      null,
      actor
    );
    expect(postsService.createPost.mock.calls[0][4]).toBe(actor);
  });

  it('returns the first result when the same file comes again', async () => {
    const { service, postsService, repo } = make();
    repo.claim.mockResolvedValueOnce({
      claimed: false,
      existing: { status: 'done', result: JSON.stringify({ created: 3, rows: [] }) },
    });
    const result = await service.import('org-1', { csv: csv(['x']) });
    expect(result).toEqual({ created: 3, rows: [], alreadyImported: true });
    expect(postsService.createPost).not.toHaveBeenCalled();
  });

  it('refuses a second import of a file still being imported', async () => {
    const { service, repo } = make();
    repo.claim.mockResolvedValueOnce({
      claimed: false,
      existing: { status: 'processing', result: null },
    });
    await expect(service.import('org-1', { csv: csv(['x']) })).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it('frees the file when nothing could be created', async () => {
    const { service, repo, postsService } = make();
    postsService.createPost.mockRejectedValueOnce(new Error('boom'));
    const result = await service.import('org-1', {
      csv: csv(['2026-11-03 09:30,Acme X,Hello,']),
    });
    expect(result).toMatchObject({ created: 0, failed: 1 });
    expect(result.rows[0].error).toBe('boom');
    expect(repo.release).toHaveBeenCalled();
    expect(repo.finish).not.toHaveBeenCalled();
  });

  it('skips the rows past the monthly post limit of the plan', async () => {
    const { service, postsService } = make();
    const result = await service.import(
      'org-1',
      {
        csv: csv([
          '2026-11-03 09:30,Acme X,One,',
          '2026-11-04 09:30,Acme X,Two,',
        ]),
      },
      1
    );
    expect(result).toMatchObject({ created: 1, skipped: 1 });
    expect(result.rows[1].error).toContain('monthly post limit');
    expect(postsService.createPost).toHaveBeenCalledTimes(1);
  });

  it('resumes an import that stopped half way without creating rows twice', async () => {
    const { service, postsService, repo } = make();
    repo.claim.mockResolvedValueOnce({
      claimed: true,
      progress: JSON.stringify({ rows: [{ row: 2, status: 'created' }] }),
    });
    const result = await service.import('org-1', {
      csv: csv(['2026-11-03 09:30,Acme X,One,', '2026-11-04 09:30,Acme X,Two,']),
    });
    expect(result).toMatchObject({ created: 2 });
    expect(postsService.createPost).toHaveBeenCalledTimes(1);
    expect(repo.touch).toHaveBeenCalledTimes(1);
  });

  it('keys the upload on its contents and timezone', () => {
    expect(importHash('a,b\r\n1,2\r\n', 'UTC')).toBe(importHash('a,b\n1,2', 'UTC'));
    expect(importHash('a,b\n1,2', 'UTC')).not.toBe(importHash('a,b\n1,2', 'Europe/Paris'));
  });
});
