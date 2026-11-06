import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Encrypts the social access/refresh tokens stored in Integration.token and
// Integration.refreshToken.
//
// AES-256-GCM, a random 12 byte IV per value and a dedicated key from
// TOKEN_ENCRYPTION_KEY (32 bytes, base64). The key is never derived from
// JWT_SECRET. Stored format: enc:v1:<iv>:<tag>:<ciphertext> (base64url).
//
// - Values without the prefix are legacy plaintext and are read as they are,
//   so rows written before the key was set keep working until backfilled.
// - Without a key nothing is encrypted (self-hosted default); a prefixed value
//   that cannot be decrypted always throws, it never returns garbage.
// - TOKEN_ENCRYPTION_KEY_PREVIOUS (optional, comma separated) lists retired
//   keys that are still accepted for reading while a rotation is running.
export const TOKEN_ENCRYPTION_PREFIX = 'enc:v1:';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
// Binds the ciphertext to its purpose so it cannot be replayed elsewhere.
const AAD = Buffer.from('postdelegate:integration-token:v1');

export class TokenEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenEncryptionError';
  }
}

type Keys = { current?: Buffer; previous: Buffer[] };

const parseKey = (value: string, name: string): Buffer => {
  const key = Buffer.from(value.trim(), 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new TokenEncryptionError(
      `${name} must be ${KEY_LENGTH} bytes encoded as base64 (generate one with: openssl rand -base64 32)`
    );
  }
  return key;
};

let cache: { current?: string; previous?: string; keys: Keys } | undefined;
let warned = false;

const loadKeys = (): Keys => {
  const current = process.env.TOKEN_ENCRYPTION_KEY?.trim() || undefined;
  const previous = process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS?.trim() || undefined;
  if (cache && cache.current === current && cache.previous === previous) {
    return cache.keys;
  }
  const keys: Keys = {
    current: current ? parseKey(current, 'TOKEN_ENCRYPTION_KEY') : undefined,
    previous: previous
      ? previous
          .split(',')
          .filter((part) => part.trim())
          .map((part) => parseKey(part, 'TOKEN_ENCRYPTION_KEY_PREVIOUS'))
      : [],
  };
  cache = { current, previous, keys };
  return keys;
};

const decryptWith = (key: Buffer, iv: Buffer, tag: Buffer, data: Buffer) => {
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8'
  );
};

export const TokenEncryption = {
  // Throws when a configured key is malformed, so a typo fails at startup
  // instead of silently storing plaintext.
  isEnabled(): boolean {
    return !!loadKeys().current;
  },

  isEncrypted(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(TOKEN_ENCRYPTION_PREFIX);
  },

  // Plaintext that still has to be encrypted (a key is set, the value is not
  // empty and not already encrypted). Used by the backfill.
  needsEncryption(value: string | null | undefined): boolean {
    return (
      !!value && !TokenEncryption.isEncrypted(value) && TokenEncryption.isEnabled()
    );
  },

  // Encrypted with a retired key, to be re-encrypted by a rotation backfill.
  needsReencryption(value: string | null | undefined): boolean {
    if (!TokenEncryption.isEncrypted(value) || !TokenEncryption.isEnabled()) {
      return false;
    }
    return TokenEncryption.decryptWithInfo(value).usedCurrentKey === false;
  },

  // Empty values (the erased sentinel), null and already encrypted values are
  // returned untouched, so encrypting twice is harmless.
  encrypt<T extends string | null | undefined>(value: T): T {
    if (!value || TokenEncryption.isEncrypted(value)) {
      return value;
    }
    const { current } = loadKeys();
    if (!current) {
      return value;
    }
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, current, iv, {
      authTagLength: TAG_LENGTH,
    });
    cipher.setAAD(AAD);
    const data = Buffer.concat([cipher.update(value as string, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${TOKEN_ENCRYPTION_PREFIX}${iv.toString('base64url')}:${tag.toString(
      'base64url'
    )}:${data.toString('base64url')}` as T;
  },

  decryptWithInfo(value: string): { value: string; usedCurrentKey: boolean } {
    if (!TokenEncryption.isEncrypted(value)) {
      return { value, usedCurrentKey: true };
    }
    const keys = loadKeys();
    const candidates = [keys.current, ...keys.previous].filter(
      (key): key is Buffer => !!key
    );
    if (!candidates.length) {
      throw new TokenEncryptionError(
        'A stored token is encrypted but TOKEN_ENCRYPTION_KEY is not set'
      );
    }
    const parts = value.slice(TOKEN_ENCRYPTION_PREFIX.length).split(':');
    if (parts.length !== 3) {
      throw new TokenEncryptionError('A stored token has a malformed encrypted value');
    }
    const [iv, tag, data] = parts.map((part) => Buffer.from(part, 'base64url'));
    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
      throw new TokenEncryptionError('A stored token has a malformed encrypted value');
    }
    for (const key of candidates) {
      try {
        return { value: decryptWith(key, iv, tag, data), usedCurrentKey: key === keys.current };
      } catch {
        // wrong key or tampered value: try the next retired key
      }
    }
    throw new TokenEncryptionError(
      'A stored token could not be decrypted: it was tampered with or TOKEN_ENCRYPTION_KEY is not the key it was encrypted with'
    );
  },

  // Legacy plaintext (no prefix), null and '' are returned as they are.
  decrypt<T extends string | null | undefined>(value: T): T {
    if (!TokenEncryption.isEncrypted(value)) {
      return value;
    }
    return TokenEncryption.decryptWithInfo(value).value as T;
  },

  // Logs one warning per process when tokens are stored in plaintext. Throws
  // when TOKEN_ENCRYPTION_KEY is set but invalid.
  warnIfDisabled(log: (message: string) => void = console.warn) {
    if (TokenEncryption.isEnabled() || warned) {
      return;
    }
    warned = true;
    log(
      'TOKEN_ENCRYPTION_KEY is not set: social access and refresh tokens are stored in plaintext. Generate one with "openssl rand -base64 32".'
    );
  },

  // test hook
  reset() {
    cache = undefined;
    warned = false;
  },
};

type Credentials = { token?: string | null; refreshToken?: string | null };

// Returns a copy of the data with the credential fields encrypted. Fields that
// are absent stay absent.
export const encryptCredentials = <T extends Credentials>(data: T): T => {
  const copy = { ...data };
  if ('token' in copy) copy.token = TokenEncryption.encrypt(copy.token);
  if ('refreshToken' in copy) {
    copy.refreshToken = TokenEncryption.encrypt(copy.refreshToken);
  }
  return copy;
};

// Returns a copy of the row with the credential fields decrypted. Throws a
// TokenEncryptionError when one of them cannot be decrypted.
export const decryptCredentials = <T extends Credentials>(row: T): T => {
  if (!row) return row;
  const copy = { ...row };
  if ('token' in copy) copy.token = TokenEncryption.decrypt(copy.token);
  if ('refreshToken' in copy) {
    copy.refreshToken = TokenEncryption.decrypt(copy.refreshToken);
  }
  return copy;
};

// A post that was loaded together with its integration row (include: {
// integration: true }): the integration's credentials are decrypted, the
// rest of the post is returned as it is.
export const decryptIntegrationOf = <
  T extends { integration?: Credentials | null }
>(
  post: T
): T =>
  post && post.integration
    ? { ...post, integration: decryptCredentials(post.integration) }
    : post;
