import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'crypto';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { uniq, uniqBy } from 'lodash';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { PostsImportRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.import.repository';
import { isValidTimezone } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.import.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { getValidationSchemas } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import { composerOnlySettings } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/composer.only.decorator';
import {
  BULK_VIDEO_LIMIT,
  BulkVideoPostsDto,
} from '@gitroom/nestjs-libraries/dtos/posts/bulk.videos.dto';
import { CreatePostDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import { ApprovalActor } from '@gitroom/nestjs-libraries/database/prisma/approvals/approval.policy.service';
import { plainTextToHtml } from '@gitroom/helpers/utils/plain.text.to.html';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';

dayjs.extend(utc);
dayjs.extend(timezone);

const DAY = 24 * 60;
// the times findFreeDateTime uses for a channel without time slots
const DEFAULT_TIMES = [120, 400, 700];
// how far ahead a video can be scheduled, in both modes
const SLOT_SEARCH_DAYS = 366;
// the least time between now and a scheduled post
const MARGIN = 5 * 60 * 1000;
// the hash key of a bulk schedule, apart from the CSV imports
const HASH_PREFIX = 'bulk-videos';

export type BulkVideoIssue = {
  field: 'media' | 'caption' | 'settings' | 'date' | 'channel';
  message: string;
  hint?: string;
};

// a provider setting the bulk form can show: text, a list of choices, a
// yes/no or a number. Composer-only settings (picked from a list loaded from
// the network, or set by a check of the composer) are left out
export type BulkVideoSettingField = {
  key: string;
  type: 'text' | 'select' | 'boolean' | 'number';
  required: boolean;
  options?: string[];
  maxLength?: number;
  defaultValue?: string;
};

// "My clip.final.mp4" -> "My clip.final"
export const fileTitle = (name: string) =>
  (name || '').replace(/\.[a-z0-9]{1,5}$/i, '').trim();

// {filename} in a caption or a text setting
export const fillPlaceholders = <T>(value: T, filename: string): T => {
  if (typeof value === 'string') {
    return value.replace(/\{filename\}/gi, filename) as T;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        typeof item === 'string' ? fillPlaceholders(item, filename) : item,
      ])
    ) as T;
  }
  return value;
};

// a time slot is minutes after midnight UTC (see time.table.tsx)
const slotMinutes = (times: number[]) =>
  uniq(
    (times.length ? times : DEFAULT_TIMES).map(
      (time) => ((Math.round(time) % DAY) + DAY) % DAY
    )
  ).sort((a, b) => a - b);

const minuteKey = (date: Date | number) =>
  Math.floor(new Date(date).getTime() / 60_000);

// The next `count` time slots of a channel from `start`, day by day in slot
// order, skipping the dates that already have a post (`taken`, as
// minuteKey) and the next 5 minutes. Fewer come back when the year runs out.
export const nextFreeSlots = (options: {
  times: number[];
  start: Date;
  count: number;
  taken: Set<number>;
  now?: number;
  days?: number;
}): Date[] => {
  const now = (options.now ?? Date.now()) + MARGIN;
  const from = Math.max(options.start.getTime(), now);
  const minutes = slotMinutes(options.times);
  const firstDay = dayjs.utc(from).startOf('day');
  const dates: Date[] = [];

  for (
    let day = 0;
    day <= (options.days ?? SLOT_SEARCH_DAYS) && dates.length < options.count;
    day++
  ) {
    for (const minute of minutes) {
      const date = firstDay.add(day, 'day').add(minute, 'minute');
      if (
        date.valueOf() < from ||
        date.valueOf() <= now ||
        options.taken.has(minuteKey(date.valueOf()))
      ) {
        continue;
      }
      dates.push(date.toDate());
      if (dates.length === options.count) {
        break;
      }
    }
  }

  return dates;
};

// One date every `every` hours or days from `start`. Days are counted on the
// wall clock of `tz`, so a daily 09:00 stays at 09:00 after a clock change.
export const intervalDates = (options: {
  start: Date;
  count: number;
  every: number;
  unit: 'hours' | 'days';
  tz?: string;
}): Date[] => {
  const start = dayjs.utc(options.start);
  if (options.unit === 'hours') {
    return Array.from({ length: options.count }, (_, index) =>
      start.add(index * options.every, 'hour').toDate()
    );
  }
  const tz = options.tz && isValidTimezone(options.tz) ? options.tz : 'UTC';
  const local = start.tz(tz).format('YYYY-MM-DDTHH:mm:ss');
  return Array.from({ length: options.count }, (_, index) =>
    dayjs
      .tz(
        dayjs
          .utc(local)
          .add(index * options.every, 'day')
          .format('YYYY-MM-DDTHH:mm:ss'),
        tz
      )
      .toDate()
  );
};

// The top level settings of a provider DTO (its JSON schema) the bulk form
// can fill, without the composer-only ones. A required free text "title"
// starts as the file name.
export const settingFields = (
  schema: any,
  composerOnly: string[] = []
): BulkVideoSettingField[] => {
  const required: string[] = schema?.required || [];
  return Object.entries<any>(schema?.properties || {}).flatMap(
    ([key, property]): BulkVideoSettingField[] => {
      if (key.startsWith('__') || !property || composerOnly.includes(key)) {
        return [];
      }
      const base = { key, required: required.includes(key) };
      if (property.type === 'boolean') {
        return [{ ...base, type: 'boolean' }];
      }
      if (Array.isArray(property.enum) && property.enum.length) {
        return [
          { ...base, type: 'select', options: property.enum.map(String) },
        ];
      }
      if (property.type === 'number' || property.type === 'integer') {
        return [{ ...base, type: 'number' }];
      }
      if (property.type === 'string') {
        return [
          {
            ...base,
            type: 'text',
            ...(property.maxLength ? { maxLength: property.maxLength } : {}),
            ...(key === 'title' && base.required
              ? { defaultValue: '{filename}' }
              : {}),
          },
        ];
      }
      return [];
    }
  );
};

// The bulk form of a provider: the settings it can fill, and whether the
// network requires a composer-only setting, which leaves drafts only
export const bulkSettings = (dto: any, schemas: Record<string, any>) => {
  const schema = dto ? schemas[dto.name] : undefined;
  const composerOnly = composerOnlySettings(dto);
  const required: string[] = schema?.required || [];
  return {
    fields: settingFields(schema, composerOnly),
    draftsOnly: composerOnly.some((key) => required.includes(key)),
  };
};

// the unique key of a bulk schedule: same videos, channels and settings
export const bulkVideosHash = (body: BulkVideoPostsDto) =>
  createHash('sha256')
    .update(`${HASH_PREFIX}\n${JSON.stringify(body)}`)
    .digest('hex');

const errorMessage = (err: any): string => {
  if (err instanceof HttpException) {
    const response: any = err.getResponse();
    const message = response?.message ?? err.message;
    return Array.isArray(message) ? message.join('; ') : String(message);
  }
  return err?.message || 'Something went wrong';
};

// a plan limit (posts a month, a network's monthly cap) answers 402
const isLimit = (err: any) =>
  err instanceof HttpException && err.getStatus() === 402;

type PlanChannel = {
  id: string;
  name: string;
  identifier: string;
  picture?: string | null;
  date: string | null;
  errors: BulkVideoIssue[];
};

// a channel a video did not go to, and why
type SkippedChannel = { id: string; name: string; error: string };

type BulkVideoResult = {
  index: number;
  name: string;
  status: 'created' | 'skipped' | 'failed';
  error?: string;
  skippedChannels?: SkippedChannel[];
};

type PlanItem = {
  index: number;
  mediaId: string;
  name: string;
  caption: string;
  channels: PlanChannel[];
  errors: BulkVideoIssue[];
  request: CreatePostDto | null;
  // the request after the checks of POST /posts, what createPost gets
  mapped: CreatePostDto | null;
};

const hasErrors = (item: PlanItem) =>
  !!item.errors.length || item.channels.some((p) => p.errors.length);

@Injectable()
export class PostsBulkVideosService {
  constructor(
    private _postsService: PostsService,
    private _importRepository: PostsImportRepository,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager,
    private _mediaService: MediaService
  ) {}

  // The channels a video can go to, with the settings their network asks for
  async channels(orgId: string) {
    const integrations = (
      await this._integrationService.getIntegrationsList(orgId)
    ).filter((integration) => !integration.disabled && !integration.inBetweenSteps);
    const schemas = getValidationSchemas() as Record<string, any>;

    return Promise.all(
      integrations.map(async (integration) => {
        const provider = this._integrationManager.getSocialIntegration(
          integration.providerIdentifier
        );
        let additionalSettings: any[] = [];
        try {
          additionalSettings = JSON.parse(
            integration.additionalSettings || '[]'
          );
        } catch (err) {
          additionalSettings = [];
        }
        // the network's own media rules, with one video and default settings
        let acceptsVideo = !!provider;
        if (provider) {
          try {
            acceptsVideo =
              (await provider.checkValidity(
                [[{ path: 'bulk-video.mp4' }]],
                {},
                additionalSettings
              )) === true;
          } catch (err) {
            // a check that needs the real file: the preview runs it on it
            acceptsVideo = true;
          }
        }
        const form = bulkSettings(provider?.dto, schemas);
        return {
          id: integration.id,
          name: integration.name,
          identifier: integration.providerIdentifier,
          picture: integration.picture,
          refreshNeeded: integration.refreshNeeded,
          acceptsVideo,
          settings: form.fields,
          // a network that needs a setting picked in the composer
          draftsOnly: form.draftsOnly,
        };
      })
    );
  }

  // The dates of every video on every channel, and in slots mode the
  // minutes each channel already posts at (minuteKey), by channel id
  private async dates(
    orgId: string,
    body: BulkVideoPostsDto,
    channelIds: string[]
  ): Promise<{
    dates: Record<string, Date[]>;
    taken: Record<string, Set<number>>;
  }> {
    const count = body.videos.length;
    const start = new Date(body.schedule.start);

    if (body.schedule.mode === 'interval') {
      const dates = intervalDates({
        start,
        count,
        every: body.schedule.every!,
        unit: body.schedule.unit!,
        tz: body.schedule.timezone,
      });
      return {
        dates: Object.fromEntries(channelIds.map((id) => [id, dates])),
        taken: {},
      };
    }

    const from = dayjs
      .utc(Math.max(start.getTime(), Date.now()))
      .startOf('day');
    const posts = await this._postsService.getPublishDatesOfIntegrations(
      orgId,
      channelIds,
      from.toDate(),
      from.add(SLOT_SEARCH_DAYS + 1, 'day').toDate()
    );

    const dates: Record<string, Date[]> = {};
    const taken: Record<string, Set<number>> = {};
    for (const id of channelIds) {
      taken[id] = new Set(
        posts
          .filter((post) => post.integrationId === id)
          .map((post) => minuteKey(post.publishDate))
      );
      dates[id] = nextFreeSlots({
        times: await this._integrationService.findFreeDateTime(orgId, id),
        start,
        count,
        taken: taken[id],
      });
    }
    return { dates, taken };
  }

  // The problem of the date a video gets on a channel: the planned one, or
  // the one the preview showed (`sent`), which must still be free
  private dateIssue(options: {
    date: Date | undefined;
    sent: boolean;
    body: BulkVideoPostsDto;
    taken?: Set<number>;
    used: Set<number>;
  }): BulkVideoIssue | null {
    const { date, sent, body, taken, used } = options;
    if (!date || isNaN(date.getTime())) {
      return sent
        ? {
            field: 'date',
            message: "This date can't be read.",
            hint: 'Check again to get new dates.',
          }
        : {
            field: 'date',
            message: 'There is no free time slot in the next year.',
            hint: 'Add time slots to this channel, or post every few hours or days instead.',
          };
    }
    const time = date.getTime();
    if (body.type === 'schedule' && time <= Date.now() + MARGIN) {
      return {
        field: 'date',
        message: 'This time has passed or is less than 5 minutes away.',
        hint: 'Check again to get new dates.',
      };
    }
    if (time > Date.now() + SLOT_SEARCH_DAYS * DAY * 60_000) {
      return {
        field: 'date',
        message: 'This is more than a year from now.',
        hint: 'Start sooner, post more often, or schedule fewer videos.',
      };
    }
    if (body.schedule.mode === 'slots') {
      const minute = minuteKey(time);
      if (taken?.has(minute) || used.has(minute)) {
        return {
          field: 'date',
          message: 'This time slot was taken since the preview.',
          hint: 'Check again to get a new one.',
        };
      }
      used.add(minute);
    }
    return null;
  }

  // the checks of POST /posts for one video, as issues instead of an error
  private async validate(
    orgId: string,
    item: PlanItem,
    type: BulkVideoPostsDto['type']
  ) {
    const request = item.request!;
    try {
      const results = await this._postsService.validatePosts(
        orgId,
        request.posts as any,
        type
      );
      results.forEach((result, index) => {
        const channel = item.channels[index];
        if (result.emptyContent) {
          channel.errors.push({
            field: 'caption',
            message: 'The post is empty.',
          });
        }
        // a draft gets the other checks when it is scheduled
        if (type === 'draft') {
          return;
        }
        if (!result.valid) {
          channel.errors.push({
            field: 'settings',
            message:
              result.settingsError || 'Some required settings are missing.',
            hint: `Fill in the ${result.name} settings.`,
          });
        }
        if (result.errors !== true) {
          channel.errors.push({ field: 'media', message: result.errors });
        }
        if (result.tooLong) {
          channel.errors.push({
            field: 'caption',
            message: `The caption is longer than ${result.maximumCharacters} characters.`,
            hint: 'Shorten it for this video, or give it a caption of its own.',
          });
        }
      });
    } catch (err) {
      item.errors.push({ field: 'channel', message: errorMessage(err) });
    }

    if (!hasErrors(item)) {
      try {
        item.mapped = await this._postsService.mapTypeToPost(request, orgId);
      } catch (err) {
        item.errors.push({ field: 'settings', message: errorMessage(err) });
      }
    }
  }

  // Every video as the post request the composer would send (all the
  // channels in one post, each at its own date), with its problems. The
  // dates the preview showed are kept when they are still free.
  private async plan(orgId: string, body: BulkVideoPostsDto) {
    if (body.videos.length > BULK_VIDEO_LIMIT) {
      throw new BadRequestException(
        `Schedule up to ${BULK_VIDEO_LIMIT} videos at a time.`
      );
    }
    const start = new Date(body.schedule.start).getTime();
    if (start > Date.now() + SLOT_SEARCH_DAYS * DAY * 60_000) {
      throw new BadRequestException('Pick a start date within the next year.');
    }
    if (
      body.type === 'schedule' &&
      body.schedule.mode === 'interval' &&
      start <= Date.now() + MARGIN
    ) {
      throw new BadRequestException(
        'Pick a start time at least 5 minutes from now.'
      );
    }

    const integrations = await this._integrationService.getIntegrationsList(
      orgId
    );
    const schemas = getValidationSchemas() as Record<string, any>;
    const channels = uniqBy(body.channels, (channel) => channel.id).map(
      (channel) => {
        const integration = integrations.find((p) => p.id === channel.id);
        if (!integration) {
          throw new BadRequestException(
            'One of the channels was not found. Pick the channels again.'
          );
        }
        if (integration.disabled || integration.inBetweenSteps) {
          throw new BadRequestException(
            `${integration.name} is turned off or not fully connected. Pick another channel.`
          );
        }
        const provider = this._integrationManager.getSocialIntegration(
          integration.providerIdentifier
        );
        if (
          body.type === 'schedule' &&
          bulkSettings(provider?.dto, schemas).draftsOnly
        ) {
          throw new BadRequestException(
            `${integration.name} needs a setting picked in the composer, like a board or a channel. Add the videos as drafts and finish them in the composer, or leave ${integration.name} out.`
          );
        }
        return { ...channel, integration };
      }
    );

    const { dates, taken } = await this.dates(
      orgId,
      body,
      channels.map((channel) => channel.id)
    );
    // the dates this batch gives each channel, so none is used twice
    const used: Record<string, Set<number>> = Object.fromEntries(
      channels.map((channel) => [channel.id, new Set<number>()])
    );

    const items: PlanItem[] = [];
    for (const [index, video] of body.videos.entries()) {
      const media = await this._mediaService.getOrgMediaById(
        orgId,
        video.mediaId
      );
      const name = fileTitle(media?.originalName || media?.name || '');
      const caption = fillPlaceholders(
        video.caption ?? body.caption ?? '',
        name
      );
      const item: PlanItem = {
        index,
        mediaId: video.mediaId,
        name: media?.originalName || media?.name || '',
        caption,
        errors: [],
        request: null,
        mapped: null,
        channels: channels.map((channel) => {
          const sent = video.dates?.[channel.id];
          const date = sent ? new Date(sent) : dates[channel.id]?.[index];
          const issue = this.dateIssue({
            date,
            sent: !!sent,
            body,
            taken: taken[channel.id],
            used: used[channel.id],
          });
          return {
            id: channel.id,
            name: channel.integration.name,
            identifier: channel.integration.providerIdentifier,
            picture: channel.integration.picture,
            date: date && !isNaN(date.getTime()) ? date.toISOString() : null,
            errors: issue ? [issue] : [],
          };
        }),
      };
      items.push(item);

      if (!media || media.deletedAt) {
        item.errors.push({
          field: 'media',
          message: 'This video is no longer in your media library.',
          hint: 'Remove it and upload it again.',
        });
        continue;
      }
      if (media.status === 'processing') {
        item.errors.push({
          field: 'media',
          message: 'This video is still being processed.',
          hint: 'Give it a minute, then check again.',
        });
        continue;
      }
      if (media.status === 'failed') {
        item.errors.push({
          field: 'media',
          message: media.processingError || 'This video could not be processed.',
          hint: 'Remove it and upload it again.',
        });
        continue;
      }
      if (!hasExtension(media.path, 'mp4')) {
        item.errors.push({
          field: 'media',
          message: 'This file is not an MP4 video.',
        });
        continue;
      }
      if (item.channels.some((channel) => !channel.date)) {
        continue;
      }

      const posted = item.channels.map((p) => p.date!).sort();
      item.request = {
        type: body.type,
        shortLink: false,
        date: posted[0],
        tags: [],
        posts: channels.map((channel, position) => ({
          integration: { id: channel.id },
          date: item.channels[position].date!,
          value: [
            {
              content: caption ? plainTextToHtml(caption) : '',
              image: [{ id: media.id, path: media.path }],
            },
          ],
          settings: {
            ...fillPlaceholders(channel.settings || {}, name),
            ...fillPlaceholders(video.settings?.[channel.id] || {}, name),
          },
        })),
      } as unknown as CreatePostDto;

      await this.validate(orgId, item, body.type);
    }

    return items;
  }

  async preview(
    orgId: string,
    body: BulkVideoPostsDto,
    remaining: number | null = null
  ) {
    const items = await this.plan(orgId, body);
    const valid = items.filter((item) => !hasErrors(item)).length;
    return {
      limit: BULK_VIDEO_LIMIT,
      remaining,
      // every channel of a video is a post of the plan
      needed: items.reduce((all, item) => all + item.channels.length, 0),
      total: items.length,
      valid,
      invalid: items.length - valid,
      posts: items.map(({ request, mapped, ...item }) => item),
    };
  }

  // Where a bulk request stands: never sent (or sent and freed because
  // nothing went in), still running, or done with its result. Read without
  // the plan checks, so a request that timed out can always be followed.
  // `key` is what statusOf() reads it by after that, without the body.
  async status(orgId: string, body: BulkVideoPostsDto) {
    const key = bulkVideosHash(body);
    return { key, ...(await this.statusOf(orgId, key)) };
  }

  // the same by the key of a request, only ever within the organization
  async statusOf(orgId: string, key: string) {
    if (!/^[a-f0-9]{64}$/.test(key || '')) {
      throw new BadRequestException('This is not the key of a request.');
    }
    const claim = await this._importRepository.get(orgId, key);
    if (!claim) {
      return { status: 'none' as const };
    }
    if (claim.status === 'done' && claim.result) {
      return { status: 'done' as const, result: JSON.parse(claim.result) };
    }
    return { status: 'running' as const };
  }

  // Creates a post for every video once all of them pass the checks. The
  // same request only ever runs once: a second one returns the first result.
  // `remaining` is how many posts the plan still allows this month (null for
  // no limit). At the monthly post limit the rest are skipped and the result
  // says how many went in; a network's cap only skips that network. A run
  // that stopped half way resumes, and ends with what it created even when
  // the rest can't go in any more. `actor` is the member scheduling,
  // approvals apply.
  async create(
    orgId: string,
    body: BulkVideoPostsDto,
    remaining: number | null = null,
    actor?: ApprovalActor
  ) {
    const hash = bulkVideosHash(body);
    const claim = await this._importRepository.claim(orgId, hash);
    if (!claim.claimed) {
      if (claim.existing?.status === 'done' && claim.existing.result) {
        return { ...JSON.parse(claim.existing.result), alreadyCreated: true };
      }
      throw new ConflictException(
        'These videos are already being scheduled. Give it a minute, then check the calendar.'
      );
    }

    const results: BulkVideoResult[] = [];
    let limitReached = '';
    // the channels a network cap of the plan stopped, for the rest of the run
    const capped = new Map<string, SkippedChannel>();

    // videos created by an earlier attempt that stopped half way
    const done = new Set<number>();
    try {
      for (const result of JSON.parse(claim.progress || '{}')?.posts || []) {
        if (result?.status === 'created') {
          done.add(result.index);
        }
      }
    } catch (err) {
      /** no progress **/
    }

    try {
      const items = await this.plan(orgId, body);
      const invalid = items.filter(
        (item) => !done.has(item.index) && hasErrors(item)
      ).length;
      if (invalid) {
        throw new BadRequestException(
          `${invalid} of ${items.length} videos need a fix. Check the preview, then try again.`
        );
      }

      let posts = 0;
      for (const item of items) {
        if (done.has(item.index)) {
          results.push({ index: item.index, name: item.name, status: 'created' });
          continue;
        }
        const open = item.channels.filter((channel) => !capped.has(channel.id));
        const skipped = item.channels
          .filter((channel) => capped.has(channel.id))
          .map((channel) => capped.get(channel.id)!);
        if (!open.length) {
          results.push({
            index: item.index,
            name: item.name,
            status: 'skipped',
            error: skipped[0].error,
            skippedChannels: skipped,
          });
          continue;
        }
        if (
          !limitReached &&
          remaining !== null &&
          posts + open.length > remaining
        ) {
          limitReached =
            "Your plan's monthly post limit is reached. Upgrade your plan or schedule the rest next month.";
        }
        if (limitReached) {
          results.push({
            index: item.index,
            name: item.name,
            status: 'skipped',
            error: limitReached,
          });
          continue;
        }
        try {
          const outcome = await this.createVideo(orgId, item, open, capped, actor);
          posts += outcome.created;
          const problems = [...skipped, ...outcome.problems];
          results.push({
            index: item.index,
            name: item.name,
            status: outcome.created ? 'created' : 'skipped',
            ...(outcome.created ? {} : { error: problems[0]?.error }),
            ...(problems.length ? { skippedChannels: problems } : {}),
          });
          // the progress keeps the claim fresh and survives a crash
          await this._importRepository.touch(
            orgId,
            hash,
            JSON.stringify({ posts: results })
          );
        } catch (err) {
          results.push({
            index: item.index,
            name: item.name,
            status: 'failed',
            error: errorMessage(err),
          });
        }
      }
    } catch (err) {
      // nothing was created yet, so the same request can be tried again
      if (!done.size && !results.some((result) => result.status === 'created')) {
        await this._importRepository.release(orgId, hash);
        throw err;
      }
      // a resumed run that stopped before creating anything ends with what
      // the earlier run created, the rest failed
      if (!results.length) {
        body.videos.forEach((_, index) =>
          results.push(
            done.has(index)
              ? { index, name: `Video ${index + 1}`, status: 'created' }
              : {
                  index,
                  name: `Video ${index + 1}`,
                  status: 'failed',
                  error: errorMessage(err),
                }
          )
        );
      }
    }

    const summary = {
      type: body.type,
      created: results.filter((result) => result.status === 'created').length,
      skipped: results.filter((result) => result.status === 'skipped').length,
      failed: results.filter((result) => result.status === 'failed').length,
      limitReached: limitReached || null,
      cappedChannels: [...capped.values()],
      posts: results,
    };

    if (!summary.created) {
      // nothing went in: let the user fix it and send it again
      await this._importRepository.release(orgId, hash);
    } else {
      await this._importRepository.finish(orgId, hash, JSON.stringify(summary));
    }

    return summary;
  }

  // Creates a video on the channels still open. A network's monthly cap
  // (402) refuses the whole save, so each channel is then tried on its own:
  // a capped one is skipped here and for the rest of the run, the others go
  // ahead. Returns how many posts went in and the channels left out.
  private async createVideo(
    orgId: string,
    item: PlanItem,
    open: PlanChannel[],
    capped: Map<string, SkippedChannel>,
    actor?: ApprovalActor
  ) {
    const mapped =
      item.mapped ||
      (await this._postsService.mapTypeToPost(item.request!, orgId));
    const only = (channels: PlanChannel[]) => {
      const ids = channels.map((channel) => channel.id);
      const posts = mapped.posts
        .filter((post) => ids.includes(post.integration.id))
        .map((post) => ({ ...post }));
      return {
        ...mapped,
        date: posts.map((post) => post.date!).sort()[0] || mapped.date,
        posts,
      } as CreatePostDto;
    };

    try {
      await this._postsService.createPost(orgId, only(open), 'WEB', false, actor);
      return { created: open.length, problems: [] as SkippedChannel[] };
    } catch (err) {
      if (!isLimit(err)) {
        throw err;
      }
      if (open.length === 1) {
        const skipped = { id: open[0].id, name: open[0].name, error: errorMessage(err) };
        capped.set(open[0].id, skipped);
        return { created: 0, problems: [skipped] };
      }
    }

    let created = 0;
    const problems: SkippedChannel[] = [];
    for (const channel of open) {
      try {
        await this._postsService.createPost(
          orgId,
          only([channel]),
          'WEB',
          false,
          actor
        );
        created++;
      } catch (err) {
        const skipped = { id: channel.id, name: channel.name, error: errorMessage(err) };
        if (isLimit(err)) {
          capped.set(channel.id, skipped);
        }
        problems.push(skipped);
      }
    }
    return { created, problems };
  }
}
