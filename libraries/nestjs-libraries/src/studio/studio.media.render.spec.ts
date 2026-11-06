// Renders the templates made of pictures and clips for real on tiny
// generated fixtures, with music, and checks the output with ffprobe. Also
// runs the picture and music checks of a render on real files. Skipped where
// ffmpeg is not installed; without libass the text layer is left out, like
// studio.render.spec.ts does
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service',
  () => ({ AiCredentialService: class {}, MISSING_AI_KEY: '' })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));

import 'reflect-metadata';
import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { StudioService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.service';
import { HookOverClipTemplate } from '@gitroom/nestjs-libraries/studio/templates/hook.over.clip.template';
import { ImageSlideshowTemplate } from '@gitroom/nestjs-libraries/studio/templates/image.slideshow.template';
import { BeforeAfterTemplate } from '@gitroom/nestjs-libraries/studio/templates/before.after.template';
import { TopNListTemplate } from '@gitroom/nestjs-libraries/studio/templates/top.n.list.template';
import { QuoteCardTemplate } from '@gitroom/nestjs-libraries/studio/templates/quote.card.template';
import {
  StudioPlan,
  StudioPlanContext,
  StudioTemplateAbstract,
} from '@gitroom/nestjs-libraries/studio/studio.interface';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const installed =
  spawnSync(ffmpeg, ['-version']).status === 0 &&
  spawnSync(ffprobe, ['-version']).status === 0;
const libass =
  installed &&
  /\sass\s/.test(
    spawnSync(ffmpeg, ['-hide_banner', '-filters']).stdout?.toString() || ''
  );
const fontsDir = resolve(__dirname, '../../../../deploy/postdelegate/fonts');
const id = '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f';

const maybe = installed ? describe : describe.skip;

maybe('Studio pictures, clips and music with ffmpeg', () => {
  let dir: string;
  const service = new StudioService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

  const make = (args: string[]) => {
    const result = spawnSync(
      ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-y', ...args],
      { cwd: dir }
    );
    expect(result.stderr?.toString()).toBe('');
    expect(result.status).toBe(0);
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'studio-media-render-'));
    // a landscape and a portrait picture, a clip with a tone and a tune
    make([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360',
      '-frames:v',
      '1',
      'wide.png',
    ]);
    make([
      '-f',
      'lavfi',
      '-i',
      'smptebars=size=360x640',
      '-frames:v',
      '1',
      'tall.jpg',
    ]);
    make([
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x180:rate=30:duration=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      '-shortest',
      'clip.mp4',
    ]);
    make([
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:duration=3',
      '-c:a',
      'aac',
      'music.m4a',
    ]);
    make([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360',
      '-frames:v',
      '1',
      'wide.jpg',
    ]);
    // the same picture taken with the phone turned: EXIF Orientation 6
    // (turn 90 degrees clockwise to show it), an APP1 segment after the start
    const jpeg = readFileSync(join(dir, 'wide.jpg'));
    const tiff = Buffer.from([
      0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6,
      0, 0, 0, 0, 0, 0,
    ]);
    const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(body.length + 2);
    writeFileSync(
      join(dir, 'rotated.jpg'),
      Buffer.concat([
        jpeg.subarray(0, 2),
        Buffer.from([0xff, 0xe1]),
        length,
        body,
        jpeg.subarray(2),
      ])
    );
    // not a picture: a text file named like one
    writeFileSync(join(dir, 'fake.png'), '#EXTM3U\nhttp://169.254.169.254/\n');
    // larger than the 6000 pixels a side a picture may have
    make([
      '-f',
      'lavfi',
      '-i',
      'color=c=red:size=6100x16',
      '-frames:v',
      '1',
      'huge.png',
    ]);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const render = async (
    template: StudioTemplateAbstract<any>,
    spec: any,
    context: Omit<StudioPlanContext, 'fontsDir'>
  ) => {
    const plan: StudioPlan = template.plan(spec, { ...context, fontsDir });
    for (const file of plan.files) {
      writeFileSync(join(dir, file.name), file.content);
    }
    const filterComplex = libass
      ? plan.filterComplex
      : plan.filterComplex.replace(/ass=filename=[^,;[]+,?/g, '');

    await service.run(
      'ffmpeg',
      [
        ...service.ffmpegArgs({ ...plan, filterComplex }, plan.duration),
        'output.mp4',
      ],
      { cwd: dir, timeout: 120000 }
    );

    const probe = JSON.parse(
      spawnSync(
        ffprobe,
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,codec_name,width,height,profile,r_frame_rate:format=duration',
          '-of',
          'json',
          'output.mp4',
        ],
        { cwd: dir }
      ).stdout.toString()
    );
    rmSync(join(dir, 'output.mp4'), { force: true });
    return probe;
  };

  const expectVertical = (probe: any, seconds: number) => {
    const video = probe.streams.find((p: any) => p.codec_type === 'video');
    const audio = probe.streams.find((p: any) => p.codec_type === 'audio');
    expect(video).toMatchObject({
      codec_name: 'h264',
      width: 1080,
      height: 1920,
      profile: 'High',
      r_frame_rate: '30/1',
    });
    expect(audio).toMatchObject({ codec_name: 'aac' });
    expect(Number(probe.format.duration)).toBeGreaterThan(seconds - 0.2);
    expect(Number(probe.format.duration)).toBeLessThan(seconds + 0.25);
  };

  const picture = (file: string) => ({ file, hasAudio: false, image: true });
  const clip = { file: 'clip.mp4', hasAudio: true, duration: 2 };

  it('renders a slideshow with xfade, the pan and music', async () => {
    const probe = await render(
      new ImageSlideshowTemplate(),
      {
        slides: [
          { mediaId: id, seconds: 1.5, text: 'One {\\fs200}' },
          { mediaId: id, seconds: 2, text: 'Two' },
          { mediaId: id, seconds: 1.5 },
        ],
        transition: 'slideleft',
        music: { assetId: id },
      },
      {
        inputs: [picture('wide.png'), picture('tall.jpg'), picture('wide.png')],
        music: { file: 'music.m4a' },
      }
    );
    // 5 seconds less two half second transitions
    expectVertical(probe, 4);
  }, 120000);

  it('renders a slideshow cut without a pan or music', async () => {
    const probe = await render(
      new ImageSlideshowTemplate(),
      {
        slides: [
          { mediaId: id, seconds: 1.5 },
          { mediaId: id, seconds: 1.5 },
        ],
        transition: 'none',
        pan: false,
      },
      { inputs: [picture('tall.jpg'), picture('wide.png')] }
    );
    expectVertical(probe, 3);
  }, 120000);

  it('renders before/after stacked, a picture over a clip with its sound ducking the music', async () => {
    const probe = await render(
      new BeforeAfterTemplate(),
      {
        before: { mediaId: id, label: 'Before' },
        after: { mediaId: id, label: 'After', start: 0.5 },
        seconds: 3,
        music: { assetId: id, volume: 0.3 },
      },
      { inputs: [picture('wide.png'), clip], music: { file: 'music.m4a' } }
    );
    expectVertical(probe, 3);
  }, 120000);

  it('renders before/after as a wipe, the clip held on its last frame', async () => {
    const probe = await render(
      new BeforeAfterTemplate(),
      {
        before: { mediaId: id, label: 'Before' },
        after: { mediaId: id, label: 'After' },
        layout: 'wipe',
        seconds: 4,
      },
      { inputs: [clip, picture('tall.jpg')] }
    );
    expectVertical(probe, 4);
  }, 120000);

  it('renders a top-N list of pictures and clips with their sound', async () => {
    const probe = await render(
      new TopNListTemplate(),
      {
        title: 'Three things',
        items: [
          { mediaId: id, label: 'First', seconds: 1 },
          { mediaId: id, label: 'Second', trim: { start: 0.5, end: 1.5 } },
          { mediaId: id, label: 'Third', seconds: 1.5 },
        ],
        music: { assetId: id },
      },
      {
        inputs: [picture('wide.png'), clip, picture('tall.jpg')],
        music: { file: 'music.m4a' },
      }
    );
    expectVertical(probe, 3.5);
  }, 120000);

  it('renders a top-N list of pictures only with a silent track', async () => {
    const probe = await render(
      new TopNListTemplate(),
      {
        title: 'Silent',
        items: [
          { mediaId: id, label: 'A', seconds: 1 },
          { mediaId: id, label: 'B', seconds: 1 },
          { mediaId: id, label: 'C', seconds: 1 },
        ],
      },
      {
        inputs: [picture('wide.png'), picture('tall.jpg'), picture('wide.png')],
      }
    );
    expectVertical(probe, 3);
  }, 120000);

  it('renders a quote card over a colour, a picture and a clip', async () => {
    const quote = {
      quote: 'Simple things done every day add up.',
      author: 'Someone',
      seconds: 5,
    };
    expectVertical(
      await render(
        new QuoteCardTemplate(),
        {
          ...quote,
          background: { color: '#1E3A8A' },
          music: { assetId: id },
        },
        { inputs: [], music: { file: 'music.m4a' } }
      ),
      5
    );
    expectVertical(
      await render(
        new QuoteCardTemplate(),
        { ...quote, background: { mediaId: id } },
        { inputs: [picture('wide.png')] }
      ),
      5
    );
    expectVertical(
      await render(
        new QuoteCardTemplate(),
        { ...quote, background: { mediaId: id }, dim: false },
        { inputs: [clip] }
      ),
      5
    );
  }, 120000);

  it('renders "Hook over clip" with music ducked under the clip', async () => {
    const probe = await render(
      new HookOverClipTemplate(),
      {
        input: { mediaId: id },
        trim: { start: 0, end: 2 },
        hook: { text: 'With music' },
        music: { assetId: id, start: 1 },
      },
      { inputs: [clip], music: { file: 'music.m4a' } }
    );
    expectVertical(probe, 2);
  }, 120000);

  const size = (file: string) =>
    JSON.parse(
      spawnSync(
        ffprobe,
        ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', file],
        { cwd: dir }
      ).stdout.toString()
    ).streams[0];

  it('scales pictures down to just cover the panned frame, at most twice it', async () => {
    const wide = await service.prescaleImage(dir, 'wide.png', 0);
    expect(wide).toBe('picture-0.jpg');
    // 640x360 covers 1242x2208 at 3925x2208, cut to twice the width
    expect(size(wide)).toEqual({ width: 2484, height: 2208 });
    const tall = await service.prescaleImage(dir, 'tall.jpg', 1);
    expect(size(tall)).toEqual({ width: 1242, height: 2208 });
  }, 60000);

  it('turns a rotated JPEG upright before scaling it', async () => {
    expect(await service.imageOrientation(join(dir, 'rotated.jpg'))).toBe(6);
    expect(await service.imageOrientation(join(dir, 'wide.jpg'))).toBe(1);
    const upright = await service.prescaleImage(dir, 'rotated.jpg', 2);
    // 640x360 turned is 360x640, the 9:16 frame exactly
    expect(size(upright)).toEqual({ width: 1242, height: 2208 });
    const unturned = await service.prescaleImage(dir, 'wide.jpg', 3);
    expect(size(unturned)).toEqual({ width: 2484, height: 2208 });
  }, 60000);

  it('renders a slideshow from the scaled down pictures', async () => {
    const files = [
      await service.prescaleImage(dir, 'rotated.jpg', 4),
      await service.prescaleImage(dir, 'wide.png', 5),
    ];
    const probe = await render(
      new ImageSlideshowTemplate(),
      {
        slides: [
          { mediaId: id, seconds: 2 },
          { mediaId: id, seconds: 2 },
        ],
      },
      { inputs: files.map(picture) }
    );
    expectVertical(probe, 3.5);
  }, 120000);

  it('accepts real pictures and refuses what is not one or is too large', async () => {
    await expect(service.probeImage(dir, 'wide.png')).resolves.toBeUndefined();
    await expect(service.probeImage(dir, 'tall.jpg')).resolves.toBeUndefined();
    await expect(service.probeImage(dir, 'fake.png')).rejects.toMatchObject({
      type: 'studio_stop',
    });
    await expect(service.probeImage(dir, 'huge.png')).rejects.toMatchObject({
      type: 'studio_stop',
      message: expect.stringContaining('25 megapixels'),
    });
    await expect(service.probeImage(dir, 'clip.mp4')).rejects.toMatchObject({
      type: 'studio_stop',
    });
  }, 60000);

  it('accepts music and refuses a file without sound', async () => {
    await expect(service.probeAudio(dir, 'music.m4a')).resolves.toBeUndefined();
    await expect(service.probeAudio(dir, 'wide.png')).rejects.toMatchObject({
      type: 'studio_stop',
    });
    await expect(service.probeAudio(dir, 'fake.png')).rejects.toMatchObject({
      type: 'studio_stop',
    });
  }, 60000);
});
