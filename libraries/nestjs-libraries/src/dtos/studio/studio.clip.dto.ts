// The browser reads this file for its constants, on a direct load of /studio
// before anything else installed the polyfill @Type needs
import 'reflect-metadata';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
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

// The pieces every Studio template is built from. Times are seconds on the
// source video; the template maps them to the output timeline (trim, speed)

// Every style is a bundled OFL font, the same file the preview loads
export const studioTextStyles = ['bold', 'impact', 'clean', 'classic'] as const;
export type StudioTextStyle = (typeof studioTextStyles)[number];

// The font of each style: "family" is the name libass and the browser match,
// "file" the file in deploy/postdelegate/fonts and public/fonts/studio
export const studioFonts: Record<
  StudioTextStyle,
  { family: string; bold: boolean; file: string }
> = {
  bold: {
    family: 'Montserrat ExtraBold',
    bold: false,
    file: 'Montserrat-ExtraBold.ttf',
  },
  impact: { family: 'Anton', bold: false, file: 'Anton-Regular.ttf' },
  clean: { family: 'Inter', bold: true, file: 'Inter-Bold.ttf' },
  classic: { family: 'Noto Sans', bold: true, file: 'NotoSans-Bold.ttf' },
};

export const studioSpeeds = [0.5, 1, 1.5, 2] as const;
export const studioPositions = ['top', 'center', 'bottom'] as const;
export type StudioPosition = (typeof studioPositions)[number];

// Longest output a render may have, also enforced with -t on the encoder
export const STUDIO_MAX_SECONDS = 90;
// Longest source a render reads, a 90 second window of it at most
export const STUDIO_MAX_SOURCE_SECONDS = 600;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// What the customer reads when a field is refused: the editor shows these as
// they are, so each one says what to do, never which field or rule failed
const say = (message: string) => ({ message });
const VIDEO = say('Pick a video from your media library');
const VIDEO_LINK = say('Pick the video again from your media library');
const TRIM = say('Trim the clip first');
const TRIM_START = say('Move the start of the clip back inside the video');
const TRIM_END = say('Move the end of the clip back inside the video');
const SOURCE_LONG = say(
  `Studio reads the first ${STUDIO_MAX_SOURCE_SECONDS / 60} minutes of a video`
);
const CLIP_SHORT = say('Keep at least half a second of the clip');
const FOCUS = say('Drag the crop back onto the picture');
const SPEED = say('Pick one of the speeds');
const SOUND = say('Choose whether the sound is on or muted');
const CAPTIONS = say('Make the captions first');
const CAPTIONS_SOURCE = say('Make the captions again');
const CAPTIONS_LONG = say('Captions are 1,500 words at most, trim the clip');
const SCRIPT_LONG = say('The script is 3,000 characters at most');
const WORD = say('A caption word cannot be empty');
const WORD_LONG = say('A caption word is 60 characters at most');
const WORD_TIME = say('Make the captions again, their timing is off');
const CAPTION_STYLE = say('Pick one of the caption styles');
const WORDS_PER_LINE = say('Pick 1 to 8 words per line');
const LINE_LENGTH = say('Caption lines are 8 to 40 characters');
const CAPTION_POSITION = say('Pick where the captions sit');
const CAPTION_COLOR = say('Pick the caption colour with the colour picker');
const HIGHLIGHT_COLOR = say('Pick the highlight colour with the colour picker');
export const STUDIO_HOOK_MISSING = 'Add a hook line';
const HOOK = say(STUDIO_HOOK_MISSING);
const HOOK_LONG = say('The hook is 120 characters at most');
const HOOK_STYLE = say('Pick one of the text styles');
const HOOK_POSITION = say('Pick where the hook sits');
const HOOK_SECONDS = say(
  `Show the hook for 1 to ${STUDIO_MAX_SECONDS} seconds, or the whole video`
);

// Only media of the workspace, by id: a url would let a render fetch anything
export class StudioInputDto {
  @IsDefined(VIDEO)
  @IsUUID(undefined, VIDEO)
  mediaId: string;

  // what the editor plays; the render never reads it, it finds the file of
  // the media id in our own storage
  @IsOptional()
  @IsString(VIDEO_LINK)
  @MaxLength(2000, VIDEO_LINK)
  path?: string;
}

export class StudioTrimDto {
  @IsDefined(TRIM)
  @IsNumber({ allowNaN: false, allowInfinity: false }, TRIM_START)
  @Min(0, TRIM_START)
  @Max(STUDIO_MAX_SOURCE_SECONDS, SOURCE_LONG)
  start: number;

  @IsDefined(TRIM)
  @IsNumber({ allowNaN: false, allowInfinity: false }, TRIM_END)
  @Min(0.5, CLIP_SHORT)
  @Max(STUDIO_MAX_SOURCE_SECONDS, SOURCE_LONG)
  end: number;
}

// Where the 9:16 window sits on the picture, 0 to 1 on each axis
export class StudioFocusDto {
  @IsDefined(FOCUS)
  @IsNumber({ allowNaN: false, allowInfinity: false }, FOCUS)
  @Min(0, FOCUS)
  @Max(1, FOCUS)
  x: number;

  @IsDefined(FOCUS)
  @IsNumber({ allowNaN: false, allowInfinity: false }, FOCUS)
  @Min(0, FOCUS)
  @Max(1, FOCUS)
  y: number;
}

// The settings every template that edits one clip shares
export class StudioClipDto {
  @IsDefined(VIDEO)
  @Type(() => StudioInputDto)
  @ValidateNested(VIDEO)
  input: StudioInputDto;

  @IsDefined(TRIM)
  @Type(() => StudioTrimDto)
  @ValidateNested(TRIM)
  trim: StudioTrimDto;

  @IsOptional()
  @IsIn(studioSpeeds, SPEED)
  speed?: (typeof studioSpeeds)[number];

  @IsOptional()
  @IsBoolean(SOUND)
  mute?: boolean;

  @IsOptional()
  @Type(() => StudioFocusDto)
  @ValidateNested(FOCUS)
  focus?: StudioFocusDto;
}

// Same shape as ClippingWord, so the words of a clipping and of Studio are
// read the same way
export class StudioCaptionWordDto {
  @IsDefined(WORD)
  @IsString(WORD)
  @MinLength(1, WORD)
  @MaxLength(60, WORD_LONG)
  text: string;

  @IsDefined(WORD_TIME)
  @IsNumber({ allowNaN: false, allowInfinity: false }, WORD_TIME)
  @Min(0, WORD_TIME)
  @Max(STUDIO_MAX_SOURCE_SECONDS, WORD_TIME)
  start: number;

  @IsDefined(WORD_TIME)
  @IsNumber({ allowNaN: false, allowInfinity: false }, WORD_TIME)
  @Min(0, WORD_TIME)
  @Max(STUDIO_MAX_SOURCE_SECONDS, WORD_TIME)
  end: number;
}

// The same knobs as ClipJob.captions.style
export class StudioCaptionStyleDto {
  @IsOptional()
  @IsIn(studioTextStyles, CAPTION_STYLE)
  font?: StudioTextStyle;

  @IsOptional()
  @IsInt(WORDS_PER_LINE)
  @Min(1, WORDS_PER_LINE)
  @Max(8, WORDS_PER_LINE)
  maxWords?: number;

  @IsOptional()
  @IsInt(LINE_LENGTH)
  @Min(8, LINE_LENGTH)
  @Max(40, LINE_LENGTH)
  maxChars?: number;

  @IsOptional()
  @IsIn(studioPositions, CAPTION_POSITION)
  position?: StudioPosition;

  @IsOptional()
  @Matches(HEX_COLOR, CAPTION_COLOR)
  color?: string;

  @IsOptional()
  @Matches(HEX_COLOR, HIGHLIGHT_COLOR)
  highlight?: string;
}

export class StudioCaptionsDto {
  // "whisper" words come from the workspace's own AI key, "script" words are
  // a typed script spread over the clip
  @IsOptional()
  @IsIn(['whisper', 'script'], CAPTIONS_SOURCE)
  source?: 'whisper' | 'script';

  @IsOptional()
  @IsString(SCRIPT_LONG)
  @MaxLength(3000, SCRIPT_LONG)
  script?: string;

  @IsDefined(CAPTIONS)
  @IsArray(CAPTIONS)
  @ArrayMaxSize(1500, CAPTIONS_LONG)
  @Type(() => StudioCaptionWordDto)
  @ValidateNested({ each: true, ...WORD })
  words: StudioCaptionWordDto[];

  @IsOptional()
  @Type(() => StudioCaptionStyleDto)
  @ValidateNested(CAPTION_STYLE)
  style?: StudioCaptionStyleDto;
}

export class StudioHookDto {
  @IsDefined(HOOK)
  @IsString(HOOK)
  @MinLength(1, HOOK)
  @MaxLength(120, HOOK_LONG)
  text: string;

  @IsOptional()
  @IsIn(studioTextStyles, HOOK_STYLE)
  style?: StudioTextStyle;

  @IsOptional()
  @IsIn(studioPositions, HOOK_POSITION)
  position?: StudioPosition;

  // how long the hook stays on screen, the whole video when missing
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false }, HOOK_SECONDS)
  @Min(1, HOOK_SECONDS)
  @Max(STUDIO_MAX_SECONDS, HOOK_SECONDS)
  seconds?: number;
}
