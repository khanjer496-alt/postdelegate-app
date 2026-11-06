import {
  STUDIO_FPS,
  STUDIO_HEIGHT,
  STUDIO_WIDTH,
  StudioPlan,
  StudioPlanContext,
  StudioTemplate,
  StudioTemplateAbstract,
  assKaraoke,
  ffNumber,
} from '@gitroom/nestjs-libraries/studio/studio.interface';
import {
  StudioWord,
  wordsFromScript,
} from '@gitroom/helpers/utils/studio.captions';
import type {
  StudioAiAssetRequest,
  StudioAiScript,
  StudioAiScriptRequest,
} from '@gitroom/nestjs-libraries/studio/ai/studio.ai.interface';
import {
  AiUgcDto,
  STUDIO_AI_LINE_CHARS,
  STUDIO_AI_MAX_LINES,
  STUDIO_AI_POST_CHARS,
  StudioAiTone,
} from '@gitroom/nestjs-libraries/dtos/studio/ai.ugc.dto';
import { STUDIO_MAX_SECONDS } from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';

const CAPTIONS_FILE = 'captions.ass';
// the length a script is written for when none was picked
const DEFAULT_SECONDS = 30;
// silence after the last word, so the video does not end mid breath
const TAIL = 0.6;
// a part of the timeline shorter than this joins the one before it
const MIN_PART = 0.4;
// a still is scaled 15% above the frame so it has room to pan
const STILL_WIDTH = 1242;
const STILL_HEIGHT = 2208;

// How the voice says the script
const TONE_INSTRUCTIONS: Record<StudioAiTone, string> = {
  friendly:
    'Warm and friendly, like talking to a friend on camera. Natural pace.',
  excited: 'Energetic and excited, upbeat and slightly fast.',
  calm: 'Calm and reassuring, relaxed and unhurried.',
  expert: 'Confident and clear, like an expert explaining. Steady pace.',
  funny: 'Playful and funny, light, with natural comic timing.',
};

const clip = (text: string | undefined, length: number) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, length);

// script → voice (TTS) → word times (Whisper) → the footage cut to the
// length of each line, cycled, with AI stills panning between → the voice,
// and captions lighting up word by word. The AI steps run in the render
// workflow before the render, the render only reads their files
@StudioTemplate({
  identifier: 'ai-ugc',
  title: 'AI UGC',
  description:
    'Your AI writes a short script and voices it, Studio cuts your footage to it with word-by-word captions. Runs on your own OpenAI key.',
  agentDescription:
    'A spoken script over your own footage (videos of the media library), cut line by line with word-by-word captions. Write the script yourself (hook, lines, cta). By default there is no AI voice: the script is shown as captions for "seconds" and no AI key is needed. An AI voice (voiceover: true) needs the workspace\'s own OpenAI key, and AI stills (stills) only come with the voice, so they need voiceover: true too.',
  agentDefaults: { voiceover: false },
  dto: AiUgcDto,
  captions: false,
  ai: true,
})
export class AiUgcTemplate extends StudioTemplateAbstract<any> {
  mediaIds(spec: AiUgcDto): string[] {
    return (spec.footage || []).map((p) => p.mediaId);
  }

  // What the script is written for. The video is as long as its voice, which
  // is only known once the voice is made, and never longer than the limit
  duration(spec: AiUgcDto) {
    return spec.seconds || DEFAULT_SECONDS;
  }

  voiced(spec: AiUgcDto) {
    return spec.voiceover !== false;
  }

  // the editor hides the stills without a voice and makes none, an
  // assistant asking for them is told instead
  agentCheck(spec: AiUgcDto) {
    return spec.stills && !this.voiced(spec)
      ? 'AI stills need the AI voice: set voiceover to true (it needs the workspace\'s own OpenAI key) or leave stills out'
      : undefined;
  }

  // What is said, part by part: the hook, every line, the call to action
  parts(spec: AiUgcDto) {
    return [spec.script?.hook, ...(spec.script?.lines || []), spec.script?.cta]
      .map((part) => clip(part, STUDIO_AI_LINE_CHARS))
      .filter(Boolean);
  }

  aiScript(spec: AiUgcDto): StudioAiScriptRequest | null {
    const topic = clip(spec.topic, 500);
    if (!topic) {
      return null;
    }

    return {
      topic,
      tone: spec.tone || 'friendly',
      seconds: this.duration(spec),
    };
  }

  // What the AI wrote, cut to what the project takes
  applyAiScript(spec: AiUgcDto, script: StudioAiScript): AiUgcDto {
    const lines = (script.lines || [])
      .map((line) => clip(line, STUDIO_AI_LINE_CHARS))
      .filter(Boolean);
    const hook = clip(script.hook, STUDIO_AI_LINE_CHARS) || lines.shift() || '';
    return {
      ...spec,
      script: {
        hook,
        lines: lines.slice(0, STUDIO_AI_MAX_LINES),
        cta: clip(script.cta, STUDIO_AI_LINE_CHARS),
        postText: String(script.postText || '')
          .trim()
          .slice(0, STUDIO_AI_POST_CHARS),
      },
    };
  }

  aiAssets(spec: AiUgcDto): StudioAiAssetRequest[] {
    const parts = this.parts(spec);
    if (!parts.length) {
      return [];
    }

    const lines = parts.slice(1, -1).length ? parts.slice(1, -1) : parts;
    const topic = clip(spec.topic, 300);
    return [
      ...(this.voiced(spec)
        ? [
            {
              kind: 'voice' as const,
              text: parts.join(' '),
              voice: spec.voice || '',
              instructions: TONE_INSTRUCTIONS[spec.tone || 'friendly'],
            },
          ]
        : []),
      // stills go with the voice: without one the editor hides them and
      // nothing is made, so nothing is billed
      ...Array.from(
        { length: this.voiced(spec) ? spec.stills || 0 : 0 },
        (_, index) => ({
          kind: 'image' as const,
          prompt: `A vertical photo used as b-roll in a short social media video${
            topic ? ` about "${topic}"` : ''
          }. It shows: ${
            lines[index % lines.length]
          }. Realistic, natural light, shot on a phone. No text, no captions, no logos, no watermarks.`,
        })
      ),
    ];
  }

  // Where each part starts and ends on the output. With a voice, a part
  // starts at the spoken word its first word maps to (by position, the
  // spoken words never match the script exactly); without one, the parts
  // share the length by their number of words
  timeline(parts: string[], words: StudioWord[], total: number) {
    const counts = parts.map(
      (part) => part.split(/\s+/).filter(Boolean).length || 1
    );
    const all = counts.reduce((sum, count) => sum + count, 0);
    let before = 0;
    const starts = counts.map((count, index) => {
      const at = before;
      before += count;
      if (index === 0) {
        return 0;
      }
      if (!words.length) {
        return (total * at) / all;
      }
      const word =
        words[
          Math.min(words.length - 1, Math.round((at * words.length) / all))
        ];
      return word.start;
    });

    const timeline: { start: number; end: number }[] = [];
    starts.forEach((start, index) => {
      const from = Math.min(
        total,
        Math.max(start, timeline[timeline.length - 1]?.start || 0)
      );
      const to = index === starts.length - 1 ? total : starts[index + 1];
      const end = Math.min(total, Math.max(from, to));
      // a part too short to show joins the one before it
      if (timeline.length && end - from < MIN_PART) {
        timeline[timeline.length - 1].end = end;
        return;
      }
      timeline.push({ start: from, end });
    });

    // the first part too short to show joins the next one
    if (timeline.length > 1 && timeline[0].end - timeline[0].start < MIN_PART) {
      timeline[1].start = 0;
      timeline.shift();
    }

    return timeline.filter((part) => part.end - part.start > 0);
  }

  plan(spec: AiUgcDto, context: StudioPlanContext): StudioPlan {
    const assets = this.aiAssets(spec);
    const voiceAt = assets.findIndex((p) => p.kind === 'voice');
    const voice = voiceAt === -1 ? undefined : context.ai?.[voiceAt];
    const stills = assets
      .map((asset, index) =>
        asset.kind === 'image' ? context.ai?.[index]?.file : undefined
      )
      .filter((file): file is string => !!file);

    const total = Math.min(
      STUDIO_MAX_SECONDS,
      voice?.seconds ? voice.seconds + TAIL : this.duration(spec)
    );
    const spoken = voice?.seconds ? Math.min(voice.seconds, total) : total;
    const parts = this.parts(spec);
    const words = (
      voice?.words?.length
        ? voice.words
        : wordsFromScript(parts.join(' '), 0, spoken)
    )
      .filter((word) => word.start < total)
      .map((word) => ({ ...word, end: Math.min(word.end, total) }));

    // the footage and the stills one after the other, cycled over the parts
    const visuals: ({ footage: number } | { still: string })[] = [];
    for (let i = 0; i < Math.max(context.inputs.length, stills.length); i++) {
      if (i < context.inputs.length) {
        visuals.push({ footage: i });
      }
      if (i < stills.length) {
        visuals.push({ still: stills[i] });
      }
    }

    // a footage used again goes on from where it stopped, looping at its end
    const played = context.inputs.map(() => 0);
    const inputs: string[][] = [];
    const filters: string[] = [];
    this.timeline(parts, words, total).forEach((part, index) => {
      const length = ffNumber(part.end - part.start);
      const visual = visuals[index % visuals.length];
      if ('still' in visual) {
        inputs.push([
          '-protocol_whitelist',
          'file',
          '-f',
          'image2',
          '-loop',
          '1',
          '-framerate',
          String(STUDIO_FPS),
          '-t',
          length,
          '-i',
          visual.still,
        ]);
        // Ken Burns: a slow pan across the still, one way then the other
        const x = index % 2 ? `(iw-ow)*(1-t/${length})` : `(iw-ow)*t/${length}`;
        filters.push(
          `[${index}:v]scale=${STILL_WIDTH}:${STILL_HEIGHT}:force_original_aspect_ratio=increase,crop=${STILL_WIDTH}:${STILL_HEIGHT},setsar=1,crop=${STUDIO_WIDTH}:${STUDIO_HEIGHT}:x=${x}:y=(ih-oh)/2,fps=${STUDIO_FPS},trim=duration=${length},setpts=PTS-STARTPTS,format=yuv420p[p${index}]`
        );
        return;
      }

      const input = context.inputs[visual.footage];
      const offset = input.duration
        ? played[visual.footage] % input.duration
        : 0;
      played[visual.footage] += part.end - part.start;
      inputs.push([
        // a clip shorter than its part loops
        '-stream_loop',
        '-1',
        '-protocol_whitelist',
        'file',
        '-format_whitelist',
        'mov,mp4,m4a,3gp,3g2,mj2',
        '-threads',
        '2',
        '-ss',
        ffNumber(offset),
        '-t',
        length,
        '-i',
        input.file,
      ]);
      filters.push(
        `[${index}:v]setpts=PTS-STARTPTS,fps=${STUDIO_FPS},${this.cover(
          {}
        )},trim=duration=${length},setpts=PTS-STARTPTS,format=yuv420p[p${index}]`
      );
    });

    const count = filters.length;
    // the voice padded with silence to the end of the video, the music
    // (MIX) lowered and ducked under it; without either a silent track
    const voiceInputs = voice
      ? [
          [
            '-protocol_whitelist',
            'file',
            '-format_whitelist',
            'mp3',
            '-i',
            voice.file,
          ],
        ]
      : [];
    const audio = this.soundtrack({
      voice: voice
        ? `[${count}:a]aresample=48000,apad=whole_dur=${ffNumber(total)}`
        : undefined,
      music: spec.music,
      context,
      inputIndex: count + voiceInputs.length,
      duration: total,
    });

    return {
      inputs: [...inputs, ...voiceInputs, ...audio.inputs],
      filterComplex: [
        ...filters,
        `${Array.from({ length: count }, (_, i) => `[p${i}]`).join(
          ''
        )}concat=n=${count}:v=1:a=0[vcat]`,
        `[vcat]${this.subtitles(CAPTIONS_FILE, context)},format=yuv420p[vout]`,
        audio.filter,
      ].join(';'),
      maps: ['-map', '[vout]', '-map', '[aout]'],
      files: [
        {
          name: CAPTIONS_FILE,
          content: assKaraoke(words, spec.captionStyle),
        },
      ],
      duration: total,
    };
  }
}
