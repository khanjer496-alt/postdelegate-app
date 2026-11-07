import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

// The store for every credential that used to go through
// AuthService.fixedEncryption (AES-256-CBC with a fixed key *and* IV derived
// from JWT_SECRET: reversible, deterministic, unauthenticated).
//
// Two primitives, because the credentials split into two kinds:
//
// - hash() for a secret that is only ever matched - an org API key, an OAuth
//   access or refresh token, an authorization code, a client secret. HMAC-SHA256,
//   so a database read yields nothing usable. Deterministic on purpose: the
//   lookup is a single indexed equality.
// - encrypt()/decrypt() for a secret that has to be read back and replayed to
//   someone else - a customer's own AI key, a custom instance credential.
//   AES-256-GCM, a random 12 byte IV per value, same shape as
//   token.encryption.ts.
//
// Both take a `label` naming the field, folded into the HMAC input and into the
// AAD, so a value cannot be lifted from one column into another.
//
// Both keys are derived from TOKEN_ENCRYPTION_KEY by HKDF-SHA256 with distinct
// info strings. Nothing here derives from JWT_SECRET, and no new environment
// variable is needed: a missing one would be an authentication outage, since
// these lookups sit on the login path.
//
// TOKEN_ENCRYPTION_KEY_PREVIOUS (optional, comma separated) lists retired keys.
// decrypt() accepts them; hashCandidates() returns a hash per key so a lookup
// still finds rows written before a rotation.
export const SECRET_HASH_PREFIX = 'h1:';
export const SECRET_ENCRYPTION_PREFIX = 'enc:v1:';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const HMAC_INFO = 'postdelegate:secret-hmac:v1';
const AEAD_INFO = 'postdelegate:secret-aead:v1';
const AAD_PREFIX = 'postdelegate:secret:v1:';

export class SecretCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretCryptoError';
  }
}

type DerivedKey = { hmac: Buffer; aead: Buffer };
type Keys = { current?: DerivedKey; previous: DerivedKey[] };

const derive = (value: string, name: string): DerivedKey => {
  const material = Buffer.from(value.trim(), 'base64');
  if (material.length !== KEY_LENGTH) {
    throw new SecretCryptoError(
      `${name} must be ${KEY_LENGTH} bytes encoded as base64 (generate one with: openssl rand -base64 32)`
    );
  }
  const subkey = (info: string) =>
    Buffer.from(hkdfSync('sha256', material, Buffer.alloc(0), info, KEY_LENGTH));
  return { hmac: subkey(HMAC_INFO), aead: subkey(AEAD_INFO) };
};

let cache: { current?: string; previous?: string; keys: Keys } | undefined;

const loadKeys = (): Keys => {
  const current = process.env.TOKEN_ENCRYPTION_KEY?.trim() || undefined;
  const previous = process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS?.trim() || undefined;
  if (cache && cache.current === current && cache.previous === previous) {
    return cache.keys;
  }
  const keys: Keys = {
    current: current ? derive(current, 'TOKEN_ENCRYPTION_KEY') : undefined,
    previous: previous
      ? previous
          .split(',')
          .filter((part) => part.trim())
          .map((part) => derive(part, 'TOKEN_ENCRYPTION_KEY_PREVIOUS'))
      : [],
  };
  cache = { current, previous, keys };
  return keys;
};

const requireCurrent = (): DerivedKey => {
  const { current } = loadKeys();
  if (!current) {
    throw new SecretCryptoError(
      'TOKEN_ENCRYPTION_KEY is not set, so this secret cannot be hashed'
    );
  }
  return current;
};

const hashWith = (key: Buffer, value: string, label: string) =>
  SECRET_HASH_PREFIX +
  createHmac('sha256', key)
    .update(`${label}:${value}`)
    .digest('base64url');

const aad = (label: string) => Buffer.from(AAD_PREFIX + label);

const decryptWith = (
  key: Buffer,
  iv: Buffer,
  tag: Buffer,
  data: Buffer,
  label: string
) => {
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAAD(aad(label));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8'
  );
};

// Whether this module can authenticate the value as its own ciphertext for
// this field. Used to decide "already encrypted", which a prefix alone cannot.
const canRead = (value: string, label: string) => {
  try {
    SecretCrypto.decrypt(value, label);
    return true;
  } catch {
    return false;
  }
};

export const SecretCrypto = {
  isEnabled(): boolean {
    return !!loadKeys().current;
  },

  isHashed(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(SECRET_HASH_PREFIX);
  },

  isEncrypted(value: unknown): value is string {
    return (
      typeof value === 'string' && value.startsWith(SECRET_ENCRYPTION_PREFIX)
    );
  },

  // Always hashes what it is given, even a value that already looks like a
  // hash. It must not short-circuit: a caller that hashes a presented
  // credential and compares it with the stored hash would otherwise accept the
  // stored hash itself as the credential. Idempotence belongs to the callers
  // that need it, which guard with isHashed.
  hash(value: string, label: string): string {
    return hashWith(requireCurrent().hmac, value, label);
  },

  // Every hash this value could be stored under: the current key first, then
  // each retired one. Empty when no key is configured, which lets a caller tell
  // "no key" from "no match" instead of querying for nothing.
  hashCandidates(value: string, label: string): string[] {
    const keys = loadKeys();
    if (!keys.current) {
      return [];
    }
    return [keys.current, ...keys.previous].map((key) =>
      hashWith(key.hmac, value, label)
    );
  },

  // Constant-time comparison of two hashes, for the paths that compare a
  // presented secret against a stored one rather than querying for it.
  hashEquals(a: string | null | undefined, b: string | null | undefined) {
    if (!a || !b || a.length !== b.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  },

  // null, undefined and '' (the erased sentinel) are returned untouched, as is
  // a value this module can already read back under this label, so encrypting
  // twice is harmless. A value that merely carries the prefix is NOT trusted:
  // the Chrome extension posts arbitrary bytes into one of these columns, and
  // a ciphertext belonging to another field is not this field's. Both get
  // encrypted rather than stored as they are. Without a key nothing is
  // encrypted, which is the self-hosted default, matching token.encryption.ts.
  encrypt<T extends string | null | undefined>(value: T, label: string): T {
    if (!value) {
      return value;
    }
    const { current } = loadKeys();
    if (!current) {
      return value;
    }
    if (SecretCrypto.isEncrypted(value) && canRead(value, label)) {
      return value;
    }
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, current.aead, iv, {
      authTagLength: TAG_LENGTH,
    });
    cipher.setAAD(aad(label));
    const data = Buffer.concat([
      cipher.update(value as string, 'utf8'),
      cipher.final(),
    ]);
    return `${SECRET_ENCRYPTION_PREFIX}${iv.toString(
      'base64url'
    )}:${cipher.getAuthTag().toString('base64url')}:${data.toString(
      'base64url'
    )}` as T;
  },

  // Anything without the prefix is returned as it is, so legacy values and the
  // erased sentinel pass through. A prefixed value that cannot be
  // authenticated always throws; it never returns garbage.
  decrypt<T extends string | null | undefined>(value: T, label: string): T {
    if (!SecretCrypto.isEncrypted(value)) {
      return value;
    }
    return SecretCrypto.decryptWithInfo(value, label).value as T;
  },

  // Which key read it, so a rotation can tell what it still has to re-encrypt.
  // Mirrors token.encryption.ts's decryptWithInfo.
  decryptWithInfo(
    value: string,
    label: string
  ): { value: string; usedCurrentKey: boolean } {
    if (!SecretCrypto.isEncrypted(value)) {
      return { value, usedCurrentKey: true };
    }
    const keys = loadKeys();
    const candidates = [keys.current, ...keys.previous].filter(
      (key): key is DerivedKey => !!key
    );
    if (!candidates.length) {
      throw new SecretCryptoError(
        'A stored secret is encrypted but TOKEN_ENCRYPTION_KEY is not set'
      );
    }
    const parts = value.slice(SECRET_ENCRYPTION_PREFIX.length).split(':');
    if (parts.length !== 3) {
      throw new SecretCryptoError('A stored secret has a malformed value');
    }
    const [iv, tag, data] = parts.map((part) => Buffer.from(part, 'base64url'));
    if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
      throw new SecretCryptoError('A stored secret has a malformed value');
    }
    for (const key of candidates) {
      try {
        return {
          value: decryptWith(key.aead, iv, tag, data, label),
          usedCurrentKey: key === keys.current,
        };
      } catch {
        // wrong key, wrong label or a tampered value: try the next retired key
      }
    }
    throw new SecretCryptoError(
      'A stored secret could not be decrypted: it was tampered with, belongs to another field, or TOKEN_ENCRYPTION_KEY is not the key it was encrypted with'
    );
  },

  // Encrypted with a retired key, so a rotation still has to move it. There is
  // no equivalent for a hashed column: an HMAC cannot be recomputed without the
  // plaintext, and for an OAuth token or client secret the plaintext is held
  // only by the customer. See ROTATABLE_BY_BACKFILL in secret.backfill.service.
  needsReencryption(value: string | null | undefined, label: string): boolean {
    if (!SecretCrypto.isEncrypted(value) || !SecretCrypto.isEnabled()) {
      return false;
    }
    return SecretCrypto.decryptWithInfo(value, label).usedCurrentKey === false;
  },

  // test hook
  reset() {
    cache = undefined;
  },
};

// How a recoverable credential is stored. With a key configured that is this
// module's AES-GCM; without one it is the legacy scheme, never plaintext, so a
// self-hosted instance with no TOKEN_ENCRYPTION_KEY is no worse off than before.
export const writeSecret = <T extends string | null | undefined>(
  value: T,
  label: string
): T => {
  if (!value || SecretCrypto.isEncrypted(value)) {
    return value;
  }
  return SecretCrypto.isEnabled()
    ? SecretCrypto.encrypt(value, label)
    : (AuthService.fixedEncryption(value as string) as T);
};

// Reads a credential whichever scheme wrote it: this module's AES-GCM, or the
// AuthService.fixedEncryption of releases before it. null and '' read as null,
// so an erased row needs no special case at the call site. Callers that parse
// the result (JSON payloads) keep doing that themselves.
export const readLegacySecret = (
  value: string | null | undefined,
  label: string
): string | null => {
  if (!value) {
    return null;
  }
  if (SecretCrypto.isEncrypted(value)) {
    return SecretCrypto.decrypt(value, label);
  }
  return AuthService.fixedDecryption(value);
};
