import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { uniq } from 'lodash';
import { Organization } from '@prisma/client';
import { ApplicationFailure, TypedSearchAttributes } from '@temporalio/common';
import { TemporalService } from 'nestjs-temporal-core';
import { spawn } from 'child_process';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, open, readdir, rm, stat, statfs, writeFile } from 'fs/promises';
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
import { STUDIO_MUSIC_MAX_BYTES } from '@gitroom/nestjs-libraries/dtos/studio/studio.music.dto';
import {
  StudioPlanContext,
  StudioPlanInput,
  StudioTemplateAbstract,
} from '@gitroom/nestjs-libraries/studio/studio.interface';
import {
  studioAiAssetFromRow,
  studioAiAssetKey,
} from '@gitroom/nestjs-libraries/studio/ai/studio.ai.interface';
import { CreateStudioRenderDto } from '@gitroom/nestjs-libraries/dtos/studio/studio.render.dto';
import { getValidationSchemas } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import { timer } from '@gitroom/helpers/utils/timer';

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
// Pictures: only what the image demuxer reads from a png, jpg or webp file,
// so a picture can never be a playlist or anything that opens another file.
// Every picture of a render is decoded at once, so their size is capped
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const IMAGE_FORMATS = ['-format_whitelist', 'image2'];
const IMAGE_CODECS = ['png', 'mjpeg', 'webp'];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_SIDE = 6000;
const MAX_IMAGE_PIXELS = 25 * 1000 * 1000;
// picture types the media library holds that Studio does not read
const OTHER_IMAGE_EXTENSIONS = ['.gif', '.avif', '.bmp', '.tif', '.tiff', '.heic'];
// what a picture is scaled to before the render: the panned frame
const PRESCALE_WIDTH = 1242;
const PRESCALE_HEIGHT = 2208;
// the filters that turn a picture upright for each EXIF Orientation
const ORIENTATION_FILTERS: Record<number, string> = {
  2: 'hflip,',
  3: 'hflip,vflip,',
  4: 'vflip,',
  5: 'transpose=0,',
  6: 'transpose=1,',
  7: 'transpose=3,',
  8: 'transpose=2,',
};

// The EXIF Orientation of a JPEG (1 when it has none): the 0x0112 tag of the
// first image directory of its APP1 Exif segment
export const jpegOrientation = (data: Buffer) => {
  if (data.length < 4 || data.readUInt16BE(0) !== 0xffd8) {
    return 1;
  }
  let offset = 2;
  while (offset + 4 <= data.length) {
    const marker = data.readUInt16BE(offset);
    const length = data.readUInt16BE(offset + 2);
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda || length < 2) {
      return 1;
    }
    const start = offset + 4;
    if (
      marker === 0xffe1 &&
      start + 14 <= data.length &&
      data.toString('latin1', start, start + 6) === 'Exif\0\0'
    ) {
      const tiff = start + 6;
      const little = data.toString('latin1', tiff, tiff + 2) === 'II';
      const u16 = (at: number) =>
        little ? data.readUInt16LE(at) : data.readUInt16BE(at);
      const u32 = (at: number) =>
        little ? data.readUInt32LE(at) : data.readUInt32BE(at);
      const directory = tiff + u32(tiff + 4);
      if (directory + 2 > data.length) {
        return 1;
      }
      const entries = u16(directory);
      for (let i = 0; i < entries; i++) {
        const entry = directory + 2 + i * 12;
        if (entry + 12 > data.length) {
          return 1;
        }
        if (u16(entry) === 0x0112) {
          const value = u16(entry + 8);
          return value >= 1 && value <= 8 ? value : 1;
        }
      }
      return 1;
    }
    offset = start + length - 2;
  }
  return 1;
};

// Music: the containers and codecs POST /studio/assets lets in
const MUSIC_FORMATS = ['-format_whitelist', 'mp3,mov,mp4,m4a,3gp,3g2,mj2,wav'];
const AUDIO_CODECS = [
  'mp3',
  'aac',
  'alac',
  'pcm_s16le',
  'pcm_s24le',
  'pcm_s32le',
  'pcm_f32le',
  'pcm_u8',
];
// Uploaded music no project uses is removed after a week, and renders older
// than 90 days are forgotten (their videos stay in the media library)
const ORPHAN_ASSET_DAYS = 7;
const RENDER_HISTORY_DAYS = 90;
const MAX_ASSETS = 50;
const CLEANUP_PAGE = 100;
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
  private templateSchemas?: {
    identifier: string;
    title: string;
    description: string;
    captions: boolean;
    ai: boolean;
    schema: any;
  }[];

  constructor(
    private _studioRepository: StudioRepository,
    private _templateManager: StudioTemplateManager,
    private _mediaService: MediaService,
    private _aiCredentialService: AiCredentialService,
    private _temporalService: TemporalService,
    private _organizationService: OrganizationService
  ) {}

  tmpRoot() {
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
  async billing(org: string) {
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
      ai: !!template.ai,
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

  getProjects(org: string, includeApi = false) {
    return this._studioRepository.getProjects(org, includeApi);
  }

  async getProject(org: string, id: string) {
    const project = await this._studioRepository.getProject(org, id);
    if (!project) {
      throw new HttpException('Project not found', 404);
    }

    return { ...project, spec: this.parseSpec(project.spec) };
  }

  // "source" marks a project an assistant or the public API made
  async createProject(
    org: string,
    body: CreateStudioProjectDto,
    source?: 'api'
  ) {
    if (!this._templateManager.getTemplate(body.template)) {
      throw new BadRequestException('Unknown template');
    }

    return this._studioRepository.createProject(
      org,
      body.name,
      body.template,
      '{}',
      source
    );
  }

  async updateProject(org: string, id: string, body: UpdateStudioProjectDto) {
    const project = await this.getProject(org, id);
    const template = this._templateManager.getTemplate(project.template);
    const validated = body.spec
      ? await this._templateManager.validateSpec(
          project.template,
          body.spec,
          true
        )
      : undefined;

    // The music is read from the validated settings. Most saves keep it as
    // it was; a new one must be an asset of the workspace no other project
    // took. Its name and address always come from the asset, never the client
    const before = template?.instance.musicAssetId(project.spec || {});
    const assetId = validated
      ? template?.instance.musicAssetId(validated)
      : undefined;
    const changed = !!validated && assetId !== before;
    if (validated?.music) {
      if (changed) {
        const asset = await this._studioRepository.getAsset(org, assetId!);
        if (!asset || (asset.projectId && asset.projectId !== id)) {
          throw new BadRequestException(
            'This music is not available anymore, add it again'
          );
        }
        validated.music.name = asset.originalName || undefined;
        validated.music.path = asset.path;
      } else {
        validated.music.name = project.spec.music?.name;
        validated.music.path = project.spec.music?.path;
      }
    }

    const spec = validated ? JSON.stringify(validated) : undefined;
    if (spec && Buffer.byteLength(spec) > MAX_SPEC_BYTES) {
      throw new BadRequestException('The project is too large');
    }

    await this._studioRepository.updateProject(org, id, {
      ...(body.name ? { name: body.name } : {}),
      ...(spec ? { spec } : {}),
    });

    // only once the settings that name it are saved
    if (changed) {
      await this.useMusic(org, id, assetId);
    }
    return this.getProject(org, id);
  }

  // A render of the project that is still waiting or running is cancelled,
  // nothing should land in the media library from a deleted project. Its
  // music goes with it; what can't be removed now the daily cleanup removes
  async deleteProject(org: string, id: string) {
    await this.getProject(org, id);
    for (const render of (
      await this._studioRepository.getActiveRenders(org)
    ).filter((p) => p.projectId === id)) {
      await this.cancelRender(org, render.id);
    }
    await this._studioRepository.deleteProject(org, id);
    for (const asset of await this._studioRepository.getProjectAssets(
      org,
      id
    )) {
      await this.removeAsset(asset);
    }
    return { success: true };
  }

  // Where a stored file can be read: a presigned url on cloud storage, the
  // file itself on local storage. Never the stored path as is, so a render
  // can only ever read our own storage
  private async storedSource(
    name: string,
    path: string
  ): Promise<{ url?: string; file?: string } | null> {
    if (this.storage.signDownloadUrl) {
      return { url: await this.storage.signDownloadUrl(name) };
    }

    const publicPrefix = process.env.FRONTEND_URL + '/uploads';
    const base = resolve(String(process.env.UPLOAD_DIRECTORY));
    if (!path.startsWith(publicPrefix)) {
      return null;
    }
    const file = resolve(base + path.slice(publicPrefix.length));
    if (!file.startsWith(base + sep)) {
      return null;
    }

    return { file };
  }

  // A file the AI made, copied from our storage to a local file
  async downloadStored(
    stored: { name: string; path: string },
    target: string,
    signal?: AbortSignal
  ) {
    const source = await this.storedSource(stored.name, stored.path);
    if (!source) {
      throw new StudioStop('A file of this video is missing. Try again.');
    }
    await this.download(source, target, signal);
  }

  // Where a media of the workspace can be read
  private async mediaSource(org: string, mediaId: string) {
    const media = await this._mediaService.getOrgMediaById(org, mediaId);
    if (!media || media.deletedAt || media.status !== 'ready') {
      return null;
    }

    const source = await this.storedSource(media.name, media.path);
    return source ? { media, ...source } : null;
  }

  // Music uploaded for Studio: stored like a media but kept out of the media
  // library. A workspace keeps a few at a time; the ones no project uses go
  // after a week
  // Throws when the workspace can't add music: no active plan, or as many
  // files as it may keep. Checked before an upload is stored, and again when
  // it is saved
  async checkAssetAllowed(org: string) {
    if (!(await this.billing(org)).subscribed) {
      throw new HttpException(
        'Studio needs an active plan. Pick one in Billing to add music.',
        406
      );
    }
    if ((await this._studioRepository.countAssets(org)) >= MAX_ASSETS) {
      throw new BadRequestException(
        `A workspace keeps up to ${MAX_ASSETS} music files. Delete a project that uses one, or wait for unused ones to be removed after ${ORPHAN_ASSET_DAYS} days.`
      );
    }
  }

  async saveAsset(
    org: string,
    file: { filename: string; path: string; originalname?: string }
  ) {
    // the count and the new row under one lock, so two uploads at once never
    // both pass the last free place
    const lock = `studioAsset:${org}`;
    const token = randomBytes(16).toString('hex');
    try {
      if (!(await ioRedis.set(lock, token, 'EX', 15, 'NX'))) {
        throw new HttpException('Another music file is being saved', 429);
      }
      try {
        await this.checkAssetAllowed(org);
        const asset = await this._studioRepository.createAsset(org, {
          kind: 'music',
          name: file.filename,
          path: file.path,
          originalName: (file.originalname || 'music').slice(0, 100),
        });
        return {
          id: asset.id,
          name: asset.originalName,
          path: asset.path,
        };
      } finally {
        if ((await ioRedis.get(lock)) === token) {
          await ioRedis.del(lock);
        }
      }
    } catch (err) {
      // a refused upload leaves nothing in storage
      await this.storage
        .removeFile(file.path)
        .catch((error) =>
          console.error(`Could not remove studio upload ${file.path}:`, error)
        );
      throw err;
    }
  }

  // The project keeps the music its settings name and lets go of any other:
  // one it lets go of is removed after a week. Music another project took
  // in the meantime stays with it
  private async useMusic(
    org: string,
    projectId: string,
    assetId: string | undefined
  ) {
    if (assetId) {
      await this._studioRepository.attachAsset(org, assetId, projectId);
    }
    await this._studioRepository.detachAssets(org, projectId, assetId);
  }

  // The row goes first and only while nothing uses the asset (a project
  // that took it in the meantime keeps it), then its file. A file already
  // gone counts as removed
  private async removeAsset(
    asset: { id: string; path: string },
    unusedSince = dayjs().subtract(ORPHAN_ASSET_DAYS, 'day').toDate()
  ) {
    if (
      !(await this._studioRepository.deleteRemovableAsset(asset.id, unusedSince))
        .count
    ) {
      return false;
    }
    try {
      await this.storage.removeFile(asset.path);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        console.error(
          `Could not remove the file of studio asset ${asset.id}:`,
          err
        );
      }
    }
    return true;
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
    const seconds = this.renderableSeconds(template, spec);

    // a voice or stills need the workspace's own key, before anything waits
    if (
      template.instance.aiAssets(spec).length &&
      !(await this._aiCredentialService.hasCredential(org.id))
    ) {
      throw new BadRequestException(MISSING_AI_KEY);
    }

    const names = new Map<string, string>();
    for (const mediaId of uniq(template.instance.mediaIds(spec))) {
      const source = await this.mediaSource(org.id, mediaId);
      if (!source) {
        throw new BadRequestException(
          'A video or picture of this project is not in the media library anymore'
        );
      }
      names.set(mediaId, source.media.name);
    }

    // each place takes what its template expects
    for (const [index, mediaId] of template.instance.mediaIds(spec).entries()) {
      const problem = this.inputKindProblem(
        template.instance,
        spec,
        index,
        names.get(mediaId)!
      );
      if (problem) {
        throw new BadRequestException(problem);
      }
    }

    const musicId = template.instance.musicAssetId(spec);
    if (musicId && !(await this._studioRepository.getAsset(org.id, musicId))) {
      throw new BadRequestException(
        'The music of this project is not available anymore, add it again'
      );
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
        await client.workflow.start('studioRenderWorkflowV2', {
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

  // Templates as assistants and the public API read them, each with a JSON
  // schema of its inputs generated from its DTO, so a new template shows up
  // by itself. A media is only ever its id: the "path" next to it is left
  // out. Templates are registered at boot, so the list is built once
  getTemplateSchemas() {
    if (this.templateSchemas) {
      return this.templateSchemas;
    }

    const schemas = getValidationSchemas() as Record<string, any>;
    this.templateSchemas = this._templateManager
      .getAllTemplates()
      .map((template) => {
        const schema = this.agentSchema(
          schemas[template.dto.name] || { type: 'object' }
        );

        // renderFromSpec times a typed script over the clip, like the
        // editor's typed script, so the words can be left out
        const captions = template.captions
          ? schema.properties?.captions
          : undefined;
        if (captions?.properties?.script && captions?.properties?.words) {
          const required = (captions.required || []).filter(
            (p: string) => p !== 'words'
          );
          if (required.length) {
            captions.required = required;
          } else {
            delete captions.required;
          }
          captions.properties.script.description =
            'What is said in the clip. Without words, Studio spreads it over the clip and longer words get more time';
        }

        // what renderFromSpec fills in when the spec leaves it out
        for (const [key, value] of Object.entries(
          template.agentDefaults || {}
        )) {
          if (schema.properties?.[key]) {
            schema.properties[key].default = value;
          }
        }

        return {
          identifier: template.identifier,
          title: template.title,
          description: template.agentDescription || template.description,
          captions: template.captions,
          ai: !!template.ai,
          schema,
        };
      });

    return this.templateSchemas;
  }

  private agentSchema(schema: any): any {
    if (Array.isArray(schema)) {
      return schema.map((item) => this.agentSchema(item));
    }
    if (!schema || typeof schema !== 'object') {
      return schema;
    }

    const copy: Record<string, any> = Object.fromEntries(
      Object.entries(schema).map(([key, value]) => [
        key,
        this.agentSchema(value),
      ])
    );
    if (copy.properties?.path) {
      delete copy.properties.path;
      if (Array.isArray(copy.required)) {
        copy.required = copy.required.filter((p: string) => p !== 'path');
      }
    }
    if (copy.properties?.mediaId || copy.properties?.assetId) {
      const properties = copy.properties;
      copy.properties = {
        ...properties,
        ...(properties.mediaId
          ? {
              mediaId: {
                ...properties.mediaId,
                description:
                  'The id of a media in the media library of this workspace. Urls are not accepted',
              },
            }
          : {
              assetId: {
                ...properties.assetId,
                description:
                  'The id of a music uploaded to Studio in this workspace that no other project uses. Urls are not accepted',
              },
            }),
      };
    }

    return copy;
  }

  // The checks a spec passes before a render may start, whoever starts it:
  // the template's own check and length. "transcribing": a typed script is
  // timed over the trim of the clip first, so it must fit a transcription
  // too. Returns the length of the video
  private renderableSeconds(
    template: NonNullable<ReturnType<StudioTemplateManager['getTemplate']>>,
    spec: any,
    transcribing = false
  ) {
    const problem = template.instance.check(spec);
    if (problem) {
      throw new BadRequestException(problem);
    }

    const seconds = template.instance.duration(spec);
    if (seconds > STUDIO_MAX_SECONDS) {
      throw new BadRequestException(
        `Videos are ${STUDIO_MAX_SECONDS} seconds at most, this one would be ${Math.ceil(
          seconds
        )}. Trim it or speed it up.`
      );
    }

    const trim = spec?.trim;
    if (transcribing && trim && trim.end - trim.start > MAX_TRANSCRIBE_SECONDS) {
      throw new BadRequestException(
        `Trim the clip to ${MAX_TRANSCRIBE_SECONDS} seconds or less first`
      );
    }

    return seconds;
  }

  // Every media the template reads (its mediaIds) must be a ready media of
  // this workspace, of a kind its place takes, and its music a Studio music
  // of the workspace. Each object of the spec pointing at a media gets its
  // path in our own storage: a path sent by the caller is dropped, the
  // editor plays the stored one and the render reads the media by its id
  private async withWorkspaceMedia(
    org: string,
    template: NonNullable<ReturnType<StudioTemplateManager['getTemplate']>>,
    spec: any
  ) {
    const paths = new Map<string, string>();
    for (const [index, mediaId] of template.instance
      .mediaIds(spec)
      .entries()) {
      const media = await this._mediaService.getOrgMediaById(org, mediaId);
      if (!media || media.deletedAt) {
        throw new BadRequestException(
          `Media ${mediaId} is not in the media library of this workspace`
        );
      }
      if (media.status !== 'ready') {
        throw new BadRequestException(
          `Media ${mediaId} is still processing, try again once it is ready`
        );
      }
      const problem = this.inputKindProblem(
        template.instance,
        spec,
        index,
        media.name
      );
      if (problem) {
        throw new BadRequestException(`Media ${mediaId}: ${problem}`);
      }
      paths.set(mediaId, media.path);
    }

    // a music belongs to one project (it goes with the project), and this
    // project does not exist yet
    const musicId = template.instance.musicAssetId(spec);
    if (musicId) {
      const music = await this._studioRepository.getAsset(org, musicId);
      if (!music) {
        throw new BadRequestException(
          `Music ${musicId} is not a Studio music of this workspace`
        );
      }
      if (music.projectId) {
        throw new BadRequestException(
          'That music belongs to another Studio project; upload it again in Studio'
        );
      }
      paths.set(musicId, music.path);
    }

    const withPaths = (value: any): any => {
      if (Array.isArray(value)) {
        return value.map(withPaths);
      }
      if (!value || typeof value !== 'object') {
        return value;
      }

      const result = Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, withPaths(item)])
      );
      // a path is only ever the stored one of a media or music
      const id =
        typeof value.mediaId === 'string'
          ? value.mediaId
          : typeof value.assetId === 'string'
          ? value.assetId
          : undefined;
      const { path, ...rest } = result;
      return id && paths.has(id) ? { ...rest, path: paths.get(id) } : rest;
    };

    return withPaths(spec);
  }

  private withoutNulls(value: any): any {
    if (Array.isArray(value)) {
      return value
        .filter((item) => item !== null)
        .map((item) => this.withoutNulls(item));
    }
    if (!value || typeof value !== 'object') {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null)
        .map(([key, item]) => [key, this.withoutNulls(item)])
    );
  }

  // A render in one call, for assistants and the public API: a project of the
  // template with the spec, rendered on the same path as the editor (the same
  // validation, media checks, fair use and billing). It only makes a video in
  // the media library, never a post. Everything that can be checked is
  // checked before the project is made, and a project whose render could
  // still not start is removed again
  async renderFromSpec(org: Organization, body: CreateStudioRenderDto) {
    const template = this._templateManager.getTemplate(body.template);
    if (!template) {
      throw new BadRequestException(
        `Unknown template, use one of: ${this._templateManager
          .getAllTemplates()
          .map((p) => p.identifier)
          .join(', ')}`
      );
    }

    // Captions of the shared StudioCaptionsDto may come as a typed script,
    // its words are timed once the project exists, so they may be missing
    const captions = (body.spec as any)?.captions;
    const timeScript =
      template.captions &&
      typeof captions?.script === 'string' &&
      !!captions.script.trim() &&
      !captions?.words?.length;
    // what the template gives assistants by default, like the AI UGC path
    // without a voice that needs no key. A null counts as left out, and a
    // switch that is off by default is on only when it is true
    const defaults = template.agentDefaults || {};
    const given = this.withoutNulls(body.spec) || {};
    const filled = {
      ...defaults,
      ...given,
      ...Object.fromEntries(
        Object.entries(defaults)
          .filter(([, value]) => value === false)
          .map(([key]) => [key, given[key] === true])
      ),
    };
    const validated = await this._templateManager.validateSpec(
      body.template,
      timeScript
        ? { ...filled, captions: { ...captions, words: [] } }
        : filled,
      false
    );
    this.renderableSeconds(template, validated, timeScript);
    const agentProblem = template.instance.agentCheck(validated);
    if (agentProblem) {
      throw new BadRequestException(agentProblem);
    }
    const spec = await this.withWorkspaceMedia(
      org.id,
      template,
      JSON.parse(JSON.stringify(validated))
    );

    // a voice or stills need the workspace's own key, the same check as
    // startRender, before a project is made
    if (
      template.instance.aiAssets(spec).length &&
      !(await this._aiCredentialService.hasCredential(org.id))
    ) {
      throw new BadRequestException(
        `${MISSING_AI_KEY}. Without a key, render it without the AI voice and stills.`
      );
    }

    // the limits are checked again when the render starts; checking them
    // first answers a busy or capped workspace without making a project
    await this.checkFairUse(org);

    const project = await this.createProject(
      org.id,
      {
        name: body.name || template.title,
        template: body.template,
      },
      'api'
    );

    try {
      await this.updateProject(org.id, project.id, { spec });
      if (timeScript) {
        await this.transcribe(org.id, project.id, {
          script: spec.captions.script,
        });
      }

      const render = await this.startRender(org, project.id);
      return { id: render.id, projectId: project.id };
    } catch (err) {
      // a render that failed to start keeps its project, soft deleted
      const removed = await this._studioRepository
        .removeUnrenderedProject(org.id, project.id)
        .catch(() => false);
      if (!removed) {
        await this.deleteProject(org.id, project.id).catch(() => undefined);
      }
      throw err;
    }
  }

  // For assistants: waits up to "seconds" for the render to end, so a status
  // call answers as soon as the video is in the media library
  async waitForRender(org: string, id: string, seconds: number) {
    let render = await this.getRender(org, id);
    for (
      let waited = 0;
      waited < seconds && !STUDIO_FINAL_STATUSES.includes(render.status);
      waited += 3
    ) {
      await timer(3000);
      render = await this.getRender(org, id);
    }

    return render;
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
    signal?: AbortSignal,
    cap = { bytes: MAX_INPUT_BYTES, message: 'This video is larger than 500 MB.' }
  ) {
    let received = 0;
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        callback(
          received > cap.bytes ? new StudioStop(cap.message) : null,
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

  // A picture: one png, jpg or webp frame within the size cap. An animated
  // webp has no size ffprobe can read, so it is refused here too
  async probeImage(dir: string, file: string) {
    let info: {
      streams?: { codec_type: string; codec_name: string; width?: number; height?: number }[];
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
            ...IMAGE_FORMATS,
            '-f',
            'image2',
            '-pattern_type',
            'none',
            '-show_entries',
            'stream=codec_type,codec_name,width,height',
            '-of',
            'json',
            file,
          ],
          { cwd: dir, timeout: 30000 }
        )
      );
    } catch (err) {
      throw new StudioStop('This picture could not be read.');
    }

    const image = info.streams?.find((p) => p.codec_type === 'video');
    if (!image || !IMAGE_CODECS.includes(image.codec_name)) {
      throw new StudioStop('Pictures in PNG, JPG or WebP are supported.');
    }
    const width = image.width || 0;
    const height = image.height || 0;
    if (!width || !height) {
      throw new StudioStop('This picture could not be read.');
    }
    if (
      width > MAX_IMAGE_SIDE ||
      height > MAX_IMAGE_SIDE ||
      width * height > MAX_IMAGE_PIXELS
    ) {
      throw new StudioStop(
        'Pictures up to 25 megapixels (6000 pixels a side) are supported.'
      );
    }
  }

  // What is wrong with the media at this place of the template, by its file
  // type, in words for the customer
  private inputKindProblem(
    template: StudioTemplateAbstract<any>,
    spec: unknown,
    index: number,
    name: string
  ) {
    const ext = extname(name).toLowerCase();
    if (OTHER_IMAGE_EXTENSIONS.includes(ext)) {
      return 'Pictures in PNG, JPG or WebP are supported';
    }
    const image = IMAGE_EXTENSIONS.includes(ext);
    if (image && !template.allowsImage(spec, index)) {
      return 'This template needs a video, not a picture';
    }
    if (!image && !template.allowsVideo(spec, index)) {
      return 'This template takes pictures, not videos';
    }
    return undefined;
  }

  // The rotation a JPEG asks for in its EXIF Orientation (1 to 8), read from
  // the file itself so it is the same whatever ffmpeg version renders it
  async imageOrientation(path: string) {
    const handle = await open(path, 'r');
    try {
      const { buffer, bytesRead } = await handle.read(
        Buffer.alloc(128 * 1024),
        0,
        128 * 1024,
        0
      );
      return jpegOrientation(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }

  // Every picture is turned upright and scaled down on its own before the
  // render, one at a time: the render then holds small 8-bit frames instead
  // of every full size picture at once. The result just covers the panned
  // frame (1242x2208), at most twice that on its long side, so the focus
  // point still has room. Returns the file the render reads
  async prescaleImage(
    dir: string,
    file: string,
    index: number,
    signal?: AbortSignal
  ) {
    const output = `picture-${index}.jpg`;
    const turn =
      ORIENTATION_FILTERS[await this.imageOrientation(join(dir, file))] || '';
    await this.run(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'error',
        '-y',
        '-protocol_whitelist',
        'file',
        ...IMAGE_FORMATS,
        '-threads',
        '2',
        // the rotation is ours, read from the file, never applied twice
        '-noautorotate',
        '-f',
        'image2',
        '-pattern_type',
        'none',
        '-i',
        file,
        '-frames:v',
        '1',
        '-vf',
        `${turn}scale=${PRESCALE_WIDTH}:${PRESCALE_HEIGHT}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=w=min(iw\\,${
          PRESCALE_WIDTH * 2
        }):h=min(ih\\,${PRESCALE_HEIGHT * 2}),format=yuvj420p`,
        '-q:v',
        '2',
        output,
      ],
      { cwd: dir, signal, timeout: 60000 }
    );
    return output;
  }

  // Music: an audio stream in a supported codec, 10 minutes at most
  async probeAudio(dir: string, file: string) {
    let info: {
      streams?: { codec_type: string; codec_name: string }[];
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
            ...MUSIC_FORMATS,
            '-show_entries',
            'stream=codec_type,codec_name:format=duration',
            '-of',
            'json',
            file,
          ],
          { cwd: dir, timeout: 30000 }
        )
      );
    } catch (err) {
      throw new StudioStop('The music could not be read.');
    }

    const audio = info.streams?.find((p) => p.codec_type === 'audio');
    if (!audio || !AUDIO_CODECS.includes(audio.codec_name)) {
      throw new StudioStop('Music in MP3, M4A or WAV is supported.');
    }
    if (Number(info.format?.duration || 0) > STUDIO_MAX_SOURCE_SECONDS + 1) {
      throw new StudioStop('Music up to 10 minutes long is supported.');
    }
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
      const inputs: StudioPlanInput[] = [];
      for (const [index, mediaId] of template.instance
        .mediaIds(spec)
        .entries()) {
        const source = await this.mediaSource(org, mediaId);
        if (!source) {
          throw new StudioStop(
            'A video or picture of this project was removed from the media library.'
          );
        }

        hooks.heartbeat?.(`downloading input ${index}`);
        const ext =
          extname(source.media.name)
            .toLowerCase()
            .replace(/[^.a-z0-9]/g, '') || '.mp4';
        const image = IMAGE_EXTENSIONS.includes(ext);
        const problem = this.inputKindProblem(
          template.instance,
          spec,
          index,
          source.media.name
        );
        if (problem) {
          throw new StudioStop(`${problem}.`);
        }

        const file = `source-${index}${ext}`;
        if (image) {
          await this.download(source, join(dir, file), hooks.signal, {
            bytes: MAX_IMAGE_BYTES,
            message: 'This picture is larger than 20 MB.',
          });
          await this.probeImage(dir, file);
          inputs.push({
            file: await this.prescaleImage(dir, file, index, hooks.signal),
            hasAudio: false,
            image: true,
          });
          continue;
        }

        await this.download(source, join(dir, file), hooks.signal);
        const probed = await this.probe(dir, file);
        inputs.push({
          file,
          hasAudio: probed.hasAudio,
          duration: probed.duration,
        });
      }

      const problem = template.instance.checkInputs(spec, inputs);
      if (problem) {
        throw new StudioStop(problem);
      }

      const music = await this.downloadMusic(
        org,
        template.instance.musicAssetId(spec),
        dir,
        hooks
      );
      const ai = await this.downloadAi(
        render.projectId,
        template.instance.aiAssets(spec),
        dir,
        hooks
      );

      const plan = template.instance.plan(spec, {
        inputs,
        fontsDir: this.fontsDir(),
        ...(music ? { music } : {}),
        ...(ai.length ? { ai } : {}),
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

  // What the workspace's AI made in the step before the render (a voice,
  // stills), next to the inputs, in the order the template asked for them
  private async downloadAi(
    projectId: string,
    requests: ReturnType<StudioTemplateAbstract['aiAssets']>,
    dir: string,
    hooks: StudioRenderHooks
  ) {
    const ai: NonNullable<StudioPlanContext['ai']> = [];
    if (!requests.length) {
      return ai;
    }

    const made = (await this._studioRepository.getAiAssets(projectId))
      .map(studioAiAssetFromRow)
      .filter((p) => !!p);
    for (const [index, request] of requests.entries()) {
      const key = studioAiAssetKey(request);
      const asset = made.find((p) => p!.key === key);
      if (!asset) {
        throw new StudioStop(
          'What your AI made for this video is missing. Render it again.'
        );
      }
      hooks.heartbeat?.(`downloading ai file ${index}`);
      const file = `ai-${index}.${asset.kind === 'voice' ? 'mp3' : 'jpg'}`;
      await this.downloadStored(asset, join(dir, file), hooks.signal);
      ai.push({ file, seconds: asset.seconds, words: asset.words });
    }
    return ai;
  }

  // The music of the workspace the spec picked, next to the inputs
  private async downloadMusic(
    org: string,
    assetId: string | undefined,
    dir: string,
    hooks: StudioRenderHooks
  ) {
    if (!assetId) {
      return undefined;
    }

    const asset = await this._studioRepository.getAsset(org, assetId);
    const source = asset
      ? await this.storedSource(asset.name, asset.path)
      : null;
    if (!asset || !source) {
      throw new StudioStop(
        'The music of this project is not available anymore, add it again.'
      );
    }

    hooks.heartbeat?.('downloading music');
    const file = `music${
      extname(asset.name)
        .toLowerCase()
        .replace(/[^.a-z0-9]/g, '') || '.mp3'
    }`;
    await this.download(source, join(dir, file), hooks.signal, {
      bytes: STUDIO_MUSIC_MAX_BYTES,
      message: 'The music is larger than 30 MB.',
    });
    await this.probeAudio(dir, file);
    return { file };
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

  // The finished videos of the workspace, newest first, to schedule at once
  getFinishedRenders(org: string) {
    return this._studioRepository.getFinishedRenders(org);
  }

  // The daily cleanup: stored music of deleted projects and music no project
  // has used for a week, then render records older than 90 days. The videos
  // they made are media and stay. Works in pages, heartbeating between them
  async cleanup(heartbeat: (details: string) => void = () => undefined) {
    const removed = { assets: 0, renders: 0 };
    const unusedSince = dayjs().subtract(ORPHAN_ASSET_DAYS, 'day').toDate();
    // ids a project took back in the meantime, so a page never repeats them
    const failed: string[] = [];
    for (;;) {
      const assets = await this._studioRepository.getAssetsToRemove(
        unusedSince,
        failed,
        CLEANUP_PAGE
      );
      for (const asset of assets) {
        if (await this.removeAsset(asset, unusedSince)) {
          removed.assets++;
        } else {
          failed.push(asset.id);
        }
      }
      heartbeat(`studio cleanup: ${removed.assets} assets`);
      if (assets.length < CLEANUP_PAGE) {
        break;
      }
    }

    removed.renders = (
      await this._studioRepository.pruneRenders(
        dayjs().subtract(RENDER_HISTORY_DAYS, 'day').toDate()
      )
    ).count;
    heartbeat(`studio cleanup: ${removed.renders} renders`);
    return removed;
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
