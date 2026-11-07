import {
  STUDIO_FPS,
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
  QuoteCardDto,
  STUDIO_QUOTE_COLOR,
} from '@gitroom/nestjs-libraries/dtos/studio/quote.card.dto';

const QUOTE_FILE = 'quote.ass';
// how long each word takes to fade in, in milliseconds
const WORD_FADE = 300;

// A validated "#RRGGBB" as ffmpeg's colour syntax; anything else is the
// default, so nothing but six hex digits ever reaches the filter graph
const ffColor = (hex?: string) =>
  `0x${(hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : STUDIO_QUOTE_COLOR)
    .slice(1)
    .toUpperCase()}`;

// a colour (color=s=1080x1920) or COVER of a picture or video → the quote
// fading in word by word and its author → the music (MIX)
@StudioTemplate({
  identifier: 'quote-card',
  title: 'Quote card',
  description:
    'A quote that appears word by word with its author, over a colour, a picture or a video.',
  dto: QuoteCardDto,
  captions: false,
})
export class QuoteCardTemplate extends StudioTemplateAbstract<QuoteCardDto> {
  mediaIds(spec: QuoteCardDto) {
    return spec.background.mediaId ? [spec.background.mediaId] : [];
  }

  allowsImage() {
    return true;
  }

  check() {
    return undefined;
  }

  checkInputs(spec: QuoteCardDto, inputs: StudioPlanInput[]) {
    const input = inputs[0];
    return input &&
      !input.image &&
      (spec.background.start || 0) >= (input.duration ?? Infinity)
      ? 'The background video starts after its end.'
      : undefined;
  }

  duration(spec: QuoteCardDto) {
    return spec.seconds;
  }

  // the words come in over the first part of the video, at most 60% of it,
  // and the author once they are all there
  quoteAss(spec: QuoteCardDto) {
    const style = spec.style || 'bold';
    const words = spec.quote.trim().split(/\s+/).filter(Boolean);
    const length = spec.quote.trim().length;
    const base = length <= 80 ? 84 : length <= 160 ? 72 : 60;
    const size = style === 'impact' ? base + 12 : base;
    const reveal = Math.min(
      spec.seconds * 0.6,
      Math.max(1, words.length * 0.18)
    );
    const step = (reveal * 1000) / Math.max(1, words.length);
    const text = words
      .map((word, index) => {
        const at = Math.round(index * step);
        return `{\\alpha&HFF&\\t(${at},${
          at + WORD_FADE
        },\\alpha&H00&)}${escapeAssText(word)}`;
      })
      .join(' ');
    const end = Math.round(reveal * 1000);
    const author = spec.author?.trim()
      ? `\\N{\\fs${Math.round(size * 0.6)}\\alpha&HFF&\\t(${end},${
          end + 400
        },\\alpha&H00&)}— ${escapeAssText(spec.author.trim())}`
      : '';

    return [
      assHeader([
        {
          name: 'Quote',
          font: style,
          size,
          color: spec.textColor || '#FFFFFF',
          position: 'center',
        },
      ]),
      assDialogue(
        0,
        this.duration(spec),
        'Quote',
        `{\\fad(0,300)}${text}${author}`
      ),
      '',
    ].join('\n');
  }

  plan(spec: QuoteCardDto, context: StudioPlanContext): StudioPlan {
    const duration = this.duration(spec);
    const background = context.inputs[0];
    const dim =
      spec.dim === false
        ? ''
        : ',drawbox=x=0:y=0:w=iw:h=ih:color=black@0.45:t=fill';

    const inputs = !background
      ? [
          [
            '-f',
            'lavfi',
            '-i',
            `color=c=${ffColor(
              spec.background.color
            )}:s=${STUDIO_WIDTH}x${STUDIO_HEIGHT}:r=${STUDIO_FPS}:d=${ffNumber(
              duration
            )}`,
          ],
        ]
      : background.image
      ? [this.imageInput(background.file)]
      : [
          this.videoInput(
            background.file,
            spec.background.start || 0,
            duration
          ),
        ];

    const cover = this.coverTo(
      spec.background.focus,
      STUDIO_WIDTH,
      STUDIO_HEIGHT
    );
    const frame = !background
      ? '[0:v]setsar=1'
      : background.image
      ? `[0:v]${cover},${this.hold(duration)}${dim}`
      : `[0:v]${this.fill(duration)},${cover}${dim}`;

    const audio = this.soundtrack({
      music: spec.music,
      context,
      inputIndex: 1,
      duration,
    });

    return {
      inputs: [...inputs, ...audio.inputs],
      filterComplex: [
        `${frame},${this.subtitles(QUOTE_FILE, context)},format=yuv420p[vout]`,
        audio.filter,
      ].join(';'),
      maps: ['-map', '[vout]', '-map', '[aout]'],
      files: [{ name: QUOTE_FILE, content: this.quoteAss(spec) }],
      duration,
    };
  }
}
