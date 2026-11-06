// ships ESM only, which jest does not transform; not under test
jest.mock('@gitroom/nestjs-libraries/integrations/social/nostr.provider', () => ({
  NostrProvider: class {
    identifier = 'nostr';
    name = 'Nostr';
  },
}));

import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';

describe('IntegrationManager hidden providers', () => {
  const env = { ...process.env };
  const manager = new IntegrationManager();
  const listed = async (orgId?: string) =>
    (await manager.getAllIntegrations(orgId)).social.map((p) => p.identifier);

  beforeEach(() => {
    process.env.HIDDEN_PROVIDERS = 'x, pinterest';
    process.env.PREVIEW_PROVIDER_ORGS = 'org-qa, org-demo';
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('hides a hidden provider from every workspace that is not allowlisted', () => {
    expect(manager.isHiddenFor('x', 'org-1')).toBe(true);
    expect(manager.isHiddenFor('pinterest', undefined)).toBe(true);
    expect(manager.isHiddenFor('bluesky', 'org-1')).toBe(false);
  });

  it('shows hidden providers to the allowlisted workspaces', () => {
    expect(manager.isHiddenFor('x', 'org-qa')).toBe(false);
    expect(manager.isHiddenFor('pinterest', 'org-demo')).toBe(false);
  });

  it('reads HIDDEN_PROVIDERS case-insensitively and org ids exactly', () => {
    process.env.HIDDEN_PROVIDERS = ' X , Pinterest ';
    process.env.PREVIEW_PROVIDER_ORGS = ' org-qa ,org-demo';
    expect(manager.isHiddenFor('x', 'org-1')).toBe(true);
    expect(manager.isHiddenFor('pinterest', 'org-1')).toBe(true);
    expect(manager.isHiddenFor('x', 'org-qa')).toBe(false);
    expect(manager.isHiddenFor('x', 'ORG-QA')).toBe(true);
  });

  it('allowlists nobody when PREVIEW_PROVIDER_ORGS is unset or empty', () => {
    delete process.env.PREVIEW_PROVIDER_ORGS;
    expect(manager.isHiddenFor('x', 'org-qa')).toBe(true);

    process.env.PREVIEW_PROVIDER_ORGS = '';
    expect(manager.isHiddenFor('x', '')).toBe(true);
  });

  it('lists hidden providers only for an allowlisted workspace', async () => {
    for (const orgId of [undefined, 'org-1']) {
      const list = await listed(orgId);
      expect(list).not.toContain('x');
      expect(list).not.toContain('pinterest');
      expect(list).toContain('bluesky');
    }

    const preview = await listed('org-qa');
    expect(preview).toContain('x');
    expect(preview).toContain('pinterest');
    expect(preview).toContain('bluesky');
  });
});
