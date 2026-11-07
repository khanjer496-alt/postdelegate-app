import { createHash, timingSafeEqual } from 'crypto';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';

// Who may finish a connect. The OAuth callback (POST
// /integrations/social-connect) runs without a session and finds the
// workspace from the state alone, so a consent link started in one workspace
// and opened by someone else would attach their account to that workspace
// (OAuth login CSRF, RFC 6749 §10.12, RFC 9700 §4.7.1). Every place that
// starts a connect records here how it was started:
// - session: from the app, in the browser of the member who started it. A
//   nonce cookie set on that browser (or that member's own session) has to
//   come back with the callback.
// - invite, api, enterprise, mobile: a link meant to be opened somewhere
//   else (a customer, an API client, a partner app, the system browser of the
//   mobile app). Nothing ties it to a browser, so the person opening it
//   confirms the workspace before the code is exchanged and the link works
//   once. The admins hear about the channels an invite or API link added.
export type ConnectBindingType =
  | 'session'
  | 'invite'
  | 'api'
  | 'enterprise'
  | 'mobile';

const BINDING_TYPES: ConnectBindingType[] = [
  'session',
  'invite',
  'api',
  'enterprise',
  'mobile',
];

export interface ConnectBinding {
  type: ConnectBindingType;
  orgId: string;
  // the member who started a session connect
  userId?: string;
  // sha256 of the nonce cookie of a session connect, never the nonce itself
  nonceHash?: string;
  // a link connect the person confirmed, kept for its page picking step
  confirmed?: boolean;
}

// A forwarded invite has to survive until it is opened, so a link keeps the
// hour every connect always had; it is single use and confirmed instead
export const CONNECT_SESSION_TTL = 3600;
export const CONNECT_LINK_TTL = 3600;

export const CONNECT_OTHER_BROWSER_MESSAGE =
  'This connect link was started in another browser. Start the connection again from PostDelegate.';

export const connectStateTtl = (type: ConnectBindingType) =>
  type === 'session' ? CONNECT_SESSION_TTL : CONNECT_LINK_TTL;

export const isConnectLink = (binding: ConnectBinding) =>
  binding.type !== 'session';

// A mobile connect is the member's own and a partner manages its enterprise
// connects, only an invite or an API link adds a channel the admins may not
// expect
export const notifiesAdmins = (binding: ConnectBinding) =>
  binding.type === 'invite' || binding.type === 'api';

// who created a link, for the person asked to confirm it: the member's name
// with the email masked (ja***@example.com), or just the masked email
export const connectLinkCreator = (user?: {
  name?: string | null;
  lastName?: string | null;
  email?: string | null;
} | null) => {
  if (!user) {
    return undefined;
  }
  const [local = '', domain = ''] = (user.email || '').split('@');
  const masked = local && domain ? `${local.slice(0, 2)}***@${domain}` : '';
  const name = [user.name, user.lastName].filter(Boolean).join(' ').trim();
  if (name && masked) {
    return `${name} (${masked})`;
  }
  return name || masked || undefined;
};

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const bindingKey = (state: string) => `binding:${state}`;

// One cookie per connect, so two connects started in two tabs never
// overwrite each other. Named after a hash, the state never sits in a header.
// Host-only: with a Domain any other subdomain (staging, the site) could
// plant a nonce, so it carries the __Host- prefix whenever it is Secure, which
// makes the browser refuse one with a Domain or set over http
export const connectNonceCookie = (state: string) =>
  `${process.env.NOT_SECURED ? '' : '__Host-'}connect_${sha256(state).slice(
    0,
    16
  )}`;

// Always HttpOnly, the app never reads it, it only travels back. Cleared with
// the same attributes and a negative age
export const connectNonceCookieOptions = (maxAgeSeconds: number) => ({
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: !process.env.NOT_SECURED,
  maxAge: maxAgeSeconds * 1000,
});

// A minute longer than the other keys of the state, which are written after
// it, so the organization of a state never outlives its binding
const BINDING_MARGIN = 60;

// Written before any other key of the state, so a state never exists without
// the way it was started. Returns the nonce of a session connect, for the
// cookie, and the lifetime every other key of the state gets
export const saveConnectBinding = async (
  state: string,
  binding: { type: ConnectBindingType; orgId: string; userId?: string }
) => {
  const ttl = connectStateTtl(binding.type);
  const nonce = binding.type === 'session' ? makeSecureId(32) : undefined;
  const stored: ConnectBinding = {
    type: binding.type,
    orgId: binding.orgId,
    ...(binding.userId ? { userId: binding.userId } : {}),
    ...(nonce ? { nonceHash: sha256(nonce) } : {}),
  };
  await ioRedis.set(
    bindingKey(state),
    JSON.stringify(stored),
    'EX',
    ttl + BINDING_MARGIN
  );
  return { nonce, ttl };
};

// undefined only when nothing was recorded, which only a state created before
// this release can be (every producer writes the binding first, and Redis
// runs without eviction). Those expire within an hour of the release and keep
// the old behaviour until then. Anything unreadable is refused, never read as
// legacy
export const readConnectBinding = async (
  state: string
): Promise<ConnectBinding | undefined> => {
  const raw = await ioRedis.get(bindingKey(state));
  if (!raw) {
    return undefined;
  }
  const parsed = JSON.parse(raw);
  if (
    !parsed ||
    !BINDING_TYPES.includes(parsed.type) ||
    typeof parsed.orgId !== 'string' ||
    !parsed.orgId
  ) {
    throw new Error('Invalid connect binding');
  }
  return parsed as ConnectBinding;
};

export const connectNonceMatches = (binding: ConnectBinding, nonce?: unknown) => {
  if (!binding.nonceHash || typeof nonce !== 'string' || !nonce) {
    return false;
  }
  const expected = Buffer.from(binding.nonceHash);
  const received = Buffer.from(sha256(nonce));
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
};

// the code of a confirmed link was exchanged, only its page is left to pick
export const confirmConnectBinding = (state: string, binding: ConnectBinding) =>
  ioRedis.set(
    bindingKey(state),
    JSON.stringify({ ...binding, confirmed: true }),
    'EX',
    CONNECT_LINK_TTL + BINDING_MARGIN
  );

export const deleteConnectBinding = (state: string) =>
  ioRedis.del(bindingKey(state));

// Every key a connect producer writes for a state, binding last so the state
// is never left without one
export const deleteConnectState = async (state: string) => {
  for (const key of [
    'login',
    'organization',
    'refresh',
    'onboarding',
    'redirect',
    'external',
    'webhookUrl',
  ]) {
    await ioRedis.del(`${key}:${state}`);
  }
  await deleteConnectBinding(state);
};
