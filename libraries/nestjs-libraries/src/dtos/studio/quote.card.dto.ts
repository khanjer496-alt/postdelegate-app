import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  STUDIO_MAX_SOURCE_SECONDS,
  StudioFocusDto,
  StudioTextStyle,
  studioTextStyles,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';
import { say } from '@gitroom/nestjs-libraries/dtos/studio/studio.media.dto';
import { StudioMusicDto } from '@gitroom/nestjs-libraries/dtos/studio/studio.music.dto';

export const STUDIO_QUOTE_MIN_SECONDS = 5;
export const STUDIO_QUOTE_MAX_SECONDS = 15;
export const STUDIO_QUOTE_COLOR = '#111111';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const QUOTE = say('Write the quote');
const QUOTE_LONG = say('The quote is 300 characters at most');
const AUTHOR = say('The author is 80 characters at most');
const BACKGROUND = say('Pick a background colour, picture or video');
const BACKGROUND_COLOR = say('Pick the background colour with the colour picker');
const BACKGROUND_MEDIA = say('Pick the background picture or video again');
const FOCUS = say('Drag the crop back onto the picture');
const START = say(
  `Start the video within its first ${STUDIO_MAX_SOURCE_SECONDS / 60} minutes`
);
const SECONDS = say(
  `Make the video ${STUDIO_QUOTE_MIN_SECONDS} to ${STUDIO_QUOTE_MAX_SECONDS} seconds long`
);
const STYLE = say('Pick one of the text styles');
const TEXT_COLOR = say('Pick the text colour with the colour picker');
const DIM = say('Turn darkening the background on or off');
const MUSIC = say('Add the music again');

// A plain colour, or a picture or video of the media library when a media
// is picked
export class StudioBackgroundDto {
  @IsOptional()
  @Matches(HEX_COLOR, BACKGROUND_COLOR)
  color?: string;

  @IsOptional()
  @IsUUID(undefined, BACKGROUND_MEDIA)
  mediaId?: string;

  @IsOptional()
  @IsString(BACKGROUND_MEDIA)
  @MaxLength(2000, BACKGROUND_MEDIA)
  path?: string;

  @IsOptional()
  @Type(() => StudioFocusDto)
  @ValidateNested(FOCUS)
  focus?: StudioFocusDto;

  // where a video starts, in seconds
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false }, START)
  @Min(0, START)
  @Max(STUDIO_MAX_SOURCE_SECONDS, START)
  start?: number;
}

// "Quote card": a quote appearing word by word with its author, over a
// colour, a picture or a video
export class QuoteCardDto {
  @IsDefined(QUOTE)
  @IsString(QUOTE)
  @MinLength(1, QUOTE)
  @MaxLength(300, QUOTE_LONG)
  quote: string;

  @IsOptional()
  @IsString(AUTHOR)
  @MaxLength(80, AUTHOR)
  author?: string;

  @IsDefined(BACKGROUND)
  @Type(() => StudioBackgroundDto)
  @ValidateNested(BACKGROUND)
  background: StudioBackgroundDto;

  @IsDefined(SECONDS)
  @IsNumber({ allowNaN: false, allowInfinity: false }, SECONDS)
  @Min(STUDIO_QUOTE_MIN_SECONDS, SECONDS)
  @Max(STUDIO_QUOTE_MAX_SECONDS, SECONDS)
  seconds: number;

  @IsOptional()
  @IsIn(studioTextStyles, STYLE)
  style?: StudioTextStyle;

  @IsOptional()
  @Matches(HEX_COLOR, TEXT_COLOR)
  textColor?: string;

  // darkens a picture or video so the text stays readable, on by default
  @IsOptional()
  @IsBoolean(DIM)
  dim?: boolean;

  @IsOptional()
  @Type(() => StudioMusicDto)
  @ValidateNested(MUSIC)
  music?: StudioMusicDto;
}
