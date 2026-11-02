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
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  StudioPosition,
  StudioTextStyle,
  studioPositions,
  studioTextStyles,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';
import {
  StudioMediaDto,
  say,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.media.dto';
import { StudioMusicDto } from '@gitroom/nestjs-libraries/dtos/studio/studio.music.dto';

// The xfade transitions offered between two slides, "none" cuts
export const studioTransitions = [
  'fade',
  'slideleft',
  'wipeleft',
  'smoothleft',
  'circleopen',
  'none',
] as const;
export type StudioTransition = (typeof studioTransitions)[number];
export const STUDIO_MIN_SLIDES = 2;
export const STUDIO_MAX_SLIDES = 10;
export const STUDIO_SLIDE_MIN_SECONDS = 1.5;
export const STUDIO_SLIDE_MAX_SECONDS = 5;

const SLIDES = say(
  `Add ${STUDIO_MIN_SLIDES} to ${STUDIO_MAX_SLIDES} pictures`
);
const SLIDES_MANY = say(`A slideshow has ${STUDIO_MAX_SLIDES} pictures at most`);
const SLIDE_TEXT = say('The text of a slide is 120 characters at most');
const SLIDE_SECONDS = say(
  `Show each picture for ${STUDIO_SLIDE_MIN_SECONDS} to ${STUDIO_SLIDE_MAX_SECONDS} seconds`
);
const TRANSITION = say('Pick one of the transitions');
const PAN = say('Turn the slow pan on or off');
const STYLE = say('Pick one of the text styles');
const POSITION = say('Pick where the text sits');
const MUSIC = say('Add the music again');

export class StudioSlideDto extends StudioMediaDto {
  static studioLabel = 'Slide';

  @IsOptional()
  @IsString(SLIDE_TEXT)
  @MaxLength(120, SLIDE_TEXT)
  text?: string;

  @IsDefined(SLIDE_SECONDS)
  @IsNumber({ allowNaN: false, allowInfinity: false }, SLIDE_SECONDS)
  @Min(STUDIO_SLIDE_MIN_SECONDS, SLIDE_SECONDS)
  @Max(STUDIO_SLIDE_MAX_SECONDS, SLIDE_SECONDS)
  seconds: number;
}

// "Image slideshow": pictures one after the other, each slowly panning, with
// a line of text each and a transition between them
export class ImageSlideshowDto {
  @IsDefined(SLIDES)
  @IsArray(SLIDES)
  @ArrayMinSize(STUDIO_MIN_SLIDES, SLIDES)
  @ArrayMaxSize(STUDIO_MAX_SLIDES, SLIDES_MANY)
  @Type(() => StudioSlideDto)
  @ValidateNested({ each: true })
  slides: StudioSlideDto[];

  @IsOptional()
  @IsIn(studioTransitions, TRANSITION)
  transition?: StudioTransition;

  // the slow pan across each picture, on unless switched off
  @IsOptional()
  @IsBoolean(PAN)
  pan?: boolean;

  @IsOptional()
  @IsIn(studioTextStyles, STYLE)
  style?: StudioTextStyle;

  @IsOptional()
  @IsIn(studioPositions, POSITION)
  position?: StudioPosition;

  @IsOptional()
  @Type(() => StudioMusicDto)
  @ValidateNested(MUSIC)
  music?: StudioMusicDto;
}
