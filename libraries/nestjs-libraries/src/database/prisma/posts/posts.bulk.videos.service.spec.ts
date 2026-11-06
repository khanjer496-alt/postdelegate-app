import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';

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
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));

import 'reflect-metadata';
import { IsDefined, IsString } from 'class-validator';
import { ComposerOnly } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';
import {
  PostsBulkVideosService,
  bulkSettings,
  bulkVideosHash,
  fileTitle,
  fillPlaceholders,
  intervalDates,
  nextFreeSlots,
  settingFields,
} from '@gitroom/nestjs-libraries/database/prisma/posts/posts.bulk.videos.service';

const now = new Date('2026-11-01T10:00:00.000Z').getTime();
const minute = (iso: string) => Math.floor(new Date(iso).getTime() / 60_000);
const iso = (dates: Date[]) => dates.map((date) => date.toISOString());

describe('nextFreeSlots', () => {
  it('fills the time slots in order, day by day, from the start', () => {
    const dates = nextFreeSlots({
      // 09:00 and 17:00 UTC, given out of order
      times: [1020, 540],
      start: new Date('2026-11-01T00:00:00.000Z'),
      count: 4,
      taken: new Set(),
      now,
    });
    // 09:00 today has passed already
    expect(iso(dates)).toEqual([
      '2026-11-01T17:00:00.000Z',
      '2026-11-02T09:00:00.000Z',
      '2026-11-02T17:00:00.000Z',
      '2026-11-03T09:00:00.000Z',
    ]);
  });

  it('keeps 5 minutes between now and the first slot', () => {
    const dates = nextFreeSlots({
      // 10:03 and 10:06 UTC, now is 10:00
      times: [603, 606],
      start: new Date('2026-11-01T00:00:00.000Z'),
      count: 1,
      taken: new Set(),
      now,
    });
    expect(iso(dates)).toEqual(['2026-11-01T10:06:00.000Z']);
  });

  it('skips the slots that already have a post', () => {
    const dates = nextFreeSlots({
      times: [540, 1020],
      start: new Date('2026-11-02T00:00:00.000Z'),
      count: 2,
      taken: new Set([minute('2026-11-02T09:00:00.000Z')]),
      now,
    });
    expect(iso(dates)).toEqual([
      '2026-11-02T17:00:00.000Z',
      '2026-11-03T09:00:00.000Z',
    ]);
  });

  it('starts at the start time, not at the start of its day', () => {
    const dates = nextFreeSlots({
      times: [540, 1020],
      start: new Date('2026-11-05T12:00:00.000Z'),
      count: 1,
      taken: new Set(),
      now,
    });
    expect(iso(dates)).toEqual(['2026-11-05T17:00:00.000Z']);
  });

  it('uses the default times of findFreeDateTime without time slots', () => {
    const dates = nextFreeSlots({
      times: [],
      start: new Date('2026-11-02T00:00:00.000Z'),
      count: 3,
      taken: new Set(),
      now,
    });
    expect(iso(dates)).toEqual([
      '2026-11-02T02:00:00.000Z',
      '2026-11-02T06:40:00.000Z',
      '2026-11-02T11:40:00.000Z',
    ]);
  });

  it('wraps slots outside of one day and drops duplicates', () => {
    const dates = nextFreeSlots({
      // -60 is 23:00 of the day before, 1500 is 01:00 of the next one
      times: [-60, 1380, 1500],
      start: new Date('2026-11-02T00:00:00.000Z'),
      count: 3,
      taken: new Set(),
      now,
    });
    expect(iso(dates)).toEqual([
      '2026-11-02T01:00:00.000Z',
      '2026-11-02T23:00:00.000Z',
      '2026-11-03T01:00:00.000Z',
    ]);
  });

  it('returns fewer dates when the search window runs out', () => {
    const dates = nextFreeSlots({
      times: [540],
      start: new Date('2026-11-02T00:00:00.000Z'),
      count: 5,
      taken: new Set([minute('2026-11-03T09:00:00.000Z')]),
      now,
      days: 2,
    });
    expect(iso(dates)).toEqual([
      '2026-11-02T09:00:00.000Z',
      '2026-11-04T09:00:00.000Z',
    ]);
  });
});

describe('intervalDates', () => {
  it('adds hours from the start', () => {
    expect(
      iso(
        intervalDates({
          start: new Date('2026-11-02T22:00:00.000Z'),
          count: 3,
          every: 6,
          unit: 'hours',
        })
      )
    ).toEqual([
      '2026-11-02T22:00:00.000Z',
      '2026-11-03T04:00:00.000Z',
      '2026-11-03T10:00:00.000Z',
    ]);
  });

  it('keeps the wall clock time of daily posts across a clock change', () => {
    // 09:00 in London, the clocks go back on 25 October 2026
    expect(
      iso(
        intervalDates({
          start: new Date('2026-10-24T08:00:00.000Z'),
          count: 2,
          every: 2,
          unit: 'days',
          tz: 'Europe/London',
        })
      )
    ).toEqual(['2026-10-24T08:00:00.000Z', '2026-10-26T09:00:00.000Z']);
  });
});

describe('placeholders and settings', () => {
  it('turns a file name into a title', () => {
    expect(fileTitle('Launch day.final.mp4')).toBe('Launch day.final');
    expect(fileTitle('clip')).toBe('clip');
  });

  it('fills {filename} in text and in text settings only', () => {
    expect(fillPlaceholders('New: {filename} / {FILENAME}', 'Demo')).toBe(
      'New: Demo / Demo'
    );
    expect(
      fillPlaceholders({ title: '{filename}', type: 'public', duet: false }, 'Demo')
    ).toEqual({ title: 'Demo', type: 'public', duet: false });
  });

  it('leaves composer-only settings out, and drafts only when one is required', () => {
    class Channel {
      @IsDefined()
      @IsString()
      @ComposerOnly()
      channel: string;
    }
    class Check {
      @IsString()
      title: string;

      @IsString()
      @ComposerOnly()
      verified?: string;
    }
    const schemas = {
      Channel: { properties: { channel: { type: 'string' } }, required: ['channel'] },
      Check: {
        properties: { title: { type: 'string' }, verified: { type: 'string' } },
        required: ['title'],
      },
    };
    expect(bulkSettings(Channel, schemas)).toEqual({ fields: [], draftsOnly: true });
    expect(bulkSettings(Check, schemas)).toEqual({
      fields: [{ key: 'title', type: 'text', required: true, defaultValue: '{filename}' }],
      draftsOnly: false,
    });
    expect(bulkSettings(undefined, schemas)).toEqual({ fields: [], draftsOnly: false });
  });

  it('describes the settings a bulk form can fill', () => {
    const fields = settingFields({
      properties: {
        title: { type: 'string', maxLength: 100 },
        type: { type: 'string', enum: ['public', 'private'] },
        duet: { type: 'boolean' },
        consent: { type: 'boolean', enum: [true] },
        verified: { type: 'boolean', enum: [true] },
        tags: { type: 'array', items: {} },
        thumbnail: { type: 'object', properties: {} },
        __type: { type: 'string' },
      },
      required: ['title', 'type'],
    }, ['verified']);
    expect(fields).toEqual([
      {
        key: 'title',
        type: 'text',
        required: true,
        maxLength: 100,
        defaultValue: '{filename}',
      },
      { key: 'type', type: 'select', required: true, options: ['public', 'private'] },
      { key: 'duet', type: 'boolean', required: false },
      { key: 'consent', type: 'boolean', required: false },
    ]);
  });
});

describe('PostsBulkVideosService', () => {
  const integrations = [
    { id: 'yt', name: 'Acme YouTube', providerIdentifier: 'youtube', picture: null },
    { id: 'tt', name: 'Acme TikTok', providerIdentifier: 'tiktok', picture: null },
    { id: 'off', name: 'Old', providerIdentifier: 'x', disabled: true },
  ];
  const media: Record<string, any> = {
    'm-1': { id: 'm-1', name: 'a1.mp4', originalName: 'First clip.mp4', path: 'https://cdn/a1.mp4', status: 'ready' },
    'm-2': { id: 'm-2', name: 'b2.mp4', originalName: 'Second.mp4', path: 'https://cdn/b2.mp4', status: 'ready' },
    'm-3': { id: 'm-3', name: 'c3.mp4', originalName: 'Third.mp4', path: 'https://cdn/c3.mp4', status: 'ready' },
  };

  const make = () => {
    const postsService = {
      validatePosts: jest.fn().mockImplementation(async (_org, posts) =>
        posts.map((post: any) => ({
          name: post.integration.id,
          valid: true,
          settingsError: '',
          errors: true,
          emptyContent: false,
          tooLong: false,
          maximumCharacters: 5000,
        }))
      ),
      mapTypeToPost: jest.fn().mockImplementation(async (body) => body),
      createPost: jest.fn().mockResolvedValue([{ postId: 'p-1' }]),
      getPublishDatesOfIntegrations: jest.fn().mockResolvedValue([]),
    };
    const repo = {
      claim: jest.fn().mockResolvedValue({ claimed: true, progress: null }),
      finish: jest.fn(),
      release: jest.fn(),
      touch: jest.fn(),
      get: jest.fn().mockResolvedValue(null),
    };
    const integrationService = {
      getIntegrationsList: jest.fn().mockResolvedValue(integrations),
      // 09:00 UTC on YouTube, 12:00 UTC on TikTok
      findFreeDateTime: jest
        .fn()
        .mockImplementation(async (_org, id) => (id === 'yt' ? [540] : [720])),
    };
    const integrationManager = {
      getSocialIntegration: jest.fn().mockReturnValue(undefined),
    };
    const mediaService = {
      getOrgMediaById: jest.fn().mockImplementation(async (_org, id) => media[id] || null),
    };
    const service = new PostsBulkVideosService(
      postsService as any,
      repo as any,
      integrationService as any,
      integrationManager as any,
      mediaService as any
    );
    return {
      service,
      postsService,
      repo,
      integrationService,
      integrationManager,
      mediaService,
    };
  };

  const body = (override: Record<string, any> = {}) =>
    ({
      type: 'schedule',
      schedule: { mode: 'slots', start: '2026-11-02T00:00:00.000Z' },
      caption: 'Watch {filename}',
      channels: [
        { id: 'yt', settings: { title: '{filename}', type: 'public' } },
        { id: 'tt' },
      ],
      videos: [{ mediaId: 'm-1' }, { mediaId: 'm-2', caption: 'Own text' }],
      ...override,
    } as any);

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date(now));
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('plans one post a video, each channel at its own next free slot', async () => {
    const { service, postsService } = make();
    postsService.getPublishDatesOfIntegrations.mockResolvedValueOnce([
      { integrationId: 'yt', publishDate: new Date('2026-11-02T09:00:00.000Z') },
    ]);
    const preview = await service.preview('org-1', body(), null);
    expect(preview).toMatchObject({ total: 2, valid: 2, invalid: 0, needed: 4 });
    expect(preview.posts.map((post) => post.channels.map((p) => p.date))).toEqual([
      ['2026-11-03T09:00:00.000Z', '2026-11-02T12:00:00.000Z'],
      ['2026-11-04T09:00:00.000Z', '2026-11-03T12:00:00.000Z'],
    ]);
    expect(preview.posts.map((post) => post.caption)).toEqual([
      'Watch First clip',
      'Own text',
    ]);
    // the request a video becomes is not sent to the browser
    expect((preview.posts[0] as any).request).toBeUndefined();
  });

  it('sends the composer request: the video, the caption and the filled settings', async () => {
    const { service, postsService } = make();
    await service.preview('org-1', body());
    const [, posts, operation] = postsService.validatePosts.mock.calls[0];
    expect(operation).toBe('schedule');
    expect(posts[0]).toEqual({
      integration: { id: 'yt' },
      date: '2026-11-02T09:00:00.000Z',
      value: [
        {
          content: '<p>Watch First clip</p>',
          image: [{ id: 'm-1', path: 'https://cdn/a1.mp4' }],
        },
      ],
      settings: { title: 'First clip', type: 'public' },
    });
    expect(postsService.mapTypeToPost).toHaveBeenCalledTimes(2);
  });

  it('puts a video setting over the channel setting', async () => {
    const { service, postsService } = make();
    await service.preview(
      'org-1',
      body({
        videos: [{ mediaId: 'm-1', settings: { yt: { title: 'Better title' } } }],
      })
    );
    expect(postsService.validatePosts.mock.calls[0][1][0].settings).toEqual({
      title: 'Better title',
      type: 'public',
    });
  });

  it('spreads the videos every N hours on every channel', async () => {
    const { service, postsService } = make();
    const preview = await service.preview(
      'org-1',
      body({
        schedule: {
          mode: 'interval',
          start: '2026-11-02T08:00:00.000Z',
          every: 4,
          unit: 'hours',
        },
      })
    );
    expect(preview.posts.map((post) => post.channels.map((p) => p.date))).toEqual([
      ['2026-11-02T08:00:00.000Z', '2026-11-02T08:00:00.000Z'],
      ['2026-11-02T12:00:00.000Z', '2026-11-02T12:00:00.000Z'],
    ]);
    expect(postsService.getPublishDatesOfIntegrations).not.toHaveBeenCalled();
  });

  it('refuses an interval that starts in the past, unless the posts are drafts', async () => {
    const { service } = make();
    const past = { mode: 'interval', start: '2026-10-01T08:00:00.000Z', every: 1, unit: 'days' };
    await expect(
      service.preview('org-1', body({ schedule: past }))
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.preview('org-1', body({ schedule: past, type: 'draft' }))
    ).resolves.toMatchObject({ valid: 2 });
  });

  it('shows the problems of each channel and of each video', async () => {
    const { service, postsService, mediaService } = make();
    mediaService.getOrgMediaById.mockImplementation(async (_org: string, id: string) =>
      id === 'm-2' ? { ...media['m-2'], status: 'processing' } : media[id]
    );
    postsService.validatePosts.mockImplementationOnce(async (_org, posts) =>
      posts.map((post: any) => ({
        name: post.integration.id,
        valid: post.integration.id !== 'yt',
        settingsError: 'title must be longer than or equal to 2 characters',
        errors: post.integration.id === 'tt' ? 'Video is too long' : true,
        emptyContent: false,
        tooLong: false,
        maximumCharacters: 5000,
      }))
    );
    const preview = await service.preview('org-1', body());
    expect(preview).toMatchObject({ valid: 0, invalid: 2 });
    expect(preview.posts[0].channels[0].errors[0]).toMatchObject({
      field: 'settings',
      message: 'title must be longer than or equal to 2 characters',
    });
    expect(preview.posts[0].channels[1].errors[0]).toMatchObject({
      field: 'media',
      message: 'Video is too long',
    });
    expect(preview.posts[1].errors[0].message).toContain('still being processed');
    // a video that can't be posted is not checked further
    expect(postsService.validatePosts).toHaveBeenCalledTimes(1);
  });

  it('only checks drafts for what a draft save checks', async () => {
    const { service, postsService } = make();
    postsService.validatePosts.mockImplementation(async (_org, posts) =>
      posts.map(() => ({
        name: 'yt',
        valid: false,
        settingsError: 'title should not be empty',
        errors: true,
        emptyContent: false,
        tooLong: true,
        maximumCharacters: 10,
      }))
    );
    const preview = await service.preview('org-1', body({ type: 'draft' }));
    expect(preview).toMatchObject({ valid: 2, invalid: 0 });
    expect(postsService.validatePosts.mock.calls[0][2]).toBe('draft');
  });

  it('refuses a channel that is turned off', async () => {
    const { service } = make();
    await expect(
      service.preview('org-1', body({ channels: [{ id: 'off' }] }))
    ).rejects.toThrow('turned off');
  });

  it('creates nothing until every video passes the checks', async () => {
    const { service, postsService, repo } = make();
    postsService.validatePosts.mockImplementation(async (_org, posts) =>
      posts.map(() => ({
        name: 'yt',
        valid: false,
        settingsError: 'title should not be empty',
        errors: true,
        emptyContent: false,
        tooLong: false,
      }))
    );
    await expect(service.create('org-1', body())).rejects.toThrow(
      '2 of 2 videos need a fix'
    );
    expect(postsService.createPost).not.toHaveBeenCalled();
    expect(repo.release).toHaveBeenCalled();
  });

  it('creates one post a video, as the member scheduling', async () => {
    const { service, postsService, repo } = make();
    const actor = { type: 'user' as const, userId: 'u-1', role: 'USER' };
    const result = await service.create('org-1', body(), null, actor);
    expect(result).toMatchObject({ type: 'schedule', created: 2, skipped: 0, failed: 0, limitReached: null });
    expect(postsService.createPost).toHaveBeenCalledTimes(2);
    const [org, request, method, keepGroup, who] = postsService.createPost.mock.calls[0];
    expect([org, method, keepGroup, who]).toEqual(['org-1', 'WEB', false, actor]);
    expect(request.type).toBe('schedule');
    expect(request.date).toBe('2026-11-02T09:00:00.000Z');
    expect(request.posts.map((post: any) => post.integration.id)).toEqual(['yt', 'tt']);
    expect(repo.finish).toHaveBeenCalledWith('org-1', bulkVideosHash(body()), expect.any(String));
  });

  it('creates drafts when asked', async () => {
    const { service, postsService } = make();
    const result = await service.create('org-1', body({ type: 'draft' }));
    expect(result).toMatchObject({ type: 'draft', created: 2 });
    expect(postsService.createPost.mock.calls[0][1].type).toBe('draft');
  });

  it('stops at the monthly post limit and says how many went in', async () => {
    const { service, postsService } = make();
    // two channels a video: 3 posts left fit one video
    const result = await service.create(
      'org-1',
      body({ videos: [{ mediaId: 'm-1' }, { mediaId: 'm-2' }, { mediaId: 'm-3' }] }),
      3
    );
    expect(result).toMatchObject({ created: 1, skipped: 2, failed: 0 });
    expect(result.limitReached).toContain('monthly post limit');
    expect(postsService.createPost).toHaveBeenCalledTimes(1);
  });

  it('skips only the network a cap of the plan stops, and keeps going', async () => {
    const { service, postsService } = make();
    const cap = new HttpException({ message: "You've used your 50 X posts for this month." }, 402);
    postsService.createPost.mockImplementation(async (_org, request) => {
      if (request.posts.some((post: any) => post.integration.id === 'tt')) {
        throw cap;
      }
      return [{ postId: 'p-1' }];
    });
    const result = await service.create(
      'org-1',
      body({ videos: [{ mediaId: 'm-1' }, { mediaId: 'm-2' }, { mediaId: 'm-3' }] })
    );
    expect(result).toMatchObject({ created: 3, skipped: 0, failed: 0, limitReached: null });
    expect(result.cappedChannels).toEqual([
      { id: 'tt', name: 'Acme TikTok', error: "You've used your 50 X posts for this month." },
    ]);
    // every video still went to YouTube, TikTok is reported on each one
    expect(result.posts.map((post: any) => post.skippedChannels?.[0]?.id)).toEqual(['tt', 'tt', 'tt']);
    const channels = postsService.createPost.mock.calls.map((call: any) =>
      call[1].posts.map((post: any) => post.integration.id).join('+')
    );
    // the first video finds the cap and splits, the next ones skip TikTok
    expect(channels).toEqual(['yt+tt', 'yt', 'tt', 'yt', 'yt']);
  });

  it('skips a video whose only channel is capped', async () => {
    const { service, postsService } = make();
    postsService.createPost.mockRejectedValue(
      new HttpException({ message: 'X cap reached' }, 402)
    );
    const result = await service.create(
      'org-1',
      body({ channels: [{ id: 'tt' }], videos: [{ mediaId: 'm-1' }, { mediaId: 'm-2' }] })
    );
    expect(result).toMatchObject({ created: 0, skipped: 2 });
    expect(result.posts[1].error).toBe('X cap reached');
    expect(postsService.createPost).toHaveBeenCalledTimes(1);
  });

  it('reports a video that failed and keeps going', async () => {
    const { service, postsService, repo } = make();
    postsService.createPost
      .mockRejectedValueOnce(new BadRequestException('Integration with id yt not found'))
      .mockResolvedValueOnce([{ postId: 'p-2' }]);
    const result = await service.create('org-1', body());
    expect(result).toMatchObject({ created: 1, failed: 1, skipped: 0 });
    expect(result.posts[0]).toMatchObject({
      index: 0,
      name: 'First clip.mp4',
      status: 'failed',
      error: 'Integration with id yt not found',
    });
    expect(repo.finish).toHaveBeenCalled();
  });

  it('frees the request when nothing could be created', async () => {
    const { service, postsService, repo } = make();
    postsService.createPost.mockRejectedValue(new Error('boom'));
    const result = await service.create('org-1', body());
    expect(result).toMatchObject({ created: 0, failed: 2 });
    expect(repo.release).toHaveBeenCalled();
    expect(repo.finish).not.toHaveBeenCalled();
  });

  it('returns the first result when the same request comes again', async () => {
    const { service, postsService, repo } = make();
    repo.claim.mockResolvedValueOnce({
      claimed: false,
      existing: { status: 'done', result: JSON.stringify({ created: 2, posts: [] }) },
    });
    expect(await service.create('org-1', body())).toEqual({
      created: 2,
      posts: [],
      alreadyCreated: true,
    });
    expect(postsService.createPost).not.toHaveBeenCalled();
  });

  it('refuses the same request while it is still running', async () => {
    const { service, repo } = make();
    repo.claim.mockResolvedValueOnce({
      claimed: false,
      existing: { status: 'processing', result: null },
    });
    await expect(service.create('org-1', body())).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it('resumes a run that stopped half way without creating a video twice', async () => {
    const { service, postsService, repo } = make();
    repo.claim.mockResolvedValueOnce({
      claimed: true,
      progress: JSON.stringify({ posts: [{ index: 0, status: 'created' }] }),
    });
    const result = await service.create('org-1', body());
    expect(result).toMatchObject({ created: 2 });
    expect(postsService.createPost).toHaveBeenCalledTimes(1);
  });

  it('ends a resumed run whose interval start passed with what it created', async () => {
    const { service, postsService, repo } = make();
    repo.claim.mockResolvedValueOnce({
      claimed: true,
      progress: JSON.stringify({ posts: [{ index: 0, status: 'created' }] }),
    });
    const result = await service.create(
      'org-1',
      body({
        schedule: { mode: 'interval', start: '2026-10-31T08:00:00.000Z', every: 1, unit: 'days' },
      })
    );
    expect(result).toMatchObject({ created: 1, failed: 1 });
    expect(result.posts[1].error).toContain('at least 5 minutes from now');
    expect(postsService.createPost).not.toHaveBeenCalled();
    expect(repo.finish).toHaveBeenCalled();
    expect(repo.release).not.toHaveBeenCalled();
  });

  it('ends a resumed run that fails before creating anything with the saved progress', async () => {
    const { service, postsService, repo } = make();
    repo.claim.mockResolvedValueOnce({
      claimed: true,
      progress: JSON.stringify({ posts: [{ index: 0, status: 'created' }] }),
    });
    const result = await service.create('org-1', body({ channels: [{ id: 'off' }] }));
    expect(result).toMatchObject({ created: 1, failed: 1 });
    expect(result.posts[1].error).toContain('turned off');
    expect(repo.finish).toHaveBeenCalledWith('org-1', expect.any(String), expect.any(String));
    expect(repo.release).not.toHaveBeenCalled();
    expect(postsService.createPost).not.toHaveBeenCalled();
  });

  it('creates the request the checks returned, without mapping it again', async () => {
    const { service, postsService } = make();
    postsService.mapTypeToPost.mockImplementation(async (request) => ({
      ...request,
      checked: true,
    }));
    await service.create('org-1', body());
    expect(postsService.mapTypeToPost).toHaveBeenCalledTimes(2);
    expect(postsService.createPost.mock.calls[0][1].checked).toBe(true);
  });

  it('creates at the dates the preview showed while they are still free', async () => {
    const { service, postsService } = make();
    const dates = { yt: '2026-11-05T09:00:00.000Z', tt: '2026-11-05T12:00:00.000Z' };
    const result = await service.create(
      'org-1',
      body({ videos: [{ mediaId: 'm-1', dates }] })
    );
    expect(result.created).toBe(1);
    const request = postsService.createPost.mock.calls[0][1];
    expect(request.posts.map((post: any) => post.date)).toEqual([dates.yt, dates.tt]);
    expect(request.date).toBe(dates.yt);
  });

  it('refuses a preview date taken since, or used twice, or too close', async () => {
    const { service, postsService } = make();
    postsService.getPublishDatesOfIntegrations.mockResolvedValue([
      { integrationId: 'yt', publishDate: new Date('2026-11-05T09:00:00.000Z') },
    ]);
    const preview = await service.preview(
      'org-1',
      body({
        videos: [
          { mediaId: 'm-1', dates: { yt: '2026-11-05T09:00:00.000Z', tt: '2026-11-06T12:00:00.000Z' } },
          { mediaId: 'm-2', dates: { yt: '2026-11-06T09:00:00.000Z', tt: '2026-11-06T12:00:00.000Z' } },
          { mediaId: 'm-3', dates: { yt: '2026-11-01T10:02:00.000Z', tt: 'soon' } },
        ],
      })
    );
    const errors = preview.posts.map((post) =>
      post.channels.map((channel) => channel.errors[0]?.message || '')
    );
    expect(errors[0][0]).toContain('taken since the preview');
    expect(errors[0][1]).toBe('');
    expect(errors[1]).toEqual(['', expect.stringContaining('taken since the preview')]);
    expect(errors[2][0]).toContain('less than 5 minutes away');
    expect(errors[2][1]).toContain("can't be read");
    await expect(
      service.create('org-1', body({ videos: [{ mediaId: 'm-1', dates: { yt: '2026-11-05T09:00:00.000Z', tt: '2026-11-06T12:00:00.000Z' } }] }))
    ).rejects.toThrow('1 of 1 videos need a fix');
    expect(postsService.createPost).not.toHaveBeenCalled();
  });

  it('keeps every N hours or days within a year', async () => {
    const { service } = make();
    const preview = await service.preview(
      'org-1',
      body({
        schedule: { mode: 'interval', start: '2026-11-02T08:00:00.000Z', every: 400, unit: 'days' },
      })
    );
    expect(preview.posts[0].channels[0].errors).toEqual([]);
    expect(preview.posts[1].channels[0].errors[0].message).toContain('more than a year');
    expect(preview.invalid).toBe(1);
    await expect(
      service.preview(
        'org-1',
        body({ schedule: { mode: 'slots', start: '2028-01-01T00:00:00.000Z' } })
      )
    ).rejects.toThrow('within the next year');
  });

  it('refuses an interval that starts in less than 5 minutes', async () => {
    const { service } = make();
    await expect(
      service.preview(
        'org-1',
        body({
          schedule: { mode: 'interval', start: '2026-11-01T10:03:00.000Z', every: 1, unit: 'days' },
        })
      )
    ).rejects.toThrow('at least 5 minutes from now');
  });

  it('refuses to schedule on a network that needs a setting picked in the composer', async () => {
    const { service, integrationManager } = make();
    class NeedsChannel {
      @IsDefined()
      @IsString()
      @ComposerOnly()
      channel: string;
    }
    integrationManager.getSocialIntegration.mockImplementation((identifier: string) =>
      identifier === 'tiktok' ? { dto: NeedsChannel } : undefined
    );
    const schemas = jest
      .spyOn(require('@gitroom/nestjs-libraries/chat/validation.schemas.helper'), 'getValidationSchemas')
      .mockReturnValue({ NeedsChannel: { properties: { channel: { type: 'string' } }, required: ['channel'] } });
    await expect(service.preview('org-1', body())).rejects.toThrow('Add the videos as drafts');
    await expect(service.preview('org-1', body({ type: 'draft' }))).resolves.toMatchObject({ valid: 2 });
    schemas.mockRestore();
  });

  it('tells where a request stands, keyed like create', async () => {
    const { service, repo } = make();
    const key = bulkVideosHash(body());
    expect(await service.status('org-1', body())).toEqual({ key, status: 'none' });
    expect(repo.get).toHaveBeenCalledWith('org-1', key);
    repo.get.mockResolvedValueOnce({ status: 'processing', result: null });
    expect(await service.statusOf('org-1', key)).toEqual({ status: 'running' });
    repo.get.mockResolvedValueOnce({ status: 'done', result: JSON.stringify({ created: 2 }) });
    expect(await service.statusOf('org-1', key)).toEqual({
      status: 'done',
      result: { created: 2 },
    });
  });

  it('reads a status by key only within the organization, and only a real key', async () => {
    const { service, repo } = make();
    const key = bulkVideosHash(body());
    await service.statusOf('org-2', key);
    expect(repo.get).toHaveBeenCalledWith('org-2', key);
    await expect(service.statusOf('org-1', '../x')).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(repo.get).toHaveBeenCalledTimes(1);
  });

  it('lists the channels that take a video, with their settings', async () => {
    const { service, integrationManager } = make();
    integrationManager.getSocialIntegration.mockImplementation((identifier: string) => ({
      checkValidity: async () => (identifier === 'tiktok' ? 'Only photos' : true),
    }));
    const channels = await service.channels('org-1');
    expect(channels.map((p) => [p.id, p.acceptsVideo])).toEqual([
      ['yt', true],
      ['tt', false],
    ]);
  });
});
