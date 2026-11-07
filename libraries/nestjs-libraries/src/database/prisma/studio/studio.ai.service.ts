import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { ApplicationFailure } from '@temporalio/common';
import { createReadStream } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomBytes } from 'crypto';
import dayjs from 'dayjs';
import {
  StudioRepository,
  STUDIO_FINAL_STATUSES,
} from '@gitroom/nestjs-libraries/database/prisma/studio/studio.repository';
import {
  StudioService,
  StudioStop,
} from '@gitroom/nestjs-libraries/database/prisma/studio/studio.service';
import { StudioTemplateManager } from '@gitroom/nestjs-libraries/studio/studio.manager';
import { StudioAiManager } from '@gitroom/nestjs-libraries/studio/ai/studio.ai.manager';
import {
  StudioAiAsset,
  StudioAiAssetRequest,
  StudioAiError,
  StudioAiProviderAbstract,
  studioAiAssetData,
  studioAiAssetFromRow,
  studioAiAssetKey,
} from '@gitroom/nestjs-libraries/studio/ai/studio.ai.interface';
import { MISSING_AI_KEY } from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { truncateForTemporal } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { STUDIO_MAX_SECONDS } from '@gitroom/nestjs-libraries/dtos/studio/studio.clip.dto';

// A failure of the AI that may pass (a rate limit, an outage): the workflow
// retries it a few times, and its message is still the customer's to read
export class StudioAiRetry extends ApplicationFailure {
  constructor(message: string) {
    super(truncateForTemporal(message, 2000), 'studio_ai_retry', false);
  }
}

// A proxy in front of the API gives up after 60 seconds, so what runs in a
// request (a script, a voice preview) has 50 for the whole AI call
const REQUEST_BUDGET = 50 * 1000;
// A voice preview also measures and uploads the file in the same 60 seconds
const VOICE_REQUEST_BUDGET = 40 * 1000;
const PROBE_TIMEOUT = 5 * 1000;
// The longest a prepare step lets one AI call take; stills are slow
const RENDER_CALL_BUDGET = 4 * 60 * 1000;
// One AI step per project at a time; a lock that is never released (a
// crash) expires: a request lasts at most a minute, the render step 10
const REQUEST_LOCK_SECONDS = 2 * 60;
const RENDER_LOCK_SECONDS = 16 * 60;
// Refreshes a lock only while it is still ours
const REFRESH_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2]) end return false`;
// a render this long untouched has a dead workflow (StudioService)
const STALE_HOURS = 2;

@Injectable()
export class StudioAiService {
  private storage = UploadFactory.createStorage();

  constructor(
    private _studioService: StudioService,
    private _studioRepository: StudioRepository,
    private _templateManager: StudioTemplateManager,
    private _aiManager: StudioAiManager
  ) {}

  // What the workspace's AI can do in Studio, for the editor: its voices, and
  // whether it makes video at all (no provider does today, so it is hidden)
  async getCapabilities(org: string) {
    const provider = await this._aiManager.forOrganization(org);
    if (!provider) {
      return { connected: false, voices: [] as string[], video: false };
    }

    return {
      connected: true,
      provider: provider.identifier,
      voices: provider.instance.voices,
      video: typeof provider.instance.video === 'function',
    };
  }

  // Writes the script of a project with the workspace's own AI and saves it
  // for the customer to edit before rendering
  async writeScript(org: string, id: string) {
    const { project, template } = await this.aiProject(org, id);
    const request = template.instance.aiScript(project.spec);
    if (!request) {
      throw new BadRequestException('Describe the topic or product first');
    }

    const provider = await this.provider(org);
    const script = await this.locked(id, () =>
      provider.instance
        .script(org, request, { signal: AbortSignal.timeout(REQUEST_BUDGET) })
        .catch((err) => this.httpError(err))
    );

    // read again: the customer kept editing while the AI wrote
    const fresh = await this._studioService.getProject(org, id);
    const updated = await this._studioService.updateProject(org, id, {
      spec: template.instance.applyAiScript(fresh.spec, script),
    });
    return { script: updated.spec.script };
  }

  // Makes the voice of the script now, so the customer hears it before
  // rendering; the render reuses it as long as the script and voice stay
  async voiceover(org: string, id: string) {
    const { project, template } = await this.aiProject(org, id);
    const requests = template.instance
      .aiAssets(project.spec)
      .filter((p) => p.kind === 'voice');
    if (!requests.length) {
      throw new BadRequestException(
        'Write the script and turn the voiceover on first'
      );
    }

    // a render reads the voice of the project: it is never replaced under it
    if (
      (await this._studioRepository.getActiveRenders(org)).some(
        (p) =>
          p.projectId === id &&
          dayjs(p.updatedAt).isAfter(dayjs().subtract(STALE_HOURS, 'hour'))
      )
    ) {
      throw new HttpException(
        'This video is rendering, wait for it to finish',
        409
      );
    }

    const provider = await this.provider(org);
    const [voice] = await this.locked(id, () =>
      this.fulfil(org, id, provider.instance, requests, {
        signal: AbortSignal.timeout(VOICE_REQUEST_BUDGET),
        words: false,
        prune: ['voice'],
      }).catch((err) => this.httpError(err))
    );

    return { path: voice.path, seconds: voice.seconds };
  }

  // The step of the render workflow before the render: makes what the
  // template asks the AI for, or reuses what a preview or an earlier
  // attempt made, and keeps only that on the project
  async generateForRender(renderId: string, signal?: AbortSignal) {
    const render = await this._studioRepository.getRenderById(renderId);
    if (!render || STUDIO_FINAL_STATUSES.includes(render.status)) {
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
        JSON.parse(render.specSnapshot || '{}'),
        false
      );
    } catch (err) {
      throw new StudioStop('The project settings are not valid anymore.');
    }

    const requests = template.instance.aiAssets(spec);
    if (!requests.length) {
      // nothing to make: a voice previewed before the voice was turned off
      // is not kept around
      await this.prune(await this.storedAssets(render.projectId), [], 'all');
      return;
    }

    const provider = await this._aiManager.forOrganization(
      render.organizationId
    );
    if (!provider) {
      throw new StudioStop(MISSING_AI_KEY);
    }

    await this._studioRepository.updateRender(renderId, {
      status: 'generating',
      progress: 0,
    });

    // the lock is named after the render, so an attempt that follows one
    // that crashed takes its own lock back instead of waiting it out
    const lock = `studioAi:${render.projectId}`;
    const token = `render:${renderId}`;
    if (
      !(await ioRedis.set(lock, token, 'EX', RENDER_LOCK_SECONDS, 'NX')) &&
      !(await ioRedis.eval(
        REFRESH_LOCK,
        1,
        lock,
        token,
        String(RENDER_LOCK_SECONDS)
      ))
    ) {
      // a preview of this project is running, the next attempt waits for it
      throw new StudioAiRetry('Your AI is busy with this video, try again.');
    }

    try {
      await this.fulfil(
        render.organizationId,
        render.projectId,
        provider.instance,
        requests,
        { signal, words: true, prune: 'all' }
      );
    } catch (err) {
      if (signal?.aborted) {
        throw err;
      }
      // the key was removed while the render waited
      if (err instanceof HttpException) {
        throw new StudioStop(err.message);
      }
      if (!(err instanceof StudioAiError)) {
        throw err;
      }
      throw err.retry
        ? new StudioAiRetry(err.message)
        : new StudioStop(err.message);
    } finally {
      if ((await ioRedis.get(lock)) === token) {
        await ioRedis.del(lock);
      }
    }
  }

  private async aiProject(org: string, id: string) {
    const project = await this._studioService.getProject(org, id);
    const template = this._templateManager.getTemplate(project.template);
    if (!template?.ai) {
      throw new BadRequestException('This template does not use AI');
    }

    // the AI of Studio is a Studio feature like rendering: it needs a plan
    if (!(await this._studioService.billing(org)).subscribed) {
      throw new HttpException(
        'Studio needs an active plan. Pick one in Billing to use AI in Studio.',
        406
      );
    }

    return { project, template };
  }

  private async provider(org: string) {
    const provider = await this._aiManager.forOrganization(org);
    if (!provider) {
      throw new BadRequestException(MISSING_AI_KEY);
    }
    return provider;
  }

  // One AI step per project at a time: each spends the customer's own credit
  private async locked<T>(projectId: string, run: () => Promise<T>) {
    const lock = `studioAi:${projectId}`;
    const token = randomBytes(16).toString('hex');
    if (!(await ioRedis.set(lock, token, 'EX', REQUEST_LOCK_SECONDS, 'NX'))) {
      throw new HttpException(
        'Your AI is already working on this video, wait for it to finish',
        429
      );
    }
    try {
      return await run();
    } finally {
      if ((await ioRedis.get(lock)) === token) {
        await ioRedis.del(lock);
      }
    }
  }

  // A failure of the AI as the response the customer reads
  private httpError(err: unknown): never {
    if (err instanceof HttpException) {
      throw err;
    }
    if (err instanceof StudioAiError) {
      throw new HttpException(err.message, err.status);
    }
    console.error('Studio AI step failed:', (err as Error)?.message);
    throw new HttpException('Your AI could not do this, try again.', 502);
  }

  // What the AI made for a project, by the key of what it was made from
  private async storedAssets(projectId: string) {
    const stored: Record<string, StudioAiAsset> = {};
    for (const row of await this._studioRepository.getAiAssets(projectId)) {
      const asset = studioAiAssetFromRow(row);
      if (asset) {
        stored[asset.key] = asset;
      }
    }
    return stored;
  }

  // A file the AI made, kept as a StudioAsset of the project as soon as it
  // is stored: nothing is ever paid for twice, and erasure and the daily
  // cleanup see it like the music
  private async record(
    org: string,
    projectId: string,
    asset: Omit<StudioAiAsset, 'id'>
  ): Promise<StudioAiAsset> {
    const { id } = await this._studioRepository.createAiAsset(org, projectId, {
      kind: asset.kind,
      name: asset.name,
      path: asset.path,
      data: studioAiAssetData(asset),
    });
    return { ...asset, id };
  }

  // Makes every request that has no file yet, keeps every file as soon as it
  // is made and returns them in the order of the requests. "prune" then
  // removes the files of those kinds that no request asked for anymore
  private async fulfil(
    org: string,
    projectId: string,
    provider: StudioAiProviderAbstract,
    requests: StudioAiAssetRequest[],
    options: {
      signal?: AbortSignal;
      // a voice needs the times of its words
      words: boolean;
      prune: 'all' | StudioAiAssetRequest['kind'][];
    }
  ): Promise<StudioAiAsset[]> {
    const stored = await this.storedAssets(projectId);
    const keys = requests.map(studioAiAssetKey);
    const made: Record<string, StudioAiAsset> = {};
    const dir = join(
      this._studioService.tmpRoot(),
      `ai-${projectId}-${randomBytes(4).toString('hex')}`
    );
    const call = () => ({
      signal: options.signal
        ? AbortSignal.any([
            options.signal,
            AbortSignal.timeout(RENDER_CALL_BUDGET),
          ])
        : AbortSignal.timeout(RENDER_CALL_BUDGET),
    });

    try {
      await mkdir(dir, { recursive: true });
      // the voice first, it is the one a preview waits for; stills together
      for (const [index, request] of requests.entries()) {
        if (request.kind !== 'voice') {
          continue;
        }
        const existing = stored[keys[index]];
        if (existing && (!options.words || existing.words)) {
          continue;
        }
        made[keys[index]] = await this.voice(
          org,
          projectId,
          provider,
          request,
          keys[index],
          existing,
          join(dir, `voice-${index}.mp3`),
          options.words,
          call
        );
      }

      // every still that was made is kept even when another one fails, so a
      // retry never pays for it again
      const stills = await Promise.allSettled(
        requests.map(async (request, index) => {
          if (request.kind !== 'image' || stored[keys[index]]) {
            return;
          }
          const image = await provider.image(org, request, call());
          const file = join(dir, `still-${index}.jpg`);
          await writeFile(file, image);
          const uploaded = await this.storage.uploadStream(
            createReadStream(file),
            'image/jpeg',
            'jpg'
          );
          made[keys[index]] = await this.record(org, projectId, {
            kind: 'image',
            key: keys[index],
            name: uploaded.filename,
            path: uploaded.path,
          });
        })
      );
      const failed = stills.find(
        (p): p is PromiseRejectedResult => p.status === 'rejected'
      );
      if (failed) {
        throw failed.reason;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    const all = { ...stored, ...made };
    await this.prune(all, keys, options.prune);
    return keys.map((key) => all[key]);
  }

  // A voice, or the word times of one made before
  private async voice(
    org: string,
    projectId: string,
    provider: StudioAiProviderAbstract,
    request: Extract<StudioAiAssetRequest, { kind: 'voice' }>,
    key: string,
    existing: StudioAiAsset | undefined,
    file: string,
    words: boolean,
    call: () => { signal: AbortSignal }
  ): Promise<StudioAiAsset> {
    let asset = existing;
    if (existing) {
      await this._studioService.downloadStored(existing, file, call().signal);
    } else {
      await writeFile(file, await provider.tts(org, request, call()));
      const seconds = await this.audioSeconds(file, call().signal);
      if (seconds > STUDIO_MAX_SECONDS) {
        throw new StudioAiError(
          `The voiceover is ${Math.ceil(
            seconds
          )} seconds, videos are ${STUDIO_MAX_SECONDS} at most. Shorten the script.`,
          400
        );
      }
      const uploaded = await this.storage.uploadStream(
        createReadStream(file),
        'audio/mpeg',
        'mp3'
      );
      asset = await this.record(org, projectId, {
        kind: 'voice',
        key,
        name: uploaded.filename,
        path: uploaded.path,
        seconds,
      });
    }

    if (!words) {
      return asset!;
    }

    // Whisper on the voice itself. Timing is a nicety: when it fails (a rate
    // limit, an outage, a key without whisper-1), this render spreads the
    // script over the voice instead of retrying and paying again, and nothing
    // is saved so the next render times it for real. Only a rejected key or
    // an empty account stops the render: nothing else would work either
    let timed: StudioAiAsset;
    try {
      timed = {
        ...asset!,
        words: await provider.transcribe(org, file, call()),
      };
    } catch (err) {
      if (
        (err instanceof StudioAiError && err.account) ||
        call().signal.aborted
      ) {
        throw err;
      }
      console.error(
        'Studio voice timing failed, spreading the script instead:',
        (err as Error)?.message
      );
      return asset!;
    }

    await this._studioRepository.updateAiAssetData(
      timed.id!,
      studioAiAssetData(timed)
    );
    return timed;
  }

  private async audioSeconds(file: string, signal: AbortSignal) {
    const output = await this._studioService.run(
      'ffprobe',
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file',
        '-format_whitelist',
        'mp3',
        '-show_entries',
        'format=duration',
        '-of',
        'csv=p=0',
        file,
      ],
      { cwd: join(file, '..'), timeout: PROBE_TIMEOUT, signal }
    );
    const seconds = Number(output.trim());
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new StudioAiError(
        'The voiceover came back empty. Try again.',
        502,
        true
      );
    }
    return Number(seconds.toFixed(3));
  }

  // Removes the files of those kinds that no request asks for anymore, so a
  // project only ever holds the files of its latest script. The row goes
  // first: a file whose row is gone is never read again
  private async prune(
    all: Record<string, StudioAiAsset>,
    keys: string[],
    prune: 'all' | StudioAiAssetRequest['kind'][]
  ) {
    for (const [key, asset] of Object.entries(all)) {
      if (
        keys.includes(key) ||
        (prune !== 'all' && !prune.includes(asset.kind)) ||
        !asset.id
      ) {
        continue;
      }
      if (await this._studioRepository.deleteAiAsset(asset.id)) {
        await this.storage
          .removeFile(asset.path)
          .catch((err) =>
            console.error(
              `Could not remove the file of studio asset ${asset.id}:`,
              err?.message
            )
          );
      }
    }
  }
}
