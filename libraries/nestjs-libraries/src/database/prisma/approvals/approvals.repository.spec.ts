import { ApprovalsRepository } from './approvals.repository';

const makeRepo = (claimed = 1) => {
  const post = {
    updateMany: jest
      .fn()
      .mockResolvedValueOnce({ count: claimed })
      .mockResolvedValue({ count: 2 }),
  };
  const transaction = {
    model: { $transaction: jest.fn((run: any) => run({ post })) },
  };
  const repo = new ApprovalsRepository(
    {} as any,
    {} as any,
    { model: { post } } as any,
    {} as any,
    {} as any,
    {} as any,
    transaction as any
  );
  return { repo, post, transaction };
};

describe('ApprovalsRepository.transitionGroup', () => {
  const root = { id: 'p-1', group: 'g-1' };

  it('moves the main post and its comments in one transaction', async () => {
    const { repo, post, transaction } = makeRepo();
    const moved = await repo.transitionGroup(
      'org-1',
      root,
      { approvalStatus: 'IN_REVIEW' },
      { state: 'DRAFT', approvalStatus: 'CHANGES_REQUESTED' }
    );
    expect(moved).toBe(true);
    expect(transaction.model.$transaction).toHaveBeenCalledTimes(1);
    expect(post.updateMany).toHaveBeenCalledTimes(2);
    expect(post.updateMany.mock.calls[0][0]).toEqual({
      where: {
        AND: [
          { approvalStatus: 'IN_REVIEW' },
          { id: 'p-1', organizationId: 'org-1', deletedAt: null },
        ],
      },
      data: { state: 'DRAFT', approvalStatus: 'CHANGES_REQUESTED' },
    });
    expect(post.updateMany.mock.calls[1][0].where).toEqual({
      organizationId: 'org-1',
      group: 'g-1',
      deletedAt: null,
      id: { not: 'p-1' },
    });
  });

  it('leaves the comments alone when the main post was not claimed', async () => {
    const { repo, post } = makeRepo(0);
    expect(
      await repo.transitionGroup('org-1', root, {}, {
        state: 'QUEUE',
        approvalStatus: 'APPROVED',
      })
    ).toBe(false);
    expect(post.updateMany).toHaveBeenCalledTimes(1);
  });

  it('a post queued again loses the error and release of its last attempt', async () => {
    const { repo, post } = makeRepo();
    await repo.transitionGroup('org-1', root, {}, {
      state: 'QUEUE',
      approvalStatus: 'APPROVED',
    });
    for (const [{ data }] of post.updateMany.mock.calls) {
      expect(data).toEqual({
        state: 'QUEUE',
        approvalStatus: 'APPROVED',
        error: null,
        releaseId: null,
        releaseURL: null,
      });
    }
  });
});
