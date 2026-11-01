import { Injectable, Type } from '@nestjs/common';
import {
  StudioClipDto,
  StudioPosition,
  StudioTextStyle,
  studioFonts,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';

// Every template renders the same frame: vertical 1080x1920 at 30 fps
export const STUDIO_WIDTH = 1080;
export const STUDIO_HEIGHT = 1920;
export const STUDIO_FPS = 30;

export interface StudioTemplateParams {
  identifier: string;
  title: string;
  description: string;
  dto: Type<any>;
  // the template burns captions in, so the editor offers to transcribe
  captions: boolean;
}

// What the render knows about the inputs once they are downloaded and probed.
// "file" is a name inside the render's own folder, never a user string
export interface StudioPlanContext {
  inputs: { file: string; hasAudio: boolean }[];
  fontsDir: string;
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
  T extends StudioClipDto = StudioClipDto
> {
  abstract plan(spec: T, context: StudioPlanContext): StudioPlan;

  // The media of the workspace the template reads, in input order
  mediaIds(spec: T): string[] {
    return [spec.input.mediaId];
  }

  speed(spec: T) {
    return spec.speed || 1;
  }

  // Length of the output in seconds
  duration(spec: T) {
    return Math.max(0, (spec.trim.end - spec.trim.start) / this.speed(spec));
  }

  // TRIM: an accurate seek on the input, so only the window is decoded. The
  // input is a local mp4 and nothing else: no protocol or container that
  // could make ffmpeg read another file or address
  protected trimmedInput(spec: T, file: string) {
    return [
      '-protocol_whitelist',
      'file',
      '-format_whitelist',
      'mov,mp4,m4a,3gp,3g2,mj2',
      // decoding takes 2 threads too, not one per core
      '-threads',
      '2',
      '-ss',
      ffNumber(spec.trim.start),
      '-t',
      ffNumber(spec.trim.end - spec.trim.start),
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

  // COVER: fills the frame, the focus picks the part that stays
  protected cover(spec: T) {
    const x = ffNumber(spec.focus?.x ?? 0.5);
    const y = ffNumber(spec.focus?.y ?? 0.5);
    return `scale=${STUDIO_WIDTH}:${STUDIO_HEIGHT}:force_original_aspect_ratio=increase,crop=${STUDIO_WIDTH}:${STUDIO_HEIGHT}:x=(iw-${STUDIO_WIDTH})*${x}:y=(ih-${STUDIO_HEIGHT})*${y},setsar=1`;
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
  // videos without one. Returns the extra input and the filter to [aout]
  protected audio(spec: T, context: StudioPlanContext, inputIndex: number) {
    const duration = ffNumber(this.duration(spec));
    if (spec.mute || !context.inputs[0]?.hasAudio) {
      return {
        inputs: [
          ['-f', 'lavfi', '-t', duration, '-i', 'anullsrc=r=48000:cl=stereo'],
        ],
        filter: `[${inputIndex}:a]anull[aout]`,
      };
    }

    const speed = this.speed(spec);
    return {
      inputs: [],
      filter: `[0:a]${
        speed === 1 ? '' : `atempo=${ffNumber(speed)},`
      }asetpts=PTS-STARTPTS,aresample=48000[aout]`,
    };
  }
}
