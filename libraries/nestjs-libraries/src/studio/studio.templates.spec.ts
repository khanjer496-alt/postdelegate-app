import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { StudioTemplateManager } from '@gitroom/nestjs-libraries/studio/studio.manager';
import { HookOverClipTemplate } from '@gitroom/nestjs-libraries/studio/templates/hook.over.clip.template';
import { TalkingHeadCaptionsTemplate } from '@gitroom/nestjs-libraries/studio/templates/talking.head.captions.template';
import { StudioPlanContext } from '@gitroom/nestjs-libraries/studio/studio.interface';

const context: StudioPlanContext = {
  inputs: [{ file: 'source-0.mp4', hasAudio: true }],
  fontsDir: '/usr/share/fonts/truetype/postdelegate-studio',
};

const hookSpec = {
  input: { mediaId: '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f' },
  trim: { start: 2.5, end: 17.5 },
  speed: 1.5,
  focus: { x: 0.3, y: 0.5 },
  hook: { text: 'Nobody tells you this', style: 'bold', position: 'top' },
} as any;

const captionsSpec = {
  input: { mediaId: '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f' },
  trim: { start: 10, end: 20 },
  fit: 'crop',
  captions: {
    source: 'script',
    words: [
      { text: 'This', start: 10, end: 10.4 },
      { text: 'is', start: 10.4, end: 10.6 },
      { text: 'how', start: 10.6, end: 11 },
      { text: 'it', start: 11, end: 11.2 },
      { text: 'works', start: 11.2, end: 11.8 },
    ],
    style: { maxWords: 3, color: '#FFFFFF', highlight: '#FFD400' },
  },
} as any;

const manager = () => {
  const templates = new Map<any, any>([
    [HookOverClipTemplate, new HookOverClipTemplate()],
    [TalkingHeadCaptionsTemplate, new TalkingHeadCaptionsTemplate()],
  ]);
  return new StudioTemplateManager({
    get: (target: any) => templates.get(target),
  } as any);
};

describe('Studio templates', () => {
  it('registers both templates with their DTO', () => {
    expect(
      manager()
        .getAllTemplates()
        .map((p) => [p.identifier, p.captions])
    ).toEqual(
      expect.arrayContaining([
        ['hook-over-clip', false],
        ['talking-head-captions', true],
      ])
    );
  });

  it('plans "Hook over clip"', () => {
    const plan = new HookOverClipTemplate().plan(hookSpec, context);
    expect(plan.duration).toBe(10);
    expect(plan.inputs).toMatchSnapshot('inputs');
    expect(plan.filterComplex).toMatchSnapshot('filter');
    expect(plan.maps).toEqual(['-map', '[vout]', '-map', '[aout]']);
    expect(plan.files[0].content).toMatchSnapshot('hook.ass');
  });

  it('plans "Hook over clip" muted with a silent track', () => {
    const plan = new HookOverClipTemplate().plan(
      { ...hookSpec, speed: 1, mute: true },
      context
    );
    expect(plan.inputs[1]).toEqual([
      '-f',
      'lavfi',
      '-t',
      '15',
      '-i',
      'anullsrc=r=48000:cl=stereo',
    ]);
    expect(plan.filterComplex).toMatchSnapshot('filter');
  });

  it('plans "Talking head + captions" cropped', () => {
    const plan = new TalkingHeadCaptionsTemplate().plan(captionsSpec, context);
    expect(plan.filterComplex).toMatchSnapshot('filter');
    expect(plan.files[0].content).toMatchSnapshot('captions.ass');
  });

  it('plans "Talking head + captions" over a blurred copy, without sound', () => {
    const plan = new TalkingHeadCaptionsTemplate().plan(
      { ...captionsSpec, fit: 'blur' },
      { ...context, inputs: [{ file: 'source-0.mov', hasAudio: false }] }
    );
    expect(plan.inputs).toMatchSnapshot('inputs');
    expect(plan.filterComplex).toMatchSnapshot('filter');
  });

  it('never puts user text in the filter graph', () => {
    const text = "x';drawtext=text=pwned:[out]";
    const hook = new HookOverClipTemplate().plan(
      { ...hookSpec, hook: { ...hookSpec.hook, text } },
      context
    );
    expect(hook.filterComplex).not.toContain('pwned');
    expect(hook.files[0].content).toContain('pwned');

    const captions = new TalkingHeadCaptionsTemplate().plan(
      {
        ...captionsSpec,
        captions: {
          ...captionsSpec.captions,
          words: [{ text: '{\\pos(0,0)}pwned', start: 10, end: 11 }],
        },
      },
      context
    );
    expect(captions.filterComplex).not.toContain('pwned');
    // the user's brace is escaped, only our own colour tags open a block
    expect(captions.files[0].content).toContain('\\{\\\u2060pos(0,0)\\}pwned');
  });

  it('highlights one word per event', () => {
    const ass = new TalkingHeadCaptionsTemplate().captionsAss(captionsSpec);
    const events = ass.split('\n').filter((p) => p.startsWith('Dialogue:'));
    // 5 words in lines of 3 and 2
    expect(events).toHaveLength(5);
    expect(events[0]).toContain('0:00:00.00,0:00:00.40');
    expect(events[1]).toContain('{\\1c&H0000D4FF&}is{\\1c&H00FFFFFF&}');
  });
});

describe('Studio spec validation', () => {
  it('accepts a whole spec and drops unknown fields', async () => {
    const spec = await manager().validateSpec(
      'hook-over-clip',
      { ...hookSpec, url: 'http://169.254.169.254/' },
      false
    );
    expect(spec.hook.text).toBe('Nobody tells you this');
    expect((spec as any).url).toBeUndefined();
  });

  it('refuses a hook over 120 characters', async () => {
    await expect(
      manager().validateSpec(
        'hook-over-clip',
        { ...hookSpec, hook: { text: 'x'.repeat(121) } },
        false
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a speed that is not offered and a focus off the picture', async () => {
    await expect(
      manager().validateSpec('hook-over-clip', { ...hookSpec, speed: 3 }, false)
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      manager().validateSpec(
        'hook-over-clip',
        { ...hookSpec, focus: { x: 2, y: 0 } },
        false
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses caption words with the wrong shape and colours that are not hex', async () => {
    await expect(
      manager().validateSpec(
        'talking-head-captions',
        {
          ...captionsSpec,
          captions: { ...captionsSpec.captions, words: [{ text: 'a' }] },
        },
        false
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      manager().validateSpec(
        'talking-head-captions',
        {
          ...captionsSpec,
          captions: {
            ...captionsSpec.captions,
            style: { color: 'red;drawtext' },
          },
        },
        false
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets a draft miss parts but not have wrong ones', async () => {
    await expect(
      manager().validateSpec('hook-over-clip', { speed: 2 }, true)
    ).resolves.toBeTruthy();
    await expect(
      manager().validateSpec('hook-over-clip', { speed: 2 }, false)
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      manager().validateSpec('hook-over-clip', { speed: 7 }, true)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an unknown template', async () => {
    await expect(
      manager().validateSpec('nope', hookSpec, false)
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
