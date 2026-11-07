import {
  readLegacySecret,
  writeSecret,
} from '@gitroom/nestjs-libraries/database/prisma/secrets/secret.crypto';

// Integration.customInstanceDetails holds a live credential to someone's
// account on an instance we do not run: a Bluesky app password, a Lemmy,
// Listmonk or custom Mastodon login, Skool credentials, or a browser
// extension's cookie jar. Sometimes raw, sometimes JSON - this module does not
// care which, and never parses it; callers keep doing that.
//
// It lives in its own module so a provider can read the column without
// importing the Prisma repository.
export const CUSTOM_INSTANCE_DETAILS_LABEL = 'custom-instance-details';

export const writeCustomInstanceDetails = <T extends string | null | undefined>(
  value: T
): T => writeSecret(value, CUSTOM_INSTANCE_DETAILS_LABEL);

// null for an unset column and for the '' an erased channel leaves behind, so
// no caller needs a special case for either.
export const readCustomInstanceDetails = (
  value: string | null | undefined
): string | null => readLegacySecret(value, CUSTOM_INSTANCE_DETAILS_LABEL);
