jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({ SubscriptionService: class {} }));

import { NotFoundException } from '@nestjs/common';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';

const makeRepo = (existing: { id: string } | null) => {
  const webhooks = {
    findFirst: jest.fn(async () => existing),
    create: jest.fn(async () => ({ id: 'new' })),
    update: jest.fn(async () => ({})),
    upsert: jest.fn(),
  };
  const integration = {
    findMany: jest.fn(async () => [{ id: 'i1' }]),
  };
  const repo = new WebhooksRepository(
    { model: { webhooks } } as any,
    { model: { integration } } as any
  );
  return { repo, webhooks };
};

const body = {
  id: 'w1',
  name: 'Hook',
  url: 'https://example.com/hook',
  integrations: [{ id: 'i1' }],
};

describe('WebhooksRepository', () => {
  it('updates an existing webhook of the organization', async () => {
    const { repo, webhooks } = makeRepo({ id: 'w1' });

    await expect(repo.updateWebhook('org-1', body)).resolves.toEqual({ id: 'w1' });
    expect(webhooks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'w1', organizationId: 'org-1', deletedAt: null },
      })
    );
    expect(webhooks.update).toHaveBeenCalledTimes(1);
    expect(webhooks.create).not.toHaveBeenCalled();
    expect(webhooks.upsert).not.toHaveBeenCalled();
  });

  it('never creates a webhook for an unknown id', async () => {
    const { repo, webhooks } = makeRepo(null);

    await expect(repo.updateWebhook('org-1', body)).resolves.toBeNull();
    expect(webhooks.update).not.toHaveBeenCalled();
    expect(webhooks.create).not.toHaveBeenCalled();
    expect(webhooks.upsert).not.toHaveBeenCalled();
  });

  it('creates a new webhook even when an id is sent', async () => {
    const { repo, webhooks } = makeRepo({ id: 'w1' });

    await expect(repo.createWebhook('org-1', body)).resolves.toEqual({ id: 'new' });
    expect(webhooks.create).toHaveBeenCalledTimes(1);
    expect(webhooks.update).not.toHaveBeenCalled();
  });
});

describe('WebhooksService.updateWebhook', () => {
  it('answers 404 for an unknown webhook', async () => {
    const { repo } = makeRepo(null);
    const service = new WebhooksService(repo, {} as any);

    await expect(service.updateWebhook('org-1', body)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});

describe('WebhooksService.getWebhooksToSend', () => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  afterEach(() => {
    if (key === undefined) {
      delete process.env.STRIPE_PUBLISHABLE_KEY;
    } else {
      process.env.STRIPE_PUBLISHABLE_KEY = key;
    }
  });

  const hooks = Array.from({ length: 5 }, (_, i) => ({ id: `w${i}` }));
  const serviceFor = (tier?: string) =>
    new WebhooksService(
      { getWebhooks: jest.fn(async () => hooks) } as any,
      {
        getSubscriptionByOrganizationId: jest.fn(async () =>
          tier ? { subscriptionTier: tier } : null
        ),
      } as any
    );

  it('marks the webhooks over the plan limit as paused in the list', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
    expect(
      (await serviceFor('STANDARD').getWebhooks('org')).map((w) => w.paused)
    ).toEqual([false, false, true, true, true]);
  });

  it('sends only as many as a downgraded plan holds, the oldest first', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
    // STANDARD holds 2 webhooks
    expect(
      (await serviceFor('STANDARD').getWebhooksToSend('org')).map((w) => w.id)
    ).toEqual(['w0', 'w1']);
  });

  it('sends none from a lapsed workspace', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
    expect(await serviceFor(undefined).getWebhooksToSend('org')).toEqual([]);
  });

  it('sends all with billing off', async () => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    expect(await serviceFor(undefined).getWebhooksToSend('org')).toHaveLength(5);
  });
});
