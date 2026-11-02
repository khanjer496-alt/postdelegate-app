import { ErasureRepository } from './erasure.repository';

interface Call {
  model: string;
  op: string;
  args: any;
}

const makeDb = (results: Record<string, any> = {}) => {
  const calls: Call[] = [];
  const db: any = new Proxy(
    {},
    {
      get: (_target, model: string) =>
        new Proxy(
          {},
          {
            get: (_t, op: string) => async (args: any) => {
              calls.push({ model, op, args });
              const configured = results[`${model}.${op}`];
              const value =
                typeof configured === 'function'
                  ? configured(args)
                  : configured;
              if (value !== undefined) return value;
              if (op === 'deleteMany' || op === 'updateMany') {
                return { count: 1 };
              }
              if (op === 'findMany') return [];
              return op === 'count' ? 1 : null;
            },
          }
        ),
    }
  );
  const repo = new ErasureRepository(
    { model: db } as any,
    {
      model: { $transaction: (fn: (tx: any) => any) => fn(db) },
    } as any
  );
  return { repo, db, calls };
};

const writes = (calls: Call[]) =>
  calls.filter((call) =>
    ['deleteMany', 'updateMany', 'delete', 'update', 'create'].includes(call.op)
  );

describe('ErasureRepository.eraseOrganization', () => {
  it('deletes children before parents and the organization row last', async () => {
    const { repo, calls } = makeDb();

    const tables = await repo.eraseOrganization('org-1');

    const order = writes(calls)
      .filter((call) => call.op === 'deleteMany')
      .map((call) => call.model);
    const at = (model: string) => order.indexOf(model);

    expect(order[order.length - 1]).toBe('organization');
    expect(at('comments')).toBeLessThan(at('post'));
    expect(at('errors')).toBeLessThan(at('post'));
    expect(at('tagsPosts')).toBeLessThan(at('tags'));
    expect(at('post')).toBeLessThan(at('integration'));
    expect(at('plugs')).toBeLessThan(at('integration'));
    expect(at('integrationsWebhooks')).toBeLessThan(at('webhooks'));
    expect(at('integration')).toBeLessThan(at('customer'));
    expect(at('aiCredential')).toBeGreaterThan(-1);
    expect(at('aiCredential')).toBeLessThan(at('organization'));
    expect(tables.AiCredential).toBe(1);
    expect(at('orderItems')).toBeLessThan(at('orders'));
    expect(at('orders')).toBeLessThan(at('messagesGroup'));
    expect(at('clippingClip')).toBeLessThan(at('clipping'));
    expect(at('studioRender')).toBeLessThan(at('studioProject'));
    expect(at('studioAsset')).toBeGreaterThan(-1);
    expect(at('studioAsset')).toBeLessThan(at('studioProject'));
    expect(at('studioProject')).toBeLessThan(at('organization'));
    expect(at('oAuthSelfHostedAuthorization')).toBeLessThan(at('oAuthApp'));
    expect(at('oAuthApp')).toBeLessThan(at('media'));
    expect(at('subscription')).toBeLessThan(at('organization'));
    expect(at('userOrganization')).toBeLessThan(at('organization'));
    expect(tables.Integration).toBe(1);
    expect(tables.Organization).toBe(1);
  });

  it('detaches rows that must survive before the media and posts go', async () => {
    const { repo, calls } = makeDb();

    await repo.eraseOrganization('org-1');

    const ops = writes(calls).map((call) => `${call.op}:${call.model}`);
    expect(ops.indexOf('updateMany:post')).toBeLessThan(
      ops.indexOf('deleteMany:post')
    );
    expect(ops.indexOf('updateMany:user')).toBeLessThan(
      ops.indexOf('deleteMany:media')
    );
    expect(ops.indexOf('updateMany:socialMediaAgency')).toBeLessThan(
      ops.indexOf('deleteMany:media')
    );
  });

  it('scopes every statement to the organization', async () => {
    const { repo, calls } = makeDb();

    await repo.eraseOrganization('org-1');

    for (const call of writes(calls)) {
      expect(JSON.stringify(call.args.where)).toContain('org-1');
    }
  });

  it('never touches the affiliate ledger', async () => {
    const { repo, calls } = makeDb();

    await repo.eraseOrganization('org-1');

    expect(calls.some((call) => call.model === 'affiliateCommission')).toBe(
      false
    );
  });
});

describe('ErasureRepository planning', () => {
  it('only counts, so a dry run writes nothing', async () => {
    const { repo, calls } = makeDb();

    const plan = await repo.planOrganization('org-1');
    await repo.planUser('user-1', ['org-1']);
    await repo.planSharedOrganizationLeave('user-1', 'org-2');
    await repo.runOrganizationAiMemory('org-1', false);

    expect(plan.Post).toBe(1);
    expect(writes(calls)).toEqual([]);
  });

  it('counts the same tables that a real run erases', async () => {
    const dry = makeDb();
    const real = makeDb();

    const planned = await dry.repo.planOrganization('org-1');
    const erased = await real.repo.eraseOrganization('org-1');

    expect(Object.keys(planned)).toEqual(Object.keys(erased));
  });
});

describe('ErasureRepository.eraseUser', () => {
  const user = { id: 'user-1', pictureId: null, agencies: null };

  it('hard-deletes a person without commissions, with their affiliate profile', async () => {
    const { repo, calls } = makeDb({
      'user.findUnique': user,
      'affiliateProfile.findUnique': {
        id: 'aff-1',
        _count: { commissions: 0 },
      },
    });

    const outcome = await repo.eraseUser('user-1');

    expect(outcome.affiliate).toBe('deleted');
    expect(outcome.tombstone).toBe(false);
    expect(
      calls.some((c) => c.model === 'affiliateProfile' && c.op === 'delete')
    ).toBe(true);
    expect(calls.some((c) => c.model === 'user' && c.op === 'delete')).toBe(
      true
    );
    expect(
      calls.some((c) => c.model === 'review' && c.op === 'deleteMany')
    ).toBe(true);
    expect(
      calls.some((c) => c.model === 'reviewPrompt' && c.op === 'deleteMany')
    ).toBe(true);
    // organizations that pointed at the deleted profile lose the link
    const detach = calls.find(
      (c) => c.model === 'organization' && c.op === 'updateMany'
    );
    expect(detach?.args.data).toEqual({
      referredByAffiliateId: null,
      referralCode: null,
    });
  });

  it('keeps the ledger and anonymises the person when commissions exist', async () => {
    const { repo, calls } = makeDb({
      'user.findUnique': user,
      'affiliateProfile.findUnique': {
        id: 'aff-1',
        _count: { commissions: 3 },
      },
    });

    const outcome = await repo.eraseUser('user-1');

    expect(outcome.affiliate).toBe('kept-anonymised');
    expect(outcome.tombstone).toBe(true);
    // the profile row survives with the payout email and vanity code stripped
    const profileUpdate = calls.find(
      (c) => c.model === 'affiliateProfile' && c.op === 'update'
    );
    expect(profileUpdate?.args.data).toEqual({
      payoutEmail: null,
      code: 'erased-aff-1',
      customCodeSet: false,
    });
    expect(
      calls.some((c) => c.model === 'affiliateProfile' && c.op === 'delete')
    ).toBe(false);
    // the user row stays only as a tombstone without personal data
    expect(calls.some((c) => c.model === 'user' && c.op === 'delete')).toBe(
      false
    );
    const tombstone = calls.find(
      (c) => c.model === 'user' && c.op === 'update' && c.args.data.email
    );
    expect(tombstone?.args.data).toMatchObject({
      email: 'erased_user-1',
      password: null,
      name: null,
      lastName: null,
      providerId: null,
      ip: null,
      isSuperAdmin: false,
    });
    expect(calls.some((c) => c.model === 'affiliateCommission')).toBe(false);
  });

  it('deletes an avatar uploaded into a shared workspace unless it is in use', async () => {
    const media = {
      id: 'm1',
      name: 'a.png',
      path: 'https://media/a.png',
      thumbnail: null,
    };
    const unused = makeDb({
      'user.findUnique': { ...user, pictureId: 'm1' },
      'media.findUnique': media,
      'post.count': 0,
      'user.count': 0,
      'oAuthApp.count': 0,
      'socialMediaAgency.count': 0,
    });
    const used = makeDb({
      'user.findUnique': { ...user, pictureId: 'm1' },
      'media.findUnique': media,
      'post.count': 1,
    });

    const first = await unused.repo.eraseUser('user-1');
    const second = await used.repo.eraseUser('user-1');

    expect(first.objectSources).toEqual(['https://media/a.png']);
    expect(second.objectSources).toEqual([]);
    expect(
      used.calls.some((c) => c.model === 'media' && c.op === 'delete')
    ).toBe(false);
  });

  it('does nothing for a person that no longer exists', async () => {
    const { repo, calls } = makeDb({ 'user.findUnique': null });

    const outcome = await repo.eraseUser('gone');

    expect(outcome.tables).toEqual({});
    expect(writes(calls)).toEqual([]);
  });
});

describe('ErasureRepository.runOrganizationAiMemory', () => {
  it('tolerates a missing framework table', async () => {
    const { repo } = makeDb({
      'mastra_threads.findMany': () => {
        throw Object.assign(new Error('missing'), { code: 'P2021' });
      },
      'mastra_messages.deleteMany': () => {
        throw Object.assign(new Error('missing'), { code: 'P2021' });
      },
    });

    const result = await repo.runOrganizationAiMemory('org-1', true);

    expect(result.mastra_messages).toBeNull();
    expect(result.mastra_resources).toBe(1);
  });
});

describe('ErasureRepository.getOrganizationObjectSources', () => {
  it('lists every Studio asset, music and the voices and stills of AI', async () => {
    const { repo, calls } = makeDb({
      'studioAsset.findMany': [
        { id: 'a-1', path: 'https://media.example/music.mp3' },
        { id: 'a-2', path: 'https://media.example/voice.mp3' },
        { id: 'a-3', path: 'https://media.example/still.jpg' },
      ],
    });
    const sources = await repo.getOrganizationObjectSources('org-1');
    expect(sources).toEqual(
      expect.arrayContaining([
        'https://media.example/voice.mp3',
        'https://media.example/still.jpg',
      ])
    );
    const call = calls.find(
      (p) => p.model === 'studioAsset' && p.op === 'findMany'
    );
    // every kind of the workspace, not only music
    expect(call?.args.where).toEqual({ organizationId: 'org-1' });
  });
});
