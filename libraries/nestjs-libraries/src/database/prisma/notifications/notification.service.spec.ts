// the service pulls in heavy modules that are not under test
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository',
  () => ({ NotificationsRepository: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository',
  () => ({ OrganizationRepository: class {} })
);
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));
jest.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({
      info: { workflowExecution: { workflowId: 'post_p1' } },
    }),
  },
}));

import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';

const providers: Record<string, { identifier: string; name: string }> = {
  tiktok: { identifier: 'tiktok', name: 'TikTok' },
  youtube: { identifier: 'youtube', name: 'YouTube' },
  x: { identifier: 'x', name: 'X' },
  instagram: { identifier: 'instagram', name: 'Instagram\n(Facebook Business)' },
};

const integrationManager = {
  getSocialIntegration: (identifier: string) => providers[identifier],
};
const repository = {
  getUserTimezone: jest.fn().mockResolvedValue({ timezoneName: 'Asia/Dubai' }),
};
const emailService = { sendEmail: jest.fn() };

const service = new NotificationService(
  repository as any,
  emailService as any,
  {} as any,
  {} as any,
  integrationManager as any
);

const createdAt = '2026-10-31T10:05:00.000Z';

describe('NotificationService digest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FRONTEND_URL = 'https://app.example.com';
  });

  it('turns a published notification into a card with a link', () => {
    const card = service.digestCard(
      {
        type: 'success',
        provider: 'tiktok',
        createdAt,
        message:
          'Your post has been published on Tiktok at https://www.tiktok.com/@user7777405737227',
      },
      'Asia/Dubai'
    );

    expect(card).toEqual({
      tone: 'success',
      title: 'TikTok',
      icon: 'https://app.example.com/icons/platforms/tiktok.png',
      status: 'Published',
      time: 'Oct 31, 2:05 PM GMT+4',
      link: {
        href: 'https://www.tiktok.com/@user7777405737227',
        label: 'View post',
      },
    });
  });

  it('uses the provider labels for an inbox upload', () => {
    const card = service.digestCard({
      type: 'success',
      provider: 'tiktok',
      publishedLabel: 'Sent to TikTok inbox',
      publishedLinkLabel: 'Open TikTok inbox',
      message:
        'Your post has been published on Tiktok at https://www.tiktok.com/messages?lang=en#v_inbox_url~v2.77028',
    });

    expect(card.status).toBe('Sent to TikTok inbox');
    expect(card.tone).toBe('info');
    expect(card.link).toEqual({
      href: 'https://www.tiktok.com/messages?lang=en#v_inbox_url~v2.77028',
      label: 'Open TikTok inbox',
    });
  });

  it('finds the provider in the message when the entry has none', () => {
    const card = service.digestCard({
      type: 'success',
      message: 'Your post has been published on Youtube at https://youtu.be/abc',
    });

    expect(card.title).toBe('YouTube');
    expect(card.time).toBeUndefined();
    expect(card.link?.href).toBe('https://youtu.be/abc');
  });

  it('keeps the reason of a failure', () => {
    const card = service.digestCard({
      type: 'fail',
      message: 'An error occurred while posting on x: Duplicate content',
    });

    expect(card).toMatchObject({
      tone: 'fail',
      title: 'X',
      status: 'Failed',
      message: 'Duplicate content',
    });
    expect(card.link).toBeUndefined();
    expect(
      service.digestCard({
        type: 'fail',
        provider: 'x',
        message: 'An error occurred while posting comments on x',
      })
    ).toMatchObject({
      status: 'Comments failed',
      message: 'An error occurred while posting comments on x',
    });
    expect(
      service.digestCard({ type: 'fail', message: 'Something broke' })
    ).toMatchObject({ status: 'Failed', message: 'Something broke' });
  });

  it('falls back to the original text for an unknown message', () => {
    const message = 'Something new happened';
    expect(service.digestCard({ type: 'info', message })).toEqual({
      tone: 'info',
      title: undefined,
      icon: undefined,
      time: undefined,
      status: 'Needs attention',
      message,
    });
    expect(service.digestCard({ type: 'success', message }).status).toBe(
      'Update'
    );
  });

  it('never links a URL that is not http', () => {
    const card = service.digestCard({
      type: 'success',
      provider: 'x',
      message: 'Your post has been published on X at javascript:alert(1)',
    });

    expect(card).toMatchObject({ status: 'Published', title: 'X' });
    expect(card.link).toBeUndefined();
    const empty = service.digestCard({
      type: 'success',
      provider: 'x',
      message: 'Your post has been published on X at ',
    });
    expect(empty.status).toBe('Published');
    expect(empty.link).toBeUndefined();
  });

  it('collapses multi-line provider names and survives a bad timezone', () => {
    const card = service.digestCard(
      { type: 'success', provider: 'instagram', createdAt, message: 'Hi' },
      'Not/AZone'
    );

    expect(card.title).toBe('Instagram (Facebook Business)');
    expect(card.time).toBe('Oct 31, 10:05 AM UTC');
  });

  it('shows ten cards, failures first, then how many more', () => {
    const notifications = [
      ...Array.from({ length: 11 }, (_, i) => ({
        type: 'success' as const,
        provider: 'youtube',
        message: `Your post has been published on Youtube at https://youtu.be/${i}`,
      })),
      { type: 'fail' as const, provider: 'x', message: 'Could not post <b>' },
    ];

    const { subject, html } = service.digestEmail(notifications);

    expect(subject).toBe('[PostDelegate] Your latest notifications');
    expect(html.match(/<table role="presentation" width="100%"/g)).toHaveLength(
      10
    );
    expect(html.indexOf('Failed')).toBeLessThan(html.indexOf('Published'));
    expect(html).toContain('Could not post &lt;b&gt;');
    expect(html).toContain('And 2 more notifications.');
    expect(html).toContain('href="https://youtu.be/8"');
    expect(html).not.toContain('href="https://youtu.be/9"');
    expect(html).toContain('href="https://app.example.com/launches"');
    expect(html).toContain('Open PostDelegate');
    expect(html).toContain("Here's what happened with your posts.");
  });

  it('names a single notification in the subject', () => {
    expect(
      service.digestEmail([
        {
          type: 'success',
          provider: 'tiktok',
          publishedLabel: 'Sent to TikTok inbox',
          message:
            'Your post has been published on Tiktok at https://www.tiktok.com/messages',
        },
      ]).subject
    ).toBe('Your post was sent to TikTok inbox');
    expect(
      service.digestEmail([
        {
          type: 'success',
          provider: 'youtube',
          message: 'Your post has been published on Youtube at https://youtu.be/a',
        },
      ]).subject
    ).toBe('Your post has been published on YouTube');
  });

  it('sends the digest in the user timezone', async () => {
    await service.sendDigestEmail('user-1', 'a@b.com', [
      {
        type: 'success',
        provider: 'x',
        createdAt,
        message: 'Your post has been published on X at https://x.com/a/status/1',
      },
    ]);

    expect(repository.getUserTimezone).toHaveBeenCalledWith('user-1');
    const [to, subject, html, addTo] = emailService.sendEmail.mock.calls[0];
    expect([to, subject, addTo]).toEqual([
      'a@b.com',
      'Your post has been published on X',
      'bottom',
    ]);
    expect(html).toContain('Oct 31, 2:05 PM GMT+4');
  });
});

describe('NotificationService digest queue', () => {
  const signalWithStart = jest.fn();
  const queueRepository = {
    getPostNotificationContext: jest.fn(),
    createScopedNotification: jest.fn().mockResolvedValue(true),
  };
  const manager = {
    getSocialIntegration: (identifier: string) =>
      ({
        tiktok: {
          identifier: 'tiktok',
          name: 'TikTok',
          publishedLabel: () => 'Sent to TikTok inbox',
          publishedLinkLabel: () => 'Open TikTok inbox',
        },
        youtube: {
          identifier: 'youtube',
          name: 'YouTube',
          authorizationPolicy: {},
        },
      } as any)[identifier],
  };
  const queueService = new NotificationService(
    queueRepository as any,
    {} as any,
    {} as any,
    { client: { getRawClient: () => ({ workflow: { signalWithStart } }) } } as any,
    manager as any
  );
  const post = (providerIdentifier: string) => ({
    id: 'p1',
    integrationId: 'i1',
    deletedAt: null,
    settings: '{"content_posting_method":"UPLOAD"}',
    integration: { providerIdentifier, deletedAt: null },
  });

  beforeEach(() => jest.clearAllMocks());

  it('queues the provider labels on the v3 digest', async () => {
    queueRepository.getPostNotificationContext.mockResolvedValue(post('tiktok'));
    await queueService.inAppNotification(
      'org1',
      'Your post has been published on Tiktok',
      'Your post has been published on Tiktok at https://www.tiktok.com/messages',
      true,
      true
    );

    const [workflow, options] = signalWithStart.mock.calls[0];
    expect(workflow).toBe('digestEmailWorkflowV3');
    expect(options.workflowId).toBe('digest_email_workflow_v3_org1');
    expect(options.signalArgs[0][0]).toMatchObject({
      type: 'success',
      provider: 'tiktok',
      publishedLabel: 'Sent to TikTok inbox',
      publishedLinkLabel: 'Open TikTok inbox',
    });
    expect(options.signalArgs[0][0].createdAt).toEqual(expect.any(String));
  });

  it('adds nothing about the channel for a provider with an authorization policy', async () => {
    queueRepository.getPostNotificationContext.mockResolvedValue(post('youtube'));
    await queueService.inAppNotification(
      'org1',
      'Your post has been published on Youtube',
      'Your post has been published on Youtube at https://youtu.be/a',
      true,
      true
    );

    const entry = signalWithStart.mock.calls[0][1].signalArgs[0][0];
    expect(entry.provider).toBeUndefined();
    expect(entry.publishedLabel).toBeUndefined();
    expect(entry.message).not.toContain('youtu.be');
  });
});
