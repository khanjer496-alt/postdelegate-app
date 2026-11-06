import 'reflect-metadata';
import { StudioTemplateManager } from '@gitroom/nestjs-libraries/studio/studio.manager';
import { AiUgcTemplate } from '@gitroom/nestjs-libraries/studio/templates/ai.ugc.template';
import { StudioPlanContext } from '@gitroom/nestjs-libraries/studio/studio.interface';
import { studioAiAssetKey } from '@gitroom/nestjs-libraries/studio/ai/studio.ai.interface';

const FOOTAGE_A = '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f';
const FOOTAGE_B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const spec = {
  topic: 'A standing desk for small flats',
  tone: 'excited',
  seconds: 20,
  voice: 'cedar',
  stills: 1,
  footage: [{ mediaId: FOOTAGE_A }, { mediaId: FOOTAGE_B }],
  script: {
    hook: 'My back stopped hurting',
    lines: ['This desk folds flat', 'It fits {\\fs200} anywhere'],
    cta: 'Link in bio',
    postText: 'Small flat, big desk',
  },
  captionStyle: { maxWords: 3, highlight: '#00FF88' },
} as any;

// voice timings as Whisper returns them, a little off the script
const words = [
  { text: 'My', start: 0.1, end: 0.3 },
  { text: 'back', start: 0.3, end: 0.6 },
  { text: 'stopped', start: 0.6, end: 1 },
  { text: 'hurting', start: 1, end: 1.5 },
  { text: 'This', start: 1.7, end: 1.9 },
  { text: 'desk', start: 1.9, end: 2.2 },
  { text: 'folds', start: 2.2, end: 2.6 },
  { text: 'flat', start: 2.6, end: 3 },
  { text: 'It', start: 3.2, end: 3.3 },
  { text: 'fits', start: 3.3, end: 3.6 },
  { text: '{\\fs200}', start: 3.6, end: 3.8 },
  { text: 'anywhere', start: 3.8, end: 4.4 },
  { text: 'Link', start: 4.6, end: 4.8 },
  { text: 'in', start: 4.8, end: 4.9 },
  { text: 'bio', start: 4.9, end: 5.2 },
];

const context: StudioPlanContext = {
  inputs: [
    { file: 'source-0.mp4', hasAudio: true, duration: 1.5 },
    { file: 'source-1.mp4', hasAudio: false, duration: 10 },
  ],
  fontsDir: '/usr/share/fonts/truetype/postdelegate-studio',
  ai: [{ file: 'ai-0.mp3', seconds: 5.4, words }, { file: 'ai-1.jpg' }],
};

const manager = () => {
  const template = new AiUgcTemplate();
  return new StudioTemplateManager({
    get: () => template,
  } as any);
};

describe('AI UGC template', () => {
  const template = new AiUgcTemplate();

  it('registers as an AI template', () => {
    const registered = manager()
      .getAllTemplates()
      .find((p) => p.identifier === 'ai-ugc');
    expect(registered).toMatchObject({ ai: true, captions: false });
  });

  it('reads every footage as an input, in order', () => {
    expect(template.mediaIds(spec)).toEqual([FOOTAGE_A, FOOTAGE_B]);
  });

  it('asks the AI for the voice and the stills, with stable keys', () => {
    const assets = template.aiAssets(spec);
    expect(assets).toHaveLength(2);
    expect(assets[0]).toMatchObject({
      kind: 'voice',
      voice: 'cedar',
      text: 'My back stopped hurting This desk folds flat It fits {\\fs200} anywhere Link in bio',
    });
    expect(assets[0]).toHaveProperty('instructions');
    expect(assets[1]).toMatchObject({ kind: 'image' });
    expect((assets[1] as any).prompt).toContain('This desk folds flat');
    expect((assets[1] as any).prompt).toContain('No text');
    // the same script gives the same key, a changed one a new key
    expect(studioAiAssetKey(template.aiAssets(spec)[0])).toBe(
      studioAiAssetKey(assets[0])
    );
    expect(
      studioAiAssetKey(template.aiAssets({ ...spec, voice: 'marin' })[0])
    ).not.toBe(studioAiAssetKey(assets[0]));
  });

  it('asks for nothing with a typed script and no voice', () => {
    expect(template.aiAssets({ ...spec, voiceover: false, stills: 0 })).toEqual(
      []
    );
    expect(template.aiAssets({ footage: [] } as any)).toEqual([]);
  });

  it('never makes stills without a voice, the editor hides them', () => {
    expect(template.aiAssets({ ...spec, voiceover: false, stills: 3 })).toEqual(
      []
    );
  });

  it('asks the AI for a script only with a topic', () => {
    expect(template.aiScript(spec)).toEqual({
      topic: 'A standing desk for small flats',
      tone: 'excited',
      seconds: 20,
    });
    expect(template.aiScript({ ...spec, topic: '  ' })).toBeNull();
  });

  it('cuts what the AI wrote to what a project takes', () => {
    const applied = template.applyAiScript(spec, {
      hook: '',
      lines: Array.from(
        { length: 12 },
        (_, i) => `Line ${i} ${'x'.repeat(300)}`
      ),
      cta: 'Go',
      postText: 'p'.repeat(5000),
    });
    // an empty hook takes the first line
    expect(applied.script.hook.startsWith('Line 0')).toBe(true);
    expect(applied.script.hook.length).toBe(160);
    expect(applied.script.lines).toHaveLength(8);
    expect(applied.script.lines.every((p) => p.length <= 160)).toBe(true);
    expect(applied.script.postText).toHaveLength(2200);
    expect(applied.topic).toBe(spec.topic);
  });

  it('cuts the timeline at the spoken words of each part', () => {
    const timeline = template.timeline(template.parts(spec), words, 6);
    expect(timeline).toEqual([
      { start: 0, end: 1.7 },
      { start: 1.7, end: 3.2 },
      { start: 3.2, end: 4.6 },
      { start: 4.6, end: 6 },
    ]);
  });

  it('shares the length by words without a voice, and merges tiny parts', () => {
    expect(template.timeline(['one two', 'three four'], [], 10)).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 10 },
    ]);
    // the second part would last 0.2 seconds, it joins the first
    expect(
      template.timeline(
        ['a', 'b', 'c'],
        [
          { text: 'a', start: 0, end: 1 },
          { text: 'b', start: 1, end: 1.2 },
          { text: 'c', start: 1.2, end: 3 },
        ],
        3
      )
    ).toEqual([
      { start: 0, end: 1.2 },
      { start: 1.2, end: 3 },
    ]);
  });

  it('plans the footage cut to the parts, a panning still, the voice and karaoke captions', () => {
    const plan = template.plan(spec, context);
    expect(plan.duration).toBe(6);
    // 4 parts + the voice
    expect(plan.inputs).toHaveLength(5);
    // footage A, the still, footage B, footage A again from where it
    // stopped, looping at its end (1.7 seconds played of a 1.5 second clip)
    expect(plan.inputs[0]).toEqual(
      expect.arrayContaining(['-stream_loop', '-1', '-ss', '0', '-t', '1.7'])
    );
    expect(plan.inputs[1]).toEqual(
      expect.arrayContaining(['-f', 'image2', '-loop', '1', 'ai-1.jpg'])
    );
    expect(plan.inputs[2]).toContain('source-1.mp4');
    expect(plan.inputs[3]).toEqual(
      expect.arrayContaining(['-ss', '0.2', 'source-0.mp4'])
    );
    expect(plan.inputs[4]).toEqual(
      expect.arrayContaining(['-format_whitelist', 'mp3', 'ai-0.mp3'])
    );
    expect(plan.filterComplex).toMatchSnapshot();
    expect(plan.files[0].name).toBe('captions.ass');
    expect(plan.files[0].content).toMatchSnapshot();
    // user text never opens an override block in the captions
    expect(plan.files[0].content).not.toContain('{\\fs200}');
    expect(plan.filterComplex).not.toContain('fs200');
  });

  it('plans a typed script without a voice on a silent track for the picked length', () => {
    const plan = template.plan(
      { ...spec, voiceover: false, stills: 0 },
      { ...context, ai: [] }
    );
    expect(plan.duration).toBe(20);
    expect(plan.inputs[plan.inputs.length - 1]).toEqual(
      expect.arrayContaining(['anullsrc=r=48000:cl=stereo'])
    );
    expect(plan.filterComplex).not.toContain('image2');
    expect(plan.filterComplex).toMatchSnapshot();
  });

  it('ducks the music under the voice', () => {
    const plan = template.plan(
      {
        ...spec,
        music: { assetId: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f', volume: 0.3 },
      },
      { ...context, music: { file: 'music.mp3' } }
    );
    // the voice, then the music
    expect(plan.inputs[4]).toContain('ai-0.mp3');
    expect(plan.inputs[5]).toContain('music.mp3');
    expect(plan.filterComplex).toContain(
      '[4:a]aresample=48000,apad=whole_dur=6,aformat'
    );
    expect(plan.filterComplex).toContain('[5:a]aresample=48000');
    expect(plan.filterComplex).toContain('sidechaincompress');
    expect(plan.filterComplex).toContain('volume=0.3');
  });

  it('plays the music on its own over a typed script without a voice', () => {
    const plan = template.plan(
      {
        ...spec,
        voiceover: false,
        stills: 0,
        music: { assetId: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f' },
      },
      { ...context, ai: [], music: { file: 'music.mp3' } }
    );
    expect(plan.filterComplex).not.toContain('sidechaincompress');
    expect(plan.filterComplex).toContain('[4:a]aresample=48000');
  });

  it('is trim-safe: nothing to check without a trim', () => {
    expect(template.check(spec)).toBeUndefined();
    expect(template.checkInputs(spec, context.inputs)).toBeUndefined();
  });

  it('never plans a video longer than the limit', () => {
    const plan = template.plan(spec, {
      ...context,
      ai: [{ file: 'ai-0.mp3', seconds: 200, words: [] }, { file: 'ai-1.jpg' }],
    });
    expect(plan.duration).toBe(90);
  });

  describe('validation', () => {
    const validate = (value: any, partial = false) =>
      manager().validateSpec('ai-ugc', value, partial);

    it('accepts a full project', async () => {
      await expect(validate(spec)).resolves.toBeTruthy();
    });

    it('accepts a draft without a script or footage', async () => {
      await expect(validate({ topic: 'A desk' }, true)).resolves.toBeTruthy();
    });

    it('refuses to render without footage or a script', async () => {
      await expect(validate({ ...spec, footage: [] })).rejects.toBeTruthy();
      await expect(
        validate({ ...spec, script: undefined })
      ).rejects.toBeTruthy();
    });

    it('caps the length, the lines, the stills and the footage', async () => {
      await expect(validate({ ...spec, seconds: 60 })).rejects.toBeTruthy();
      await expect(validate({ ...spec, seconds: 10 })).rejects.toBeTruthy();
      await expect(validate({ ...spec, stills: 4 })).rejects.toBeTruthy();
      await expect(
        validate({
          ...spec,
          script: { ...spec.script, lines: Array(9).fill('a') },
        })
      ).rejects.toBeTruthy();
      await expect(
        validate({
          ...spec,
          script: { ...spec.script, hook: 'x'.repeat(161) },
        })
      ).rejects.toBeTruthy();
      await expect(
        validate({
          ...spec,
          footage: Array(7).fill({ mediaId: FOOTAGE_A }),
        })
      ).rejects.toBeTruthy();
    });

    it('only takes footage by media id and a plain voice name', async () => {
      await expect(
        validate({
          ...spec,
          footage: [{ mediaId: 'https://evil.example/a.mp4' }],
        })
      ).rejects.toBeTruthy();
      await expect(
        validate({ ...spec, voice: 'cedar;rm -rf' })
      ).rejects.toBeTruthy();
    });
  });
});
