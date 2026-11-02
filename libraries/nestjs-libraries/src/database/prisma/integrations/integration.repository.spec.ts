import { NotFoundException } from '@nestjs/common';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';

jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn() },
}));

const makeRepo = () => {
  const integration = {
    findFirst: jest.fn(),
    update: jest.fn().mockResolvedValue({ id: 'int-1' }),
  };
  const customer = { findFirst: jest.fn() };
  const plugs = { upsert: jest.fn().mockResolvedValue({ activated: true }) };
  const repo = new IntegrationRepository(
    { model: { integration } } as any,
    {} as any,
    { model: { plugs } } as any,
    {} as any,
    { model: { customer } } as any,
    {} as any,
    {} as any,
    {} as any
  );
  return { repo, integration, customer, plugs };
};

describe('IntegrationRepository.updateIntegrationGroup', () => {
  it('rejects a customer that does not belong to the organization', async () => {
    const { repo, customer, integration } = makeRepo();
    customer.findFirst.mockResolvedValue(null);

    await expect(
      repo.updateIntegrationGroup('org-A', 'int-1', 'foreign-customer')
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(customer.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'foreign-customer',
      orgId: 'org-A',
      deletedAt: null,
    });
    expect(integration.update).not.toHaveBeenCalled();
  });

  it('connects an owned customer', async () => {
    const { repo, customer, integration } = makeRepo();
    customer.findFirst.mockResolvedValue({ id: 'cust-1' });

    await repo.updateIntegrationGroup('org-A', 'int-1', 'cust-1');

    expect(integration.update.mock.calls[0][0].data).toEqual({
      customer: { connect: { id: 'cust-1' } },
    });
  });

  it('disconnects without a customer lookup when the group is empty', async () => {
    const { repo, customer, integration } = makeRepo();

    await repo.updateIntegrationGroup('org-A', 'int-1', '');

    expect(customer.findFirst).not.toHaveBeenCalled();
    expect(integration.update.mock.calls[0][0].data).toEqual({
      customer: { disconnect: true },
    });
  });
});

describe('IntegrationRepository.createOrUpdatePlug', () => {
  const dto = { func: 'like', fields: [] } as any;

  it('rejects an integration of another organization', async () => {
    const { repo, integration, plugs } = makeRepo();
    integration.findFirst.mockResolvedValue(null);

    await expect(
      repo.createOrUpdatePlug('org-A', 'foreign-int', dto)
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(integration.findFirst.mock.calls[0][0].where).toMatchObject({
      id: 'foreign-int',
      organizationId: 'org-A',
    });
    expect(plugs.upsert).not.toHaveBeenCalled();
  });

  it('upserts the plug for an owned integration', async () => {
    const { repo, integration, plugs } = makeRepo();
    integration.findFirst.mockResolvedValue({ id: 'int-1' });

    await expect(
      repo.createOrUpdatePlug('org-A', 'int-1', dto)
    ).resolves.toEqual({ activated: true });
    expect(plugs.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('IntegrationRepository.disableIntegrations', () => {
  it('turns off the newest channels first on a downgrade', async () => {
    const integration = {
      findMany: jest.fn().mockResolvedValue([{ id: 'newest' }]),
      update: jest.fn().mockResolvedValue({}),
    };
    const repo = new IntegrationRepository(
      { model: { integration } } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await repo.disableIntegrations('org-A', 1);

    expect(integration.findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: 'org-A', disabled: false, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(integration.update).toHaveBeenCalledWith({
      where: { id: 'newest' },
      data: { disabled: true },
    });
  });
});

describe('IntegrationRepository.deleteChannel', () => {
  it('keeps the stored tokens of a plain delete', async () => {
    const { repo, integration } = makeRepo();
    await repo.deleteChannel('org-A', 'int-1');

    const args = integration.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'int-1', organizationId: 'org-A' });
    expect(args.select).toEqual({ id: true });
    expect(Object.keys(args.data)).toEqual(['deletedAt']);
  });

  it('deletes the stored tokens when the provider revoked the grant', async () => {
    const { repo, integration } = makeRepo();
    await repo.deleteChannel('org-A', 'int-1', true);

    const args = integration.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'int-1', organizationId: 'org-A' });
    expect(args.select).toEqual({ id: true });
    expect(args.data).toMatchObject({
      token: '',
      refreshToken: null,
      tokenExpiration: null,
    });
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });
});
