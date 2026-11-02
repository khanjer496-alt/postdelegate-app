import {
  STUDIO_HEIGHT,
  STUDIO_WIDTH,
  StudioPlan,
  StudioPlanContext,
  StudioPlanInput,
  StudioTemplate,
  StudioTemplateAbstract,
  assDialogue,
  assHeader,
  escapeAssText,
  ffNumber,
} from '@gitroom/nestjs-libraries/studio/studio.interface';
import {
  BeforeAfterDto,
  StudioCompareSideDto,
} from '@gitroom/nestjs-libraries/dtos/studio/before.after.dto';

const LABELS_FILE = 'labels.ass';
const HALF_HEIGHT = STUDIO_HEIGHT / 2;

// each side scaled and cropped to its half → vstack, or both full frame and
// the second wiping over the first (xfade) → the labels → the sound (MIX)
@StudioTemplate({
  identifier: 'before-after',
  title: 'Before/after',
  description:
    'Two pictures or videos, one above the other or the second wiping over the first, each with its label.',
  dto: BeforeAfterDto,
  captions: false,
})
export class BeforeAfterTemplate extends StudioTemplateAbstract<BeforeAfterDto> {
  private sides(spec: BeforeAfterDto): StudioCompareSideDto[] {
    return [spec.before, spec.after];
  }

  mediaIds(spec: BeforeAfterDto) {
    return this.sides(spec).map((side) => side.mediaId);
  }

  allowsImage() {
    return true;
  }

  check() {
    return undefined;
  }

  checkInputs(spec: BeforeAfterDto, inputs: StudioPlanInput[]) {
    const late = this.sides(spec).findIndex(
      (side, index) =>
        !inputs[index]?.image &&
        (side.start || 0) >= (inputs[index]?.duration ?? Infinity)
    );
    return late === -1
      ? undefined
      : `The ${
          late === 0 ? 'before' : 'after'
        } video starts after its end.`;
  }

  duration(spec: BeforeAfterDto) {
    return spec.seconds;
  }

  // the wipe starts at 40% of the video and takes a fifth of it, at most
  // a second and a half
  wipe(spec: BeforeAfterDto) {
    const length = Math.min(1.5, spec.seconds / 5);
    return { start: spec.seconds * 0.4, length };
  }

  labelsAss(spec: BeforeAfterDto) {
    const style = spec.style || 'bold';
    const duration = this.duration(spec);
    const before = spec.before.label?.trim();
    const after = spec.after.label?.trim();
    const events: string[] = [];

    if (spec.layout === 'wipe') {
      // one label at a time, swapped half way through the wipe
      const wipe = this.wipe(spec);
      const swap = wipe.start + wipe.length / 2;
      if (before) {
        events.push(
          assDialogue(
            0,
            swap,
            'Label',
            `{\\fad(150,150)}${escapeAssText(before)}`
          )
        );
      }
      if (after) {
        events.push(
          assDialogue(
            swap,
            duration,
            'Label',
            `{\\fad(150,150)}${escapeAssText(after)}`
          )
        );
      }
    } else {
      // each label at the top of its own half
      if (before) {
        events.push(
          assDialogue(
            0,
            duration,
            'Label',
            `{\\an8\\pos(${STUDIO_WIDTH / 2},90)}${escapeAssText(before)}`
          )
        );
      }
      if (after) {
        events.push(
          assDialogue(
            0,
            duration,
            'Label',
            `{\\an8\\pos(${STUDIO_WIDTH / 2},${
              HALF_HEIGHT + 90
            })}${escapeAssText(after)}`
          )
        );
      }
    }

    return [
      assHeader([
        {
          name: 'Label',
          font: style,
          size: style === 'impact' ? 96 : 80,
          color: '#FFFFFF',
          position: 'top',
        },
      ]),
      ...events,
      '',
    ].join('\n');
  }

  // A side as a picture or a video of exactly "seconds" at the frame size
  private side(
    side: StudioCompareSideDto,
    index: number,
    image: boolean,
    seconds: number,
    height: number
  ) {
    const cover = this.coverTo(side.focus, STUDIO_WIDTH, height);
    return `[${index}:v]${
      image
        ? `${cover},${this.hold(seconds)}`
        : `${this.fill(seconds)},${cover}`
    },format=yuv420p[side${index}]`;
  }

  plan(spec: BeforeAfterDto, context: StudioPlanContext): StudioPlan {
    const duration = this.duration(spec);
    const sides = this.sides(spec);
    const wipe = this.wipe(spec);
    const labels = `${this.subtitles(LABELS_FILE, context)},format=yuv420p[vout]`;

    const video =
      spec.layout === 'wipe'
        ? [
            // the first only needs to last until the wipe is over
            this.side(
              sides[0],
              0,
              !!context.inputs[0].image,
              wipe.start + wipe.length,
              STUDIO_HEIGHT
            ),
            this.side(
              sides[1],
              1,
              !!context.inputs[1].image,
              duration - wipe.start,
              STUDIO_HEIGHT
            ),
            `[side0][side1]xfade=transition=wiperight:duration=${ffNumber(
              wipe.length
            )}:offset=${ffNumber(wipe.start)},${labels}`,
          ]
        : [
            ...sides.map((side, index) =>
              this.side(
                side,
                index,
                !!context.inputs[index].image,
                duration,
                HALF_HEIGHT
              )
            ),
            `[side0][side1]vstack=inputs=2,${labels}`,
          ];

    // the sound of the first video that has one
    const voice = spec.mute
      ? -1
      : context.inputs.findIndex((input) => !input.image && input.hasAudio);
    const audio = this.soundtrack({
      voice:
        voice === -1
          ? undefined
          : `[${voice}:a]asetpts=PTS-STARTPTS,aresample=48000,apad,atrim=duration=${ffNumber(
              duration
            )}`,
      music: spec.music,
      context,
      inputIndex: 2,
      duration,
    });

    return {
      inputs: [
        ...sides.map((side, index) =>
          context.inputs[index].image
            ? this.imageInput(context.inputs[index].file)
            : this.videoInput(
                context.inputs[index].file,
                side.start || 0,
                duration
              )
        ),
        ...audio.inputs,
      ],
      filterComplex: [...video, audio.filter].join(';'),
      maps: ['-map', '[vout]', '-map', '[aout]'],
      files: [{ name: LABELS_FILE, content: this.labelsAss(spec) }],
      duration,
    };
  }
}
