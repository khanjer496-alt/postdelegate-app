import { AuthService } from '@gitroom/helpers/auth/auth.service';
import {
  CUSTOM_INSTANCE_DETAILS_LABEL,
  readCustomInstanceDetails,
  writeCustomInstanceDetails,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/custom.instance.details';
import {
  SecretCrypto,
  SecretCryptoError,
} from '@gitroom/nestjs-libraries/database/prisma/secrets/secret.crypto';

const KEY = Buffer.alloc(32, 17).toString('base64');

describe('customInstanceDetails at rest', () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
    process.env.JWT_SECRET = 'unit-test-secret';
    SecretCrypto.reset();
  });

  afterAll(() => {
    process.env = { ...env };
    SecretCrypto.reset();
  });

  // A Bluesky app password, a Lemmy or Listmonk login, a custom Mastodon
  // credential: a live credential to someone's account.
  it('round-trips a raw credential', () => {
    const stored = writeCustomInstanceDetails('app-password-1234');
    expect(stored).not.toContain('app-password-1234');
    expect(readCustomInstanceDetails(stored)).toBe('app-password-1234');
  });

  // Skool and the browser extension store JSON here. The helper returns the
  // string; parsing stays with the caller.
  it('round-trips a JSON payload without parsing it', () => {
    const payload = JSON.stringify({ identifier: 'a', password: 'b' });
    const stored = writeCustomInstanceDetails(payload);
    expect(readCustomInstanceDetails(stored)).toBe(payload);
    expect(JSON.parse(readCustomInstanceDetails(stored)!)).toEqual({
      identifier: 'a',
      password: 'b',
    });
  });

  it('reads a value written by the previous release', () => {
    const legacy = AuthService.fixedEncryption('app-password-1234');
    expect(readCustomInstanceDetails(legacy)).toBe('app-password-1234');
  });

  // Review Focus 5: erased channels store '', and most channels store nothing
  it('reads the erased sentinel, null and undefined as null, without throwing', () => {
    expect(readCustomInstanceDetails('')).toBe(null);
    expect(readCustomInstanceDetails(null)).toBe(null);
    expect(readCustomInstanceDetails(undefined)).toBe(null);
  });

  it('leaves the erased sentinel and null alone on write', () => {
    expect(writeCustomInstanceDetails('')).toBe('');
    expect(writeCustomInstanceDetails(null)).toBe(null);
    expect(writeCustomInstanceDetails(undefined)).toBe(undefined);
  });

  it('throws rather than returning garbage on a tampered value', () => {
    const stored = writeCustomInstanceDetails('app-password-1234')!;
    const tampered = stored.slice(0, -2) + (stored.endsWith('xy') ? 'ab' : 'xy');
    expect(() => readCustomInstanceDetails(tampered)).toThrow(
      SecretCryptoError
    );
  });

  // Review Focus 3
  it('reads a value written under a retired key', () => {
    const stored = writeCustomInstanceDetails('app-password-1234');
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 18).toString('base64');
    process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = KEY;
    SecretCrypto.reset();

    expect(readCustomInstanceDetails(stored)).toBe('app-password-1234');
  });

  it('cannot be read with another field label', () => {
    const stored = writeCustomInstanceDetails('app-password-1234')!;
    expect(() => SecretCrypto.decrypt(stored, 'ai-credential')).toThrow(
      SecretCryptoError
    );
    expect(SecretCrypto.decrypt(stored, CUSTOM_INSTANCE_DETAILS_LABEL)).toBe(
      'app-password-1234'
    );
  });

  it('falls back to the legacy scheme when no key is configured', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    SecretCrypto.reset();

    const stored = writeCustomInstanceDetails('app-password-1234')!;
    expect(stored).not.toContain('app-password-1234');
    expect(readCustomInstanceDetails(stored)).toBe('app-password-1234');
  });
});
