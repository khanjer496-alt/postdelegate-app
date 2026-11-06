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
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

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
      countLiveChannelsOnGrant: jest.fn(async () => 0),
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

// Providers sharing an authorizationGrantGroup (one Google project): the
// deleted channel's tokens always go, the grant is revoked only once no other
// live channel of the group uses that account
const GROUP = 'google-project:123';

const settle = () => new Promise((resolve) => setImmediate(resolve));

const groupManager = (providers: Record<string, any>) => ({
  getSocialIntegration: (id: string) => providers[id],
  getAuthorizationGrantGroup: (group: string) =>
    Object.entries(providers)
      .filter(([, p]) => p.authorizationGrantGroup === group)
      .map(([identifier, p]) => ({ identifier, ...p })),
});

describe('IntegrationAuthorizationLifecycleService revoke on delete, shared grant', () => {
  const row = {
    id: 'int-1',
    organizationId: 'org-1',
    providerIdentifier: 'gmb',
    token: 'at',
    refreshToken: 'rt',
    internalId: 'accounts/1/locations/1',
    rootInternalId: 'google-sub',
  };

  const make = (liveOnGrant: number, rows: any[] = [row]) => {
    const revokeAuthorization = jest.fn(async () => ({ status: 'revoked' }));
    const repository = {
      getIntegrationForCleanup: jest.fn(async (_org: string, id: string) =>
        rows.find((r) => r.id === id)
      ),
      getAuthorizationIntegrationsForOrganization: jest.fn(async () =>
        rows.map(({ id, providerIdentifier }) => ({ id, providerIdentifier }))
      ),
      deleteChannel: jest.fn(async (_org: string, id: string) => ({ id })),
      countLiveChannelsOnGrant: jest.fn(async () => liveOnGrant),
    };
    const manager = groupManager({
      gmb: { authorizationGrantGroup: GROUP, revokeAuthorization },
      youtube: { authorizationGrantGroup: GROUP, authorizationPolicy: {} },
      reddit: {},
    });
    const service = new IntegrationAuthorizationLifecycleService(
      repository as any,
      manager as any,
      {} as any
    );
    return { service, repository, revokeAuthorization };
  };

  it('revokes the grant when the last channel of the account is deleted', async () => {
    const { service, repository, revokeAuthorization } = make(0);

    await expect(service.requestDeletion('org-1', 'int-1')).resolves.toEqual({
      id: 'int-1',
    });
    await settle();

    expect(repository.deleteChannel).toHaveBeenCalledWith('org-1', 'int-1', true);
    // every provider of the group counts, managed ones included
    expect(repository.countLiveChannelsOnGrant).toHaveBeenCalledWith(
      'google-sub',
      ['gmb', 'youtube'],
      ['int-1']
    );
    expect(revokeAuthorization).toHaveBeenCalledWith({
      accessToken: 'at',
      refreshToken: 'rt',
      internalId: 'accounts/1/locations/1',
      rootInternalId: 'google-sub',
    });
  });

  it('deletes the tokens but keeps the grant while another channel or a pending location choice uses the account', async () => {
    const { service, repository, revokeAuthorization } = make(1);

    await service.requestDeletion('org-1', 'int-1');
    await settle();

    expect(repository.deleteChannel).toHaveBeenCalledWith('org-1', 'int-1', true);
    expect(revokeAuthorization).not.toHaveBeenCalled();
  });

  it('never revokes a grant it cannot tie to an account', async () => {
    const { service, repository, revokeAuthorization } = make(0, [
      { ...row, rootInternalId: null },
    ]);

    await service.requestDeletion('org-1', 'int-1');
    await settle();

    expect(repository.deleteChannel).toHaveBeenCalledWith('org-1', 'int-1', true);
    expect(repository.countLiveChannelsOnGrant).not.toHaveBeenCalled();
    expect(revokeAuthorization).not.toHaveBeenCalled();
  });

  it('logs a failed revocation without credentials and still deletes', async () => {
    const { service, repository, revokeAuthorization } = make(0);
    revokeAuthorization.mockRejectedValueOnce(new Error('token=rt'));
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(service.requestDeletion('org-1', 'int-1')).resolves.toEqual({
      id: 'int-1',
    });
    await settle();

    expect(repository.deleteChannel).toHaveBeenCalledWith('org-1', 'int-1', true);
    expect(log).toHaveBeenCalledWith('Integration int-1: gmb revocation failed');
    expect(JSON.stringify(log.mock.calls)).not.toContain('rt');
    log.mockRestore();
  });

  it('does not count the channels an account deletion removes together', async () => {
    const { service, repository, revokeAuthorization } = make(0, [
      row,
      { ...row, id: 'int-2', internalId: 'accounts/1/locations/2' },
    ]);

    await service.requestOrganizationDeletion('org-1');

    expect(repository.countLiveChannelsOnGrant).toHaveBeenCalledWith(
      'google-sub',
      ['gmb', 'youtube'],
      ['int-1', 'int-2']
    );
    expect(revokeAuthorization).toHaveBeenCalled();
    expect(repository.deleteChannel).not.toHaveBeenCalled();
  });
});

// The managed lifecycle (YouTube) removes its own verified siblings with the
// grant; a live channel of the group outside it (Business Profile) keeps it
describe('IntegrationAuthorizationLifecycleService.processDeletion, shared grant', () => {
  const realFlag = process.env.INTEGRATION_AUTHORIZATION_LIFECYCLE_ENABLED;
  beforeEach(() => {
    process.env.INTEGRATION_AUTHORIZATION_LIFECYCLE_ENABLED = 'true';
    (ioRedis as any).scan = jest.fn(async () => ['0', []]);
  });
  afterEach(() => {
    if (realFlag === undefined) delete process.env.INTEGRATION_AUTHORIZATION_LIFECYCLE_ENABLED;
    else process.env.INTEGRATION_AUTHORIZATION_LIFECYCLE_ENABLED = realFlag;
  });

  const make = (liveOnGrant: number) => {
    const youtube = {
      authorizationGrantGroup: GROUP,
      authorizationPolicy: { authorizationRealm: GROUP },
      revokeAuthorization: jest.fn(async () => ({ status: 'revoked' })),
      getAuthorizationGrant: jest.fn(async () => undefined),
    };
    const repository = {
      getIntegrationForCleanup: jest.fn(async () => ({
        id: 'yt-1',
        organizationId: 'org-1',
        providerIdentifier: 'youtube',
        token: 'at',
        refreshToken: 'rt',
        internalId: 'channel-1',
        rootInternalId: 'google-sub',
        picture: null,
        deletedAt: new Date(),
        disabled: true,
        refreshNeeded: true,
      })),
      getAuthorizationPostIds: jest.fn(async () => []),
      countLiveChannelsOnGrant: jest.fn(async () => liveOnGrant),
      purgeAuthorizationNotifications: jest.fn(async () => ({ unattributed: 0 })),
      scrubAuthorizationData: jest.fn(async () => undefined),
    };
    const notFound = Object.assign(new Error('nf'), { name: 'WorkflowNotFoundError' });
    const workflow = {
      list: () => (async function* () { /* nothing running */ })(),
      getHandle: () => ({ describe: async () => { throw notFound; } }),
    };
    const service = new IntegrationAuthorizationLifecycleService(
      repository as any,
      groupManager({
        youtube,
        gmb: { authorizationGrantGroup: GROUP, revokeAuthorization: jest.fn() },
      }) as any,
      { client: { getRawClient: () => ({ workflow }) } } as any
    );
    return { service, repository, youtube };
  };

  it('keeps the grant while a Business Profile channel of the account is alive, and still removes the YouTube data', async () => {
    const { service, repository, youtube } = make(1);

    await service.processDeletion('org-1', 'yt-1');

    // only providers outside the managed lifecycle count
    expect(repository.countLiveChannelsOnGrant).toHaveBeenCalledWith(
      'google-sub',
      ['gmb'],
      ['yt-1']
    );
    expect(youtube.revokeAuthorization).not.toHaveBeenCalled();
    expect(youtube.getAuthorizationGrant).not.toHaveBeenCalled();
    expect(repository.scrubAuthorizationData).toHaveBeenCalledWith('org-1', 'yt-1');
  });

  it('revokes as before when no other channel of the group uses the account', async () => {
    const { service, repository, youtube } = make(0);

    await service.processDeletion('org-1', 'yt-1');

    expect(youtube.revokeAuthorization).toHaveBeenCalled();
    expect(repository.scrubAuthorizationData).toHaveBeenCalledWith('org-1', 'yt-1');
  });
});
