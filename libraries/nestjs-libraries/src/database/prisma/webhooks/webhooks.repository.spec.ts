import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';

describe('WebhooksRepository.createWebhook', () => {
  const makeRepo = () => {
    const webhooks = {
      upsert: jest.fn().mockResolvedValue({ id: 'wh-1' }),
      update: jest.fn().mockResolvedValue({}),
    };
    const integration = {
      findMany: jest.fn().mockResolvedValue([{ id: 'own-int' }]),
    };
    const repo = new WebhooksRepository(
      { model: { webhooks } } as any,
      { model: { integration } } as any
    );
    return { repo, webhooks, integration };
  };

  it('only links integrations that belong to the organization', async () => {
    const { repo, webhooks, integration } = makeRepo();

    await repo.createWebhook('org-A', {
      name: 'hook',
      url: 'https://example.com/hook',
      integrations: [{ id: 'own-int' }, { id: 'foreign-int' }],
    } as any);

    expect(integration.findMany.mock.calls[0][0].where).toMatchObject({
      id: { in: ['own-int', 'foreign-int'] },
      organizationId: 'org-A',
      deletedAt: null,
    });
    expect(webhooks.update.mock.calls[0][0].data.integrations).toEqual({
      deleteMany: {},
      create: [{ integrationId: 'own-int' }],
    });
  });

  it('skips the lookup when no integrations are sent', async () => {
    const { repo, webhooks, integration } = makeRepo();

    await repo.createWebhook('org-A', {
      name: 'hook',
      url: 'https://example.com/hook',
      integrations: [],
    } as any);

    expect(integration.findMany).not.toHaveBeenCalled();
    expect(webhooks.update.mock.calls[0][0].data.integrations.create).toEqual(
      []
    );
  });
});
