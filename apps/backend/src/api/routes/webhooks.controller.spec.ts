jest.mock('@gitroom/backend/services/auth/permissions/permissions.ability', () => ({
  CheckPolicies: () => () => undefined,
}));
jest.mock(
  '@gitroom/backend/services/auth/permissions/permission.exception.class',
  () => ({ AuthorizationActions: {}, Sections: {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service',
  () => ({ WebhooksService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto', () => ({
  OnlyURL: class {},
  UpdateDto: class {},
  WebhooksDto: class {},
}));

import { WebhookController } from '@gitroom/backend/api/routes/webhooks.controller';

describe('WebhookController.sendWebhook', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    delete process.env.DISABLE_SSRF_PROTECTION;
    fetchMock = jest.fn();
    global.fetch = fetchMock as any;
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('posts through the SSRF-safe fetch', async () => {
    fetchMock.mockResolvedValue(new Response('ok'));
    const controller = new WebhookController({} as any);

    await expect(
      controller.sendWebhook({ a: 1 }, { url: 'https://8.8.8.8/hook' })
    ).resolves.toEqual({ send: true, status: 200 });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      redirect: 'manual',
    });
  });

  it('does not follow a redirect to an internal address', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 307,
        headers: { location: 'https://10.0.0.1/internal' },
      })
    );
    const controller = new WebhookController({} as any);

    await controller.sendWebhook({ a: 1 }, { url: 'https://8.8.8.8/hook' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports an endpoint that refused the test', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    const controller = new WebhookController({} as any);

    await expect(
      controller.sendWebhook({ a: 1 }, { url: 'https://8.8.8.8/hook' })
    ).resolves.toMatchObject({ send: false, status: 500 });
  });

  it('reports an endpoint that could not be reached', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const controller = new WebhookController({} as any);

    await expect(
      controller.sendWebhook({ a: 1 }, { url: 'https://8.8.8.8/hook' })
    ).resolves.toMatchObject({ send: false });
  });
});

describe('WebhookController.updateWebhook', () => {
  it('updates through the service, never creates', async () => {
    const service = {
      createWebhook: jest.fn(),
      updateWebhook: jest.fn(async () => ({ id: 'w1' })),
    };
    const controller = new WebhookController(service as any);
    const body = { id: 'w1', name: 'n', url: 'https://8.8.8.8', integrations: [] };

    await expect(
      controller.updateWebhook({ id: 'org-1' } as any, body as any)
    ).resolves.toEqual({ id: 'w1' });
    expect(service.updateWebhook).toHaveBeenCalledWith('org-1', body);
    expect(service.createWebhook).not.toHaveBeenCalled();
  });
});
