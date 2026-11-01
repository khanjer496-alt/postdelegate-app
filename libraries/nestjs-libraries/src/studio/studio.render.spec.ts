// Renders each template for real on a tiny generated clip and checks the
// output with ffprobe. Skipped where ffmpeg is not installed. A build without
// libass (Homebrew's default ffmpeg) renders without the text layer, so the
// rest of the graph and the encoder settings are still checked there
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
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { StudioService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.service';
import { HookOverClipTemplate } from '@gitroom/nestjs-libraries/studio/templates/hook.over.clip.template';
import { TalkingHeadCaptionsTemplate } from '@gitroom/nestjs-libraries/studio/templates/talking.head.captions.template';
import {
  StudioPlan,
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

const maybe = installed ? describe : describe.skip;

maybe('Studio render with ffmpeg', () => {
  let dir: string;
  const service = new StudioService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'studio-render-'));
    // 2 seconds of 320x180 test picture with a tone: a few KB
    const fixture = spawnSync(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
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
        'source-0.mp4',
      ],
      { cwd: dir }
    );
    expect(fixture.status).toBe(0);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const render = async (
    template: StudioTemplateAbstract<any>,
    spec: any,
    hasAudio = true
  ) => {
    const plan: StudioPlan = template.plan(spec, {
      inputs: [{ file: 'source-0.mp4', hasAudio }],
      fontsDir,
    });
    for (const file of plan.files) {
      writeFileSync(join(dir, file.name), file.content);
    }
    const filterComplex = libass
      ? plan.filterComplex
      : plan.filterComplex.replace(/ass=filename=[^,;[]+,?/g, '');

    const ticks: number[] = [];
    await service.run(
      'ffmpeg',
      [
        ...service.ffmpegArgs({ ...plan, filterComplex }, plan.duration),
        'output.mp4',
      ],
      { cwd: dir, timeout: 60000, onProgress: (s) => ticks.push(s) }
    );

    const probe = JSON.parse(
      spawnSync(
        ffprobe,
        [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,codec_name,width,height,profile:format=duration',
          '-of',
          'json',
          'output.mp4',
        ],
        { cwd: dir }
      ).stdout.toString()
    );
    rmSync(join(dir, 'output.mp4'), { force: true });
    return { probe, ticks, plan };
  };

  it('renders "Hook over clip" at 1080x1920 H.264 with AAC audio', async () => {
    const { probe, ticks } = await render(new HookOverClipTemplate(), {
      input: { mediaId: '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f' },
      trim: { start: 0.2, end: 1.7 },
      focus: { x: 0.2, y: 0.5 },
      hook: { text: 'Wait {\\fs300} for it \\N', style: 'impact' },
    });

    const video = probe.streams.find((p: any) => p.codec_type === 'video');
    const audio = probe.streams.find((p: any) => p.codec_type === 'audio');
    expect(video).toMatchObject({
      codec_name: 'h264',
      width: 1080,
      height: 1920,
      profile: 'High',
    });
    expect(audio).toMatchObject({ codec_name: 'aac' });
    expect(Number(probe.format.duration)).toBeGreaterThan(1.4);
    expect(Number(probe.format.duration)).toBeLessThan(1.65);
    expect(ticks.length).toBeGreaterThan(0);
  }, 60000);

  it('renders "Talking head + captions" blurred, sped up and muted with a silent track', async () => {
    const { probe } = await render(
      new TalkingHeadCaptionsTemplate(),
      {
        input: { mediaId: '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f' },
        trim: { start: 0, end: 2 },
        speed: 2,
        mute: true,
        fit: 'blur',
        captions: {
          words: [
            { text: 'Hello', start: 0, end: 0.6 },
            { text: 'there', start: 0.6, end: 1.2 },
            { text: '{friend}', start: 1.2, end: 2 },
          ],
          style: { font: 'clean', highlight: '#00FF88' },
        },
      },
      true
    );

    const video = probe.streams.find((p: any) => p.codec_type === 'video');
    expect(video).toMatchObject({ width: 1080, height: 1920 });
    expect(probe.streams.some((p: any) => p.codec_type === 'audio')).toBe(true);
    // 2 seconds at double speed
    expect(Number(probe.format.duration)).toBeGreaterThan(0.9);
    expect(Number(probe.format.duration)).toBeLessThan(1.15);
  }, 60000);

  it('gives a clip without sound a silent track', async () => {
    const { probe, plan } = await render(
      new HookOverClipTemplate(),
      {
        input: { mediaId: '3f1c2a9e-8b4d-4f6a-9c2e-1a2b3c4d5e6f' },
        trim: { start: 0, end: 1 },
        hook: { text: 'No sound here' },
      },
      false
    );
    expect(plan.inputs).toHaveLength(2);
    expect(probe.streams.some((p: any) => p.codec_type === 'audio')).toBe(true);
  }, 60000);
});
