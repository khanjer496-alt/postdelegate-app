import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  STUDIO_MAX_SOURCE_SECONDS,
  StudioTextStyle,
  studioTextStyles,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';
import {
  StudioMediaDto,
  say,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.media.dto';
import { StudioMusicDto } from '@gitroom/nestjs-libraries/dtos/studio/studio.music.dto';

export const STUDIO_COMPARE_MIN_SECONDS = 2;
export const STUDIO_COMPARE_MAX_SECONDS = 30;

const BEFORE = say('Pick the before picture or video');
const AFTER = say('Pick the after picture or video');
const LABEL = say('A label is 40 characters at most');
const START = say(
  `Start the video within its first ${STUDIO_MAX_SOURCE_SECONDS / 60} minutes`
);
const LAYOUT = say('Pick stacked or wipe');
const SECONDS = say(
  `Make the video ${STUDIO_COMPARE_MIN_SECONDS} to ${STUDIO_COMPARE_MAX_SECONDS} seconds long`
);
const STYLE = say('Pick one of the text styles');
const SOUND = say('Choose whether the sound is on or muted');
const MUSIC = say('Add the music again');

export class StudioCompareSideDto extends StudioMediaDto {
  @IsOptional()
  @IsString(LABEL)
  @MaxLength(40, LABEL)
  label?: string;

  // where a video starts, in seconds
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false }, START)
  @Min(0, START)
  @Max(STUDIO_MAX_SOURCE_SECONDS, START)
  start?: number;
}

// the two sides name themselves in the messages of their fields
export class StudioBeforeDto extends StudioCompareSideDto {
  static studioLabel = 'Before';
}

export class StudioAfterDto extends StudioCompareSideDto {
  static studioLabel = 'After';
}

// "Before/after": two pictures or videos, one above the other or the second
// wiping over the first, each with its label
export class BeforeAfterDto {
  @IsDefined(BEFORE)
  @Type(() => StudioBeforeDto)
  @ValidateNested(BEFORE)
  before: StudioBeforeDto;

  @IsDefined(AFTER)
  @Type(() => StudioAfterDto)
  @ValidateNested(AFTER)
  after: StudioAfterDto;

  // "stack" puts them one above the other, "wipe" reveals the second over
  // the first half way through
  @IsOptional()
  @IsIn(['stack', 'wipe'], LAYOUT)
  layout?: 'stack' | 'wipe';

  @IsDefined(SECONDS)
  @IsNumber({ allowNaN: false, allowInfinity: false }, SECONDS)
  @Min(STUDIO_COMPARE_MIN_SECONDS, SECONDS)
  @Max(STUDIO_COMPARE_MAX_SECONDS, SECONDS)
  seconds: number;

  @IsOptional()
  @IsIn(studioTextStyles, STYLE)
  style?: StudioTextStyle;

  // the sound of the first video that has one, unless muted
  @IsOptional()
  @IsBoolean(SOUND)
  mute?: boolean;

  @IsOptional()
  @Type(() => StudioMusicDto)
  @ValidateNested(MUSIC)
  music?: StudioMusicDto;
}
