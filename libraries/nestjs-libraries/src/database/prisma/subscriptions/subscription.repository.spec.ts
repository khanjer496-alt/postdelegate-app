import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';

describe('SubscriptionRepository trial flag and provider status', () => {
  const makeRepo = () => {
    const subscription = {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([]),
    };
    const organization = {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
    };
    const usedCodes = { create: jest.fn() };
    // an interactive transaction: the callback gets the same models, and a
    // throw inside it is what rolls it back
    const transaction = {
      model: {
        $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) =>
          fn({ subscription, organization, usedCodes })
        ),
      },
    };
    const repo = new SubscriptionRepository(
      { model: { subscription } } as any,
      { model: { organization } } as any,
      {} as any,
      {} as any,
      { model: { usedCodes } } as any,
      transaction as any
    );
    return { repo, subscription, organization };
  };

  const state = {
    status: 'past_due',
    trialEndsAt: null,
    currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
  };

  it('stores the provider status on the plan and the trial flag on the workspace', async () => {
    const { repo, subscription, organization } = makeRepo();
    await repo.createOrUpdateSubscription(
      'stripe', false, 'u1', 'cus_1', 30, 'PRO', 'MONTHLY', null,
      undefined, { id: 'org_1' }, state
    );

    const { update, create } = subscription.upsert.mock.calls[0][0];
    expect(update).toMatchObject(state);
    expect(create).toMatchObject(state);
    expect(organization.update.mock.calls[0][0].data).toEqual({
      isTrailing: false,
      allowTrial: false,
    });
  });

  it('stores no status for a plan without one, never a stale one', async () => {
    const { repo, subscription } = makeRepo();
    await repo.createOrUpdateSubscription(
      'stripe', false, 'admin_1', '', 30, 'PRO', 'MONTHLY', null,
      undefined, { id: 'org_1' }
    );

    expect(subscription.upsert.mock.calls[0][0].update).toMatchObject({
      status: null,
      trialEndsAt: null,
      currentPeriodEnd: null,
    });
  });

  it('clears the trial flag when it removes a subscription', async () => {
    const { repo, organization } = makeRepo();
    expect(await repo.deleteSubscriptionByCustomerId('cus_1', 'stripe')).toEqual({
      count: 1,
    });
    expect(organization.updateMany).toHaveBeenCalledWith({
      where: { paymentId: 'cus_1' },
      data: { isTrailing: false },
    });

    await repo.deleteSubscriptionByOrgId('org_1', 'revenuecat');
    expect(organization.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'org_1' },
      data: { isTrailing: false },
    });
  });

  it('leaves the flag of a workspace that had no subscription to remove', async () => {
    const { repo, subscription, organization } = makeRepo();
    subscription.deleteMany.mockResolvedValue({ count: 0 });

    await repo.deleteSubscriptionByCustomerId('cus_1', 'stripe');
    await repo.deleteSubscriptionByOrgId('org_1', 'revenuecat');

    expect(organization.updateMany).not.toHaveBeenCalled();
    expect(organization.update).not.toHaveBeenCalled();
  });

  describe('setProviderStateIfUnchanged', () => {
    const row = {
      id: 'sub_1',
      organizationId: 'org_1',
      updatedAt: new Date('2026-11-01T00:00:00Z'),
    };

    it('writes both while the plan and the flag are what was read', async () => {
      const { repo, subscription, organization } = makeRepo();
      expect(
        await repo.setProviderStateIfUnchanged(
          row,
          { from: true, to: false },
          state
        )
      ).toBe(true);
      expect(subscription.updateMany).toHaveBeenCalledWith({
        where: { id: 'sub_1', updatedAt: row.updatedAt },
        data: state,
      });
      expect(organization.updateMany).toHaveBeenCalledWith({
        where: { id: 'org_1', isTrailing: true },
        data: { isTrailing: false },
      });
    });

    it('writes nothing when a webhook stored the plan since', async () => {
      const { repo, subscription, organization } = makeRepo();
      subscription.updateMany.mockResolvedValue({ count: 0 });
      expect(
        await repo.setProviderStateIfUnchanged(
          row,
          { from: true, to: false },
          state
        )
      ).toBe(false);
      expect(organization.updateMany).not.toHaveBeenCalled();
    });

    it('rolls the plan back when the flag changed since', async () => {
      const { repo, organization } = makeRepo();
      organization.updateMany.mockResolvedValue({ count: 0 });
      // the throw inside the transaction is what rolls it back
      expect(
        await repo.setProviderStateIfUnchanged(
          row,
          { from: true, to: false },
          state
        )
      ).toBe(false);
    });

    it('passes a database error on', async () => {
      const { repo, subscription } = makeRepo();
      subscription.updateMany.mockRejectedValue(new Error('db down'));
      await expect(
        repo.setProviderStateIfUnchanged(row, { from: true, to: false }, state)
      ).rejects.toThrow('db down');
    });
  });

  it('clears only the flags of workspaces whose subscription ended', async () => {
    const { repo, organization } = makeRepo();
    await repo.clearEndedTrialFlags();
    expect(organization.updateMany).toHaveBeenCalledWith({
      where: {
        isTrailing: true,
        allowTrial: false,
        subscription: { is: null },
      },
      data: { isTrailing: false },
    });
  });
});
