import { parseEraseAccountArgs } from './erase-account.args';

describe('parseEraseAccountArgs', () => {
  it('defaults to a dry run without a confirmation', () => {
    expect(parseEraseAccountArgs(['--email', 'a@b.co'])).toMatchObject({
      email: 'a@b.co',
      confirm: undefined,
      orgId: undefined,
      dryRun: false,
      allowSuperAdmin: false,
    });
  });

  it('reads the confirmation, scope and overrides', () => {
    expect(
      parseEraseAccountArgs([
        '--email',
        'a@b.co',
        '--org',
        'org-1',
        '--confirm',
        'org-1',
        '--allow-superadmin',
        '--allow-ownerless-orgs',
        '--skip-provider-revocation',
        '--receipt-dir',
        '/tmp/r',
      ])
    ).toEqual({
      email: 'a@b.co',
      orgId: 'org-1',
      confirm: 'org-1',
      dryRun: false,
      allowSuperAdmin: true,
      allowOwnerlessOrgs: true,
      skipProviderRevocation: true,
      receiptDir: '/tmp/r',
    });
  });

  it('requires an email', () => {
    expect(() => parseEraseAccountArgs([])).toThrow('--email is required');
  });

  it('rejects unknown flags and positionals', () => {
    expect(() =>
      parseEraseAccountArgs(['--email', 'a@b.co', '--force'])
    ).toThrow();
    expect(() => parseEraseAccountArgs(['--email', 'a@b.co', 'x'])).toThrow();
  });

  it('answers --help without an email', () => {
    expect(parseEraseAccountArgs(['--help']).help).toBe(true);
  });
});
