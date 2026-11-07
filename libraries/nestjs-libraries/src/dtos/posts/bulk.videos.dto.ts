import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
  ValidateNested,
  ValidationOptions,
} from 'class-validator';
import { Type } from 'class-transformer';

export const BULK_VIDEO_LIMIT = 50;
export const BULK_VIDEO_CHANNEL_LIMIT = 20;
export const BULK_VIDEO_CAPTION_LIMIT = 10_000;
// the settings of a channel, or of one video, as JSON
export const BULK_VIDEO_SETTINGS_LIMIT = 5_000;

// an object no longer than `max` characters as JSON
const MaxJsonLength = (max: number, options?: ValidationOptions) =>
  ValidateBy(
    {
      name: 'maxJsonLength',
      validator: {
        validate: (value) => {
          try {
            return JSON.stringify(value ?? null).length <= max;
          } catch (err) {
            return false;
          }
        },
        defaultMessage: (args) =>
          `${args?.property} must be shorter than ${max} characters`,
      },
    },
    options
  );

export class BulkVideoChannelDto {
  @IsDefined()
  @IsString()
  id: string;

  // the channel settings every video gets, like a YouTube title; text values
  // can hold {filename}
  @IsOptional()
  @IsObject()
  @MaxJsonLength(BULK_VIDEO_SETTINGS_LIMIT)
  settings?: Record<string, any>;
}

export class BulkVideoItemDto {
  // a video already uploaded to the media library
  @IsDefined()
  @IsString()
  mediaId: string;

  // the text of this video, the shared caption when missing
  @IsOptional()
  @IsString()
  @MaxLength(BULK_VIDEO_CAPTION_LIMIT)
  caption?: string;

  // settings of this video only, by channel id, over the channel settings
  @IsOptional()
  @IsObject()
  @MaxJsonLength(BULK_VIDEO_SETTINGS_LIMIT)
  settings?: Record<string, Record<string, any>>;

  // the date of this video on each channel, by channel id, as the preview
  // showed it; kept when it is still free
  @IsOptional()
  @IsObject()
  @MaxJsonLength(BULK_VIDEO_SETTINGS_LIMIT)
  dates?: Record<string, string>;
}

export class BulkVideoScheduleDto {
  // slots: the next free posting times of each channel
  // interval: one post every N hours or days from the start
  @IsDefined()
  @IsIn(['slots', 'interval'])
  mode: 'slots' | 'interval';

  @IsDefined()
  @IsDateString()
  start: string;

  @ValidateIf((o) => o.mode === 'interval')
  @IsInt()
  @Min(1)
  @Max(720)
  every?: number;

  @ValidateIf((o) => o.mode === 'interval')
  @IsIn(['hours', 'days'])
  unit?: 'hours' | 'days';

  // keeps "every day at 9:00" at 9:00 across daylight saving changes
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class BulkVideoPostsDto {
  @IsDefined()
  @IsIn(['schedule', 'draft'])
  type: 'schedule' | 'draft';

  @IsDefined()
  @ValidateNested()
  @Type(() => BulkVideoScheduleDto)
  schedule: BulkVideoScheduleDto;

  // the caption of the videos without one of their own, can hold {filename}
  @IsOptional()
  @IsString()
  @MaxLength(BULK_VIDEO_CAPTION_LIMIT)
  caption?: string;

  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_VIDEO_CHANNEL_LIMIT)
  @ValidateNested({ each: true })
  @Type(() => BulkVideoChannelDto)
  channels: BulkVideoChannelDto[];

  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_VIDEO_LIMIT)
  @ValidateNested({ each: true })
  @Type(() => BulkVideoItemDto)
  videos: BulkVideoItemDto[];
}
