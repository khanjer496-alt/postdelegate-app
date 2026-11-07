import {
  AuthProvider,
  AuthProviderAbstract,
} from '@gitroom/backend/services/auth/providers.interface';
import { randomBytes } from 'crypto';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

function hexToUint8Array(hex) {
  if (hex.startsWith('0x')) {
    hex = hex.slice(2);
  }

  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string. It must have an even length.');
  }

  const byteLength = hex.length / 2;
  const uint8Array = new Uint8Array(byteLength);

  for (let i = 0; i < byteLength; i++) {
    const byteHex = hex.substr(i * 2, 2);
    uint8Array[i] = parseInt(byteHex, 16);
  }

  return uint8Array;
}

// How long a verified wallet stays usable for the rest of the sign in: an
// existing account signs in right away, a new one still has to register
const VERIFIED_TTL = 3600;

const parse = (token: string) => {
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString()) || {};
  } catch {
    return {};
  }
};

@AuthProvider({ provider: 'WALLET' })
export class WalletProvider extends AuthProviderAbstract {
  // A pending challenge is never replaced: anyone can ask for one for any
  // public key, and replacing it would break the sign in of the wallet's
  // owner. Asking again within the minute gets the same challenge
  async generateLink(params: { publicKey: string }) {
    if (!params.publicKey) {
      return;
    }

    const key = `wallet:${params.publicKey}`;
    const challenge = randomBytes(32).toString('hex');
    if (await ioRedis.set(key, challenge, 'EX', 60, 'NX')) {
      return challenge;
    }

    const pending = await ioRedis.get(key);
    if (pending) {
      return pending;
    }

    // expired in between
    await ioRedis.set(key, challenge, 'EX', 60);
    return challenge;
  }

  // Verifies the signed challenge and spends it, so the signed code can't be
  // replayed: of two requests with the same code only one deletes the
  // challenge. What comes back is a token for the rest of this sign in
  // (getUser, and the registration of a new account)
  async getToken(code: string, _redirectUri?: string) {
    const { publicKey, challenge, signature } = parse(code);

    if (!publicKey || !challenge || !signature) {
      return '';
    }

    const key = `wallet:${publicKey}`;
    const redisGet = await ioRedis.get(key);
    if (redisGet !== challenge) {
      return '';
    }

    const publicKeyUint8 = bs58.decode(publicKey);
    const messageUint8 = new TextEncoder().encode(challenge);
    const signatureUint8 = hexToUint8Array(signature);
    const isValid = nacl.sign.detached.verify(
      messageUint8,
      signatureUint8,
      publicKeyUint8
    );

    if (!isValid) {
      return '';
    }

    if ((await ioRedis.del(key)) !== 1) {
      return '';
    }

    const verified = randomBytes(32).toString('hex');
    await ioRedis.set(
      `wallet:verified:${verified}`,
      publicKey,
      'EX',
      VERIFIED_TTL
    );

    return Buffer.from(JSON.stringify({ verified })).toString('base64');
  }

  // Takes the token getToken returned, or a signed challenge (which is
  // verified and spent here)
  async getUser(providerToken: string) {
    const token = parse(providerToken).verified
      ? providerToken
      : await this.getToken(providerToken);
    const { verified } = parse(token);
    const publicKey = verified
      ? await ioRedis.get(`wallet:verified:${verified}`)
      : null;

    if (!publicKey) {
      return {
        id: '',
        email: '',
      };
    }

    return {
      id: String(`wallet_${publicKey}`),
      email: String(`wallet_${publicKey}`),
    };
  }
}
