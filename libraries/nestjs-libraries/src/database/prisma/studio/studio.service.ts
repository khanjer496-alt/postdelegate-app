import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { ApplicationFailure, TypedSearchAttributes } from '@temporalio/common';
import { TemporalService } from 'nestjs-temporal-core';
import { spawn } from 'child_process';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, readdir, rm, stat, statfs, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { extname, join, resolve, sep } from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import dayjs from 'dayjs';
import {
  StudioRepository,
  STUDIO_FINAL_STATUSES,
} from '@gitroom/nestjs-libraries/database/prisma/studio/studio.repository';
import { StudioTemplateManager } from '@gitroom/nestjs-libraries/studio/studio.manager';
import { wordsFromScript } from '@gitroom/helpers/utils/studio.captions';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import {
  AiCredentialService,
  MISSING_AI_KEY,
} from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service';
import { openAiKeyErrorMessage } from '@gitroom/nestjs-libraries/openai/generation.error';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { ClippingWord } from '@gitroom/nestjs-libraries/upload/clipping.processor.interface';
import { organizationId } from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { truncateForTemporal } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  CreateStudioProjectDto,
  StudioTranscribeDto,
  UpdateStudioProjectDto,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.project.dto';
import {
  STUDIO_MAX_SECONDS,
  STUDIO_MAX_SOURCE_SECONDS,
} from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';

// A reason retrying can't change (a deleted video, a broken file): the
// workflow stops and the message is what the customer reads
export class StudioStop extends ApplicationFailure {
  constructor(message: string) {
    super(truncateForTemporal(message, 2000), 'studio_stop', true);
  }
}

// Fair use, the same for every paid plan: one render at a time per workspace
// (the oldest waiting one goes first), a few waiting behind it, a daily cap,
// and a short total for trials. The global queue keeps one busy workspace
// from holding everyone else back on a shared server
export const STUDIO_LIMITS = {
  maxSeconds: STUDIO_MAX_SECONDS,
  maxQueuedPerWorkspace: 3,
  maxQueuedGlobal: 25,
  maxPerDay: 30,
  trialRenders: 10,
};
// A workflow that died leaves its render running forever. A live render is
// touched every 10 seconds while it waits and every 2 while it renders, and
// waits at most an hour for a worker, so one untouched this long is closed
// and the next one can go
const STALE_HOURS = 2;
// The only containers a render or a transcription opens: what the media
// library stores. Nothing else (a playlist, a concat list) can make ffmpeg
// read another file or address
const INPUT_FORMATS = ['-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2'];
const MAX_INPUT_BYTES = 500 * 1024 * 1024;
const MAX_INPUT_PIXELS = 4096;
const VIDEO_CODECS = ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4'];
// The longest piece of a clip sent to Whisper: 90 seconds at double speed
const MAX_TRANSCRIBE_SECONDS = STUDIO_MAX_SECONDS * 2;
const MAX_SPEC_BYTES = 200 * 1024;
// A proxy in front of the API gives up on a request after 60 seconds, so a
// transcription has 55: at most 20 to cut the audio, the rest for Whisper
const TRANSCRIBE_BUDGET = 55 * 1000;
const TRANSCRIBE_EXTRACT_TIMEOUT = 20 * 1000;
// transcriptions running ffmpeg on the API servers at once
const MAX_TRANSCRIPTIONS = 3;
const RENDER_TIMEOUT = 25 * 60 * 1000;
// What the customer reads when the real reason is not theirs to fix
const SOMETHING_WENT_WRONG =
  'Something went wrong while rendering this video. It was not counted, try again.';

export interface StudioRenderHooks {
  signal?: AbortSignal;
  // called on every progress tick, so the worker can heartbeat
  heartbeat?: (details: string) => void;
}

@Injectable()
export class StudioService {
  private storage = UploadFactory.createStorage();

  constructor(
    private _studioRepository: StudioRepository,
    private _templateManager: StudioTemplateManager,
    private _mediaService: MediaService,
    private _aiCredentialService: AiCredentialService,
    private _temporalService: TemporalService,
    private _organizationService: OrganizationService
  ) {}

  private tmpRoot() {
    return resolve(
      process.env.STUDIO_TMP_DIR || join(tmpdir(), 'postdelegate-studio')
    );
  }

  private fontsDir() {
    return (
      process.env.STUDIO_FONTS_DIR ||
      '/usr/share/fonts/truetype/postdelegate-studio'
    );
  }

  // Read fresh, not from the caller: the organization of an MCP request has
  // no subscription on it. Without billing (self-hosted) everyone may render.
  // A workspace that stopped paying has no subscription row anymore, and a
  // trial is a subscription still marked as trialing
  private async billing(org: string) {
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return { subscribed: true, trial: false };
    }
    const full = await this._organizationService.getOrgByIdWithSubscription(
      org
    );
    return {
      subscribed: !!full?.subscription,
      trial: !!full?.subscription && !!full?.isTrailing,
    };
  }

  private isStale(render: { status: string; updatedAt: Date }) {
    return (
      !STUDIO_FINAL_STATUSES.includes(render.status) &&
      dayjs(render.updatedAt).isBefore(dayjs().subtract(STALE_HOURS, 'hour'))
    );
  }

  private parseSpec(spec: string) {
    try {
      return JSON.parse(spec || '{}');
    } catch (err) {
      return {};
    }
  }

  getTemplates() {
    return this._templateManager.getAllTemplates().map((template) => ({
      identifier: template.identifier,
      title: template.title,
      description: template.description,
      captions: template.captions,
    }));
  }

  async getUsage(org: Organization) {
    const { subscribed, trial } = await this.billing(org.id);
    return {
      ...STUDIO_LIMITS,
      subscribed,
      trial,
      usedToday: await this._studioRepository.countRendersSince(
        org.id,
        dayjs().subtract(1, 'day').toDate()
      ),
      trialUsed: trial
        ? await this._studioRepository.countRendersSince(org.id)
        : 0,
    };
  }

  getProjects(org: string) {
    return this._studioRepository.getProjects(org);
  }

  async getProject(org: string, id: string) {
    const project = await this._studioRepository.getProject(org, id);
    if (!project) {
      throw new HttpException('Project not found', 404);
    }

    return { ...project, spec: this.parseSpec(project.spec) };
  }

  async createProject(org: string, body: CreateStudioProjectDto) {
    if (!this._templateManager.getTemplate(body.template)) {
      throw new BadRequestException('Unknown template');
    }

    return this._studioRepository.createProject(
      org,
      body.name,
      body.template,
      '{}'
    );
  }

  async updateProject(org: string, id: string, body: UpdateStudioProjectDto) {
    const project = await this.getProject(org, id);
    const spec = body.spec
      ? JSON.stringify(
          await this._templateManager.validateSpec(
            project.template,
            body.spec,
            true
          )
        )
      : undefined;

    if (spec && Buffer.byteLength(spec) > MAX_SPEC_BYTES) {
      throw new BadRequestException('The project is too large');
    }

    await this._studioRepository.updateProject(org, id, {
      ...(body.name ? { name: body.name } : {}),
      ...(spec ? { spec } : {}),
    });
    return this.getProject(org, id);
  }

  // A render of the project that is still waiting or running is cancelled,
  // nothing should land in the media library from a deleted project
  async deleteProject(org: string, id: string) {
    await this.getProject(org, id);
    for (const render of (
      await this._studioRepository.getActiveRenders(org)
    ).filter((p) => p.projectId === id)) {
      await this.cancelRender(org, render.id);
    }
    await this._studioRepository.deleteProject(org, id);
    return { success: true };
  }

  // Where a media of the workspace can be read: a presigned url on cloud
  // storage, the file itself on local storage. Never the stored path as is,
  // so a render can only ever read our own storage
  private async mediaSource(org: string, mediaId: string) {
    const media = await this._mediaService.getOrgMediaById(org, mediaId);
    if (!media || media.deletedAt || media.status !== 'ready') {
      return null;
    }

    if (this.storage.signDownloadUrl) {
      return {
        media,
        url: await this.storage.signDownloadUrl(media.name),
      };
    }

    const publicPrefix = process.env.FRONTEND_URL + '/uploads';
    const base = resolve(String(process.env.UPLOAD_DIRECTORY));
    if (!media.path.startsWith(publicPrefix)) {
      return null;
    }
    const file = resolve(base + media.path.slice(publicPrefix.length));
    if (!file.startsWith(base + sep)) {
      return null;
    }

    return { media, file };
  }

  // Captions for the clip: a typed script is spread over it without any key,
  // otherwise the clip is transcribed by Whisper on the workspace's own key
  async transcribe(org: string, id: string, body: StudioTranscribeDto) {
    const project = await this.getProject(org, id);
    const template = this._templateManager.getTemplate(project.template);
    if (!template?.captions) {
      throw new BadRequestException('This template has no captions');
    }

    const spec = project.spec;
    const trim = spec?.trim;
    if (
      !spec?.input?.mediaId ||
      typeof trim?.start !== 'number' ||
      typeof trim?.end !== 'number' ||
      trim.end <= trim.start
    ) {
      throw new BadRequestException('Pick a video and trim it first');
    }

    if (trim.end - trim.start > MAX_TRANSCRIBE_SECONDS) {
      throw new BadRequestException(
        `Trim the clip to ${MAX_TRANSCRIBE_SECONDS} seconds or less first`
      );
    }

    let words: ClippingWord[];
    if (body.script) {
      words = wordsFromScript(body.script, trim.start, trim.end);
    } else {
      // Whisper is a Studio feature like rendering: it needs an active plan
      if (!(await this.billing(org)).subscribed) {
        throw new HttpException(
          'Studio needs an active plan. Pick one in Billing to make captions.',
          406
        );
      }

      // one transcription at a time per workspace: each runs ffmpeg here
      // and spends the workspace's own OpenAI credit
      const lock = `studioTranscribe:${org}`;
      const token = randomBytes(16).toString('hex');
      if (!(await ioRedis.set(lock, token, 'EX', 120, 'NX'))) {
        throw new HttpException('A transcription is already running', 429);
      }
      try {
        words = await this.whisper(org, spec.input.mediaId, trim);
      } finally {
        // only our own lock: one that expired may belong to a newer request
        if ((await ioRedis.get(lock)) === token) {
          await ioRedis.del(lock);
        }
      }
    }

    await this.updateProject(org, id, {
      spec: {
        ...spec,
        captions: {
          ...(spec.captions || {}),
          source: body.script ? 'script' : 'whisper',
          ...(body.script ? { script: body.script } : {}),
          words,
        },
      },
    });

    return { words };
  }

  private async whisper(
    org: string,
    mediaId: string,
    trim: { start: number; end: number }
  ): Promise<ClippingWord[]> {
    const startedAt = Date.now();
    if (!(await this._aiCredentialService.hasCredential(org))) {
      throw new BadRequestException(MISSING_AI_KEY);
    }

    const source = await this.mediaSource(org, mediaId);
    if (!source) {
      throw new BadRequestException('This video is not in the media library');
    }

    // A server-wide cap: every transcription runs ffmpeg in the API process.
    // Each one holds a slot key that expires by itself after the budget, so a
    // crashed request never keeps a slot
    const token = randomBytes(16).toString('hex');
    let slot: string | undefined;
    for (let i = 0; i < MAX_TRANSCRIPTIONS && !slot; i++) {
      if (
        await ioRedis.set(`studioTranscribeSlot:${i}`, token, 'EX', 60, 'NX')
      ) {
        slot = `studioTranscribeSlot:${i}`;
      }
    }
    if (!slot) {
      throw new HttpException(
        'Studio is busy right now, try again in a minute',
        429
      );
    }

    const dir = join(
      this.tmpRoot(),
      `transcribe-${source.media.id}-${Date.now()}`
    );
    try {
      await mkdir(dir, { recursive: true });
      // mono 16 kHz at 32 kbps: 180 seconds stay far below Whisper's 25 MB
      await this.run(
        'ffmpeg',
        [
          '-hide_banner',
          '-nostdin',
          '-loglevel',
          'error',
          '-y',
          '-protocol_whitelist',
          'file,http,https,tcp,tls,crypto',
          ...INPUT_FORMATS,
          '-ss',
          String(trim.start),
          '-t',
          String(trim.end - trim.start),
          '-i',
          source.url || source.file!,
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-b:a',
          '32k',
          'audio.mp3',
        ],
        { cwd: dir, timeout: TRANSCRIBE_EXTRACT_TIMEOUT }
      );

      const client = await this._aiCredentialService.getOpenAiClient(org);
      let result: { words?: { word: string; start: number; end: number }[] };
      try {
        result = await client.audio.transcriptions.create(
          {
            file: createReadStream(join(dir, 'audio.mp3')),
            model: 'whisper-1',
            response_format: 'verbose_json',
            timestamp_granularities: ['word'],
          },
          {
            // what is left of the 55 seconds the request may take, for the
            // whole call: no retry, a retry would start a fresh timeout
            maxRetries: 0,
            signal: AbortSignal.timeout(
              Math.max(1000, TRANSCRIBE_BUDGET - (Date.now() - startedAt))
            ),
          }
        );
      } catch (err) {
        const keyMessage = openAiKeyErrorMessage(err);
        if (keyMessage) {
          throw new BadRequestException(keyMessage);
        }
        console.error('Studio transcription failed:', (err as Error)?.message);
        throw new HttpException(
          'The clip could not be transcribed, try again or type a script.',
          502
        );
      }

      return (result.words || [])
        .filter((word) => word.word?.trim())
        .slice(0, 1500)
        .map((word) => ({
          text: word.word.trim().slice(0, 60),
          start: Number((trim.start + word.start).toFixed(3)),
          end: Number((trim.start + word.end).toFixed(3)),
        }));
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      // ffmpeg's stderr can carry the presigned url of the video
      console.error(
        'Studio audio extraction failed:',
        String((err as Error)?.message || err).replace(
          /https?:\/\/[^\s"'\\]+/g,
          '[url]'
        )
      );
      throw new HttpException('The sound of this clip could not be read', 400);
    } finally {
      if ((await ioRedis.get(slot)) === token) {
        await ioRedis.del(slot);
      }
      await rm(dir, { recursive: true, force: true });
    }
  }

  async startRender(org: Organization, projectId: string) {
    const project = await this.getProject(org.id, projectId);
    const template = this._templateManager.getTemplate(project.template);
    if (!template) {
      throw new BadRequestException('Unknown template');
    }

    const spec = await this._templateManager.validateSpec(
      project.template,
      project.spec,
      false
    );
    if (spec.trim.end <= spec.trim.start) {
      throw new BadRequestException(
        'The end of the clip must be after its start'
      );
    }

    const seconds = template.instance.duration(spec);
    if (seconds > STUDIO_MAX_SECONDS) {
      throw new BadRequestException(
        `Videos are ${STUDIO_MAX_SECONDS} seconds at most, this one would be ${Math.ceil(
          seconds
        )}. Trim it or speed it up.`
      );
    }

    for (const mediaId of template.instance.mediaIds(spec)) {
      if (!(await this.mediaSource(org.id, mediaId))) {
        throw new BadRequestException(
          'A video of this project is not in the media library anymore'
        );
      }
    }

    const client = this._temporalService.client.getRawClient();
    if (!client) {
      throw new HttpException('Studio is not available', 503);
    }

    // two starts at the same moment would both pass the limits
    if (!(await ioRedis.set(`studioStart:${org.id}`, '1', 'EX', 15, 'NX'))) {
      throw new HttpException('Another render is being started', 429);
    }

    try {
      await this.checkFairUse(org);
      const render = await this._studioRepository.createRender(
        org.id,
        projectId,
        Math.ceil(seconds),
        JSON.stringify(spec)
      );

      try {
        await client.workflow.start('studioRenderWorkflowV1', {
          workflowId: `studio_${render.id}`,
          taskQueue: 'main',
          args: [{ renderId: render.id }],
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: organizationId,
              value: org.id,
            },
          ]),
        });
      } catch (err) {
        // no workflow means nothing will ever flip the status
        await this._studioRepository.updateRender(render.id, {
          status: 'failed',
          error: 'Could not start the render',
        });
        throw new HttpException('Studio is not available', 503);
      }

      return { id: render.id };
    } finally {
      await ioRedis.del(`studioStart:${org.id}`);
    }
  }

  // Throws the limit a new render would pass, after closing renders whose
  // workflow died so they never hold the queue
  async checkFairUse(org: Organization) {
    const active = await this._studioRepository.getActiveRenders(org.id);
    for (const render of active.filter((p) => this.isStale(p))) {
      await this.failRender(render.id, 'The render never finished', true);
    }

    const { subscribed, trial } = await this.billing(org.id);
    if (!subscribed) {
      throw new HttpException(
        'Studio needs an active plan. Pick one in Billing to render videos.',
        406
      );
    }

    if (trial) {
      const used = await this._studioRepository.countRendersSince(org.id);
      if (used >= STUDIO_LIMITS.trialRenders) {
        throw new HttpException(
          `The trial includes ${STUDIO_LIMITS.trialRenders} Studio videos and they are used. Pick a plan in Billing to keep rendering.`,
          406
        );
      }
    }

    const waiting = active.filter(
      (p) => !this.isStale(p) && p.status === 'queued'
    ).length;
    if (waiting >= STUDIO_LIMITS.maxQueuedPerWorkspace) {
      throw new HttpException(
        `${STUDIO_LIMITS.maxQueuedPerWorkspace} videos are already waiting to render, wait for one to finish`,
        429
      );
    }

    if (
      (await this._studioRepository.countRendersSince(
        org.id,
        dayjs().subtract(1, 'day').toDate()
      )) >= STUDIO_LIMITS.maxPerDay
    ) {
      throw new HttpException(
        `${STUDIO_LIMITS.maxPerDay} videos were rendered in the last 24 hours, the fair use limit. Try again later.`,
        429
      );
    }

    if (
      (await this._studioRepository.countQueuedRenders(
        dayjs().subtract(STALE_HOURS, 'hour').toDate()
      )) >= STUDIO_LIMITS.maxQueuedGlobal
    ) {
      throw new HttpException(
        'Studio is busy right now, try again in a few minutes',
        429
      );
    }
  }

  async getRender(org: string, id: string) {
    const render = await this._studioRepository.getRender(org, id);
    if (!render) {
      throw new HttpException('Render not found', 404);
    }

    if (this.isStale(render)) {
      await this.failRender(id, 'The render never finished', true);
      return (await this._studioRepository.getRender(org, id))!;
    }

    return render;
  }

  // The workflow is cancelled and closes the render itself once ffmpeg is
  // stopped and its folder removed; a render without a workflow is closed here
  async cancelRender(org: string, id: string) {
    const render = await this.getRender(org, id);
    if (STUDIO_FINAL_STATUSES.includes(render.status)) {
      return render;
    }

    const client = this._temporalService.client.getRawClient();
    if (!client) {
      throw new HttpException('Studio is not available', 503);
    }

    try {
      await client.workflow.getHandle(`studio_${id}`).cancel();
    } catch (err: any) {
      // Temporal could not be reached: the render may still be running, so
      // it is not marked as cancelled
      if (err?.name !== 'WorkflowNotFoundError') {
        console.error(`Could not cancel studio render ${id}:`, err?.message);
        throw new HttpException(
          'The render could not be cancelled, try again',
          503
        );
      }
      await this.failRender(id, 'Cancelled', true, true);
    }

    return this.getRender(org, id);
  }

  // "ready" when this is the oldest render the workspace has waiting or
  // running, so a workspace renders one video at a time and in order
  async prepareRender(renderId: string): Promise<'ready' | 'wait' | 'gone'> {
    const render = await this._studioRepository.getRenderById(renderId);
    if (!render || STUDIO_FINAL_STATUSES.includes(render.status)) {
      return 'gone';
    }

    const active = await this._studioRepository.getActiveRenders(
      render.organizationId
    );
    for (const stale of active.filter((p) => this.isStale(p))) {
      await this.failRender(stale.id, 'The render waited too long', true);
    }

    if (this.isStale(render)) {
      return 'gone';
    }

    // every poll touches the render, so waiting never reads as stale
    await this._studioRepository.updateRender(renderId, {
      status: render.status,
    });

    return active.find((p) => !this.isStale(p))?.id === renderId
      ? 'ready'
      : 'wait';
  }

  private async checkFreeDisk(dir: string) {
    const minimum =
      (Number(process.env.STUDIO_MIN_FREE_GB) || 3) * 1024 * 1024 * 1024;
    const stats = await statfs(dir);
    if (stats.bavail * stats.bsize < minimum) {
      console.error(`Studio render refused: less than ${minimum} bytes free`);
      throw new StudioStop(
        'Studio is busy right now, try again in a few minutes.'
      );
    }
  }

  private async download(
    source: { url?: string; file?: string },
    target: string,
    signal?: AbortSignal
  ) {
    let received = 0;
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        callback(
          received > MAX_INPUT_BYTES
            ? new StudioStop('This video is larger than 500 MB.')
            : null,
          chunk
        );
      },
    });

    if (source.file) {
      await pipeline(
        createReadStream(source.file),
        limit,
        createWriteStream(target),
        {
          signal,
        }
      );
      return;
    }

    const response = await fetch(source.url!, { signal });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed with ${response.status}`);
    }
    await pipeline(
      Readable.fromWeb(response.body as any),
      limit,
      createWriteStream(target),
      { signal }
    );
  }

  private async probe(dir: string, file: string) {
    let info: {
      streams?: {
        codec_type: string;
        codec_name: string;
        width?: number;
        height?: number;
      }[];
      format?: { duration?: string };
    };
    try {
      info = JSON.parse(
        await this.run(
          'ffprobe',
          [
            '-v',
            'error',
            '-protocol_whitelist',
            'file',
            ...INPUT_FORMATS,
            '-show_entries',
            'stream=codec_type,codec_name,width,height:format=duration',
            '-of',
            'json',
            file,
          ],
          { cwd: dir, timeout: 30000 }
        )
      );
    } catch (err) {
      throw new StudioStop('This video could not be read.');
    }

    const video = info.streams?.find((p) => p.codec_type === 'video');
    const duration = Number(info.format?.duration || 0);
    if (!video || !VIDEO_CODECS.includes(video.codec_name)) {
      throw new StudioStop('This video format is not supported.');
    }
    if (
      (video.width || 0) > MAX_INPUT_PIXELS ||
      (video.height || 0) > MAX_INPUT_PIXELS
    ) {
      throw new StudioStop('Videos up to 4K are supported.');
    }
    if (duration > STUDIO_MAX_SOURCE_SECONDS + 1) {
      throw new StudioStop('Videos up to 10 minutes long are supported.');
    }

    return {
      duration,
      hasAudio: !!info.streams?.some((p) => p.codec_type === 'audio'),
    };
  }

  // Runs ffmpeg or ffprobe and resolves with what it printed. ffmpeg runs at
  // a low priority so a render never slows the API down; a cancel asks it to
  // stop and kills it 5 seconds later if it did not
  run(
    command: 'ffmpeg' | 'ffprobe',
    args: string[],
    options: {
      cwd: string;
      timeout?: number;
      signal?: AbortSignal;
      onProgress?: (seconds: number) => void;
    }
  ) {
    const bin =
      command === 'ffmpeg'
        ? process.env.FFMPEG_PATH || 'ffmpeg'
        : process.env.FFPROBE_PATH || 'ffprobe';

    return new Promise<string>((done, fail) => {
      if (options.signal?.aborted) {
        return fail(new Error('Cancelled'));
      }

      const child =
        command === 'ffmpeg'
          ? spawn('nice', ['-n', '15', bin, ...args], {
              cwd: options.cwd,
              stdio: ['ignore', 'pipe', 'pipe'],
            })
          : spawn(bin, args, {
              cwd: options.cwd,
              stdio: ['ignore', 'pipe', 'pipe'],
            });

      let stdout = '';
      let stderr = '';
      let killer: NodeJS.Timeout | undefined;
      const stop = () => {
        child.kill('SIGTERM');
        killer = setTimeout(() => child.kill('SIGKILL'), 5000);
      };
      const timer = setTimeout(stop, options.timeout || RENDER_TIMEOUT);
      options.signal?.addEventListener('abort', stop, { once: true });

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (!options.onProgress) {
          stdout += text;
          return;
        }
        // -progress pipe:1 prints key=value lines, out_time_us is the time
        // reached in the output
        for (const match of text.matchAll(/out_time_us=(\d+)/g)) {
          options.onProgress(Number(match[1]) / 1000000);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4000);
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        fail(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        clearTimeout(killer);
        options.signal?.removeEventListener('abort', stop);
        if (options.signal?.aborted) {
          return fail(new Error('Cancelled'));
        }
        if (code !== 0) {
          return fail(
            new Error(`${command} exited with ${code}: ${stderr.slice(-2000)}`)
          );
        }
        done(stdout);
      });
    });
  }

  // Downloads the inputs, renders, uploads the video and saves it as a media
  // with its thumbnail. Everything happens in a folder of its own that is
  // always removed, whatever happened
  async render(renderId: string, hooks: StudioRenderHooks = {}) {
    const render = await this._studioRepository.getRenderById(renderId);
    if (!render) {
      throw new StudioStop('Render not found');
    }

    // cancelled while it waited, or the video was saved by an earlier attempt
    if (STUDIO_FINAL_STATUSES.includes(render.status) || render.mediaId) {
      return;
    }

    const template = this._templateManager.getTemplate(render.project.template);
    if (!template) {
      throw new StudioStop('This template is not available anymore.');
    }

    let spec: any;
    try {
      spec = await this._templateManager.validateSpec(
        render.project.template,
        this.parseSpec(render.specSnapshot),
        false
      );
    } catch (err) {
      throw new StudioStop('The project settings are not valid anymore.');
    }

    const root = this.tmpRoot();
    await mkdir(root, { recursive: true });
    await this.checkFreeDisk(root);

    const org = render.organizationId;
    const dir = join(root, renderId);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await this._studioRepository.updateRender(renderId, {
      status: 'rendering',
      progress: 0,
    });

    try {
      const inputs: { file: string; hasAudio: boolean }[] = [];
      for (const [index, mediaId] of template.instance
        .mediaIds(spec)
        .entries()) {
        const source = await this.mediaSource(org, mediaId);
        if (!source) {
          throw new StudioStop(
            'A video of this project was removed from the media library.'
          );
        }

        hooks.heartbeat?.(`downloading input ${index}`);
        const ext =
          extname(source.media.name)
            .toLowerCase()
            .replace(/[^.a-z0-9]/g, '') || '.mp4';
        const file = `source-${index}${ext}`;
        await this.download(source, join(dir, file), hooks.signal);
        const probed = await this.probe(dir, file);
        if (index === 0 && spec.trim.start >= probed.duration) {
          throw new StudioStop('The clip starts after the end of the video.');
        }
        inputs.push({ file, hasAudio: probed.hasAudio });
      }

      const plan = template.instance.plan(spec, {
        inputs,
        fontsDir: this.fontsDir(),
      });
      for (const file of plan.files) {
        await writeFile(join(dir, file.name), file.content, 'utf8');
      }

      const duration = Math.min(plan.duration, STUDIO_MAX_SECONDS);
      let saved = Date.now();
      await this.run(
        'ffmpeg',
        [...this.ffmpegArgs(plan, duration), 'output.mp4'],
        {
          cwd: dir,
          signal: hooks.signal,
          onProgress: (seconds) => {
            hooks.heartbeat?.(`rendering ${Math.round(seconds)}s`);
            if (Date.now() - saved < 2000) {
              return;
            }
            saved = Date.now();
            this._studioRepository
              .updateRender(renderId, {
                progress: Math.min(
                  99,
                  Math.max(0, Math.floor((seconds / duration) * 100))
                ),
              })
              .catch(() => undefined);
          },
        }
      );

      await this.run(
        'ffmpeg',
        [
          '-hide_banner',
          '-nostdin',
          '-loglevel',
          'error',
          '-y',
          '-ss',
          String(Math.min(0.5, duration / 2)),
          '-i',
          'output.mp4',
          '-frames:v',
          '1',
          '-vf',
          'scale=540:-2',
          '-q:v',
          '4',
          'thumbnail.jpg',
        ],
        { cwd: dir, signal: hooks.signal, timeout: 60000 }
      );

      // nothing is uploaded for a render that was cancelled or whose project
      // was deleted while ffmpeg ran
      if (
        hooks.signal?.aborted ||
        !(await this._studioRepository.isRenderLive(renderId))
      ) {
        throw new StudioStop('The render was cancelled.');
      }

      await this._studioRepository.updateRender(renderId, {
        status: 'uploading',
        progress: 99,
      });
      hooks.heartbeat?.('uploading');

      const video = await this.storage.uploadStream(
        createReadStream(join(dir, 'output.mp4')),
        'video/mp4',
        'mp4'
      );
      const thumbnail = await this.storage.uploadStream(
        createReadStream(join(dir, 'thumbnail.jpg')),
        'image/jpeg',
        'jpg'
      );

      // the media and the render's link to it are saved together, and only
      // by a render still live: a retry, a cancel or a deleted project that
      // got there first leaves no second media, and its files are removed
      const name = render.project.name.slice(0, 90);
      const media = hooks.signal?.aborted
        ? null
        : await this._studioRepository.saveRenderMedia(renderId, org, {
            name: video.filename,
            path: video.path,
            originalName: `${name}.mp4`,
            thumbnail: thumbnail.path,
            alt: name,
          });
      if (!media) {
        for (const file of [video.path, thumbnail.path]) {
          await this.storage
            .removeFile(file)
            .catch((err) =>
              console.error(`Could not remove studio file ${file}:`, err)
            );
        }
        throw new StudioStop('The render was cancelled.');
      }
    } catch (err: any) {
      if (err instanceof StudioStop || hooks.signal?.aborted) {
        throw err;
      }
      // ffmpeg's stderr can carry presigned urls
      console.error(
        `Studio render ${renderId} failed:`,
        String(err?.message || err).replace(/https?:\/\/[^\s"'\\]+/g, '[url]')
      );
      throw err;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // The encoder settings every template shares: H.264 High and AAC, playable
  // while it downloads, and never longer than the limit
  ffmpegArgs(
    plan: { inputs: string[][]; filterComplex: string; maps: string[] },
    duration: number
  ) {
    return [
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-y',
      '-progress',
      'pipe:1',
      '-nostats',
      '-filter_complex_threads',
      '2',
      ...plan.inputs.flat(),
      '-filter_complex',
      plan.filterComplex,
      ...plan.maps,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '21',
      '-rc-lookahead',
      '20',
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '30',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-threads',
      '2',
      '-movflags',
      '+faststart',
      '-t',
      String(Number(duration.toFixed(3))),
    ];
  }

  async finishRender(renderId: string) {
    const render = await this._studioRepository.getRenderById(renderId);
    if (!render || STUDIO_FINAL_STATUSES.includes(render.status)) {
      return;
    }

    await this._studioRepository.updateRender(renderId, {
      status: 'completed',
      progress: 100,
      error: null,
    });
  }

  // "customer" says the reason was written for the customer; anything else is
  // logged and replaced. A render whose video was already saved is completed:
  // the customer has it in the media library either way
  async failRender(
    renderId: string,
    error: string,
    customer = false,
    cancelled = false
  ) {
    const render = await this._studioRepository.getRenderById(renderId);
    if (!render || STUDIO_FINAL_STATUSES.includes(render.status)) {
      return;
    }

    if (render.mediaId) {
      return this.finishRender(renderId);
    }

    if (!customer && !cancelled) {
      console.error(`Studio render ${renderId} failed:`, error);
    }

    await this._studioRepository.updateRender(renderId, {
      status: cancelled ? 'cancelled' : 'failed',
      error: cancelled
        ? null
        : customer
        ? error.slice(0, 4000)
        : SOMETHING_WENT_WRONG,
    });
  }

  // Folders a crashed worker left behind; renders never take this long
  async sweepTmp() {
    const root = this.tmpRoot();
    try {
      for (const name of await readdir(root)) {
        const path = join(root, name);
        if (
          dayjs((await stat(path)).mtime).isBefore(
            dayjs().subtract(STALE_HOURS, 'hour')
          )
        ) {
          await rm(path, { recursive: true, force: true });
        }
      }
    } catch (err) {
      /** no folder yet **/
    }
  }
}
