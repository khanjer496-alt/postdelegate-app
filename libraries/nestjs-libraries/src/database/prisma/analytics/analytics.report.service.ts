import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AnalyticsReportFrequency, SubscriptionTier } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { escape } from 'lodash';
import { AnalyticsRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository';
import {
  AnalyticsService,
  PeriodComparison,
  TopPostRow,
} from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.service';
import {
  emailButton,
  EmailService,
} from '@gitroom/nestjs-libraries/services/email.service';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

dayjs.extend(utc);

// workspaces per activity page of the scheduled report run
export const REPORTS_PAGE_SIZE = 50;
const TEST_EMAIL_COOLDOWN_SECONDS = 300;
const EMAIL_TOP_POSTS = 5;

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const COMPARISON_LABELS: Record<PeriodComparison['key'], string> = {
  followers: 'Followers gained',
  published: 'Posts published',
  engagement: 'Engagement',
  views: 'Views',
};

const formatNumber = (value: number | null) =>
  value === null ? '–' : new Intl.NumberFormat('en-US').format(value);

export interface AnalyticsReportSettingsInput {
  frequency: AnalyticsReportFrequency;
  recipients: string[];
  brandName?: string | null;
  logoUrl?: string | null;
}

@Injectable()
export class AnalyticsReportService {
  private readonly _logger = new Logger(AnalyticsReportService.name);

  constructor(
    private _analyticsRepository: AnalyticsRepository,
    private _analyticsService: AnalyticsService,
    private _emailService: EmailService
  ) {}

  enabled() {
    return process.env.ANALYTICS_REPORTS_DISABLED !== 'true';
  }

  // The report features follow the plan; without billing every workspace has them
  planAllows(
    subscription?: {
      subscriptionTier: SubscriptionTier;
      deletedAt: Date | null;
    } | null
  ) {
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return true;
    }
    const tier =
      subscription && !subscription.deletedAt
        ? subscription.subscriptionTier
        : 'FREE';
    return !!pricing[tier]?.analytics_reports;
  }

  async getSettings(orgId: string) {
    const [settings, members, organization] = await Promise.all([
      this._analyticsRepository.getReportSettings(orgId),
      this._analyticsRepository.getReportMembers(orgId),
      this._analyticsRepository.getOrganizationName(orgId),
    ]);
    const memberIds = new Set(members.map((member) => member.user.id));
    return {
      frequency: settings?.frequency || AnalyticsReportFrequency.OFF,
      // a member who left the workspace no longer receives it
      recipients: (settings?.recipients || []).filter((id) =>
        memberIds.has(id)
      ),
      brandName: settings?.brandName || null,
      logoUrl: settings?.logoUrl || null,
      lastSentAt: settings?.lastSentAt || null,
      workspaceName: organization?.name || '',
      emailAvailable: this._emailService.hasProvider(),
      members: members.map((member) => ({
        id: member.user.id,
        email: member.user.email,
        name: [member.user.name, member.user.lastName]
          .filter(Boolean)
          .join(' '),
        role: member.role,
      })),
    };
  }

  async updateSettings(
    orgId: string,
    body: AnalyticsReportSettingsInput,
    now = new Date()
  ) {
    // only real, active members of this workspace can be recipients
    const members = await this._analyticsRepository.getReportMembers(
      orgId,
      [...new Set(body.recipients || [])]
    );
    const current = await this._analyticsRepository.getReportSettings(orgId);
    const changedSchedule =
      body.frequency !== AnalyticsReportFrequency.OFF &&
      body.frequency !== (current?.frequency || AnalyticsReportFrequency.OFF);

    await this._analyticsRepository.upsertReportSettings(orgId, {
      frequency: body.frequency,
      recipients: members.map((member) => member.user.id),
      brandName: body.brandName?.trim() || null,
      logoUrl: body.logoUrl?.trim() || null,
      // a new schedule starts with the next full week or month, not a report
      // of the period that is already half over
      ...(changedSchedule ? { lastSentAt: now } : {}),
    });
    return this.getSettings(orgId);
  }

  // Everything the white-label report and the email show for one date range
  async getReportData(
    orgId: string,
    from: Date,
    to: Date,
    timezone = 'UTC'
  ) {
    const [organization, settings, trends, topPosts, insights, bestTimes] =
      await Promise.all([
        this._analyticsRepository.getOrganizationName(orgId),
        this._analyticsRepository.getReportSettings(orgId),
        this._analyticsService.trendsFor(orgId, from, to),
        this._analyticsService.topPostsFor(orgId, from, to, {
          sort: 'engagement',
          order: 'desc',
          limit: 10,
        }),
        this._analyticsService.insightsFor(orgId, from, to),
        this._analyticsService.bestTimesFor(orgId, from, to, timezone),
      ]);

    return {
      brand: {
        name: settings?.brandName || organization?.name || '',
        logoUrl: settings?.logoUrl || null,
      },
      from: trends.from,
      to: trends.to,
      generatedAt: new Date().toISOString(),
      trends,
      topPosts: topPosts.posts,
      insights,
      bestTimes,
    };
  }

  // A custom range of whole UTC days, at most a year
  async getReportDataForRange(
    orgId: string,
    from: string,
    to: string,
    timezone = 'UTC'
  ) {
    const start = dayjs.utc(from).startOf('day');
    const end = dayjs.utc(to).endOf('day');
    const now = dayjs.utc();
    if (
      !start.isValid() ||
      start.isAfter(now) ||
      !end.isValid() ||
      end.isBefore(start) ||
      end.diff(start, 'day') > 366
    ) {
      throw new BadRequestException('Choose a range of up to one year');
    }
    return this.getReportData(
      orgId,
      start.toDate(),
      (end.isAfter(now) ? now : end).toDate(),
      timezone
    );
  }

  // The previous full week (Monday to Sunday) or month, in UTC
  reportPeriod(frequency: AnalyticsReportFrequency, now = new Date()) {
    const today = dayjs(now).utc().startOf('day');
    const start =
      frequency === AnalyticsReportFrequency.MONTHLY
        ? today.startOf('month')
        : today.subtract((today.day() + 6) % 7, 'day');
    const from =
      frequency === AnalyticsReportFrequency.MONTHLY
        ? start.subtract(1, 'month')
        : start.subtract(7, 'day');
    return {
      // the current period starts here; a report sent after it is up to date
      periodStart: start.toDate(),
      from: from.toDate(),
      to: start.subtract(1, 'millisecond').toDate(),
    };
  }

  isDue(
    settings: {
      frequency: AnalyticsReportFrequency;
      lastSentAt: Date | null;
    },
    now = new Date()
  ) {
    if (settings.frequency === AnalyticsReportFrequency.OFF) {
      return false;
    }
    const { periodStart } = this.reportPeriod(settings.frequency, now);
    return !settings.lastSentAt || settings.lastSentAt < periodStart;
  }

  async sendDueReportsPage(cursor?: string, now = new Date()) {
    if (!this.enabled()) {
      return { enabled: false, sent: 0 };
    }
    const rows = await this._analyticsRepository.getScheduledReportsPage(
      REPORTS_PAGE_SIZE,
      cursor
    );
    const organizations = new Map(
      (
        await this._analyticsRepository.getOrganizationsForReports(
          rows.map((row) => row.organizationId)
        )
      ).map((organization) => [organization.id, organization])
    );

    let sent = 0;
    for (const row of rows) {
      const organization = organizations.get(row.organizationId);
      if (
        !organization ||
        !this.isDue(row, now) ||
        !this.planAllows(organization.subscription)
      ) {
        continue;
      }
      try {
        const recipients = await this._analyticsRepository.getReportMembers(
          row.organizationId,
          row.recipients
        );
        if (!recipients.length) {
          continue;
        }
        const { from, to } = this.reportPeriod(row.frequency, now);
        const email = this.buildEmail(
          await this.getReportData(row.organizationId, from, to),
          row.frequency
        );
        // claimed before sending, so a retry or a second worker never sends
        // the same period twice; a failed send skips this period
        if (
          !(await this._analyticsRepository.claimReportSend(
            row.id,
            row.lastSentAt,
            now
          ))
        ) {
          continue;
        }
        let delivered = 0;
        try {
          for (const recipient of recipients) {
            await this._emailService.sendEmail(
              recipient.user.email,
              email.subject,
              email.html,
              'bottom'
            );
            delivered++;
          }
        } finally {
          if (delivered < recipients.length) {
            this._logger.warn(
              `Analytics report of organization ${row.organizationId} reached ${delivered} of ${recipients.length} recipients`
            );
          }
        }
        sent++;
      } catch (err) {
        this._logger.warn(
          `Analytics report of organization ${row.organizationId} failed: ${
            (err as Error)?.name || 'error'
          }`
        );
      }
    }

    return {
      enabled: true,
      ...(rows.length === REPORTS_PAGE_SIZE
        ? { cursor: rows[rows.length - 1].id }
        : {}),
      sent,
    };
  }

  // A sample of the last 7 days, to the member asking only, at most every 5 minutes
  async sendTest(orgId: string, to: string) {
    if (!this._emailService.hasProvider()) {
      return { sent: false, reason: 'email_unavailable' as const };
    }
    if (
      !(await ioRedis.set(
        `analytics-report-test:${orgId}`,
        '1',
        'EX',
        TEST_EMAIL_COOLDOWN_SECONDS,
        'NX'
      ))
    ) {
      return { sent: false, reason: 'too_soon' as const };
    }
    const now = new Date();
    const { from } = this._analyticsService.historyRange(7, now);
    const email = this.buildEmail(
      await this.getReportData(orgId, from, now),
      AnalyticsReportFrequency.WEEKLY
    );
    await this._emailService.sendEmail(to, email.subject, email.html, 'top');
    return { sent: true as const };
  }

  buildEmail(
    data: Awaited<ReturnType<AnalyticsReportService['getReportData']>>,
    frequency: AnalyticsReportFrequency
  ) {
    const range = `${dayjs.utc(data.from).format('MMM D')} – ${dayjs
      .utc(data.to)
      .format('MMM D, YYYY')}`;
    const kind =
      frequency === AnalyticsReportFrequency.MONTHLY ? 'Monthly' : 'Weekly';
    const name = data.brand.name || 'Your workspace';
    const subject = `${kind} analytics for ${name}: ${range}`;
    const app = process.env.FRONTEND_URL;

    const logo = data.brand.logoUrl
      ? `<img src="${escape(data.brand.logoUrl)}" alt="${escape(
          name
        )}" height="40" style="display:block;height:40px;max-width:200px;border:0;margin:0 0 16px">`
      : '';

    const cells = data.trends.comparison
      .map((item) => {
        const change =
          item.change === null
            ? '<span class="pd-muted" style="color:#7a7a88">No earlier data</span>'
            : `<span style="color:${item.change >= 0 ? '#356b00' : '#b42318'}">${
                item.change >= 0 ? '▲' : '▼'
              } ${Math.abs(item.change)}%</span>`;
        return `<td valign="top" width="50%" style="padding:6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="pd-item" style="background:#f7f6fb;border:1px solid #e7e5ef;border-radius:12px;border-collapse:separate"><tr><td style="padding:12px 14px;font-family:${FONT}"><div class="pd-muted" style="font-size:12px;color:#7a7a88">${escape(
          COMPARISON_LABELS[item.key]
        )}</div><div class="pd-text" style="font-size:22px;font-weight:700;color:#0d0d0d;margin-top:2px">${formatNumber(
          item.current
        )}</div><div style="font-size:12px;margin-top:2px">${change}</div></td></tr></table></td>`;
      })
      .reduce<string[]>((rows, cell, index) => {
        if (index % 2 === 0) {
          rows.push(cell);
        } else {
          rows[rows.length - 1] += cell;
        }
        return rows;
      }, [])
      .map((row) => `<tr>${row}</tr>`)
      .join('');

    const posts = data.topPosts
      .slice(0, EMAIL_TOP_POSTS)
      .map((post: TopPostRow) => {
        const title = escape(
          (post.title || 'Untitled post').slice(0, 120)
        );
        const link =
          post.url && /^https?:\/\//i.test(post.url)
            ? `<a href="${escape(post.url)}" target="_blank">${title}</a>`
            : title;
        return `<tr><td style="padding:10px 0;border-top:1px solid #e7e5ef;font-family:${FONT};font-size:14px;line-height:1.45"><div class="pd-text" style="color:#0d0d0d">${link}</div><div class="pd-muted" style="font-size:12px;color:#7a7a88;margin-top:2px">${escape(
          post.channel.name
        )} · ${formatNumber(post.engagement)} engagements${
          post.views !== null ? ` · ${formatNumber(post.views)} views` : ''
        }</div></td></tr>`;
      })
      .join('');

    const html = `${logo}<p style="margin:0 0 12px">${escape(
      `${kind} summary for ${name}, ${range}, compared with the period before.`
    )}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -6px 12px">${cells}</table>${
      posts
        ? `<h2 class="pd-text" style="margin:18px 0 4px;font-family:${FONT};font-size:16px;color:#0d0d0d">Top posts</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${posts}</table>`
        : `<p class="pd-muted" style="color:#7a7a88">No post metrics were collected in this period yet.</p>`
    }${emailButton(`${app}/analytics`, 'Open analytics')}`;

    return { subject, html };
  }
}
