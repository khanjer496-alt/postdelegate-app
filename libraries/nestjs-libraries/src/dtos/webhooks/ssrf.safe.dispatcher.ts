import { Agent } from 'undici';
import axios, { AxiosInstance } from 'axios';
import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { isBlockedIp, isSafePublicUrl } from './webhook.url.validator';

// Pins DNS resolution: every resolved IP is checked with `isBlockedIp` and
// the caller connects to that same set. Closes the TOCTOU window
// `isSafePublicHttpsUrl` alone leaves open (see GHSA-f7jj-p389-4w45).
function ssrfSafeLookup(
  hostname: string,
  options: any,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: any,
    family?: number
  ) => void
) {
  if (net.isIP(hostname)) {
    const family = net.isIP(hostname);
    if (isBlockedIp(hostname)) {
      return callback(new Error('Blocked IP'), '', 0);
    }
    return options && (options as any).all
      ? callback(null, [{ address: hostname, family }] as any, family)
      : callback(null, hostname, family);
  }

  dns.lookup(hostname, options, (err, address: any, family: any) => {
    if (err) return callback(err, '', 0);
    if (Array.isArray(address)) {
      for (const entry of address) {
        if (isBlockedIp(entry.address)) {
          return callback(new Error('Blocked IP'), '', 0);
        }
      }
      return callback(null, address as any, 0);
    }
    if (isBlockedIp(address)) {
      return callback(new Error('Blocked IP'), '', 0);
    }
    callback(null, address, family);
  });
}

export const ssrfSafeDispatcher = new Agent({
  connect: {
    lookup: ssrfSafeLookup,
  },
});

// axios can't use an undici dispatcher, but Node's http(s) agents accept the
// same `lookup` hook, so axios requests (providers that need form-data /
// stream uploads) get the identical pinned-DNS guard as `this.fetch`.
const ssrfSafeAxios = axios.create({
  httpAgent: new http.Agent({ lookup: ssrfSafeLookup } as http.AgentOptions),
  httpsAgent: new https.Agent({
    lookup: ssrfSafeLookup,
  } as https.AgentOptions),
});

// Self-hosters legitimately connect Postiz to WordPress/Mastodon/Lemmy/Listmonk
// instances that live on a private network (e.g. the same Docker network or VPC).
// Setting DISABLE_SSRF_PROTECTION=true opts those deployments out of the IP
// guard. It stays ON by default so the hosted product is protected.
export function getSsrfSafeDispatcher(): Agent | undefined {
  return process.env.DISABLE_SSRF_PROTECTION === 'true'
    ? undefined
    : ssrfSafeDispatcher;
}

export function getSsrfSafeAxios(): AxiosInstance {
  return process.env.DISABLE_SSRF_PROTECTION === 'true' ? axios : ssrfSafeAxios;
}

export type SsrfSafeFetchOptions = {
  // http: is only accepted when the caller really has to read plain-http pages
  allowHttp?: boolean;
  maxRedirects?: number;
  timeoutMs?: number;
};

// Fetches a user-influenced URL. `fetch` follows redirects by default, which
// bypasses any URL check done before the request (see GHSA-34w8-5j2v-h6ww),
// so redirects are followed manually and every hop is re-validated, on top of
// the pinned-DNS dispatcher that guards the connection itself.
export async function ssrfSafeFetch(
  url: string,
  init: RequestInit = {},
  {
    allowHttp = false,
    maxRedirects = 5,
    timeoutMs = 15_000,
  }: SsrfSafeFetchOptions = {}
): Promise<Response> {
  const protocols = allowHttp ? ['https:', 'http:'] : ['https:'];
  const signal = AbortSignal.timeout(timeoutMs);
  let currentUrl = url;
  let method = init.method || 'GET';
  let body = init.body;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const safe =
      process.env.DISABLE_SSRF_PROTECTION === 'true'
        ? protocols.includes(new URL(currentUrl).protocol)
        : await isSafePublicUrl(currentUrl, protocols);
    if (!safe) {
      throw new Error('Blocked URL');
    }

    const response = await fetch(currentUrl, {
      ...init,
      method,
      body,
      signal,
      redirect: 'manual',
      // @ts-ignore — undici option, not in lib.dom fetch types
      dispatcher: getSsrfSafeDispatcher(),
    });

    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => undefined);
    if (!location) {
      throw new Error('Redirect without Location');
    }

    currentUrl = new URL(location, currentUrl).toString();
    // like a browser: 303, and 301/302 on a POST, continue as a body-less GET
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        method === 'POST')
    ) {
      method = 'GET';
      body = undefined;
    }
  }

  throw new Error('Too many redirects');
}

// Reads a response body as text and gives up once it grows past `maxBytes`.
export async function readResponseText(
  response: Response,
  maxBytes: number
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }

  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error('Response too large');
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}
