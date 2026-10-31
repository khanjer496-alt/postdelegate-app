import { randomBytes } from 'crypto';
import {
  decryptCredentials,
  decryptIntegrationOf,
  encryptCredentials,
  TOKEN_ENCRYPTION_PREFIX,
  TokenEncryption,
  TokenEncryptionError,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/token.encryption';

const newKey = () => randomBytes(32).toString('base64');

describe('TokenEncryption', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = newKey();
    delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
    TokenEncryption.reset();
  });
  afterAll(() => {
    process.env = env;
    TokenEncryption.reset();
  });

  it('round-trips a value in the versioned format', () => {
    const encrypted = TokenEncryption.encrypt('EAAB-access-token');
    expect(encrypted.startsWith(TOKEN_ENCRYPTION_PREFIX)).toBe(true);
    expect(encrypted).not.toContain('EAAB-access-token');
    expect(encrypted.split(':')).toHaveLength(5);
    expect(TokenEncryption.decrypt(encrypted)).toBe('EAAB-access-token');
  });

  it('round-trips unicode and long values', () => {
    const value = 'tökén-✓-' + 'x'.repeat(5000);
    expect(TokenEncryption.decrypt(TokenEncryption.encrypt(value))).toBe(value);
  });

  it('uses a random 12 byte IV, so the same value never encrypts the same way', () => {
    const a = TokenEncryption.encrypt('same');
    const b = TokenEncryption.encrypt('same');
    expect(a).not.toBe(b);
    const iv = (value: string) =>
      Buffer.from(value.split(':')[2], 'base64url');
    expect(iv(a)).toHaveLength(12);
    expect(iv(a).equals(iv(b))).toBe(false);
  });

  it('reads legacy plaintext as it is', () => {
    expect(TokenEncryption.decrypt('legacy-plaintext-token')).toBe(
      'legacy-plaintext-token'
    );
    expect(TokenEncryption.decrypt('')).toBe('');
    expect(TokenEncryption.decrypt(null)).toBeNull();
    expect(TokenEncryption.decrypt(undefined)).toBeUndefined();
  });

  it('leaves the erased sentinel, null and already encrypted values alone', () => {
    expect(TokenEncryption.encrypt('')).toBe('');
    expect(TokenEncryption.encrypt(null)).toBeNull();
    const encrypted = TokenEncryption.encrypt('x');
    expect(TokenEncryption.encrypt(encrypted)).toBe(encrypted);
  });

  it('refuses a tampered ciphertext instead of returning garbage', () => {
    const parts = TokenEncryption.encrypt('secret-token').split(':');
    const data = Buffer.from(parts[4], 'base64url');
    data[0] ^= 1;
    parts[4] = data.toString('base64url');
    expect(() => TokenEncryption.decrypt(parts.join(':'))).toThrow(
      TokenEncryptionError
    );
  });

  it('refuses a tampered tag or IV', () => {
    const original = TokenEncryption.encrypt('secret-token').split(':');
    for (const index of [2, 3]) {
      const parts = [...original];
      const bytes = Buffer.from(parts[index], 'base64url');
      bytes[0] ^= 1;
      parts[index] = bytes.toString('base64url');
      expect(() => TokenEncryption.decrypt(parts.join(':'))).toThrow(
        /tampered|malformed/
      );
    }
  });

  it('refuses malformed values', () => {
    expect(() => TokenEncryption.decrypt('enc:v1:abc')).toThrow(
      TokenEncryptionError
    );
    expect(() => TokenEncryption.decrypt('enc:v1:a:b:c')).toThrow(
      TokenEncryptionError
    );
  });

  it('refuses a value encrypted with another key', () => {
    const encrypted = TokenEncryption.encrypt('secret-token');
    process.env.TOKEN_ENCRYPTION_KEY = newKey();
    expect(() => TokenEncryption.decrypt(encrypted)).toThrow(
      TokenEncryptionError
    );
  });

  it('refuses a value moved between purposes (bound to its AAD)', () => {
    // a ciphertext made with the same key but another context cannot be read
    const { createCipheriv } = require('crypto');
    const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, 'base64');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('another-purpose'));
    const data = Buffer.concat([cipher.update('x'), cipher.final()]);
    const forged = `enc:v1:${iv.toString('base64url')}:${cipher
      .getAuthTag()
      .toString('base64url')}:${data.toString('base64url')}`;
    expect(() => TokenEncryption.decrypt(forged)).toThrow(TokenEncryptionError);
  });

  describe('without a key', () => {
    beforeEach(() => {
      delete process.env.TOKEN_ENCRYPTION_KEY;
      TokenEncryption.reset();
    });

    it('stores plaintext and reads plaintext', () => {
      expect(TokenEncryption.isEnabled()).toBe(false);
      expect(TokenEncryption.encrypt('plain')).toBe('plain');
      expect(TokenEncryption.decrypt('plain')).toBe('plain');
      expect(TokenEncryption.needsEncryption('plain')).toBe(false);
    });

    it('treats an empty key as not set', () => {
      process.env.TOKEN_ENCRYPTION_KEY = '  ';
      expect(TokenEncryption.isEnabled()).toBe(false);
    });

    it('fails clearly on an encrypted value instead of returning it', () => {
      process.env.TOKEN_ENCRYPTION_KEY = newKey();
      TokenEncryption.reset();
      const encrypted = TokenEncryption.encrypt('secret');
      delete process.env.TOKEN_ENCRYPTION_KEY;
      expect(() => TokenEncryption.decrypt(encrypted)).toThrow(
        /TOKEN_ENCRYPTION_KEY is not set/
      );
    });

    it('warns once per process', () => {
      const log = jest.fn();
      TokenEncryption.warnIfDisabled(log);
      TokenEncryption.warnIfDisabled(log);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toContain('TOKEN_ENCRYPTION_KEY');
    });

    it('does not warn when a key is set', () => {
      process.env.TOKEN_ENCRYPTION_KEY = newKey();
      const log = jest.fn();
      TokenEncryption.warnIfDisabled(log);
      expect(log).not.toHaveBeenCalled();
    });
  });

  it('rejects a key that is not 32 bytes', () => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(16).toString('base64');
    expect(() => TokenEncryption.isEnabled()).toThrow(/32 bytes/);
    process.env.TOKEN_ENCRYPTION_KEY = 'short';
    expect(() => TokenEncryption.encrypt('x')).toThrow(/32 bytes/);
  });

  describe('key rotation', () => {
    it('reads values of a retired key and flags them for re-encryption', () => {
      const oldKey = process.env.TOKEN_ENCRYPTION_KEY!;
      const old = TokenEncryption.encrypt('rotating');
      process.env.TOKEN_ENCRYPTION_KEY = newKey();
      process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = oldKey;

      expect(TokenEncryption.decrypt(old)).toBe('rotating');
      expect(TokenEncryption.needsReencryption(old)).toBe(true);
      const fresh = TokenEncryption.encrypt(TokenEncryption.decrypt(old));
      expect(TokenEncryption.needsReencryption(fresh)).toBe(false);
      expect(TokenEncryption.decrypt(fresh)).toBe('rotating');
    });

    it('stops reading the retired key once it is removed', () => {
      const old = TokenEncryption.encrypt('rotating');
      process.env.TOKEN_ENCRYPTION_KEY = newKey();
      expect(() => TokenEncryption.decrypt(old)).toThrow(TokenEncryptionError);
    });
  });

  describe('row helpers', () => {
    it('encrypts only the credential fields that are present', () => {
      const data = encryptCredentials({ token: 'a', name: 'n' } as any);
      expect(TokenEncryption.isEncrypted(data.token)).toBe(true);
      expect(data.name).toBe('n');
      expect('refreshToken' in data).toBe(false);
    });

    it('decrypts a row without mutating it', () => {
      const row = {
        token: TokenEncryption.encrypt('a'),
        refreshToken: TokenEncryption.encrypt('b'),
        id: '1',
      };
      expect(decryptCredentials(row)).toEqual({ token: 'a', refreshToken: 'b', id: '1' });
      expect(TokenEncryption.isEncrypted(row.token)).toBe(true);
    });

    it('decrypts the integration of a post', () => {
      const post = {
        id: 'p',
        integration: { token: TokenEncryption.encrypt('t'), refreshToken: null },
      };
      expect(decryptIntegrationOf(post).integration.token).toBe('t');
      expect(decryptIntegrationOf({ id: 'p', integration: null })).toEqual({
        id: 'p',
        integration: null,
      });
    });
  });
});
