// the bulk video service pulls in every social provider, the spec only needs
// its shape
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.bulk.videos.service',
  () => ({ PostsBulkVideosService: class {} })
);

import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StudioScheduleService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.schedule.service';
import { StudioScheduleRendersDto } from '@gitroom/nestjs-libraries/dtos/studio/studio.schedule.dto';

const renderA = '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f';
const renderB = '9b2f4c1d-3e5a-4b6c-8d7e-0f1a2b3c4d5e';

describe('StudioScheduleService', () => {
  let repository: { getRendersToSchedule: jest.Mock };
  let bulk: { status: jest.Mock; preview: jest.Mock; create: jest.Mock };
  let service: StudioScheduleService;
  const body = {
    renderIds: [renderB, renderA, renderB],
    integrations: [{ id: 'channel-1', settings: { title: 'Hi' } }],
    content: 'Out now',
  };

  beforeEach(() => {
    repository = {
      getRendersToSchedule: jest.fn().mockResolvedValue([
        { id: renderA, mediaId: 'media-a' },
        { id: renderB, mediaId: 'media-b' },
      ]),
    };
    bulk = {
      status: jest.fn().mockResolvedValue({ key: 'k', status: 'none' }),
      preview: jest
        .fn()
        .mockResolvedValue({ invalid: 0, posts: [], total: 2, valid: 2 }),
      create: jest.fn().mockResolvedValue({ created: 2, limitReached: null }),
    };
    service = new StudioScheduleService(repository as any, bulk as any);
  });

  it('reads only finished renders of the workspace, each once', async () => {
    await service.scheduleRenders('org-1', body, 10);
    expect(repository.getRendersToSchedule).toHaveBeenCalledWith('org-1', [
      renderB,
      renderA,
    ]);
  });

  it('refuses renders of another workspace or not finished', async () => {
    repository.getRendersToSchedule.mockResolvedValue([
      { id: renderA, mediaId: 'media-a' },
    ]);
    await expect(
      service.scheduleRenders('org-1', body, 10)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bulk.preview).not.toHaveBeenCalled();
    expect(bulk.create).not.toHaveBeenCalled();
  });

  it('schedules one post a video in the free slots of each channel, with the posts left this month', async () => {
    const actor: any = { type: 'user', userId: 'u-1' };
    expect(await service.scheduleRenders('org-1', body, 3, actor)).toEqual({
      created: 2,
      limitReached: null,
    });
    const request = bulk.create.mock.calls[0][1];
    expect(request).toMatchObject({
      type: 'schedule',
      schedule: { mode: 'slots' },
      caption: 'Out now',
      channels: [{ id: 'channel-1', settings: { title: 'Hi' } }],
      // in the order the renders were picked
      videos: [{ mediaId: 'media-b' }, { mediaId: 'media-a' }],
    });
    expect(bulk.create).toHaveBeenCalledWith('org-1', request, 3, actor);
    expect(bulk.preview).toHaveBeenCalledWith('org-1', request, 3);
  });

  it('asks the same request every time on one day, so a double click posts once', async () => {
    await service.scheduleRenders('org-1', body, null);
    await service.scheduleRenders('org-1', body, null);
    expect(bulk.create.mock.calls[0][1]).toEqual(bulk.create.mock.calls[1][1]);
  });

  it('returns the result of a request sent before without checking it again', async () => {
    bulk.status.mockResolvedValue({ key: 'k', status: 'done' });
    bulk.create.mockResolvedValue({ created: 2, alreadyCreated: true });
    expect(await service.scheduleRenders('org-1', body, 0)).toEqual({
      created: 2,
      alreadyCreated: true,
    });
    expect(bulk.preview).not.toHaveBeenCalled();
  });

  it('reads where a request stands by the same request', async () => {
    await service.status('org-1', body);
    await service.scheduleRenders('org-1', body, null);
    expect(bulk.status.mock.calls[0][1]).toEqual(bulk.create.mock.calls[0][1]);
  });

  it('adds drafts when asked', async () => {
    await service.scheduleRenders('org-1', { ...body, type: 'draft' }, null);
    expect(bulk.create.mock.calls[0][1].type).toBe('draft');
  });

  it('lists every problem of the preview and creates nothing', async () => {
    bulk.preview.mockResolvedValue({
      invalid: 1,
      posts: [
        { errors: [], channels: [{ name: 'YouTube', errors: [] }] },
        {
          errors: [{ message: 'This video is no longer in your media library.' }],
          channels: [
            {
              name: 'YouTube',
              errors: [{ message: 'Some required settings are missing.' }],
            },
          ],
        },
      ],
    });
    const error = await service
      .scheduleRenders('org-1', body, 10)
      .catch((err) => err);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse().message).toEqual([
      'Video 2: This video is no longer in your media library.',
      'Video 2: YouTube: Some required settings are missing.',
    ]);
    expect(bulk.create).not.toHaveBeenCalled();
  });
});

describe('StudioScheduleRendersDto', () => {
  const check = async (value: Record<string, unknown>) =>
    validate(plainToInstance(StudioScheduleRendersDto, value), {
      whitelist: true,
    });
  const valid = {
    renderIds: [renderA],
    integrations: [{ id: 'channel-1' }],
    content: 'Hello',
  };

  it('accepts renders, channels and a text', async () => {
    expect(await check(valid)).toHaveLength(0);
  });

  it.each([
    ['no renders', { ...valid, renderIds: [] }],
    ['more than 50 renders', { ...valid, renderIds: new Array(51).fill(renderA) }],
    ['a render id that is not one', { ...valid, renderIds: ['../x'] }],
    ['no channels', { ...valid, integrations: [] }],
    [
      'more than 20 channels',
      { ...valid, integrations: new Array(21).fill({ id: 'c' }) },
    ],
    ['a text over the caption limit', { ...valid, content: 'x'.repeat(10001) }],
    ['an unknown type', { ...valid, type: 'publish-now' }],
  ])('refuses %s', async (_name, value) => {
    expect((await check(value)).length).toBeGreaterThan(0);
  });
});
