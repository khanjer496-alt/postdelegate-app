jest.mock('@gitroom/nestjs-libraries/database/prisma/analytics/analytics.service', () => ({
  AnalyticsService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/services/email.service', () => ({
  EmailService: class {},
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: jest.fn().mockResolvedValue('OK') },
}));

import { AnalyticsReportService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.report.service';

const member = (id: string, email = `${id}@example.com`) => ({
  role: 'ADMIN',
  user: { id, email, name: id, lastName: null },
});

const reportData = {
  trends: {
    from: '2026-10-19',
    to: '2026-10-25',
    comparison: [
      { key: 'followers', current: 10, previous: 5, change: 100 },
      { key: 'published', current: 3, previous: null, change: null },
      { key: 'engagement', current: 40, previous: 50, change: -20 },
      { key: 'views', current: null, previous: null, change: null },
    ],
  },
  topPosts: {
    posts: [
      {
        id: 'p1',
        title: '<script>alert(1)</script>',
        url: 'https://x.com/1?a=1&b="2"',
        channel: { name: 'Brand & Co' },
        engagement: 12,
        views: null,
      },
    ],
  },
  insights: { posts: 0 },
  bestTimes: { basis: 'publish_count' },
};

const makeService = () => {
  const repository = {
    getReportSettings: jest.fn().mockResolvedValue(null),
    getReportMembers: jest.fn().mockResolvedValue([]),
    getOrganizationName: jest
      .fn()
      .mockResolvedValue({ id: 'org-A', name: 'Acme' }),
    upsertReportSettings: jest.fn().mockResolvedValue({}),
    getScheduledReportsPage: jest.fn().mockResolvedValue([]),
    getOrganizationsForReports: jest.fn().mockResolvedValue([]),
    claimReportSend: jest.fn().mockResolvedValue(true),
  };
  const analytics = {
    trendsFor: jest.fn().mockResolvedValue(reportData.trends),
    topPostsFor: jest.fn().mockResolvedValue(reportData.topPosts),
    insightsFor: jest.fn().mockResolvedValue(reportData.insights),
    bestTimesFor: jest.fn().mockResolvedValue(reportData.bestTimes),
    historyRange: jest.fn(() => ({ from: new Date(), to: new Date() })),
  };
  const email = {
    hasProvider: jest.fn().mockReturnValue(true),
    sendEmail: jest.fn().mockResolvedValue(undefined),
  };
  return {
    service: new AnalyticsReportService(
      repository as any,
      analytics as any,
      email as any
    ),
    repository,
    analytics,
    email,
  };
};

const settings = (overrides: Record<string, unknown> = {}) => ({
  id: 'set-1',
  organizationId: 'org-A',
  frequency: 'WEEKLY',
  recipients: ['u1', 'u2'],
  brandName: null,
  logoUrl: null,
  lastSentAt: new Date('2026-10-20T01:00:00Z') as Date | null,
  ...overrides,
});

const priorStripe = process.env.STRIPE_PUBLISHABLE_KEY;
afterEach(() => {
  if (priorStripe === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
  else process.env.STRIPE_PUBLISHABLE_KEY = priorStripe;
  delete process.env.ANALYTICS_REPORTS_DISABLED;
});

describe('AnalyticsReportService periods', () => {
  // Saturday
  const now = new Date('2026-10-31T10:00:00Z');

  it('reports the previous full week, Monday to Sunday, in UTC', () => {
    const { service } = makeService();
    expect(service.reportPeriod('WEEKLY' as any, now)).toEqual({
      periodStart: new Date('2026-10-26T00:00:00Z'),
      from: new Date('2026-10-19T00:00:00Z'),
      to: new Date('2026-10-25T23:59:59.999Z'),
    });
  });

  it('reports the previous month', () => {
    const { service } = makeService();
    expect(
      service.reportPeriod('MONTHLY' as any, new Date('2026-11-01T00:30:00Z'))
    ).toEqual({
      periodStart: new Date('2026-11-01T00:00:00Z'),
      from: new Date('2026-10-01T00:00:00Z'),
      to: new Date('2026-10-31T23:59:59.999Z'),
    });
  });

  it('is due once per period', () => {
    const { service } = makeService();
    expect(service.isDue(settings({ lastSentAt: null }) as any, now)).toBe(true);
    expect(
      service.isDue(settings({ lastSentAt: new Date('2026-10-25T23:00:00Z') }) as any, now)
    ).toBe(true);
    expect(
      service.isDue(settings({ lastSentAt: new Date('2026-10-26T00:10:00Z') }) as any, now)
    ).toBe(false);
    expect(service.isDue(settings({ frequency: 'OFF' }) as any, now)).toBe(false);
  });
});

describe('AnalyticsReportService.sendDueReportsPage', () => {
  const now = new Date('2026-10-26T03:00:00Z');

  it('claims the period, then emails only active members of the workspace', async () => {
    const { service, repository, email, analytics } = makeService();
    repository.getScheduledReportsPage.mockResolvedValue([settings()]);
    repository.getOrganizationsForReports.mockResolvedValue([
      { id: 'org-A', name: 'Acme', subscription: null },
    ]);
    // u2 left the workspace
    repository.getReportMembers.mockResolvedValue([member('u1')]);

    const result = await service.sendDueReportsPage(undefined, now);

    expect(result).toEqual({ enabled: true, sent: 1 });
    expect(repository.getReportMembers).toHaveBeenCalledWith('org-A', ['u1', 'u2']);
    expect(analytics.trendsFor).toHaveBeenCalledWith(
      'org-A',
      new Date('2026-10-19T00:00:00Z'),
      new Date('2026-10-25T23:59:59.999Z')
    );
    expect(repository.claimReportSend).toHaveBeenCalledWith(
      'set-1',
      new Date('2026-10-20T01:00:00Z'),
      now
    );
    expect(repository.claimReportSend.mock.invocationCallOrder[0]).toBeLessThan(
      email.sendEmail.mock.invocationCallOrder[0]
    );
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(email.sendEmail.mock.calls[0][0]).toBe('u1@example.com');
    expect(email.sendEmail.mock.calls[0][3]).toBe('bottom');
  });

  it('never sends twice when another run already claimed the period', async () => {
    const { service, repository, email } = makeService();
    repository.getScheduledReportsPage.mockResolvedValue([settings()]);
    repository.getOrganizationsForReports.mockResolvedValue([
      { id: 'org-A', name: 'Acme', subscription: null },
    ]);
    repository.getReportMembers.mockResolvedValue([member('u1')]);
    repository.claimReportSend.mockResolvedValue(false);

    expect(await service.sendDueReportsPage(undefined, now)).toEqual({
      enabled: true,
      sent: 0,
    });
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('skips workspaces whose plan does not include reports when billing is on', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
    const { service, repository, email } = makeService();
    repository.getScheduledReportsPage.mockResolvedValue([
      settings(),
      settings({ id: 'set-2', organizationId: 'org-B' }),
    ]);
    repository.getOrganizationsForReports.mockResolvedValue([
      { id: 'org-A', subscription: { subscriptionTier: 'STANDARD', deletedAt: null } },
      { id: 'org-B', subscription: { subscriptionTier: 'PRO', deletedAt: null } },
    ]);
    repository.getReportMembers.mockResolvedValue([member('u1')]);

    expect(await service.sendDueReportsPage(undefined, now)).toEqual({
      enabled: true,
      sent: 1,
    });
    expect(repository.claimReportSend).toHaveBeenCalledTimes(1);
    expect(repository.claimReportSend.mock.calls[0][0]).toBe('set-2');
  });

  it('does nothing when switched off', async () => {
    process.env.ANALYTICS_REPORTS_DISABLED = 'true';
    const { service, repository } = makeService();
    expect(await service.sendDueReportsPage(undefined, now)).toEqual({
      enabled: false,
      sent: 0,
    });
    expect(repository.getScheduledReportsPage).not.toHaveBeenCalled();
  });
});

describe('AnalyticsReportService settings', () => {
  it('keeps only members as recipients and starts a new schedule next period', async () => {
    const { service, repository } = makeService();
    repository.getReportMembers.mockResolvedValue([member('u1')]);
    const now = new Date('2026-10-28T12:00:00Z');

    await service.updateSettings(
      'org-A',
      {
        frequency: 'WEEKLY' as any,
        recipients: ['u1', 'outsider', 'u1'],
        brandName: '  Agency  ',
        logoUrl: '',
      },
      now
    );

    expect(repository.getReportMembers).toHaveBeenCalledWith('org-A', ['u1', 'outsider']);
    expect(repository.upsertReportSettings).toHaveBeenCalledWith('org-A', {
      frequency: 'WEEKLY',
      recipients: ['u1'],
      brandName: 'Agency',
      logoUrl: null,
      lastSentAt: now,
    });
  });

  it('does not reset the schedule when only the branding changes', async () => {
    const { service, repository } = makeService();
    repository.getReportSettings.mockResolvedValue(settings());
    repository.getReportMembers.mockResolvedValue([member('u1')]);

    await service.updateSettings('org-A', {
      frequency: 'WEEKLY' as any,
      recipients: ['u1'],
      brandName: 'New name',
    });

    expect(repository.upsertReportSettings.mock.calls[0][1]).not.toHaveProperty(
      'lastSentAt'
    );
  });

  it('allows reports on Pro and Ultimate only when billing is on', () => {
    const { service } = makeService();
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    expect(service.planAllows(null)).toBe(true);
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
    expect(service.planAllows(null)).toBe(false);
    expect(service.planAllows({ subscriptionTier: 'TEAM', deletedAt: null } as any)).toBe(false);
    expect(service.planAllows({ subscriptionTier: 'PRO', deletedAt: null } as any)).toBe(true);
    expect(service.planAllows({ subscriptionTier: 'ULTIMATE', deletedAt: new Date() } as any)).toBe(false);
  });
});

describe('AnalyticsReportService.buildEmail', () => {
  it('escapes everything that comes from posts and settings', () => {
    const { service } = makeService();
    const { subject, html } = service.buildEmail(
      {
        brand: { name: 'Acme <b>', logoUrl: 'https://cdn/logo.png?x="1"' },
        from: '2026-10-19',
        to: '2026-10-25',
        generatedAt: '',
        trends: reportData.trends,
        topPosts: reportData.topPosts.posts,
        insights: reportData.insights,
        bestTimes: reportData.bestTimes,
      } as any,
      'WEEKLY' as any
    );

    expect(subject).toBe('Weekly analytics for Acme <b>: Oct 19 – Oct 25, 2026');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Brand &amp; Co');
    expect(html).toContain('logo.png?x=&quot;1&quot;');
    expect(html).toContain('▲ 100%');
    expect(html).toContain('▼ 20%');
  });
});

describe('AnalyticsReportService.getReportDataForRange', () => {
  it('rejects ranges that are reversed, in the future or longer than a year', async () => {
    const { service } = makeService();
    await expect(
      service.getReportDataForRange('org-A', '2026-10-10', '2026-10-01')
    ).rejects.toThrow();
    await expect(
      service.getReportDataForRange('org-A', '2099-01-01', '2099-01-02')
    ).rejects.toThrow();
    await expect(
      service.getReportDataForRange('org-A', '2024-01-01', '2026-01-01')
    ).rejects.toThrow();
  });
});
