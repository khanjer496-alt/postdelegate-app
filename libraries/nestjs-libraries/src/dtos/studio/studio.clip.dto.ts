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

// Only media of the workspace, by id: a url would let a render fetch anything
export class StudioInputDto {
  @IsDefined()
  @IsUUID()
  mediaId: string;

  // what the editor plays; the render never reads it, it finds the file of
  // the media id in our own storage
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  path?: string;
}

export class StudioTrimDto {
  @IsDefined()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(STUDIO_MAX_SOURCE_SECONDS)
  start: number;

  @IsDefined()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.5)
  @Max(STUDIO_MAX_SOURCE_SECONDS)
  end: number;
}

// Where the 9:16 window sits on the picture, 0 to 1 on each axis
export class StudioFocusDto {
  @IsDefined()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  x: number;

  @IsDefined()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  y: number;
}

// The settings every template that edits one clip shares
export class StudioClipDto {
  @IsDefined()
  @Type(() => StudioInputDto)
  @ValidateNested()
  input: StudioInputDto;

  @IsDefined()
  @Type(() => StudioTrimDto)
  @ValidateNested()
  trim: StudioTrimDto;

  @IsOptional()
  @IsIn(studioSpeeds)
  speed?: (typeof studioSpeeds)[number];

  @IsOptional()
  @IsBoolean()
  mute?: boolean;

  @IsOptional()
  @Type(() => StudioFocusDto)
  @ValidateNested()
  focus?: StudioFocusDto;
}

// Same shape as ClippingWord, so the words of a clipping and of Studio are
// read the same way
export class StudioCaptionWordDto {
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  text: string;

  @IsDefined()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(STUDIO_MAX_SOURCE_SECONDS)
  start: number;

  @IsDefined()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(STUDIO_MAX_SOURCE_SECONDS)
  end: number;
}

// The same knobs as ClipJob.captions.style
export class StudioCaptionStyleDto {
  @IsOptional()
  @IsIn(studioTextStyles)
  font?: StudioTextStyle;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  maxWords?: number;

  @IsOptional()
  @IsInt()
  @Min(8)
  @Max(40)
  maxChars?: number;

  @IsOptional()
  @IsIn(studioPositions)
  position?: StudioPosition;

  @IsOptional()
  @Matches(HEX_COLOR)
  color?: string;

  @IsOptional()
  @Matches(HEX_COLOR)
  highlight?: string;
}

export class StudioCaptionsDto {
  // "whisper" words come from the workspace's own AI key, "script" words are
  // a typed script spread over the clip
  @IsOptional()
  @IsIn(['whisper', 'script'])
  source?: 'whisper' | 'script';

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  script?: string;

  @IsDefined()
  @IsArray()
  @ArrayMaxSize(1500)
  @Type(() => StudioCaptionWordDto)
  @ValidateNested({ each: true })
  words: StudioCaptionWordDto[];

  @IsOptional()
  @Type(() => StudioCaptionStyleDto)
  @ValidateNested()
  style?: StudioCaptionStyleDto;
}

export class StudioHookDto {
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  text: string;

  @IsOptional()
  @IsIn(studioTextStyles)
  style?: StudioTextStyle;

  @IsOptional()
  @IsIn(studioPositions)
  position?: StudioPosition;

  // how long the hook stays on screen, the whole video when missing
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1)
  @Max(STUDIO_MAX_SECONDS)
  seconds?: number;
}
