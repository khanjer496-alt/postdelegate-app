import { sign } from 'jsonwebtoken';
import { AuthService } from './auth.service';

describe('AuthService typed tokens', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-secret';
  });

  it('puts the type and an expiry on every token that has a lifetime', () => {
    for (const [typ, seconds] of [
      ['session', 365 * 24 * 3600],
      ['reset', 20 * 60],
      ['activation', 2 * 24 * 3600],
      ['invite', 2 * 24 * 3600],
    ] as const) {
      const payload: any = AuthService.verifyTypedJWT(
        AuthService.signTypedJWT(typ, { id: 'u1' }),
        typ
      );
      expect(payload.typ).toBe(typ);
      expect(payload.exp - payload.iat).toBe(seconds);
    }
  });

  it('rejects a token of another kind', () => {
    const reset = AuthService.signTypedJWT('reset', { id: 'u1' });
    expect(() => AuthService.verifyTypedJWT(reset, 'session')).toThrow();
    const invite = AuthService.signTypedJWT('invite', { id: 'u1' });
    expect(() => AuthService.verifyTypedJWT(invite, 'session')).toThrow();
    const session = AuthService.signTypedJWT('session', { id: 'u1' });
    expect(() => AuthService.verifyTypedJWT(session, 'reset')).toThrow();
    expect(() => AuthService.verifyTypedJWT(session, 'activation')).toThrow();
  });

  it('rejects the old untyped tokens, such as a signed user row', () => {
    const legacy = AuthService.signJWT({ id: 'u1', email: 'a@b.c' });
    expect(() => AuthService.verifyTypedJWT(legacy, 'session')).toThrow();
    const legacyReset = AuthService.signJWT({
      id: 'u1',
      expires: '2999-01-01 00:00:00',
    });
    expect(() => AuthService.verifyTypedJWT(legacyReset, 'reset')).toThrow();
  });

  it('rejects a session token that has no expiry', () => {
    const forever = sign({ id: 'u1', typ: 'session' }, 'unit-test-secret');
    expect(() => AuthService.verifyTypedJWT(forever, 'session')).toThrow();
  });

  it('rejects an expired token', () => {
    const expired = sign(
      { id: 'u1', typ: 'reset', iat: 1000, exp: 1001 },
      'unit-test-secret'
    );
    expect(() => AuthService.verifyTypedJWT(expired, 'reset')).toThrow(
      /expired/
    );
  });

  it('rejects another algorithm and another secret', () => {
    const hs512 = sign({ id: 'u1', typ: 'session' }, 'unit-test-secret', {
      algorithm: 'HS512',
      expiresIn: '1h',
    });
    expect(() => AuthService.verifyTypedJWT(hs512, 'session')).toThrow();
    const other = sign({ id: 'u1', typ: 'session' }, 'other-secret', {
      expiresIn: '1h',
    });
    expect(() => AuthService.verifyTypedJWT(other, 'session')).toThrow();
  });

  it('does not let the payload choose the type', () => {
    const token = AuthService.signTypedJWT('reset', { id: 'u1', typ: 'session' });
    expect(() => AuthService.verifyTypedJWT(token, 'session')).toThrow();
    expect(AuthService.verifyTypedJWT(token, 'reset').typ).toBe('reset');
  });

  it('leaves kinds that are not a login without an expiry', () => {
    const token = AuthService.signTypedJWT('extension', { integrationId: 'i' });
    const payload = AuthService.verifyTypedJWT(token, 'extension');
    expect(payload.exp).toBeUndefined();
  });

  it('changes the password fingerprint with the password hash', () => {
    const a = AuthService.passwordFingerprint('hash-a');
    expect(a).toBe(AuthService.passwordFingerprint('hash-a'));
    expect(a).not.toBe(AuthService.passwordFingerprint('hash-b'));
    expect(AuthService.passwordFingerprint('')).toBe(
      AuthService.passwordFingerprint(undefined)
    );
  });
});
