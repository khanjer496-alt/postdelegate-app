import { sign, verify, SignOptions } from 'jsonwebtoken';
import { hashSync, compareSync } from 'bcrypt';
import crypto from 'crypto';
// @ts-ignore
import EVP_BytesToKey from 'evp_bytestokey';
const algorithm = 'aes-256-cbc';
const { keyLength, ivLength } = crypto.getCipherInfo(algorithm);

function deriveLegacyKeyIv(secret: string) {
  const { keyLength, ivLength } = crypto.getCipherInfo(algorithm); // 32, 16
  const pass = Buffer.isBuffer(secret) ? secret : Buffer.from(secret ?? '', 'utf8');

  // evp_bytestokey: key length in **bits**, IV length in **bytes**
  const { key, iv } = EVP_BytesToKey(pass, null, keyLength * 8, ivLength, 'md5');

  if (key.length !== keyLength || iv.length !== ivLength) {
    throw new Error(`Derived wrong sizes (key=${key.length}, iv=${iv.length})`);
  }
  return { key, iv };
}

export function decrypt_legacy_using_IV(hexCiphertext: string) {
  const { key, iv } = deriveLegacyKeyIv(process.env.JWT_SECRET);
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  const out = Buffer.concat([decipher.update(hexCiphertext, 'hex'), decipher.final()]);
  return out.toString('utf8');
}

export function encrypt_legacy_using_IV(utf8Plaintext: string) {
  const { key, iv } = deriveLegacyKeyIv(process.env.JWT_SECRET);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const out = Buffer.concat([cipher.update(utf8Plaintext, 'utf8'), cipher.final()]);
  return out.toString('hex');
}
export type JwtType =
  | 'session'
  | 'activation'
  | 'reset'
  | 'invite'
  | 'billing-discount'
  | 'connect-webhook'
  | 'extension'
  | 'enterprise-user'
  | 'enterprise-subscription';

// How long each kind lives. The session matches the 365 day auth cookie.
// Kinds without a lifetime are scoped capabilities that are not a login:
// the browser extension token (refreshes cookies for one channel until the
// channel is removed) and the ones signed by an external system
export const jwtLifetimes: Record<JwtType, SignOptions['expiresIn']> = {
  session: '365d',
  activation: '2d',
  reset: '20m',
  invite: '2d',
  'billing-discount': '1h',
  'connect-webhook': '10m',
  extension: undefined,
  'enterprise-user': undefined,
  'enterprise-subscription': undefined,
};

export class AuthService {
  static hashPassword(password: string) {
    return hashSync(password, 10);
  }
  static comparePassword(password: string, hash: string) {
    return compareSync(password, hash);
  }
  // Untyped primitives. Only for credentials stored at rest (Nostr, legacy
  // Skool), which carry no identity claims. Never use them for a token that
  // travels to a person: those must go through signTypedJWT / verifyTypedJWT
  static signJWT(value: object) {
    return sign(value, process.env.JWT_SECRET!);
  }
  static verifyJWT(token: string) {
    return verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] });
  }

  // Every token that is handed out gets a `typ` and each consumer only accepts
  // its own, so a password reset or invite link can never act as a session.
  // Kinds with a lifetime also get a real `exp`, and a token without one is
  // rejected on verify
  static signTypedJWT(
    typ: JwtType,
    payload: object,
    expiresIn?: SignOptions['expiresIn']
  ) {
    const lifetime = expiresIn ?? jwtLifetimes[typ];
    return sign({ ...payload, typ }, process.env.JWT_SECRET!, {
      algorithm: 'HS256',
      ...(lifetime ? { expiresIn: lifetime } : {}),
    });
  }

  static verifyTypedJWT<T extends object = Record<string, any>>(
    token: string,
    typ: JwtType
  ): T & { typ: JwtType; exp?: number; iat?: number } {
    const payload = verify(token, process.env.JWT_SECRET!, {
      algorithms: ['HS256'],
    });
    if (
      !payload ||
      typeof payload !== 'object' ||
      (payload as { typ?: unknown }).typ !== typ ||
      (jwtLifetimes[typ] && typeof (payload as any).exp !== 'number')
    ) {
      throw new Error('Invalid token type');
    }

    return payload as any;
  }

  // Changes whenever the password changes, so a session or reset link issued
  // before a password change stops working without a schema change
  static passwordFingerprint(passwordHash?: string | null) {
    return crypto
      .createHmac('sha256', process.env.JWT_SECRET!)
      .update('password-fingerprint:' + (passwordHash || ''))
      .digest('hex')
      .slice(0, 16);
  }

  static fixedEncryption(value: string) {
    return encrypt_legacy_using_IV(value);
  }

  static fixedDecryption(hash: string) {
    return decrypt_legacy_using_IV(hash);
  }
}
