import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  StudioCaptionStyleDto,
  StudioInputDto,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';
import { say } from '@gitroom/nestjs-libraries/dtos/studio/studio.media.dto';
import { StudioMusicDto } from '@gitroom/nestjs-libraries/dtos/studio/studio.music.dto';
import {
  STUDIO_AI_LINE_CHARS,
  STUDIO_AI_MAX_FOOTAGE,
  STUDIO_AI_MAX_LINES,
  STUDIO_AI_MAX_SECONDS,
  STUDIO_AI_MAX_STILLS,
  STUDIO_AI_MIN_SECONDS,
  STUDIO_AI_POST_CHARS,
  StudioAiTone,
  studioAiTones,
} from '@gitroom/nestjs-libraries/dtos/studio/ai.ugc.limits';

export * from '@gitroom/nestjs-libraries/dtos/studio/ai.ugc.limits';

const HOOK = say('Write the hook, the first line of the script');
const LINE_LONG = say(
  `Each line of the script is ${STUDIO_AI_LINE_CHARS} characters at most`
);
const LINES = say(
  `Keep the script to ${STUDIO_AI_MAX_LINES} lines after the hook`
);
const POST_LONG = say(
  `The post text is ${STUDIO_AI_POST_CHARS} characters at most`
);
const TOPIC = say('Describe the topic or product in 3 to 500 characters');
const TONE = say('Pick one of the tones');
const SECONDS = say(
  `Pick a length of ${STUDIO_AI_MIN_SECONDS} to ${STUDIO_AI_MAX_SECONDS} seconds`
);
const VOICEOVER = say('Turn the AI voice on or off');
const VOICE = say('Pick one of the voices');
const FOOTAGE = say('Add at least one clip of footage');
const FOOTAGE_MAX = say(
  `Use ${STUDIO_AI_MAX_FOOTAGE} clips of footage at most`
);
const STILLS = say(`Pick 0 to ${STUDIO_AI_MAX_STILLS} AI stills`);
const SCRIPT = say('Write or type the script first');
const CAPTIONS = say('Pick the caption style again');
const MUSIC = say('Add the music again');

// What is said, in order: the hook, the lines, the call to action. Written by
// the workspace's AI, by the customer or by their assistant over MCP
export class StudioAiScriptDto {
  @IsDefined(HOOK)
  @IsString(HOOK)
  @Matches(/\S/, HOOK)
  @MaxLength(STUDIO_AI_LINE_CHARS, LINE_LONG)
  hook: string;

  @IsDefined(LINES)
  @IsArray(LINES)
  @ArrayMaxSize(STUDIO_AI_MAX_LINES, LINES)
  @IsString({ each: true, ...LINE_LONG })
  @MaxLength(STUDIO_AI_LINE_CHARS, { each: true, ...LINE_LONG })
  lines: string[];

  @IsOptional()
  @IsString(LINE_LONG)
  @MaxLength(STUDIO_AI_LINE_CHARS, LINE_LONG)
  cta?: string;

  // the caption the video is posted with
  @IsOptional()
  @IsString(POST_LONG)
  @MaxLength(STUDIO_AI_POST_CHARS, POST_LONG)
  postText?: string;
}

// "AI UGC": a spoken script over the customer's own footage, with a
// voiceover, captions lighting up word by word and the music under it
export class AiUgcDto {
  // what the AI writes about; a typed script needs none
  @IsOptional()
  @IsString(TOPIC)
  @MinLength(3, TOPIC)
  @MaxLength(500, TOPIC)
  topic?: string;

  @IsOptional()
  @IsIn(studioAiTones, TONE)
  tone?: StudioAiTone;

  @IsOptional()
  @IsInt(SECONDS)
  @Min(STUDIO_AI_MIN_SECONDS, SECONDS)
  @Max(STUDIO_AI_MAX_SECONDS, SECONDS)
  seconds?: number;

  // false: no voice and no key needed, the script is shown as captions over
  // the footage for the length above
  @IsOptional()
  @IsBoolean(VOICEOVER)
  voiceover?: boolean;

  // a voice of the workspace's AI provider, its default when unknown
  @IsOptional()
  @IsString(VOICE)
  @Matches(/^[a-z0-9_-]{1,40}$/, VOICE)
  voice?: string;

  // videos of the media library, cut to the length of each line and cycled
  @IsDefined(FOOTAGE)
  @IsArray(FOOTAGE)
  @ArrayMinSize(1, FOOTAGE)
  @ArrayMaxSize(STUDIO_AI_MAX_FOOTAGE, FOOTAGE_MAX)
  @Type(() => StudioInputDto)
  @ValidateNested({ each: true, ...FOOTAGE })
  footage: StudioInputDto[];

  // AI stills shown between the footage with a slow pan, only with a voice
  @IsOptional()
  @IsInt(STILLS)
  @Min(0, STILLS)
  @Max(STUDIO_AI_MAX_STILLS, STILLS)
  stills?: number;

  @IsDefined(SCRIPT)
  @Type(() => StudioAiScriptDto)
  @ValidateNested(SCRIPT)
  script: StudioAiScriptDto;

  @IsOptional()
  @Type(() => StudioCaptionStyleDto)
  @ValidateNested(CAPTIONS)
  captionStyle?: StudioCaptionStyleDto;

  // the workspace's own music, ducked under the voice
  @IsOptional()
  @Type(() => StudioMusicDto)
  @ValidateNested(MUSIC)
  music?: StudioMusicDto;
}
