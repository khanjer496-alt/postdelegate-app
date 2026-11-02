import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { StudioTemplateManager } from '@gitroom/nestjs-libraries/studio/studio.manager';
import { HookOverClipTemplate } from '@gitroom/nestjs-libraries/studio/templates/hook.over.clip.template';
import { ImageSlideshowTemplate } from '@gitroom/nestjs-libraries/studio/templates/image.slideshow.template';
import { BeforeAfterTemplate } from '@gitroom/nestjs-libraries/studio/templates/before.after.template';
import { TopNListTemplate } from '@gitroom/nestjs-libraries/studio/templates/top.n.list.template';
import { QuoteCardTemplate } from '@gitroom/nestjs-libraries/studio/templates/quote.card.template';
import {
  StudioPlanContext,
  StudioPlanInput,
} from '@gitroom/nestjs-libraries/studio/studio.interface';

const id = '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f';
const assetId = '9b2f4c1d-3e5a-4b6c-8d7e-0f1a2b3c4d5e';
const fontsDir = '/usr/share/fonts/truetype/postdelegate-studio';
const picture = (file: string): StudioPlanInput => ({
  file,
  hasAudio: false,
  image: true,
});
const clip = (file: string, hasAudio = true): StudioPlanInput => ({
  file,
  hasAudio,
  duration: 20,
});
const context = (
  inputs: StudioPlanInput[],
  music = false
): StudioPlanContext => ({
  inputs,
  fontsDir,
  ...(music ? { music: { file: 'music.mp3' } } : {}),
});
const events = (ass: string) =>
  ass.split('\n').filter((line) => line.startsWith('Dialogue:'));

const slideshowSpec = {
  slides: [
    { mediaId: id, seconds: 3, text: 'First light', focus: { x: 0.2, y: 0.5 } },
    { mediaId: id, seconds: 2.5, text: 'Second' },
    { mediaId: id, seconds: 4 },
  ],
  transition: 'fade',
  style: 'impact',
  position: 'center',
} as any;

const beforeAfterSpec = {
  before: { mediaId: id, label: 'Before' },
  after: { mediaId: id, label: 'After', start: 2 },
  seconds: 6,
} as any;

const listSpec = {
  title: 'Top 3 tools',
  items: [
    { mediaId: id, label: 'Hammer', seconds: 2 },
    { mediaId: id, label: 'Saw', trim: { start: 1, end: 4.5 } },
    { mediaId: id, label: 'Drill' },
  ],
} as any;

const quoteSpec = {
  quote: 'Make it work, then make it good',
  author: 'A builder',
  background: { color: '#1E3A8A' },
  seconds: 8,
} as any;

const manager = () => {
  const templates = new Map<any, any>([
    [ImageSlideshowTemplate, new ImageSlideshowTemplate()],
    [BeforeAfterTemplate, new BeforeAfterTemplate()],
    [TopNListTemplate, new TopNListTemplate()],
    [QuoteCardTemplate, new QuoteCardTemplate()],
    [HookOverClipTemplate, new HookOverClipTemplate()],
  ]);
  return new StudioTemplateManager({
    get: (target: any) => templates.get(target),
  } as any);
};

describe('Studio picture and clip templates', () => {
  it('registers the four templates', () => {
    expect(
      manager()
        .getAllTemplates()
        .map((p) => p.identifier)
    ).toEqual(
      expect.arrayContaining([
        'image-slideshow',
        'before-after',
        'top-n-list',
        'quote-card',
      ])
    );
  });

  describe('Image slideshow', () => {
    const template = new ImageSlideshowTemplate();
    const inputs = [picture('source-0.png'), picture('source-1.jpg'), picture('source-2.webp')];

    it('plans the pan, the xfade chain and the slide texts', () => {
      const plan = template.plan(slideshowSpec, context(inputs));
      // 9.5 seconds of slides less two half second transitions
      expect(plan.duration).toBe(8.5);
      expect(template.starts(slideshowSpec)).toEqual([0, 2.5, 4.5]);
      expect(plan.inputs).toMatchSnapshot('inputs');
      expect(plan.filterComplex).toMatchSnapshot('filter');
      expect(plan.filterComplex).not.toContain('zoompan');
      expect(plan.files[0].content).toMatchSnapshot('slides.ass');
      // the slide without text has no event
      expect(events(plan.files[0].content)).toHaveLength(2);
    });

    it('cuts without a transition or a pan, with music', () => {
      const plan = template.plan(
        {
          ...slideshowSpec,
          transition: 'none',
          pan: false,
          music: { assetId, volume: 0.5 },
        },
        context(inputs, true)
      );
      expect(plan.duration).toBe(9.5);
      expect(plan.filterComplex).toContain('concat=n=3:v=1:a=0[slides]');
      expect(plan.filterComplex).not.toContain('xfade');
      expect(plan.inputs[3]).toContain('-stream_loop');
      expect(plan.filterComplex).toMatchSnapshot('filter');
    });

    it('takes pictures only, at least two', () => {
      expect(template.allowsImage()).toBe(true);
      expect(
        template.checkInputs(slideshowSpec, [
          picture('source-0.png'),
          clip('source-1.mp4'),
          picture('source-2.png'),
        ])
      ).toContain('pictures');
      expect(
        template.check({ ...slideshowSpec, slides: [slideshowSpec.slides[0]] })
      ).toContain('at least 2');
    });
  });

  describe('Before/after', () => {
    const template = new BeforeAfterTemplate();

    it('plans two halves stacked with a label on each', () => {
      const plan = template.plan(
        beforeAfterSpec,
        context([picture('source-0.png'), clip('source-1.mp4')])
      );
      expect(plan.duration).toBe(6);
      expect(plan.inputs).toMatchSnapshot('inputs');
      expect(plan.filterComplex).toMatchSnapshot('filter');
      expect(plan.files[0].content).toMatchSnapshot('labels.ass');
    });

    it('plans a wipe with the labels swapping, muted under music', () => {
      const plan = template.plan(
        {
          ...beforeAfterSpec,
          layout: 'wipe',
          mute: true,
          music: { assetId },
        },
        context([clip('source-0.mp4'), clip('source-1.mp4')], true)
      );
      const wipe = template.wipe({ ...beforeAfterSpec });
      expect(wipe.start).toBeCloseTo(2.4);
      expect(wipe.length).toBeCloseTo(1.2);
      expect(plan.filterComplex).toContain('xfade=transition=wiperight');
      // muted: the music plays alone, no ducking
      expect(plan.filterComplex).not.toContain('sidechaincompress');
      expect(plan.filterComplex).toMatchSnapshot('filter');
      expect(plan.files[0].content).toMatchSnapshot('labels.ass');
    });

    it('refuses a video that starts after its end', () => {
      expect(
        template.checkInputs(
          { ...beforeAfterSpec, after: { mediaId: id, start: 30 } },
          [picture('source-0.png'), clip('source-1.mp4')]
        )
      ).toContain('after video');
    });
  });

  describe('Top-N list', () => {
    const template = new TopNListTemplate();

    it('plans every item numbered over a title, with the clip sound', () => {
      const plan = template.plan(
        listSpec,
        context([
          picture('source-0.png'),
          clip('source-1.mp4'),
          picture('source-2.jpg'),
        ])
      );
      // 2 + 3.5 + 3 (the default for a picture)
      expect(plan.duration).toBe(8.5);
      expect(plan.inputs).toMatchSnapshot('inputs');
      expect(plan.filterComplex).toMatchSnapshot('filter');
      expect(plan.filterComplex).toContain('concat=n=3:v=1:a=1');
      expect(plan.files[0].content).toMatchSnapshot('list.ass');
      const lines = events(plan.files[0].content);
      expect(lines[1]).toContain('#3 Hammer');
      expect(lines[3]).toContain('#1 Drill');
    });

    it('counts up, and pictures only concat without sound under music', () => {
      const plan = template.plan(
        { ...listSpec, countdown: false, music: { assetId } },
        context(
          [picture('source-0.png'), picture('source-1.png'), picture('source-2.png')],
          true
        )
      );
      expect(plan.filterComplex).toContain('concat=n=3:v=1:a=0[list]');
      expect(plan.filterComplex).toMatchSnapshot('filter');
      expect(events(plan.files[0].content)[1]).toContain('#1 Hammer');
    });

    it('checks the items and their trims', () => {
      expect(
        template.check({ ...listSpec, items: listSpec.items.slice(0, 2) })
      ).toContain('at least 3');
      expect(
        template.check({
          ...listSpec,
          items: [
            ...listSpec.items.slice(0, 2),
            { mediaId: id, label: 'x', trim: { start: 5, end: 2 } },
          ],
        })
      ).toContain('item 3');
      expect(
        template.checkInputs(listSpec, [
          picture('source-0.png'),
          { file: 'source-1.mp4', hasAudio: true, duration: 0.5 },
          picture('source-2.png'),
        ])
      ).toContain('Item 2');
    });
  });

  describe('Quote card', () => {
    const template = new QuoteCardTemplate();

    it('plans a colour background with the words fading in', () => {
      const plan = template.plan(quoteSpec, context([]));
      expect(template.mediaIds(quoteSpec)).toEqual([]);
      expect(plan.inputs).toMatchSnapshot('inputs');
      expect(plan.filterComplex).toMatchSnapshot('filter');
      expect(plan.files[0].content).toMatchSnapshot('quote.ass');
      // one event: the words each fade in, then the author
      expect(events(plan.files[0].content)).toHaveLength(1);
    });

    it('plans a dimmed picture or video background with music', () => {
      const spec = {
        ...quoteSpec,
        background: { mediaId: id, focus: { x: 0.7, y: 0.5 } },
        music: { assetId },
      };
      expect(template.mediaIds(spec)).toEqual([id]);
      const image = template.plan(spec, context([picture('source-0.jpg')], true));
      expect(image.filterComplex).toContain('drawbox');
      expect(image.filterComplex).toMatchSnapshot('filter');
      const video = template.plan(
        { ...spec, dim: false, background: { mediaId: id, start: 3 } },
        context([clip('source-0.mp4')], true)
      );
      expect(video.filterComplex).not.toContain('drawbox');
      expect(video.inputs[0]).toEqual(expect.arrayContaining(['-ss', '3']));
    });

    it('keeps anything but a hex colour out of the graph', () => {
      const plan = template.plan(
        { ...quoteSpec, background: { color: "red:d=999;[x]" } },
        context([])
      );
      expect(plan.inputs[0].join(' ')).toContain('color=c=0x111111');
      expect(plan.inputs[0].join(' ')).not.toContain('999');
    });
  });

  describe('Music', () => {
    it('ducks the music under the sound of the clip and normalises it', () => {
      const plan = new HookOverClipTemplate().plan(
        {
          input: { mediaId: id },
          trim: { start: 2, end: 12 },
          hook: { text: 'With music' },
          music: { assetId, start: 15, volume: 0.2 },
        } as any,
        context([clip('source-0.mp4')], true)
      );
      expect(plan.inputs[1]).toEqual([
        '-protocol_whitelist',
        'file',
        '-format_whitelist',
        'mp3,mov,mp4,m4a,3gp,3g2,mj2,wav',
        '-threads',
        '2',
        '-stream_loop',
        '-1',
        '-ss',
        '15',
        '-t',
        '10',
        '-i',
        'music.mp3',
      ]);
      expect(plan.filterComplex).toMatchSnapshot('filter');
      expect(plan.filterComplex).toContain('sidechaincompress');
      expect(plan.filterComplex).toContain('afade=t=out:st=8:d=2');
      expect(plan.filterComplex).toContain('volume=0.2');
      expect(plan.filterComplex).toContain('loudnorm=I=-14');
    });

    it('plays the music alone over a muted clip, without ducking', () => {
      const plan = new HookOverClipTemplate().plan(
        {
          input: { mediaId: id },
          trim: { start: 0, end: 10 },
          mute: true,
          hook: { text: 'Muted' },
          music: { assetId },
        } as any,
        context([clip('source-0.mp4')], true)
      );
      expect(plan.filterComplex).not.toContain('sidechaincompress');
      expect(plan.filterComplex).not.toContain('[0:a]');
      expect(plan.filterComplex).toContain('loudnorm=I=-14');
    });

    it('is ignored when the render found no music file', () => {
      const plan = new ImageSlideshowTemplate().plan(
        { ...slideshowSpec, music: { assetId } },
        context([picture('a.png'), picture('b.png'), picture('c.png')])
      );
      expect(plan.filterComplex).toContain('anull[aout]');
    });
  });

  it('never puts user text in the filter graph', () => {
    const text = "x';drawtext=text=pwned:[out]";
    const inputs = [picture('source-0.png'), picture('source-1.png'), picture('source-2.png')];
    const plans = [
      new ImageSlideshowTemplate().plan(
        {
          ...slideshowSpec,
          slides: slideshowSpec.slides.map((slide: any) => ({ ...slide, text })),
        },
        context(inputs)
      ),
      new BeforeAfterTemplate().plan(
        {
          ...beforeAfterSpec,
          before: { mediaId: id, label: text },
          after: { mediaId: id, label: '{\\pos(0,0)}pwned' },
        },
        context(inputs.slice(0, 2))
      ),
      new TopNListTemplate().plan(
        {
          ...listSpec,
          title: text,
          items: listSpec.items.map((item: any) => ({ ...item, label: text })),
        },
        context(inputs)
      ),
      new QuoteCardTemplate().plan(
        { ...quoteSpec, quote: `${text} {\\fs300}`, author: text },
        context([])
      ),
    ];
    for (const plan of plans) {
      expect(plan.filterComplex).not.toContain('pwned');
      expect(plan.files[0].content).toContain('pwned');
      // a user brace is always escaped, only our own tags open a block
      expect(plan.files[0].content).not.toContain('{\\pos(0,0)');
      expect(plan.files[0].content).not.toContain('{\\fs300');
    }
  });
});

describe('Studio picture and clip spec validation', () => {
  it('accepts whole specs and drops unknown fields', async () => {
    const slideshow = await manager().validateSpec(
      'image-slideshow',
      { ...slideshowSpec, url: 'http://169.254.169.254/' },
      false
    );
    expect(slideshow.slides).toHaveLength(3);
    expect((slideshow as any).url).toBeUndefined();
    await expect(
      manager().validateSpec('before-after', beforeAfterSpec, false)
    ).resolves.toBeTruthy();
    await expect(
      manager().validateSpec('top-n-list', listSpec, false)
    ).resolves.toBeTruthy();
    await expect(
      manager().validateSpec('quote-card', quoteSpec, false)
    ).resolves.toBeTruthy();
  });

  it.each([
    ['image-slideshow', { ...slideshowSpec, slides: [slideshowSpec.slides[0]] }],
    [
      'image-slideshow',
      { ...slideshowSpec, slides: new Array(11).fill(slideshowSpec.slides[0]) },
    ],
    [
      'image-slideshow',
      { ...slideshowSpec, slides: [{ mediaId: id, seconds: 1 }, { mediaId: id, seconds: 6 }] },
    ],
    ['image-slideshow', { ...slideshowSpec, transition: 'zoompan' }],
    ['image-slideshow', { ...slideshowSpec, slides: [{ mediaId: 'https://x.y/a.png', seconds: 2 }, slideshowSpec.slides[0]] }],
    ['before-after', { ...beforeAfterSpec, layout: 'side' }],
    ['before-after', { ...beforeAfterSpec, seconds: 31 }],
    ['before-after', { ...beforeAfterSpec, before: { mediaId: id, label: 'x'.repeat(41) } }],
    ['top-n-list', { ...listSpec, items: listSpec.items.slice(0, 2) }],
    ['top-n-list', { ...listSpec, items: new Array(8).fill(listSpec.items[0]) }],
    ['top-n-list', { ...listSpec, title: 'x'.repeat(81) }],
    ['top-n-list', { ...listSpec, items: [{ mediaId: id }, ...listSpec.items.slice(1)] }],
    ['quote-card', { ...quoteSpec, seconds: 4 }],
    ['quote-card', { ...quoteSpec, seconds: 16 }],
    ['quote-card', { ...quoteSpec, quote: 'x'.repeat(301) }],
    ['quote-card', { ...quoteSpec, background: { color: 'red' } }],
    ['quote-card', { ...quoteSpec, textColor: '#FFF' }],
    ['quote-card', { ...quoteSpec, music: { assetId: 'not-an-id' } }],
    ['quote-card', { ...quoteSpec, music: { assetId, volume: 2 } }],
    ['hook-over-clip', {
      input: { mediaId: id },
      trim: { start: 0, end: 5 },
      hook: { text: 'x' },
      music: { assetId, start: -1 },
    }],
  ])('refuses a wrong %s spec', async (template, spec) => {
    await expect(
      manager().validateSpec(template, spec, false)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('says which slide, item or side is wrong, in words for the customer', async () => {
    const reasons = async (template: string, spec: unknown) =>
      (
        (await manager()
          .validateSpec(template, spec, false)
          .catch((err) => err)) as BadRequestException
      ).getResponse() as { message: string[] };

    expect(
      (
        await reasons('image-slideshow', {
          ...slideshowSpec,
          slides: [slideshowSpec.slides[0], { mediaId: id, seconds: 9 }],
        })
      ).message
    ).toEqual(['Slide 2: Show each picture for 1.5 to 5 seconds']);
    expect(
      (
        await reasons('top-n-list', {
          ...listSpec,
          items: [...listSpec.items.slice(0, 2), { mediaId: 'x', label: '' }],
        })
      ).message
    ).toEqual(
      expect.arrayContaining([
        'Item 3: Pick a picture or video from your media library',
        'Item 3: Add a label',
      ])
    );
    expect(
      (
        await reasons('before-after', {
          ...beforeAfterSpec,
          before: { mediaId: id, label: 'x'.repeat(41) },
        })
      ).message
    ).toEqual(['Before: A label is 40 characters at most']);
    expect(
      (await reasons('quote-card', { ...quoteSpec, seconds: 30 })).message
    ).toEqual(['Make the video 5 to 15 seconds long']);
  });

  it('lets a draft hold fewer items than a render needs, never more', async () => {
    await expect(
      manager().validateSpec(
        'image-slideshow',
        { slides: [slideshowSpec.slides[0]] },
        true
      )
    ).resolves.toBeTruthy();
    await expect(
      manager().validateSpec('top-n-list', { items: [] }, true)
    ).resolves.toBeTruthy();
    await expect(
      manager().validateSpec(
        'image-slideshow',
        { slides: new Array(11).fill(slideshowSpec.slides[0]) },
        true
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
