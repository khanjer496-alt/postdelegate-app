jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository',
  () => ({
    IntegrationRepository: class {},
    isOwnedIntegrationPicture: () => false,
  })
);
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));

import { IntegrationAuthorizationLifecycleService } from './integration.authorization.lifecycle.service';

const makeService = (
  running: { workflowId: string; runId: string; searchAttributes?: any }[],
  describeOutcome: (id: string) => any = () => ({ status: { name: 'RUNNING' } })
) => {
  const terminated: string[] = [];
  const workflow = {
    list: () =>
      (async function* () {
        for (const execution of running) yield execution;
      })(),
    getHandle: (id: string) => ({
      describe: async () => {
        const outcome = describeOutcome(id);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
      terminate: async () => {
        terminated.push(id);
      },
    }),
  };
  const service = new IntegrationAuthorizationLifecycleService(
    {} as any,
    {} as any,
    { client: { getRawClient: () => ({ workflow }) } } as any
  );
  return { service, terminated };
};

describe('IntegrationAuthorizationLifecycleService.closeWorkflows', () => {
  it('terminates the post, refresh and extra workflows of the organization', async () => {
    const { service, terminated } = makeService([
      { workflowId: 'post_p1_abc123', runId: 'r1' },
      { workflowId: 'post_unrelated', runId: 'r2' },
      {
        workflowId: 'child',
        runId: 'r3',
        searchAttributes: { organizationId: ['org-1'], postId: ['p2'] },
      },
    ]);

    const result = await service.closeWorkflows(
      'org-1',
      ['int-1'],
      ['p1', 'p2'],
      ['streak_org-1']
    );

    expect(result).toMatchObject({ stopped: true, newlyStopped: true });
    expect(terminated.sort()).toEqual(
      [
        'child',
        'post_p1',
        'post_p1_abc123',
        'post_p2',
        'refresh_int-1',
        'streak_org-1',
      ].sort()
    );
    expect(terminated).not.toContain('post_unrelated');
  });

  it('treats a workflow that does not exist as closed', async () => {
    const notFound = Object.assign(new Error('nf'), {
      name: 'WorkflowNotFoundError',
    });
    const { service, terminated } = makeService([], () => notFound);

    const result = await service.closeWorkflows('org-1', ['int-1'], ['p1']);

    expect(result).toMatchObject({ stopped: true, newlyStopped: false });
    expect(terminated).toEqual([]);
  });

  it('reports pending when a workflow cannot be described', async () => {
    const { service } = makeService([], () => new Error('temporal down'));

    const result = await service.closeWorkflows('org-1', ['int-1'], []);

    expect(result.stopped).toBe(false);
    expect(result.pending).toBe(1);
  });

  it('closes thousands of posts in chunks', async () => {
    const posts = Array.from({ length: 120 }, (_, i) => `p${i}`);
    const { service, terminated } = makeService([]);

    const result = await service.closeWorkflows('org-1', [], posts);

    expect(result.terminated).toBe(120);
    expect(terminated).toHaveLength(120);
  });
});

// Providers without an authorizationPolicy that can revoke their grant (Reddit):
// revoked best effort when the channel is deleted, tokens deleted with it
describe('IntegrationAuthorizationLifecycleService revoke on delete', () => {
  const row = {
    id: 'int-1',
    organizationId: 'org-1',
    providerIdentifier: 'reddit',
    token: 'at',
    refreshToken: 'rt',
    internalId: 'u1',
    rootInternalId: null,
  };

  const make = (provider: any, rows: any[] = [row]) => {
    const repository = {
      getIntegrationForCleanup: jest.fn(async (_org: string, id: string) =>
        rows.find((r) => r.id === id)
      ),
      getAuthorizationIntegrationsForOrganization: jest.fn(async () =>
        rows.map(({ id, providerIdentifier }) => ({ id, providerIdentifier }))
      ),
      deleteChannel: jest.fn(async (_org: string, id: string) => ({ id })),
    };
    const manager = { getSocialIntegration: () => provider };
    const service = new IntegrationAuthorizationLifecycleService(
      repository as any,
      manager as any,
      {} as any
    );
    return { service, repository };
  };

  it('deletes the channel and its tokens first, then revokes the grant', async () => {
    const revokeAuthorization = jest.fn(async () => ({ status: 'revoked' }));
    const { service, repository } = make({ revokeAuthorization });

    await expect(service.requestDeletion('org-1', 'int-1')).resolves.toEqual({
      id: 'int-1',
    });

    expect(repository.deleteChannel).toHaveBeenCalledWith('org-1', 'int-1', true);
    // with the credentials read before the delete cleared them
    expect(revokeAuthorization).toHaveBeenCalledWith({
      accessToken: 'at',
      refreshToken: 'rt',
      internalId: 'u1',
      rootInternalId: null,
    });
    expect(repository.deleteChannel.mock.invocationCallOrder[0]).toBeLessThan(
      revokeAuthorization.mock.invocationCallOrder[0]
    );
  });

  it('never blocks or delays the delete on the revocation', async () => {
    let finish: () => void = () => undefined;
    const revokeAuthorization = jest.fn(
      () =>
        new Promise((_, reject) => {
          finish = () => reject(new Error('reddit down'));
        })
    );
    const { service, repository } = make({ revokeAuthorization });

    // resolves while the revocation is still in flight
    await expect(service.requestDeletion('org-1', 'int-1')).resolves.toEqual({
      id: 'int-1',
    });
    expect(repository.deleteChannel).toHaveBeenCalledWith('org-1', 'int-1', true);
    finish();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('never revokes when the delete itself fails, the channel stays usable', async () => {
    const revokeAuthorization = jest.fn(async () => ({ status: 'revoked' }));
    const { service, repository } = make({ revokeAuthorization });
    repository.deleteChannel.mockRejectedValueOnce(new Error('db down'));

    await expect(service.requestDeletion('org-1', 'int-1')).rejects.toThrow(
      'db down'
    );
    expect(revokeAuthorization).not.toHaveBeenCalled();
  });

  it('keeps the plain delete for providers that cannot revoke', async () => {
    const { service, repository } = make({});

    await service.requestDeletion('org-1', 'int-1');
    expect(repository.deleteChannel).toHaveBeenCalledWith('org-1', 'int-1');
  });

  it('revokes before an account deletion erases the channels, without taking them over', async () => {
    const revokeAuthorization = jest.fn(async () => ({ status: 'revoked' }));
    const { service, repository } = make({ revokeAuthorization }, [
      row,
      // deleted earlier, its tokens are already gone
      { ...row, id: 'int-2', token: '', refreshToken: null },
    ]);

    await expect(service.requestOrganizationDeletion('org-1')).resolves.toEqual(
      []
    );
    expect(revokeAuthorization).toHaveBeenCalledTimes(1);
    expect(repository.deleteChannel).not.toHaveBeenCalled();
  });
});
