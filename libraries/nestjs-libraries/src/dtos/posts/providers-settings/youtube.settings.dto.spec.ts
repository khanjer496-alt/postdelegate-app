import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { getValidationSchemas } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import { YoutubeSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/youtube.settings.dto';

dayjs.extend(utc);

const settings = (overrides: Record<string, any> = {}) =>
  plainToInstance(YoutubeSettingsDto, {
    title: 'My video',
    type: 'public',
    ...overrides,
  });

const errorsOf = async (overrides: Record<string, any> = {}) =>
  (await validate(settings(overrides))).flatMap((e) =>
    Object.values(e.constraints || {})
  );

describe('YoutubeSettingsDto', () => {
  it('accepts settings saved before publishAt and containsSyntheticMedia existed', async () => {
    expect(
      await errorsOf({
        selfDeclaredMadeForKids: 'no',
        __validationOperation: 'schedule',
        __validationDate: dayjs
          .utc()
          .add(1, 'day')
          .format('YYYY-MM-DDTHH:mm:ss'),
      })
    ).toEqual([]);
  });

  describe('containsSyntheticMedia', () => {
    it('accepts yes and no', async () => {
      expect(await errorsOf({ containsSyntheticMedia: 'yes' })).toEqual([]);
      expect(await errorsOf({ containsSyntheticMedia: 'no' })).toEqual([]);
    });

    it('rejects anything else', async () => {
      expect(await errorsOf({ containsSyntheticMedia: 'true' })).toHaveLength(
        1
      );
    });
  });

  describe('publishAt', () => {
    const postDate = dayjs.utc().add(1, 'day');

    it('accepts a time after the post date', async () => {
      expect(
        await errorsOf({
          publishAt: postDate.add(2, 'hour').format(),
          __validationOperation: 'schedule',
          // post dates come without a zone and are UTC
          __validationDate: postDate.format('YYYY-MM-DDTHH:mm:ss'),
        })
      ).toEqual([]);
    });

    const formatMessage =
      'Pick a valid date and time for YouTube to publish the video, like 2026-11-05T15:00:00Z.';

    it('rejects values that are not RFC 3339 dates, on every operation', async () => {
      for (const publishAt of [
        'tomorrow',
        // valid ISO 8601 that dayjs reads wrongly or not at all
        '20261105T150000Z',
        '2026-W45-1',
        '2026-309',
        // no zone, or a date that does not exist
        '2026-11-05T15:00:00',
        '2026-02-30T15:00:00Z',
        '2026-11-05T24:00:00Z',
      ]) {
        for (const __validationOperation of ['schedule', 'draft', undefined]) {
          expect(await errorsOf({ publishAt, __validationOperation })).toEqual([
            formatMessage,
          ]);
        }
      }
    });

    it('accepts RFC 3339 with or without seconds, fractions and offsets', async () => {
      const later = postDate.add(1, 'day');
      for (const publishAt of [
        later.format('YYYY-MM-DDTHH:mm[Z]'),
        later.format('YYYY-MM-DDTHH:mm:ss[Z]'),
        later.toISOString(),
        later.utcOffset(120).format('YYYY-MM-DDTHH:mm:ssZ'),
      ]) {
        expect(
          await errorsOf({
            publishAt,
            __validationOperation: 'schedule',
            __validationDate: postDate.format('YYYY-MM-DDTHH:mm:ss'),
          })
        ).toEqual([]);
      }
    });

    it('rejects a time in the past', async () => {
      expect(
        await errorsOf({
          publishAt: dayjs.utc().subtract(1, 'hour').format(),
          __validationOperation: 'now',
        })
      ).toEqual([
        'The time YouTube makes the video public must be in the future.',
      ]);
    });

    it('rejects a time before or at the post date', async () => {
      const message =
        'The time YouTube makes the video public must be after the post is published, the video is uploaded at the post time.';
      for (const publishAt of [
        postDate.subtract(1, 'hour').format(),
        postDate.format(),
      ]) {
        expect(
          await errorsOf({
            publishAt,
            __validationOperation: 'schedule',
            __validationDate: postDate.format('YYYY-MM-DDTHH:mm:ss'),
          })
        ).toEqual([message]);
      }
    });

    it('skips the time rules for drafts, published posts and the client form', async () => {
      const past = dayjs.utc().subtract(1, 'day').format();
      for (const __validationOperation of ['draft', 'update', undefined]) {
        expect(
          await errorsOf({ publishAt: past, __validationOperation })
        ).toEqual([]);
      }
      // an update of a post that already went out
      expect(
        await errorsOf({
          publishAt: past,
          __validationOperation: 'update',
          __validationDate: dayjs
            .utc()
            .subtract(2, 'day')
            .format('YYYY-MM-DDTHH:mm:ss'),
        })
      ).toEqual([]);
    });

    it('checks an update of a post that has not gone out yet', async () => {
      expect(
        await errorsOf({
          publishAt: postDate.subtract(1, 'hour').format(),
          __validationOperation: 'update',
          __validationDate: postDate.format('YYYY-MM-DDTHH:mm:ss'),
        })
      ).toEqual([
        'The time YouTube makes the video public must be after the post is published, the video is uploaded at the post time.',
      ]);
    });
  });
});

describe('YoutubeSettingsDto schema for the public API and MCP', () => {
  it('describes publishAt and containsSyntheticMedia', () => {
    const schema = getValidationSchemas().YoutubeSettingsDto as any;
    expect(schema.properties.publishAt).toMatchObject({
      type: 'string',
      format: 'date-time',
    });
    expect(schema.properties.publishAt.description).toContain('private');
    expect(schema.properties.containsSyntheticMedia).toMatchObject({
      enum: ['yes', 'no'],
    });
    expect(schema.required).not.toContain('publishAt');
    expect(schema.required).not.toContain('containsSyntheticMedia');
  });
});
