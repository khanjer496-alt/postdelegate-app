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
  ImageSlideshowDto,
  STUDIO_MIN_SLIDES,
} from '@gitroom/nestjs-libraries/dtos/studio/image.slideshow.dto';

const SLIDES_FILE = 'slides.ass';
// how long two slides overlap while the transition plays
const TRANSITION_SECONDS = 0.5;
// The pan: each picture is scaled to 1.15 times the frame and the frame
// slides across it. A moving crop costs almost nothing, zoompan is too slow
const PAN_WIDTH = 1242;
const PAN_HEIGHT = 2208;

// per slide: the picture held for its time → a slow pan (crop on t) →
// an xfade chain → the text of each slide → the music (MIX)
@StudioTemplate({
  identifier: 'image-slideshow',
  title: 'Image slideshow',
  description:
    'Two to ten pictures that slowly pan, each with its own line of text and a transition between them.',
  dto: ImageSlideshowDto,
  captions: false,
})
export class ImageSlideshowTemplate extends StudioTemplateAbstract<ImageSlideshowDto> {
  mediaIds(spec: ImageSlideshowDto) {
    return spec.slides.map((slide) => slide.mediaId);
  }

  allowsImage() {
    return true;
  }

  allowsVideo() {
    return false;
  }

  check(spec: ImageSlideshowDto) {
    return spec.slides.length < STUDIO_MIN_SLIDES
      ? `Add at least ${STUDIO_MIN_SLIDES} pictures`
      : undefined;
  }

  checkInputs(spec: ImageSlideshowDto, inputs: StudioPlanInput[]) {
    return inputs.some((input) => !input.image)
      ? 'A slideshow is made of pictures, swap the video for a picture.'
      : undefined;
  }

  private overlap(spec: ImageSlideshowDto) {
    return (spec.transition || 'fade') === 'none' ? 0 : TRANSITION_SECONDS;
  }

  // when each slide starts on the output
  starts(spec: ImageSlideshowDto) {
    const overlap = this.overlap(spec);
    return spec.slides.reduce<number[]>(
      (all, slide, index) =>
        index === 0
          ? [0]
          : [...all, all[index - 1] + spec.slides[index - 1].seconds - overlap],
      []
    );
  }

  duration(spec: ImageSlideshowDto) {
    return Math.max(
      0,
      spec.slides.reduce((all, slide) => all + slide.seconds, 0) -
        (spec.slides.length - 1) * this.overlap(spec)
    );
  }

  slidesAss(spec: ImageSlideshowDto) {
    const style = spec.style || 'bold';
    const starts = this.starts(spec);
    const overlap = this.overlap(spec);
    const last = spec.slides.length - 1;
    return [
      assHeader([
        {
          name: 'Slide',
          font: style,
          size: style === 'impact' ? 100 : 84,
          color: '#FFFFFF',
          position: spec.position || 'bottom',
        },
      ]),
      // each line stays while its picture is on screen, until the next one
      // starts coming in
      ...spec.slides.flatMap((slide, index) =>
        slide.text?.trim()
          ? [
              assDialogue(
                starts[index],
                starts[index] + slide.seconds - (index < last ? overlap : 0),
                'Slide',
                `{\\fad(200,200)}${escapeAssText(slide.text.trim())}`
              ),
            ]
          : []
      ),
      '',
    ].join('\n');
  }

  // The frame slides diagonally across the bigger picture, one way on even
  // slides and back on odd ones. crop keeps x and y on the picture
  private pan(index: number, seconds: number) {
    const progress = `t/${ffNumber(seconds)}`;
    const along = index % 2 === 0 ? progress : `(1-${progress})`;
    return `crop=${STUDIO_WIDTH}:${STUDIO_HEIGHT}:x=(iw-ow)*${along}:y=(ih-oh)*${along}`;
  }

  plan(spec: ImageSlideshowDto, context: StudioPlanContext): StudioPlan {
    const pan = spec.pan !== false;
    const overlap = this.overlap(spec);
    const starts = this.starts(spec);
    const duration = this.duration(spec);
    const count = spec.slides.length;

    const slides = spec.slides.map(
      (slide, index) =>
        `[${index}:v]${
          pan
            ? `${this.coverTo(slide.focus, PAN_WIDTH, PAN_HEIGHT)},${this.hold(
                slide.seconds
              )},${this.pan(index, slide.seconds)}`
            : `${this.coverTo(
                slide.focus,
                STUDIO_WIDTH,
                STUDIO_HEIGHT
              )},${this.hold(slide.seconds)}`
        },format=yuv420p[s${index}]`
    );

    // every transition starts where the next slide starts on the output
    const joined: string[] = [];
    let last = '[s0]';
    if (!overlap) {
      joined.push(
        `${spec.slides.map((_, index) => `[s${index}]`).join('')}concat=n=${count}:v=1:a=0[slides]`
      );
      last = '[slides]';
    } else {
      for (let index = 1; index < count; index++) {
        joined.push(
          `${last}[s${index}]xfade=transition=${
            spec.transition || 'fade'
          }:duration=${ffNumber(overlap)}:offset=${ffNumber(
            starts[index]
          )}[x${index}]`
        );
        last = `[x${index}]`;
      }
    }

    const audio = this.soundtrack({
      music: spec.music,
      context,
      inputIndex: count,
      duration,
    });

    return {
      inputs: [
        ...spec.slides.map((_, index) =>
          this.imageInput(context.inputs[index].file)
        ),
        ...audio.inputs,
      ],
      filterComplex: [
        ...slides,
        ...joined,
        `${last}${this.subtitles(SLIDES_FILE, context)},format=yuv420p[vout]`,
        audio.filter,
      ].join(';'),
      maps: ['-map', '[vout]', '-map', '[aout]'],
      files: [{ name: SLIDES_FILE, content: this.slidesAss(spec) }],
      duration,
    };
  }
}
