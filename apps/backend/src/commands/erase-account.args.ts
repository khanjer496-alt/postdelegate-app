import { parseArgs } from 'util';
import { ErasureOptions } from '@gitroom/nestjs-libraries/database/prisma/erasure/erasure.service';

export const ERASE_ACCOUNT_USAGE = `Usage: erase-account --email <email> [--org <organization id>] [options]

Permanently erases a person's PostDelegate data on a verified request.
Dry run is the default: nothing is written without --confirm.

  --email <email>          account email (all accounts with it, also ones removed from the app)
  --org <id>               limit to one organization of that person; the user rows are kept
  --dry-run                print the per-table plan only (default)
  --confirm <value>        run for real; must repeat the --email, or the --org id when --org is used
  --allow-superadmin       allow erasing a platform super admin
  --allow-ownerless-orgs   allow leaving a shared workspace without an owner
  --skip-provider-revocation
                           erase channel credentials without revoking provider authorization
  --receipt-dir <dir>      where the JSON receipt is written (default /config/erasure-receipts)
  --help
`;

// Throws on unknown or malformed flags; the caller prints the message and the usage
export const parseEraseAccountArgs = (
  argv: string[]
): ErasureOptions & { help?: boolean } => {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      email: { type: 'string' },
      org: { type: 'string' },
      confirm: { type: 'string' },
      'dry-run': { type: 'boolean' },
      'allow-superadmin': { type: 'boolean' },
      'allow-ownerless-orgs': { type: 'boolean' },
      'skip-provider-revocation': { type: 'boolean' },
      'receipt-dir': { type: 'string' },
      help: { type: 'boolean' },
    },
  });

  if (values.help) {
    return { email: '', help: true };
  }
  if (!values.email) {
    throw new Error('--email is required');
  }

  return {
    email: values.email,
    orgId: values.org,
    confirm: values.confirm,
    dryRun: !!values['dry-run'],
    allowSuperAdmin: !!values['allow-superadmin'],
    allowOwnerlessOrgs: !!values['allow-ownerless-orgs'],
    skipProviderRevocation: !!values['skip-provider-revocation'],
    receiptDir: values['receipt-dir'],
  };
};
