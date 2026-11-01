import {
  StudioPlan,
  StudioPlanContext,
  StudioTemplate,
  StudioTemplateAbstract,
  assDialogue,
  assHeader,
  escapeAssText,
} from '@gitroom/nestjs-libraries/studio/studio.interface';
import { HookOverClipDto } from '@gitroom/nestjs-libraries/dtos/studio/hook.over.clip.dto';

const HOOK_FILE = 'hook.ass';

// TRIM → COVER → hook text that pops in and fades out → the clip's sound
@StudioTemplate({
  identifier: 'hook-over-clip',
  title: 'Hook over clip',
  description:
    'A clip filling the vertical frame with a hook line popping in over it.',
  dto: HookOverClipDto,
  captions: false,
})
export class HookOverClipTemplate extends StudioTemplateAbstract<HookOverClipDto> {
  hookAss(spec: HookOverClipDto) {
    const duration = this.duration(spec);
    const style = spec.hook.style || 'bold';
    const end = Math.min(duration, spec.hook.seconds || duration);
    return [
      assHeader([
        {
          name: 'Hook',
          font: style,
          size: style === 'impact' ? 112 : 92,
          color: '#FFFFFF',
          position: spec.hook.position || 'top',
        },
      ]),
      // starts small and grows to full size (the pop), fades in and out
      assDialogue(
        0,
        end,
        'Hook',
        `{\\fad(120,200)\\fscx70\\fscy70\\t(0,160,\\fscx100\\fscy100)}${escapeAssText(
          spec.hook.text
        )}`
      ),
      '',
    ].join('\n');
  }

  plan(spec: HookOverClipDto, context: StudioPlanContext): StudioPlan {
    const audio = this.audio(spec, context, 1);
    return {
      inputs: [
        this.trimmedInput(spec, context.inputs[0].file),
        ...audio.inputs,
      ],
      filterComplex: [
        `${this.videoIn(spec)},${this.cover(spec)},${this.subtitles(
          HOOK_FILE,
          context
        )},format=yuv420p[vout]`,
        audio.filter,
      ].join(';'),
      maps: ['-map', '[vout]', '-map', '[aout]'],
      files: [{ name: HOOK_FILE, content: this.hookAss(spec) }],
      duration: this.duration(spec),
    };
  }
}
