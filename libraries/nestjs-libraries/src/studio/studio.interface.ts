import { Injectable, Type } from '@nestjs/common';
import {
  StudioCaptionStyleDto,
  StudioClipDto,
  StudioPosition,
  StudioTextStyle,
  studioFonts,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';
import {
  STUDIO_MUSIC_VOLUME,
  StudioMusicDto,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.music.dto';
import {
  StudioWord,
  groupCaptionLines,
} from '@gitroom/helpers/utils/studio.captions';
import type {
  StudioAiAssetRequest,
  StudioAiScript,
  StudioAiScriptRequest,
} from '@gitroom/nestjs-libraries/studio/ai/studio.ai.interface';

// Every template renders the same frame: vertical 1080x1920 at 30 fps
export const STUDIO_WIDTH = 1080;
export const STUDIO_HEIGHT = 1920;
export const STUDIO_FPS = 30;

export interface StudioTemplateParams {
  identifier: string;
  title: string;
  description: string;
  // what assistants and the public API read in place of the description,
  // when the editor's wording does not fit them
  agentDescription?: string;
  // what assistants and the public API get when their spec leaves it out
  agentDefaults?: Record<string, unknown>;
  dto: Type<any>;
  // the template burns captions in, so the editor offers to transcribe
  captions: boolean;
  // the template runs on the workspace's own AI key (a script, a voice)
  ai?: boolean;
}

// What the render knows about an input once it is downloaded and probed.
// "file" is a name inside the render's own folder, never a user string
export interface StudioPlanInput {
  file: string;
  hasAudio: boolean;
  // a still picture (png, jpg or webp) instead of a video
  image?: boolean;
  // seconds, for a video
  duration?: number;
}

export interface StudioPlanContext {
  inputs: StudioPlanInput[];
  fontsDir: string;
  // the music of the workspace the spec picked, downloaded and probed
  music?: { file: string };
  // what the AI made for the template's aiAssets(), in the same order: a
  // file in the render's folder, and for a voice its length and word times
  ai?: { file: string; seconds?: number; words?: StudioWord[] }[];
}

// The ffmpeg command of a render, without the encoder settings every template
// shares. "files" are written next to the inputs before ffmpeg starts: user
// text only ever reaches ffmpeg through them, never through the filter graph
export interface StudioPlan {
  inputs: string[][];
  filterComplex: string;
  maps: string[];
  files: { name: string; content: string }[];
  duration: number;
}

// A number as ffmpeg reads it, never in exponent form
export const ffNumber = (value: number) => String(Number(value.toFixed(3)));

// Every soundtrack ends at the loudness the networks normalise to
const LOUDNORM = 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000';
// The containers a music file may come in: what POST /studio/assets accepts
const MUSIC_FORMATS = 'mp3,mov,mp4,m4a,3gp,3g2,mj2,wav';

const POSITION_ALIGNMENT: Record<StudioPosition, number> = {
  top: 8,
  center: 5,
  bottom: 2,
};

// Above the captions and buttons the networks draw over a vertical video
const POSITION_MARGIN: Record<StudioPosition, number> = {
  top: 300,
  center: 0,
  bottom: 420,
};

// "#RRGGBB" as an ASS colour, which is blue-green-red
export const assColor = (hex: string) => {
  const value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.slice(1) : 'FFFFFF';
  return `&H00${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(
    0,
    2
  )}&`.toUpperCase();
};

// H:MM:SS.cc, the only time format ASS reads
export const assTime = (seconds: number) => {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(centiseconds / 360000);
  const m = Math.floor((centiseconds % 360000) / 6000);
  const s = Math.floor((centiseconds % 6000) / 100);
  const cs = centiseconds % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(
    2,
    '0'
  )}.${String(cs).padStart(2, '0')}`;
};

// User text as the text of an ASS event. A "{" opens an override block that
// could restyle, move or hide anything, so braces are escaped; a backslash is
// followed by an invisible word joiner so it can never form \N, \h, \{ or \}
// with the next character. Line breaks would end the event line, so every
// control character becomes a space or goes
export const escapeAssText = (text: string) =>
  text
    .replace(/\r\n|[\r\n\t\v\f\u2028\u2029]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\u2060')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');

export interface AssStyle {
  name: string;
  font: StudioTextStyle;
  size: number;
  color: string;
  position: StudioPosition;
}

// The header of an ASS file on the 1080x1920 canvas with the given styles
export const assHeader = (styles: AssStyle[]) =>
  [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${STUDIO_WIDTH}`,
    `PlayResY: ${STUDIO_HEIGHT}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles.map((style) => {
      const font = studioFonts[style.font] || studioFonts.bold;
      return `Style: ${style.name},${font.family},${style.size},${assColor(
        style.color
      )},&H000000FF&,&H00000000&,&H80000000&,${
        font.bold ? -1 : 0
      },0,0,0,100,100,0,0,1,6,0,${POSITION_ALIGNMENT[style.position]},80,80,${
        POSITION_MARGIN[style.position]
      },1`;
    }),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

export const assDialogue = (
  start: number,
  end: number,
  style: string,
  text: string
) => `Dialogue: 0,${assTime(start)},${assTime(end)},${style},,0,0,0,,${text}`;

// Captions lighting up word by word, as a whole ASS file: one event per word,
// the whole line with the spoken word in the highlight colour until the next
// word starts. Words are on the output timeline
export const assKaraoke = (
  words: StudioWord[],
  style: StudioCaptionStyleDto = {}
) => {
  const color = style.color || '#FFFFFF';
  const highlight = assColor(style.highlight || '#FFD400');
  const lines = groupCaptionLines(
    words,
    style.maxWords || 3,
    style.maxChars || 22
  );

  const events = lines.flatMap((line) => {
    const text = line.map((word) => escapeAssText(word.text));
    return line.map((word, index) =>
      assDialogue(
        index === 0 ? line[0].start : word.start,
        index === line.length - 1 ? word.end : line[index + 1].start,
        'Captions',
        text
          .map((value, at) =>
            at === index
              ? `{\\1c${highlight}}${value}{\\1c${assColor(color)}}`
              : value
          )
          .join(' ')
      )
    );
  });

  return [
    assHeader([
      {
        name: 'Captions',
        font: style.font || 'bold',
        size: style.font === 'impact' ? 96 : 80,
        color,
        position: style.position || 'bottom',
      },
    ]),
    ...events,
    '',
  ].join('\n');
};

export function StudioTemplate(params: StudioTemplateParams) {
  return function (target: any) {
    Injectable()(target);

    const existingMetadata =
      Reflect.getMetadata('studio-template', StudioTemplateAbstract) || [];
    existingMetadata.push({ target, ...params });
    Reflect.defineMetadata(
      'studio-template',
      existingMetadata,
      StudioTemplateAbstract
    );
  };
}

// A template turns its validated spec into an ffmpeg plan. Adding a template
// is adding a class with @StudioTemplate; nothing generic changes. The pieces
// below are the shared building blocks of the design (TRIM, COVER, BLUR)
export abstract class StudioTemplateAbstract<
  T extends object = StudioClipDto
> {
  abstract plan(spec: T, context: StudioPlanContext): StudioPlan;

  // The defaults below are for a template that edits one clip
  // (StudioClipDto); a template made of several pictures or videos overrides
  // the ones it needs
  private clip(spec: T) {
    return spec as unknown as StudioClipDto;
  }

  // The media of the workspace the template reads, in input order
  mediaIds(spec: T): string[] {
    return [this.clip(spec).input.mediaId];
  }

  // Whether the input at this position may be a still picture
  allowsImage(spec: T, index: number) {
    return false;
  }

  // Whether it may be a video, checked before anything is downloaded
  allowsVideo(spec: T, index: number) {
    return true;
  }

  // The music asset of the workspace the spec picked
  musicAssetId(spec: T): string | undefined {
    return (spec as { music?: StudioMusicDto }).music?.assetId;
  }

  // What stops a whole spec from rendering, in words for the customer. A
  // template without a trim has nothing to check here
  check(spec: T): string | undefined {
    const trim = this.clip(spec).trim;
    return trim && trim.end <= trim.start
      ? 'The end of the clip must be after its start'
      : undefined;
  }

  // The same, once the inputs are downloaded and probed
  checkInputs(spec: T, inputs: StudioPlanInput[]): string | undefined {
    const trim = this.clip(spec).trim;
    return trim && trim.start >= (inputs[0]?.duration ?? Infinity)
      ? 'The clip starts after the end of the video.'
      : undefined;
  }

  // What the workspace's AI is asked to write for the project, null when the
  // template has no AI script or misses what it is written from
  aiScript(spec: T): StudioAiScriptRequest | null {
    return null;
  }

  // The spec with a script the AI wrote, for the customer to edit
  applyAiScript(spec: T, script: StudioAiScript): T {
    return spec;
  }

  // What the AI makes before the render (a voiceover, stills); the render
  // reads the files from StudioPlanContext.ai
  aiAssets(spec: T): StudioAiAssetRequest[] {
    return [];
  }

  // What stops a spec an assistant or the public API sent, on top of
  // check(): settings the editor quietly hides are refused there instead
  agentCheck(spec: T): string | undefined {
    return undefined;
  }

  speed(spec: T) {
    return this.clip(spec).speed || 1;
  }

  // Length of the output in seconds
  duration(spec: T) {
    const trim = this.clip(spec).trim;
    return Math.max(0, (trim.end - trim.start) / this.speed(spec));
  }

  // TRIM: an accurate seek on the input, so only the window is decoded. The
  // input is a local mp4 and nothing else: no protocol or container that
  // could make ffmpeg read another file or address
  protected videoInput(file: string, start: number, length: number) {
    return [
      '-protocol_whitelist',
      'file',
      '-format_whitelist',
      'mov,mp4,m4a,3gp,3g2,mj2',
      // decoding takes 2 threads too, not one per core
      '-threads',
      '2',
      '-ss',
      ffNumber(start),
      '-t',
      ffNumber(length),
      '-i',
      file,
    ];
  }

  protected trimmedInput(spec: T, file: string) {
    const trim = this.clip(spec).trim;
    return this.videoInput(file, trim.start, trim.end - trim.start);
  }

  // A still picture, read once by the image demuxer and nothing else: the
  // name is read as it is, never as a pattern that could match other files
  protected imageInput(file: string) {
    return [
      '-protocol_whitelist',
      'file',
      '-format_whitelist',
      'image2',
      '-threads',
      '2',
      '-f',
      'image2',
      '-pattern_type',
      'none',
      '-framerate',
      String(STUDIO_FPS),
      '-i',
      file,
    ];
  }

  // The music, looped when it is shorter than the video and cut to it
  protected musicInput(file: string, music: StudioMusicDto, duration: number) {
    return [
      '-protocol_whitelist',
      'file',
      '-format_whitelist',
      MUSIC_FORMATS,
      '-threads',
      '2',
      '-stream_loop',
      '-1',
      '-ss',
      ffNumber(music.start || 0),
      '-t',
      ffNumber(duration),
      '-i',
      file,
    ];
  }

  // The video of input 0 back at zero, at the chosen speed and 30 fps
  protected videoIn(spec: T) {
    const speed = this.speed(spec);
    return `[0:v]setpts=${
      speed === 1 ? 'PTS-STARTPTS' : `(PTS-STARTPTS)/${ffNumber(speed)}`
    },fps=${STUDIO_FPS}`;
  }

  // COVER on any frame size: fills it, the focus picks the part that stays
  protected coverTo(
    focus: { x: number; y: number } | undefined,
    width: number,
    height: number
  ) {
    const x = ffNumber(focus?.x ?? 0.5);
    const y = ffNumber(focus?.y ?? 0.5);
    return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:x=(iw-${width})*${x}:y=(ih-${height})*${y},setsar=1`;
  }

  // COVER: fills the frame, the focus picks the part that stays
  protected cover(spec: T) {
    return this.coverTo(this.clip(spec).focus, STUDIO_WIDTH, STUDIO_HEIGHT);
  }

  // A still picture held for the given seconds at 30 fps. It is decoded and
  // scaled once, then the one frame is repeated, so a long slide costs
  // almost nothing
  protected hold(seconds: number) {
    const frames = Math.max(1, Math.round(seconds * STUDIO_FPS));
    return `loop=loop=${frames - 1}:size=1:start=0,settb=1/${STUDIO_FPS},setpts=N`;
  }

  // A video input back at zero at 30 fps, its last frame held when it is
  // shorter than the seconds it must fill, and cut to them
  protected fill(seconds: number) {
    return `setpts=PTS-STARTPTS,fps=${STUDIO_FPS},tpad=stop_mode=clone:stop_duration=${ffNumber(
      seconds
    )},trim=duration=${ffNumber(seconds)},setpts=PTS-STARTPTS`;
  }

  // BLUR: the whole picture over a blurred copy of itself, blurred at a
  // quarter of the size because a full size blur is slow
  protected blur(input: string, output: string) {
    return [
      `${input}split[bgsrc][fgsrc]`,
      `[bgsrc]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=10,scale=${STUDIO_WIDTH}:${STUDIO_HEIGHT},setsar=1[bg]`,
      `[fgsrc]scale=${STUDIO_WIDTH}:${STUDIO_HEIGHT}:force_original_aspect_ratio=decrease,setsar=1[fg]`,
      `[bg][fg]overlay=(W-w)/2:(H-h)/2${output}`,
    ].join(';');
  }

  // Burns an ASS file of the render folder in, with only the bundled fonts
  protected subtitles(file: string, context: StudioPlanContext) {
    if (!/^[\w.-]+$/.test(file) || !/^[\w/.-]+$/.test(context.fontsDir)) {
      throw new Error('Invalid subtitles path');
    }
    return `ass=filename=${file}:fontsdir=${context.fontsDir}`;
  }

  // The sound of the clip at the chosen speed, or silence when it is muted or
  // has none: every output carries an audio stream, some networks refuse
  // videos without one. Music, when picked, goes under it. Returns the extra
  // input and the filter to [aout]
  protected audio(
    spec: T,
    context: StudioPlanContext,
    inputIndex: number,
    music?: StudioMusicDto
  ) {
    const speed = this.speed(spec);
    return this.soundtrack({
      voice:
        this.clip(spec).mute || !context.inputs[0]?.hasAudio
          ? undefined
          : `[0:a]${
              speed === 1 ? '' : `atempo=${ffNumber(speed)},`
            }asetpts=PTS-STARTPTS,aresample=48000`,
      music,
      context,
      inputIndex,
      duration: this.duration(spec),
    });
  }

  // MIX: the music under the voice. It is cut to the video and fades out at
  // the end; under a voice it is lowered to its volume and ducked whenever
  // the voice speaks (sidechaincompress), then both are joined. Either way
  // the result is brought to the loudness the networks normalise to
  protected mixMusic(
    voice: string | null,
    musicIndex: number,
    music: StudioMusicDto,
    duration: number
  ) {
    const fade = Math.min(2, duration / 2);
    const bed = `[${musicIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${ffNumber(
      duration
    )},asetpts=PTS-STARTPTS,afade=t=out:st=${ffNumber(
      duration - fade
    )}:d=${ffNumber(fade)}`;
    if (!voice) {
      return `${bed},${LOUDNORM}[aout]`;
    }

    return [
      `${bed},volume=${ffNumber(music.volume ?? STUDIO_MUSIC_VOLUME)}[mixmusic]`,
      `${voice}aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[mixvoice][mixkey]`,
      '[mixmusic][mixkey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=350[mixducked]',
      `[mixvoice][mixducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,${LOUDNORM}[aout]`,
    ].join(';');
  }

  // The audio of a render to [aout]. "voice" is a filter chain without its
  // output label (the sound of the video), or nothing when the video is
  // silent. With music the voice is mixed over it; with neither the video
  // gets a silent track. Returns the extra input and the filter
  protected soundtrack(options: {
    voice?: string;
    music?: StudioMusicDto;
    context: StudioPlanContext;
    inputIndex: number;
    duration: number;
  }) {
    const { voice, music, context, inputIndex, duration } = options;
    if (music && context.music) {
      return {
        inputs: [this.musicInput(context.music.file, music, duration)],
        filter: this.mixMusic(
          voice ? `${voice},` : null,
          inputIndex,
          music,
          duration
        ),
      };
    }

    if (voice) {
      return { inputs: [] as string[][], filter: `${voice}[aout]` };
    }

    return {
      inputs: [
        [
          '-f',
          'lavfi',
          '-t',
          ffNumber(duration),
          '-i',
          'anullsrc=r=48000:cl=stereo',
        ],
      ],
      filter: `[${inputIndex}:a]anull[aout]`,
    };
  }
}
