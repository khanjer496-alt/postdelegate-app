import { Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { escape } from 'lodash';
import { WeeklySummaryRepository } from '@gitroom/nestjs-libraries/database/prisma/weekly-summary/weekly.summary.repository';
import {
  EmailCard,
  EmailService,
  emailButton,
  emailCard,
} from '@gitroom/nestjs-libraries/services/email.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { curatedPostError } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.curated.error';

dayjs.extend(utc);
dayjs.extend(timezone);

// the summary goes out on Monday from this local hour
const SEND_HOUR = 8;
const PAGE = 200;
// summaries sent per hourly run, the next run picks up the rest
const RUN_LIMIT = 500;
const UPCOMING = 5;
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export type WeeklySummaryPost = {
  channel: string;
  icon?: string;
  text: string;
  date: Date;
  url?: string;
  error?: string;
  engagement?: number;
};

export type WeeklySummaryData = {
  workspace: string;
  timezone: string;
  lastWeekStart: Date;
  weekStart: Date;
  published: number;
  failed: number;
  topPosts: WeeklySummaryPost[];
  scheduled: number;
  upcoming: WeeklySummaryPost[];
  failedPosts: WeeklySummaryPost[];
  reconnect: Array<{ name: string; icon?: string }>;
};

const safeTimezone = (tz?: string | null) => {
  if (!tz) {
    return 'UTC';
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch (err) {
    return 'UTC';
  }
};

// Monday 00:00 of this week, of last week and of next week, in the timezone
export const weeklySummaryWindow = (now: Date, tz?: string | null) => {
  const zone = safeTimezone(tz);
  const local = dayjs(now).tz(zone);
  const daysSinceMonday = (local.day() + 6) % 7;
  // calendar days are counted in UTC, where no day is 23 or 25 hours long,
  // then each Monday is placed at midnight in the timezone
  const monday = dayjs
    .utc(local.format('YYYY-MM-DD'))
    .subtract(daysSinceMonday, 'day');
  const midnight = (date: dayjs.Dayjs) =>
    dayjs.tz(`${date.format('YYYY-MM-DD')}T00:00:00`, zone).toDate();
  return {
    timezone: zone,
    local,
    weekStart: midnight(monday),
    lastWeekStart: midnight(monday.subtract(7, 'day')),
    nextWeekStart: midnight(monday.add(7, 'day')),
  };
};

// Monday, from 8:00 local time, and not sent yet this week
export const isWeeklySummaryDue = (
  now: Date,
  tz: string | null | undefined,
  sentAt: Date | null | undefined
) => {
  const { local, weekStart } = weeklySummaryWindow(now, tz);
  if (local.day() !== 1 || local.hour() < SEND_HOUR) {
    return false;
  }
  return !sentAt || sentAt.getTime() < weekStart.getTime();
};

// the reactions counted as engagement in the analytics a provider reports
const ENGAGEMENT =
  /like|comment|share|repost|retweet|reaction|repl|save|engagement|quote/i;

export const engagementFromAnalytics = (analytics: unknown): number => {
  if (!Array.isArray(analytics)) {
    return 0;
  }
  return analytics.reduce((total, item: any) => {
    if (!ENGAGEMENT.test(item?.label || '') || !Array.isArray(item?.data)) {
      return total;
    }
    // the totals are cumulative, the largest is the latest count
    const value = Math.max(
      0,
      ...item.data.map((point: any) => Number(point?.total) || 0)
    );
    return total + value;
  }, 0);
};

const snippet = (html: string, length = 140) => {
  const text = stripHtmlValidation('none', html || '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
};

// The same curation the calendar and the public API use: the raw column holds
// the serialized workflow failure, which can carry anything the runtime put in
// the message.
export const summaryPostError = (error?: string | null) => {
  const curated = curatedPostError(error);
  return curated ? snippet(curated, 200) : undefined;
};

const formatDate = (date: Date, tz: string, withTime = true) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(date);

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

const heading = (text: string) =>
  `<h2 class="pd-text" style="margin:30px 0 12px;font-family:${FONT};font-size:16px;font-weight:700;line-height:1.35;color:#0d0d0d">${escape(
    text
  )}</h2>`;

const muted = (text: string) =>
  `<p class="pd-muted" style="margin:0 0 12px;font-family:${FONT};font-size:14px;line-height:1.55;color:#7a7a88">${escape(
    text
  )}</p>`;

// three numbers side by side, a table so every email client keeps the row
const stats = (items: Array<{ label: string; value: number; alert?: boolean }>) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 4px;border-collapse:separate;border-spacing:8px 0"><tr>${items
    .map(
      (item) =>
        `<td width="${Math.floor(100 / items.length)}%" valign="top" class="${
          item.alert ? 'pd-item-fail' : 'pd-item'
        }" style="padding:14px 12px;background:${
          item.alert ? '#fff5f5' : '#f7f6fb'
        };border:1px solid ${
          item.alert ? '#f4c7c7' : '#e7e5ef'
        };border-radius:14px;text-align:center"><div class="pd-text" style="font-family:${FONT};font-size:26px;font-weight:700;line-height:1.1;color:#0d0d0d">${
          item.value
        }</div><div class="pd-muted" style="margin-top:4px;font-family:${FONT};font-size:12px;line-height:1.4;color:#7a7a88">${escape(
          item.label
        )}</div></td>`
    )
    .join('')}</tr></table>`;

const safeLink = (url?: string) => {
  if (!url) {
    return undefined;
  }
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol)
      ? url
      : undefined;
  } catch (err) {
    return undefined;
  }
};

// The Monday email: last week, this week and what needs attention, in the
// card style of the notification digest. Pure, so it is easy to test.
export const weeklySummaryEmail = (
  data: WeeklySummaryData,
  app = process.env.FRONTEND_URL || ''
) => {
  const tz = data.timezone;
  const lastWeekEnd = new Date(data.weekStart.getTime() - 1);
  const range = `${formatDate(data.lastWeekStart, tz, false)} – ${formatDate(
    lastWeekEnd,
    tz,
    false
  )}`;
  const attention = data.failedPosts.length + data.reconnect.length;

  const html: string[] = [
    `<p style="margin:0 0 18px">Here's how <strong>${escape(
      data.workspace
    )}</strong> did last week (${escape(range)}) and what's coming up.</p>`,
    stats([
      { label: 'Published last week', value: data.published },
      { label: 'Failed last week', value: data.failed, alert: data.failed > 0 },
      { label: 'Scheduled this week', value: data.scheduled },
    ]),
  ];

  if (data.topPosts.length) {
    html.push(heading('Top posts last week'));
    html.push(
      ...data.topPosts.map((post) => {
        const href = safeLink(post.url);
        const card: EmailCard = {
          tone: 'success',
          status: plural(post.engagement || 0, 'engagement', 'engagements'),
          title: post.channel,
          icon: post.icon,
          time: formatDate(post.date, tz),
          message: post.text || undefined,
          ...(href ? { link: { href, label: 'View post' } } : {}),
        };
        return emailCard(card);
      })
    );
  }

  html.push(heading('Coming up this week'));
  if (data.upcoming.length) {
    html.push(
      ...data.upcoming.map((post) =>
        emailCard({
          tone: 'info',
          status: 'Scheduled',
          title: post.channel,
          icon: post.icon,
          time: formatDate(post.date, tz),
          message: post.text || undefined,
        })
      )
    );
    const more = data.scheduled - data.upcoming.length;
    if (more > 0) {
      html.push(
        muted(`And ${plural(more, 'more post', 'more posts')} this week.`)
      );
    }
  } else {
    html.push(
      muted('Nothing is scheduled for this week yet. A good time to plan a few posts.')
    );
  }

  if (attention) {
    html.push(heading('Needs your attention'));
    html.push(
      ...data.reconnect.map((channel) =>
        emailCard({
          tone: 'fail',
          status: 'Reconnect needed',
          title: channel.name,
          icon: channel.icon,
          message:
            'Reconnect this channel so its scheduled posts can go out.',
          link: { href: `${app}/launches`, label: 'Reconnect' },
        })
      ),
      ...data.failedPosts.map((post) =>
        emailCard({
          tone: 'fail',
          status: 'Failed',
          title: post.channel,
          icon: post.icon,
          time: formatDate(post.date, tz),
          message: post.error || post.text || undefined,
        })
      )
    );
  }

  html.push(emailButton(`${app}/launches`, 'Open PostDelegate'));

  const subject = `Your week: ${plural(
    data.published,
    'post',
    'posts'
  )} published, ${data.scheduled} scheduled${
    attention ? `, ${attention} to check` : ''
  }`;

  return { subject, html: html.join('') };
};

// a week with nothing to tell is not worth an email
export const isEmptySummary = (data: WeeklySummaryData) =>
  !data.published &&
  !data.failed &&
  !data.scheduled &&
  !data.failedPosts.length &&
  !data.reconnect.length;

@Injectable()
export class WeeklySummaryService {
  private readonly _logger = new Logger(WeeklySummaryService.name);
  constructor(
    private _weeklySummaryRepository: WeeklySummaryRepository,
    private _emailService: EmailService,
    private _integrationManager: IntegrationManager
  ) {}

  async getPreference(orgId: string, userId: string) {
    const preference = await this._weeklySummaryRepository.getPreference(
      orgId,
      userId
    );
    return { enabled: !!preference?.weeklySummaryEmails };
  }

  async setPreference(orgId: string, userId: string, enabled: boolean) {
    await this._weeklySummaryRepository.setPreference(orgId, userId, enabled);
    return { enabled };
  }

  private channel(identifier: string, name: string) {
    let provider: { identifier: string } | undefined;
    try {
      provider = this._integrationManager.getSocialIntegration(identifier);
    } catch (err) {
      provider = undefined;
    }
    return {
      name,
      icon:
        provider && process.env.FRONTEND_URL
          ? `${process.env.FRONTEND_URL}/icons/platforms/${provider.identifier}.png`
          : undefined,
    };
  }

  // Engagement only comes from analytics PostDelegate already has (the post
  // statistics cache). Nothing is fetched from the networks for an email, so
  // without analytics the section is left out.
  private async topPosts(
    orgId: string,
    posts: Awaited<ReturnType<WeeklySummaryRepository['getPosts']>>
  ): Promise<WeeklySummaryPost[]> {
    if (!posts.length || !process.env.REDIS_URL) {
      return [];
    }
    try {
      const keys = posts.flatMap((post) => [
        `integration:${orgId}:${post.id}:7`,
        `integration:${orgId}:${post.id}:30`,
      ]);
      const values: Array<string | null> = await ioRedis.mget(...keys);
      return posts
        .map((post, index) => {
          const cached = values[index * 2] || values[index * 2 + 1];
          let engagement = 0;
          try {
            engagement = cached
              ? engagementFromAnalytics(JSON.parse(cached))
              : 0;
          } catch (err) {
            engagement = 0;
          }
          return {
            ...this.channel(
              post.integration.providerIdentifier,
              post.integration.name
            ),
            channel: post.integration.name,
            text: snippet(post.content),
            date: post.publishDate,
            url: post.releaseURL?.split(',')[0],
            engagement,
          };
        })
        .filter((post) => post.engagement > 0)
        .sort((a, b) => b.engagement - a.engagement)
        .slice(0, 3);
    } catch (err) {
      return [];
    }
  }

  private toPost(
    post: Awaited<ReturnType<WeeklySummaryRepository['getPosts']>>[number]
  ): WeeklySummaryPost {
    const channel = this.channel(
      post.integration.providerIdentifier,
      post.integration.name
    );
    return {
      channel: channel.name,
      icon: channel.icon,
      text: snippet(post.content),
      date: post.publishDate,
      error: summaryPostError(post.error),
    };
  }

  async buildSummary(
    orgId: string,
    workspace: string,
    now: Date,
    tz?: string | null
  ): Promise<WeeklySummaryData> {
    const window = weeklySummaryWindow(now, tz);
    const repo = this._weeklySummaryRepository;
    const [published, failed, scheduled, publishedPosts, upcoming, failedPosts, reconnect] =
      await Promise.all([
        repo.countPosts(orgId, 'PUBLISHED', window.lastWeekStart, window.weekStart),
        repo.countPosts(orgId, 'ERROR', window.lastWeekStart, window.weekStart),
        repo.countPosts(orgId, 'QUEUE', now, window.nextWeekStart),
        repo.getPosts(orgId, 'PUBLISHED', window.lastWeekStart, window.weekStart, 30, 'desc'),
        repo.getPosts(orgId, 'QUEUE', now, window.nextWeekStart, UPCOMING, 'asc'),
        // the failures of the last seven days, so nothing slips between emails
        repo.getPosts(orgId, 'ERROR', window.lastWeekStart, now, 5, 'desc'),
        repo.channelsNeedingReconnect(orgId),
      ]);

    return {
      workspace,
      timezone: window.timezone,
      lastWeekStart: window.lastWeekStart,
      weekStart: window.weekStart,
      published,
      failed,
      topPosts: await this.topPosts(orgId, publishedPosts),
      scheduled,
      upcoming: upcoming.map((post) => this.toPost(post)),
      failedPosts: failedPosts.map((post) => this.toPost(post)),
      reconnect: reconnect.map((channel) =>
        this.channel(channel.providerIdentifier, channel.name)
      ),
    };
  }

  // Run every hour by weeklySummaryWorkflowV1: sends the summary to every
  // member whose Monday morning it is and who didn't get it yet this week
  async sendDueSummaries(now = new Date()) {
    if (
      process.env.WEEKLY_SUMMARY_DISABLED === 'true' ||
      !this._emailService.hasProvider()
    ) {
      return { checked: 0, sent: 0 };
    }

    let cursor: string | undefined;
    let checked = 0;
    let sent = 0;
    let claimed = 0;
    while (claimed < RUN_LIMIT) {
      const page = await this._weeklySummaryRepository.getSubscribers(
        cursor,
        PAGE
      );
      if (!page.length) {
        break;
      }
      cursor = page[page.length - 1].id;
      checked += page.length;

      for (const member of page) {
        if (claimed >= RUN_LIMIT) {
          break;
        }
        const tz = member.user.timezoneName;
        if (!isWeeklySummaryDue(now, tz, member.weeklySummarySentAt)) {
          continue;
        }
        const { weekStart } = weeklySummaryWindow(now, tz);
        if (!(await this._weeklySummaryRepository.claimSend(member.id, weekStart))) {
          continue;
        }
        claimed++;
        try {
          const data = await this.buildSummary(
            member.organizationId,
            member.organization.name,
            now,
            tz
          );
          if (isEmptySummary(data)) {
            continue;
          }
          const { subject, html } = weeklySummaryEmail(data);
          await this._emailService.sendEmail(
            member.user.email,
            subject,
            html,
            'bottom'
          );
          sent++;
        } catch (err) {
          this._logger.warn('Could not send a weekly summary.');
        }
      }

      if (page.length < PAGE) {
        break;
      }
    }

    return { checked, sent };
  }
}
