import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  STUDIO_MAX_SECONDS,
  StudioTextStyle,
  StudioTrimDto,
  studioTextStyles,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';
import {
  StudioMediaDto,
  say,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.media.dto';
import { StudioMusicDto } from '@gitroom/nestjs-libraries/dtos/studio/studio.music.dto';

export const STUDIO_MIN_LIST_ITEMS = 3;
export const STUDIO_MAX_LIST_ITEMS = 7;
// how long a picture of the list stays when nothing is picked
export const STUDIO_LIST_ITEM_SECONDS = 3;

const TITLE = say('Add a title');
const TITLE_LONG = say('The title is 80 characters at most');
const ITEMS = say(
  `Add ${STUDIO_MIN_LIST_ITEMS} to ${STUDIO_MAX_LIST_ITEMS} pictures or clips`
);
const ITEMS_MANY = say(`A list has ${STUDIO_MAX_LIST_ITEMS} items at most`);
const LABEL = say('Add a label');
const LABEL_LONG = say('A label is 60 characters at most');
const TRIM = say('Trim the clip again');
const SECONDS = say(`Show it for 1 to ${STUDIO_MAX_SECONDS} seconds`);
const COUNTDOWN = say('Pick how the numbers count');
const STYLE = say('Pick one of the text styles');
const SOUND = say('Choose whether the sound is on or muted');
const MUSIC = say('Add the music again');

export class StudioListItemDto extends StudioMediaDto {
  static studioLabel = 'Item';

  @IsDefined(LABEL)
  @IsString(LABEL)
  @MinLength(1, LABEL)
  @MaxLength(60, LABEL_LONG)
  label: string;

  // the part of a video that plays
  @IsOptional()
  @Type(() => StudioTrimDto)
  @ValidateNested(TRIM)
  trim?: StudioTrimDto;

  // how long a picture stays, or a video without a trim
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false }, SECONDS)
  @Min(1, SECONDS)
  @Max(STUDIO_MAX_SECONDS, SECONDS)
  seconds?: number;
}

// "Top-N list": a title over 3 to 7 pictures or clips one after the other,
// each numbered with its label
export class TopNListDto {
  @IsDefined(TITLE)
  @IsString(TITLE)
  @MinLength(1, TITLE)
  @MaxLength(80, TITLE_LONG)
  title: string;

  @IsDefined(ITEMS)
  @IsArray(ITEMS)
  @ArrayMinSize(STUDIO_MIN_LIST_ITEMS, ITEMS)
  @ArrayMaxSize(STUDIO_MAX_LIST_ITEMS, ITEMS_MANY)
  @Type(() => StudioListItemDto)
  @ValidateNested({ each: true })
  items: StudioListItemDto[];

  // numbers counting down to #1 (the default) or up from #1
  @IsOptional()
  @IsBoolean(COUNTDOWN)
  countdown?: boolean;

  @IsOptional()
  @IsIn(studioTextStyles, STYLE)
  style?: StudioTextStyle;

  // the sound of the clips, unless muted
  @IsOptional()
  @IsBoolean(SOUND)
  mute?: boolean;

  @IsOptional()
  @Type(() => StudioMusicDto)
  @ValidateNested(MUSIC)
  music?: StudioMusicDto;
}
