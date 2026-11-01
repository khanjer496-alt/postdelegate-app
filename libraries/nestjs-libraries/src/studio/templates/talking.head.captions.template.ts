import {
  StudioPlan,
  StudioPlanContext,
  StudioTemplate,
  StudioTemplateAbstract,
  assColor,
  assDialogue,
  assHeader,
  escapeAssText,
} from '@gitroom/nestjs-libraries/studio/studio.interface';
import {
  groupCaptionLines,
  wordsOnOutput,
} from '@gitroom/helpers/utils/studio.captions';
import { TalkingHeadCaptionsDto } from '@gitroom/nestjs-libraries/dtos/studio/talking.head.captions.dto';

const CAPTIONS_FILE = 'captions.ass';

// TRIM → COVER or BLUR → captions lighting up word by word
@StudioTemplate({
  identifier: 'talking-head-captions',
  title: 'Talking head + captions',
  description:
    'Your clip with burned-in captions that light up word by word, from your AI key or a typed script.',
  dto: TalkingHeadCaptionsDto,
  captions: true,
})
export class TalkingHeadCaptionsTemplate extends StudioTemplateAbstract<TalkingHeadCaptionsDto> {
  captionsAss(spec: TalkingHeadCaptionsDto) {
    const style = spec.captions.style || {};
    const color = style.color || '#FFFFFF';
    const highlight = assColor(style.highlight || '#FFD400');
    const lines = groupCaptionLines(
      wordsOnOutput(
        spec.captions.words,
        spec.trim,
        this.speed(spec),
        this.duration(spec)
      ),
      style.maxWords || 3,
      style.maxChars || 22
    );

    // one event per word: the whole line, with the spoken word in the
    // highlight colour until the next word starts
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
  }

  plan(spec: TalkingHeadCaptionsDto, context: StudioPlanContext): StudioPlan {
    const audio = this.audio(spec, context, 1);
    const subtitles = `${this.subtitles(
      CAPTIONS_FILE,
      context
    )},format=yuv420p[vout]`;
    const video =
      spec.fit === 'blur'
        ? `${this.blur(
            this.videoIn(spec) + ',',
            '[framed]'
          )};[framed]${subtitles}`
        : `${this.videoIn(spec)},${this.cover(spec)},${subtitles}`;

    return {
      inputs: [
        this.trimmedInput(spec, context.inputs[0].file),
        ...audio.inputs,
      ],
      filterComplex: [video, audio.filter].join(';'),
      maps: ['-map', '[vout]', '-map', '[aout]'],
      files: [{ name: CAPTIONS_FILE, content: this.captionsAss(spec) }],
      duration: this.duration(spec),
    };
  }
}
