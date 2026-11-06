import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import {
  BULK_VIDEO_LIMIT,
  BulkVideoPostsDto,
} from '@gitroom/nestjs-libraries/dtos/posts/bulk.videos.dto';

// the property paths of every error, nested ones as schedule.every
const paths = (errors: ValidationError[], parent = ''): string[] =>
  errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    return error.children?.length ? paths(error.children, path) : [path];
  });

const check = async (body: Record<string, any>) =>
  paths(await validate(plainToInstance(BulkVideoPostsDto, body))).sort();

const valid = {
  type: 'schedule',
  schedule: { mode: 'slots', start: '2026-11-03T09:00:00.000Z' },
  caption: 'New video: {filename}',
  channels: [{ id: 'yt', settings: { title: '{filename}', type: 'public' } }],
  videos: [{ mediaId: 'm-1' }, { mediaId: 'm-2', caption: 'Own caption' }],
};

describe('BulkVideoPostsDto', () => {
  it('accepts a slots schedule without an interval', async () => {
    expect(await check(valid)).toEqual([]);
  });

  it('accepts drafts and an interval schedule', async () => {
    expect(
      await check({
        ...valid,
        type: 'draft',
        schedule: {
          mode: 'interval',
          start: '2026-11-03T09:00:00.000Z',
          every: 6,
          unit: 'hours',
          timezone: 'Europe/London',
        },
      })
    ).toEqual([]);
  });

  it('needs the interval of an interval schedule', async () => {
    expect(
      await check({
        ...valid,
        schedule: { mode: 'interval', start: '2026-11-03T09:00:00.000Z', every: 0, unit: 'weeks' },
      })
    ).toEqual(['schedule.every', 'schedule.unit']);
  });

  it('refuses an unknown type, mode and date', async () => {
    expect(
      await check({
        ...valid,
        type: 'now',
        schedule: { mode: 'random', start: 'tomorrow' },
      })
    ).toEqual(['schedule.mode', 'schedule.start', 'type']);
  });

  it(`takes 1 to ${BULK_VIDEO_LIMIT} videos and at least one channel`, async () => {
    expect(await check({ ...valid, videos: [], channels: [] })).toEqual([
      'channels',
      'videos',
    ]);
    expect(
      await check({
        ...valid,
        videos: Array.from({ length: BULK_VIDEO_LIMIT + 1 }, (_, i) => ({
          mediaId: `m-${i}`,
        })),
      })
    ).toEqual(['videos']);
  });

  it('checks each video and channel', async () => {
    expect(
      await check({
        ...valid,
        channels: [{ settings: 'title' }],
        videos: [{ caption: 3, settings: [] }],
      })
    ).toEqual([
      'channels.0.id',
      'channels.0.settings',
      'videos.0.caption',
      'videos.0.mediaId',
      'videos.0.settings',
    ]);
  });

  it('caps the size of settings and dates', async () => {
    const big = { title: 'a'.repeat(5_000) };
    expect(
      await check({
        ...valid,
        channels: [{ id: 'yt', settings: big }],
        videos: [{ mediaId: 'm-1', settings: { yt: big }, dates: { yt: 'a'.repeat(5_000) } }],
      })
    ).toEqual(['channels.0.settings', 'videos.0.dates', 'videos.0.settings']);
  });

  it('takes the dates the preview showed', async () => {
    expect(
      await check({
        ...valid,
        videos: [{ mediaId: 'm-1', dates: { yt: '2026-11-03T09:00:00.000Z' } }],
      })
    ).toEqual([]);
    expect(
      await check({ ...valid, videos: [{ mediaId: 'm-1', dates: ['x'] }] })
    ).toEqual(['videos.0.dates']);
  });

  it('refuses a caption longer than any network takes', async () => {
    expect(await check({ ...valid, caption: 'a'.repeat(10_001) })).toEqual([
      'caption',
    ]);
  });
});
