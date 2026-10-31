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
    ).resolves.toEqual({ send: true });

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
});
