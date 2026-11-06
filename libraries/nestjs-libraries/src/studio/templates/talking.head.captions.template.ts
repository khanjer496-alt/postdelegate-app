import {
  StudioPlan,
  StudioPlanContext,
  StudioTemplate,
  StudioTemplateAbstract,
  assKaraoke,
} from '@gitroom/nestjs-libraries/studio/studio.interface';
import { wordsOnOutput } from '@gitroom/helpers/utils/studio.captions';
import { TalkingHeadCaptionsDto } from '@gitroom/nestjs-libraries/dtos/studio/talking.head.captions.dto';

const CAPTIONS_FILE = 'captions.ass';

// TRIM → COVER or BLUR → captions lighting up word by word
@StudioTemplate({
  identifier: 'talking-head-captions',
  title: 'Talking head + captions',
  description:
    'Your clip with burned-in captions that light up word by word, from your AI key or a typed script.',
  agentDescription:
    'A clip with burned-in captions that light up word by word, from a typed script (captions.script, timed over the clip by Studio) or your own word timings (captions.words).',
  dto: TalkingHeadCaptionsDto,
  captions: true,
})
export class TalkingHeadCaptionsTemplate extends StudioTemplateAbstract<TalkingHeadCaptionsDto> {
  captionsAss(spec: TalkingHeadCaptionsDto) {
    return assKaraoke(
      wordsOnOutput(
        spec.captions.words,
        spec.trim,
        this.speed(spec),
        this.duration(spec)
      ),
      spec.captions.style
    );
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
