jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { mget: jest.fn() },
}));

import {
  WeeklySummaryData,
  WeeklySummaryService,
  engagementFromAnalytics,
  isEmptySummary,
  isWeeklySummaryDue,
  weeklySummaryEmail,
  weeklySummaryWindow,
} from '@gitroom/nestjs-libraries/database/prisma/weekly-summary/weekly.summary.service';

// Monday 2 November 2026
const mondayUtc = (hour: number) =>
  new Date(`2026-11-02T${String(hour).padStart(2, '0')}:10:00.000Z`);

const data = (extra: Partial<WeeklySummaryData> = {}): WeeklySummaryData => ({
  workspace: 'Acme <Team>',
  timezone: 'UTC',
  lastWeekStart: new Date('2026-10-26T00:00:00.000Z'),
  weekStart: new Date('2026-11-02T00:00:00.000Z'),
  published: 12,
  failed: 1,
  topPosts: [],
  scheduled: 7,
  upcoming: [
    { channel: 'X', text: 'Launch day', date: new Date('2026-11-03T09:00:00Z') },
  ],
  failedPosts: [
    {
      channel: 'LinkedIn',
      text: 'Hiring',
      date: new Date('2026-10-30T09:00:00Z'),
      error: 'Token expired',
    },
  ],
  reconnect: [{ name: 'Instagram' }],
  ...extra,
});

describe('weekly summary schedule', () => {
  it('computes the Monday window in the timezone', () => {
    const window = weeklySummaryWindow(
      new Date('2026-11-04T12:00:00Z'),
      'America/New_York'
    );
    expect(window.weekStart.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(window.lastWeekStart.toISOString()).toBe('2026-10-26T04:00:00.000Z');
    expect(window.nextWeekStart.toISOString()).toBe('2026-11-09T05:00:00.000Z');
  });

  it('is due on Monday from 8:00 local time, once a week', () => {
    expect(isWeeklySummaryDue(mondayUtc(7), 'UTC', null)).toBe(false);
    expect(isWeeklySummaryDue(mondayUtc(8), 'UTC', null)).toBe(true);
    // 8:10 UTC is 3:10 in New York, 13:40 in Kolkata
    expect(isWeeklySummaryDue(mondayUtc(8), 'America/New_York', null)).toBe(false);
    expect(isWeeklySummaryDue(mondayUtc(13), 'America/New_York', null)).toBe(true);
    expect(isWeeklySummaryDue(mondayUtc(8), 'Asia/Kolkata', null)).toBe(true);
    // already sent this week, or a stale send from last week
    expect(isWeeklySummaryDue(mondayUtc(9), 'UTC', mondayUtc(8))).toBe(false);
    expect(
      isWeeklySummaryDue(mondayUtc(9), 'UTC', new Date('2026-10-26T08:10:00Z'))
    ).toBe(true);
  });

  it('falls back to UTC for a missing or unknown timezone', () => {
    expect(isWeeklySummaryDue(mondayUtc(8), undefined, null)).toBe(true);
    expect(isWeeklySummaryDue(mondayUtc(8), 'Not/AZone', null)).toBe(true);
    expect(weeklySummaryWindow(mondayUtc(8), 'Not/AZone').timezone).toBe('UTC');
  });
});

describe('weeklySummaryEmail', () => {
  it('has every section, escapes the workspace and ends with the CTA', () => {
    const { subject, html } = weeklySummaryEmail(data(), 'https://app.test');
    expect(subject).toBe('Your week: 12 posts published, 7 scheduled, 2 to check');
    expect(html).toContain('Acme &lt;Team&gt;');
    expect(html).not.toContain('Acme <Team>');
    expect(html).toContain('Coming up this week');
    expect(html).toContain('Launch day');
    expect(html).toContain('And 6 more posts this week.');
    expect(html).toContain('Needs your attention');
    expect(html).toContain('Token expired');
    expect(html).toContain('Reconnect needed');
    expect(html.lastIndexOf('Open PostDelegate')).toBeGreaterThan(
      html.indexOf('Needs your attention')
    );
    expect(html).toContain('https://app.test/launches');
  });

  it('leaves out the top posts without analytics and shows them with', () => {
    expect(weeklySummaryEmail(data()).html).not.toContain('Top posts');
    const { html } = weeklySummaryEmail(
      data({
        topPosts: [
          {
            channel: 'X',
            text: 'Viral',
            date: new Date('2026-10-28T10:00:00Z'),
            url: 'javascript:alert(1)',
            engagement: 42,
          },
        ],
      })
    );
    expect(html).toContain('Top posts last week');
    expect(html).toContain('42 engagements');
    // an unsafe link gets no button
    expect(html).not.toContain('javascript:');
  });

  it('says so when nothing is scheduled and skips calm sections', () => {
    const { html, subject } = weeklySummaryEmail(
      data({ scheduled: 0, upcoming: [], failedPosts: [], reconnect: [], failed: 0 })
    );
    expect(html).toContain('Nothing is scheduled for this week yet.');
    expect(html).not.toContain('Needs your attention');
    expect(subject).toBe('Your week: 12 posts published, 0 scheduled');
  });

  it('knows an empty week', () => {
    expect(
      isEmptySummary(
        data({
          published: 0,
          failed: 0,
          scheduled: 0,
          upcoming: [],
          failedPosts: [],
          reconnect: [],
        })
      )
    ).toBe(true);
    expect(isEmptySummary(data())).toBe(false);
  });

  it('counts likes, comments and shares as engagement', () => {
    expect(
      engagementFromAnalytics([
        { label: 'Likes', data: [{ total: '3' }, { total: '10' }] },
        { label: 'Comments', data: [{ total: '2' }] },
        { label: 'Impressions', data: [{ total: '900' }] },
      ])
    ).toBe(12);
    expect(engagementFromAnalytics({ missing: true })).toBe(0);
  });
});

describe('WeeklySummaryService.sendDueSummaries', () => {
  const member = (id: string, timezoneName: string | null, sentAt: Date | null) => ({
    id,
    organizationId: `org-${id}`,
    weeklySummarySentAt: sentAt,
    user: { email: `${id}@test.com`, timezoneName },
    organization: { name: 'Acme' },
  });

  const make = () => {
    const repo = {
      getSubscribers: jest.fn(),
      claimSend: jest.fn().mockResolvedValue(true),
      countPosts: jest.fn().mockResolvedValue(2),
      getPosts: jest.fn().mockResolvedValue([]),
      channelsNeedingReconnect: jest.fn().mockResolvedValue([]),
    };
    const email = {
      hasProvider: jest.fn().mockReturnValue(true),
      sendEmail: jest.fn(),
    };
    const manager = { getSocialIntegration: jest.fn() };
    const service = new WeeklySummaryService(repo as any, email as any, manager as any);
    return { service, repo, email };
  };

  it('sends only to due members it could claim, scoped to their workspace', async () => {
    const { service, repo, email } = make();
    repo.getSubscribers.mockResolvedValueOnce([
      member('a', 'UTC', null),
      member('b', 'America/New_York', null),
      member('c', 'UTC', null),
    ]);
    repo.claimSend.mockImplementation(async (id: string) => id !== 'c');

    const result = await service.sendDueSummaries(mondayUtc(8));

    expect(result).toEqual({ checked: 3, sent: 1 });
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0]).toBe('a@test.com');
    expect(email.sendEmail.mock.calls[0][3]).toBe('bottom');
    for (const call of repo.countPosts.mock.calls) {
      expect(call[0]).toBe('org-a');
    }
  });

  it('does nothing without an email provider', async () => {
    const { service, repo, email } = make();
    email.hasProvider.mockReturnValue(false);
    expect(await service.sendDueSummaries(mondayUtc(8))).toEqual({ checked: 0, sent: 0 });
    expect(repo.getSubscribers).not.toHaveBeenCalled();
  });
});
