// the service pulls in heavy provider modules that are not under test
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({
    IntegrationService: class {},
  })
);

import { AnalyticsService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.service';

const channel = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Channel ${id}`,
  customName: null as string | null,
  picture: null as string | null,
  providerIdentifier: 'x',
  type: 'social',
  disabled: false,
  refreshNeeded: false,
  inBetweenSteps: false,
  tokenExpiration: null as Date | null,
  ...overrides,
});

const makeService = () => {
  const analyticsRepository = {
    getOverviewPosts: jest.fn().mockResolvedValue([]),
    getOverviewChannels: jest.fn().mockResolvedValue([]),
  };
  const integrationService = {
    checkAnalytics: jest.fn(),
  };
  const integrationManager = {
    getSocialIntegration: jest.fn(),
  };
  const service = new AnalyticsService(
    analyticsRepository as any,
    integrationService as any,
    integrationManager as any
  );
  return {
    service,
    analyticsRepository,
    integrationService,
    integrationManager,
  };
};

describe('AnalyticsService.getOverview', () => {
  it('queries only the caller organization over the selected range', async () => {
    const { service, analyticsRepository } = makeService();
    const before = Date.now();

    await service.getOverview('org-A', 30, 'UTC');

    expect(analyticsRepository.getOverviewChannels).toHaveBeenCalledWith(
      'org-A'
    );
    const [orgId, from, now, until] =
      analyticsRepository.getOverviewPosts.mock.calls[0];
    expect(orgId).toBe('org-A');
    const day = 24 * 60 * 60 * 1000;
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(Math.round((now.getTime() - from.getTime()) / day)).toBe(30);
    expect(Math.round((until.getTime() - now.getTime()) / day)).toBe(30);
  });
});

describe('AnalyticsService.aggregateOverview', () => {
  it('counts states in total and per channel, including channels without posts', () => {
    const { service } = makeService();
    const date = new Date('2026-10-05T10:00:00Z');

    const result = service.aggregateOverview(
      7,
      'UTC',
      [
        { integrationId: 'a', state: 'PUBLISHED', publishDate: date },
        { integrationId: 'a', state: 'PUBLISHED', publishDate: date },
        { integrationId: 'a', state: 'ERROR', publishDate: date },
        { integrationId: 'b', state: 'QUEUE', publishDate: date },
        { integrationId: 'b', state: 'DRAFT', publishDate: date },
      ],
      [
        channel('b'),
        channel('a', { customName: 'Renamed' }),
        channel('c'),
      ] as any
    );

    expect(result.totals).toEqual({ published: 2, scheduled: 1, failed: 1 });
    expect(
      result.channels.map((c) => [
        c.id,
        c.name,
        c.published,
        c.scheduled,
        c.failed,
      ])
    ).toEqual([
      ['a', 'Renamed', 2, 0, 1],
      ['b', 'Channel b', 0, 1, 0],
      ['c', 'Channel c', 0, 0, 0],
    ]);
  });

  it('buckets only published posts by weekday and hour in the given timezone', () => {
    const { service } = makeService();

    // Monday 2026-10-05 23:30 UTC is Tuesday 01:30 in Jerusalem (UTC+3)
    const late = new Date('2026-10-05T23:30:00Z');
    const result = service.aggregateOverview(
      7,
      'Asia/Jerusalem',
      [
        { integrationId: 'a', state: 'PUBLISHED', publishDate: late },
        { integrationId: 'a', state: 'PUBLISHED', publishDate: late },
        { integrationId: 'a', state: 'ERROR', publishDate: late },
        { integrationId: 'a', state: 'QUEUE', publishDate: late },
      ],
      [channel('a')] as any
    );

    expect(result.timezone).toBe('Asia/Jerusalem');
    expect(result.heatmap[2][2]).toBe(2);
    expect(result.byWeekday).toEqual([0, 0, 2, 0, 0, 0, 0]);
    expect(result.byHour[2]).toBe(2);
    expect(result.byHour.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('falls back to UTC for an unknown timezone', () => {
    const { service } = makeService();
    const result = service.aggregateOverview(
      7,
      'Not/AZone',
      [
        {
          integrationId: 'a',
          state: 'PUBLISHED',
          publishDate: new Date('2026-10-05T23:30:00Z'),
        },
      ],
      [channel('a')] as any
    );

    expect(result.timezone).toBe('UTC');
    expect(result.heatmap[1][23]).toBe(1);
  });

  it('returns empty, well-formed buckets when there are no posts', () => {
    const { service } = makeService();
    const result = service.aggregateOverview(90, 'UTC', [], []);

    expect(result.totals).toEqual({ published: 0, scheduled: 0, failed: 0 });
    expect(result.channels).toEqual([]);
    expect(result.heatmap).toHaveLength(7);
    expect(result.heatmap.every((hours) => hours.length === 24)).toBe(true);
    expect(result.byHour).toHaveLength(24);
  });
});

describe('AnalyticsService.getEngagement', () => {
  it('asks only active channels whose provider has analytics', async () => {
    const {
      service,
      analyticsRepository,
      integrationService,
      integrationManager,
    } = makeService();
    analyticsRepository.getOverviewChannels.mockResolvedValue([
      channel('a', { providerIdentifier: 'with' }),
      channel('b', { providerIdentifier: 'without' }),
      channel('c', { providerIdentifier: 'with', disabled: true }),
      channel('d', { providerIdentifier: 'with', refreshNeeded: true }),
      channel('e', { providerIdentifier: 'with', inBetweenSteps: true }),
      channel('f', { providerIdentifier: 'with', type: 'article' }),
    ]);
    integrationManager.getSocialIntegration.mockImplementation((id: string) =>
      id === 'with' ? { analytics: jest.fn() } : {}
    );
    integrationService.checkAnalytics.mockResolvedValue([
      { label: 'Likes', data: [{ total: 3, date: '2026-10-01' }] },
    ]);
    const org = { id: 'org-A' } as any;

    const result = await service.getEngagement(org, 7);

    expect(integrationService.checkAnalytics).toHaveBeenCalledTimes(1);
    // read-only: never refreshes or disconnects the channel
    expect(integrationService.checkAnalytics).toHaveBeenCalledWith(
      org,
      'a',
      '7',
      false,
      false
    );
    expect(result.unsupported).toBe(1);
    expect(result.channels).toEqual([
      expect.objectContaining({ id: 'a', status: 'ok' }),
    ]);
    expect(result.metrics).toEqual([{ label: 'Likes', total: 3, channels: 1 }]);
  });

  it('reports a failing provider as unavailable without failing the rest', async () => {
    const {
      service,
      analyticsRepository,
      integrationService,
      integrationManager,
    } = makeService();
    analyticsRepository.getOverviewChannels.mockResolvedValue([
      channel('a'),
      channel('b'),
    ]);
    integrationManager.getSocialIntegration.mockReturnValue({
      analytics: jest.fn(),
    });
    integrationService.checkAnalytics.mockImplementation(
      async (_org: unknown, id: string) => {
        if (id === 'a') {
          throw new Error('Invalid integration');
        }
        return [{ label: 'Impressions', data: [{ total: '10', date: 'x' }] }];
      }
    );

    const result = await service.getEngagement({ id: 'org-A' } as any, 30);

    expect(result.channels.map((c) => [c.id, c.status])).toEqual([
      ['a', 'unavailable'],
      ['b', 'ok'],
    ]);
    expect(result.metrics).toEqual([
      { label: 'Impressions', total: 10, channels: 1 },
    ]);
  });
});

describe('AnalyticsService.getEngagement expired tokens', () => {
  it('does not call a channel whose token expired and marks it unavailable', async () => {
    const {
      service,
      analyticsRepository,
      integrationService,
      integrationManager,
    } = makeService();
    analyticsRepository.getOverviewChannels.mockResolvedValue([
      channel('a', { tokenExpiration: new Date(Date.now() - 60000) }),
      channel('b', { tokenExpiration: new Date(Date.now() + 60000) }),
    ]);
    integrationManager.getSocialIntegration.mockReturnValue({
      analytics: jest.fn(),
    });
    integrationService.checkAnalytics.mockResolvedValue([]);

    const result = await service.getEngagement({ id: 'org-A' } as any, 7);

    expect(integrationService.checkAnalytics).toHaveBeenCalledTimes(1);
    expect(integrationService.checkAnalytics.mock.calls[0][1]).toBe('b');
    expect(result.channels.map((c) => [c.id, c.status])).toEqual([
      ['a', 'unavailable'],
      ['b', 'empty'],
    ]);
  });
});

describe('AnalyticsService.aggregateEngagement', () => {
  it('sums metrics by label across channels and skips averages', () => {
    const { service } = makeService();

    const result = service.aggregateEngagement(
      7,
      [channel('a'), channel('b'), channel('c')] as any,
      [
        [
          { label: 'Likes', data: [{ total: 2 }, { total: '3' }] },
          { label: 'Engagement rate', average: true, data: [{ total: 50 }] },
          { label: 'Impressions', data: [{ total: 100 }] },
        ],
        [{ label: ' likes ', data: [{ total: 5 }, { total: 'n/a' }] }],
        [],
      ],
      2
    );

    expect(result.metrics).toEqual([
      { label: 'Likes', total: 10, channels: 2 },
      { label: 'Impressions', total: 100, channels: 1 },
    ]);
    expect(result.channels.map((c) => c.status)).toEqual(['ok', 'ok', 'empty']);
    expect(result.unsupported).toBe(2);
  });
});
