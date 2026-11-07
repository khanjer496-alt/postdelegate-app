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
  STUDIO_LIST_ITEM_SECONDS,
  STUDIO_MIN_LIST_ITEMS,
  StudioListItemDto,
  TopNListDto,
} from '@gitroom/nestjs-libraries/dtos/studio/top.n.list.dto';

const LIST_FILE = 'list.ass';
const AUDIO_FORMAT = 'aformat=sample_fmts=fltp:channel_layouts=stereo';

// per item TRIM → COVER → concat of every item → "#n label" over each item
// and the title across the whole video → the sound (MIX)
@StudioTemplate({
  identifier: 'top-n-list',
  title: 'Top-N list',
  description:
    'A title over 3 to 7 pictures or clips one after the other, each numbered with its label.',
  dto: TopNListDto,
  captions: false,
})
export class TopNListTemplate extends StudioTemplateAbstract<TopNListDto> {
  mediaIds(spec: TopNListDto) {
    return spec.items.map((item) => item.mediaId);
  }

  allowsImage() {
    return true;
  }

  // a clip plays its trim, a picture (or a clip without one) its seconds
  length(item: StudioListItemDto) {
    return item.trim
      ? Math.max(0, item.trim.end - item.trim.start)
      : item.seconds || STUDIO_LIST_ITEM_SECONDS;
  }

  check(spec: TopNListDto) {
    if (spec.items.length < STUDIO_MIN_LIST_ITEMS) {
      return `Add at least ${STUDIO_MIN_LIST_ITEMS} items`;
    }
    const wrong = spec.items.findIndex(
      (item) => item.trim && item.trim.end <= item.trim.start
    );
    return wrong === -1
      ? undefined
      : `The end of item ${wrong + 1} must be after its start`;
  }

  checkInputs(spec: TopNListDto, inputs: StudioPlanInput[]) {
    const late = spec.items.findIndex(
      (item, index) =>
        !inputs[index]?.image &&
        (item.trim?.start || 0) >= (inputs[index]?.duration ?? Infinity)
    );
    return late === -1
      ? undefined
      : `Item ${late + 1} starts after the end of its video.`;
  }

  duration(spec: TopNListDto) {
    return spec.items.reduce((all, item) => all + this.length(item), 0);
  }

  // the number each item shows: counting down to #1 unless told otherwise
  number(spec: TopNListDto, index: number) {
    return spec.countdown === false ? index + 1 : spec.items.length - index;
  }

  listAss(spec: TopNListDto) {
    const style = spec.style || 'bold';
    const duration = this.duration(spec);
    let start = 0;
    const items = spec.items.map((item, index) => {
      const end = start + this.length(item);
      const event = assDialogue(
        start,
        end,
        'Item',
        `{\\fad(150,150)}#${this.number(spec, index)} ${escapeAssText(
          item.label.trim()
        )}`
      );
      start = end;
      return event;
    });

    return [
      assHeader([
        {
          name: 'Title',
          font: style,
          size: style === 'impact' ? 104 : 88,
          color: '#FFFFFF',
          position: 'top',
        },
        {
          name: 'Item',
          font: style,
          size: style === 'impact' ? 96 : 80,
          color: '#FFD400',
          position: 'bottom',
        },
      ]),
      assDialogue(0, duration, 'Title', escapeAssText(spec.title.trim())),
      ...items,
      '',
    ].join('\n');
  }

  plan(spec: TopNListDto, context: StudioPlanContext): StudioPlan {
    const duration = this.duration(spec);
    const count = spec.items.length;
    // the clips' own sound when one of them has some, otherwise none at all
    const sound =
      !spec.mute &&
      context.inputs.some((input) => !input.image && input.hasAudio);

    const segments = spec.items.flatMap((item, index) => {
      const input = context.inputs[index];
      const length = this.length(item);
      const cover = this.coverTo(item.focus, STUDIO_WIDTH, STUDIO_HEIGHT);
      const video = `[${index}:v]${
        input.image
          ? `${cover},${this.hold(length)}`
          : `${this.fill(length)},${cover}`
      },format=yuv420p[v${index}]`;
      if (!sound) {
        return [video];
      }
      return [
        video,
        !input.image && input.hasAudio
          ? `[${index}:a]asetpts=PTS-STARTPTS,aresample=48000,${AUDIO_FORMAT},apad,atrim=duration=${ffNumber(
              length
            )}[a${index}]`
          : `anullsrc=r=48000:cl=stereo,${AUDIO_FORMAT},atrim=duration=${ffNumber(
              length
            )}[a${index}]`,
      ];
    });

    const concat = `${spec.items
      .map((_, index) => (sound ? `[v${index}][a${index}]` : `[v${index}]`))
      .join('')}concat=n=${count}:v=1:a=${sound ? 1 : 0}[list]${
      sound ? '[listaudio]' : ''
    }`;

    const audio = this.soundtrack({
      voice: sound ? '[listaudio]asetpts=PTS-STARTPTS' : undefined,
      music: spec.music,
      context,
      inputIndex: count,
      duration,
    });

    return {
      inputs: [
        ...spec.items.map((item, index) =>
          context.inputs[index].image
            ? this.imageInput(context.inputs[index].file)
            : this.videoInput(
                context.inputs[index].file,
                item.trim?.start || 0,
                this.length(item)
              )
        ),
        ...audio.inputs,
      ],
      filterComplex: [
        ...segments,
        concat,
        `[list]${this.subtitles(LIST_FILE, context)},format=yuv420p[vout]`,
        audio.filter,
      ].join(';'),
      maps: ['-map', '[vout]', '-map', '[aout]'],
      files: [{ name: LIST_FILE, content: this.listAss(spec) }],
      duration,
    };
  }
}
