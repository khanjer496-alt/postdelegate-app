import { AuthService } from '@gitroom/helpers/auth/auth.service';
import {
  readLegacySecret,
  writeSecret,
  SECRET_HASH_PREFIX,
  SecretCrypto,
  SecretCryptoError,
} from '@gitroom/nestjs-libraries/database/prisma/secrets/secret.crypto';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');

describe('SecretCrypto', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
    process.env.JWT_SECRET = 'jwt-secret-for-the-legacy-path';
    SecretCrypto.reset();
  });

  afterAll(() => {
    process.env = { ...env };
    SecretCrypto.reset();
  });

  it('hashes deterministically with the h1: prefix', () => {
    expect(SecretCrypto.hash('tok', 'a')).toBe(SecretCrypto.hash('tok', 'a'));
    expect(SecretCrypto.hash('tok', 'a').startsWith(SECRET_HASH_PREFIX)).toBe(
      true
    );
  });

  it('does not store the value inside the hash', () => {
    expect(SecretCrypto.hash('tok', 'a')).not.toContain('tok');
  });

  it('separates labels, so a hash cannot be replayed into another field', () => {
    expect(SecretCrypto.hash('tok', 'a')).not.toBe(
      SecretCrypto.hash('tok', 'b')
    );
  });

  it('separates keys, so two deployments do not share hashes', () => {
    const withFirstKey = SecretCrypto.hash('tok', 'a');
    process.env.TOKEN_ENCRYPTION_KEY = OTHER_KEY;
    SecretCrypto.reset();
    expect(SecretCrypto.hash('tok', 'a')).not.toBe(withFirstKey);
  });

  it('does not derive from JWT_SECRET', () => {
    const before = SecretCrypto.hash('tok', 'a');
    process.env.JWT_SECRET = 'something-else';
    SecretCrypto.reset();
    expect(SecretCrypto.hash('tok', 'a')).toBe(before);
  });

  it('round-trips encryption and binds the label', () => {
    const enc = SecretCrypto.encrypt('secret', 'a');
    expect(enc).not.toContain('secret');
    expect(SecretCrypto.decrypt(enc, 'a')).toBe('secret');
    expect(() => SecretCrypto.decrypt(enc, 'b')).toThrow(SecretCryptoError);
  });

  it('uses a fresh IV per value', () => {
    expect(SecretCrypto.encrypt('secret', 'a')).not.toBe(
      SecretCrypto.encrypt('secret', 'a')
    );
  });

  it('passes null, undefined and the erased sentinel through encryption untouched', () => {
    expect(SecretCrypto.encrypt(null, 'a')).toBe(null);
    expect(SecretCrypto.encrypt(undefined, 'a')).toBe(undefined);
    expect(SecretCrypto.encrypt('', 'a')).toBe('');
    expect(SecretCrypto.decrypt(null, 'a')).toBe(null);
    expect(SecretCrypto.decrypt('', 'a')).toBe('');
  });

  // Review Focus 4: encrypting a value this module can read back is a no-op,
  // so the backfill is re-runnable and a dual-write cannot corrupt a row.
  it('is a no-op on a value it can already read back', () => {
    const enc = SecretCrypto.encrypt('secret', 'a');
    expect(SecretCrypto.encrypt(enc, 'a')).toBe(enc);
  });

  // hash() must NOT short-circuit on an h1: input. Otherwise any caller that
  // hashes a presented credential and compares it to the stored hash can be
  // authenticated by presenting the stored hash itself.
  it('hashes a value that already looks like a hash, rather than returning it', () => {
    const hashed = SecretCrypto.hash('tok', 'a');
    expect(SecretCrypto.hash(hashed, 'a')).not.toBe(hashed);
  });

  // A value carrying the prefix but not produced by this module (the Chrome
  // extension posts arbitrary bytes) must be encrypted, not stored as it is.
  it('encrypts a prefixed value it cannot read back, rather than storing it bare', () => {
    const foreign = 'enc:v1:not:a:real:ciphertext';
    const stored = SecretCrypto.encrypt(foreign, 'a');
    expect(stored).not.toBe(foreign);
    expect(SecretCrypto.decrypt(stored, 'a')).toBe(foreign);
  });

  it('does not treat another field label\'s ciphertext as already encrypted', () => {
    const otherField = SecretCrypto.encrypt('secret', 'b');
    const stored = SecretCrypto.encrypt(otherField, 'a');
    expect(stored).not.toBe(otherField);
    expect(SecretCrypto.decrypt(stored, 'a')).toBe(otherField);
  });

  describe('key provenance, for completing a rotation', () => {
    it('says whether a value was encrypted with the current key', () => {
      const underCurrent = SecretCrypto.encrypt('secret', 'a');
      expect(SecretCrypto.decryptWithInfo(underCurrent, 'a')).toEqual({
        value: 'secret',
        usedCurrentKey: true,
      });

      process.env.TOKEN_ENCRYPTION_KEY = OTHER_KEY;
      process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = KEY;
      SecretCrypto.reset();

      expect(SecretCrypto.decryptWithInfo(underCurrent, 'a')).toEqual({
        value: 'secret',
        usedCurrentKey: false,
      });
    });

    it('reports a value that needs re-encrypting onto the current key', () => {
      const underOldKey = SecretCrypto.encrypt('secret', 'a');
      expect(SecretCrypto.needsReencryption(underOldKey, 'a')).toBe(false);

      process.env.TOKEN_ENCRYPTION_KEY = OTHER_KEY;
      process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = KEY;
      SecretCrypto.reset();

      expect(SecretCrypto.needsReencryption(underOldKey, 'a')).toBe(true);
      expect(
        SecretCrypto.needsReencryption(SecretCrypto.encrypt('secret', 'a'), 'a')
      ).toBe(false);
      expect(SecretCrypto.needsReencryption(null, 'a')).toBe(false);
      expect(SecretCrypto.needsReencryption('legacy-not-prefixed', 'a')).toBe(
        false
      );
    });
  });

  // Review Focus 3
  it('offers the previous key as a lookup candidate', () => {
    const underOldKey = SecretCrypto.hash('tok', 'a');
    process.env.TOKEN_ENCRYPTION_KEY = OTHER_KEY;
    process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = KEY;
    SecretCrypto.reset();

    const candidates = SecretCrypto.hashCandidates('tok', 'a');
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toBe(SecretCrypto.hash('tok', 'a'));
    expect(candidates).toContain(underOldKey);
  });

  it('decrypts a value written with a retired key', () => {
    const underOldKey = SecretCrypto.encrypt('secret', 'a');
    process.env.TOKEN_ENCRYPTION_KEY = OTHER_KEY;
    process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = KEY;
    SecretCrypto.reset();
    expect(SecretCrypto.decrypt(underOldKey, 'a')).toBe('secret');
  });

  // Review Focus 1
  it('reports disabled and returns no candidates without a key', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    SecretCrypto.reset();
    expect(SecretCrypto.isEnabled()).toBe(false);
    expect(SecretCrypto.hashCandidates('tok', 'a')).toEqual([]);
    expect(SecretCrypto.encrypt('secret', 'a')).toBe('secret');
  });

  it('throws rather than hashing against an empty key', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    SecretCrypto.reset();
    expect(() => SecretCrypto.hash('tok', 'a')).toThrow(SecretCryptoError);
  });

  it('throws on a malformed key rather than storing plaintext', () => {
    process.env.TOKEN_ENCRYPTION_KEY = 'too-short';
    SecretCrypto.reset();
    expect(() => SecretCrypto.hash('tok', 'a')).toThrow(SecretCryptoError);
    expect(() => SecretCrypto.encrypt('secret', 'a')).toThrow(
      SecretCryptoError
    );
  });

  it('throws, never returns garbage, on a tampered ciphertext', () => {
    const enc = SecretCrypto.encrypt('secret', 'a');
    const tampered = enc.slice(0, -2) + (enc.endsWith('xy') ? 'ab' : 'xy');
    expect(() => SecretCrypto.decrypt(tampered, 'a')).toThrow(
      SecretCryptoError
    );
  });

  it('throws on a malformed encrypted value', () => {
    expect(() => SecretCrypto.decrypt('enc:v1:only-one-part', 'a')).toThrow(
      SecretCryptoError
    );
  });

  it('recognises its own formats and nothing else', () => {
    expect(SecretCrypto.isHashed(SecretCrypto.hash('tok', 'a'))).toBe(true);
    expect(SecretCrypto.isHashed(SecretCrypto.encrypt('tok', 'a'))).toBe(false);
    expect(SecretCrypto.isEncrypted(SecretCrypto.encrypt('tok', 'a'))).toBe(
      true
    );
    expect(SecretCrypto.isEncrypted(AuthService.fixedEncryption('tok'))).toBe(
      false
    );
    expect(SecretCrypto.isHashed(null)).toBe(false);
    expect(SecretCrypto.isEncrypted(undefined)).toBe(false);
  });
});

describe('writeSecret', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
    process.env.JWT_SECRET = 'jwt-secret-for-the-legacy-path';
    SecretCrypto.reset();
  });

  afterAll(() => {
    process.env = { ...env };
    SecretCrypto.reset();
  });

  it('encrypts with the new scheme when a key is configured', () => {
    const stored = writeSecret('v', 'a');
    expect(SecretCrypto.isEncrypted(stored)).toBe(true);
    expect(readLegacySecret(stored, 'a')).toBe('v');
  });

  // Without a key the new scheme cannot encrypt. It must fall back to the
  // legacy scheme, NOT store the secret in the clear - a self-hosted instance
  // with no key configured is no worse off than before.
  it('falls back to the legacy scheme rather than storing plaintext', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    SecretCrypto.reset();

    const stored = writeSecret('v', 'a');
    expect(stored).not.toBe('v');
    expect(stored).not.toContain('v');
    expect(readLegacySecret(stored, 'a')).toBe('v');
  });

  it('leaves null, undefined and the erased sentinel alone', () => {
    expect(writeSecret(null, 'a')).toBe(null);
    expect(writeSecret(undefined, 'a')).toBe(undefined);
    expect(writeSecret('', 'a')).toBe('');
  });
});

describe('readLegacySecret', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
    process.env.JWT_SECRET = 'jwt-secret-for-the-legacy-path';
    SecretCrypto.reset();
  });

  afterAll(() => {
    process.env = { ...env };
    SecretCrypto.reset();
  });

  it('reads a value written with the new scheme', () => {
    expect(readLegacySecret(SecretCrypto.encrypt('v', 'a'), 'a')).toBe('v');
  });

  it('reads a value written by the previous release', () => {
    expect(readLegacySecret(AuthService.fixedEncryption('v'), 'a')).toBe('v');
  });

  // Review Focus 2 and 5
  it('returns null for the erased sentinel and for null, without throwing', () => {
    expect(readLegacySecret('', 'a')).toBe(null);
    expect(readLegacySecret(null, 'a')).toBe(null);
    expect(readLegacySecret(undefined, 'a')).toBe(null);
  });

  it('reads a legacy JSON payload unchanged, leaving parsing to the caller', () => {
    const payload = JSON.stringify({ identifier: 'a', password: 'b' });
    expect(readLegacySecret(AuthService.fixedEncryption(payload), 'a')).toBe(
      payload
    );
  });

  it('throws on a new-scheme value it cannot authenticate', () => {
    const enc = SecretCrypto.encrypt('v', 'a');
    expect(() => readLegacySecret(enc, 'b')).toThrow(SecretCryptoError);
  });
});
