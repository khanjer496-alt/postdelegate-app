import { ThrottlerGuard } from '@nestjs/throttler';
import {
  createParamDecorator,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { isIP } from 'net';

const isPublicComment = (method: string, url: string) =>
  method === 'POST' && /^\/public\/posts\/[^/]+\/comments/.test(url);

// Starting a Studio render, not cancelling one
const isStudioRender = (method: string, url: string) =>
  method === 'POST' && /\/public\/v1\/studio\/renders\/?(\?.*)?$/.test(url);

// Internal hops (the nginx inside the container, Caddy or another reverse
// proxy on the same host or Docker network) are never the visitor
const isPrivateIp = (ip: string) => {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }

  const lower = ip.toLowerCase();
  return (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  );
};

const cleanIp = (value?: string) => {
  const ip = String(value || '')
    .trim()
    .replace(/^::ffff:/i, '');
  return isIP(ip) ? ip : undefined;
};

// One IPv6 /64 is one household or one attacker, rotating inside it must not
// give a fresh allowance every time
const throttleKey = (ip: string) => {
  if (isIP(ip) !== 6) {
    return ip;
  }

  const [head, tail = ''] = ip.split('::');
  const first = head ? head.split(':') : [];
  const last = tail ? tail.split(':') : [];
  const missing = Math.max(0, 8 - first.length - last.length);
  return [...first, ...Array(missing).fill('0'), ...last]
    .slice(0, 4)
    .join(':');
};

// The address a request really came from, for per-client limits.
//
// Production is Cloudflare > Caddy > nginx (in the container) > backend, and
// every hop appends to X-Forwarded-For, so the leftmost entry is whatever the
// client chose to send and must not be trusted. Instead:
// 1. With TRUST_CF_CONNECTING_IP=true the CF-Connecting-IP header is used.
//    Cloudflare overwrites it on every request, so only enable it when the
//    origin is reachable through Cloudflare only (firewall or Caddy
//    remote_ip allowlist). Otherwise a client talking to the origin directly
//    could send any value
// 2. Otherwise the X-Forwarded-For chain is read from the right, skipping our
//    own private hops, and the first public address is the client (behind
//    Cloudflare that is the Cloudflare edge, which can not be forged)
// 3. Fall back to the socket address
export const getClientIp = (req: Record<string, any>): string => {
  if (process.env.TRUST_CF_CONNECTING_IP === 'true') {
    const cf = cleanIp(req.headers?.['cf-connecting-ip']);
    if (cf) {
      return throttleKey(cf);
    }
  }

  const chain = String(req.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map(cleanIp);
  for (let i = chain.length - 1; i >= 0; i--) {
    const ip = chain[i];
    if (!ip) {
      // an unparseable entry means the chain was tampered with, stop trusting
      break;
    }
    if (!isPrivateIp(ip)) {
      return throttleKey(ip);
    }
  }

  return throttleKey(cleanIp(req.ip) || req.socket?.remoteAddress || 'unknown');
};

// Controller parameter with the hardened client address (getClientIp), in
// place of the unverified X-Forwarded-For based @RealIP()
export const ClientIp = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string =>
    getClientIp(ctx.switchToHttp().getRequest())
);

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  public override async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    const { url, method } = context.switchToHttp().getRequest<Request>();
    if (
      (method === 'POST' && url.includes('/public/v1/posts')) ||
      isStudioRender(method, url) ||
      isPublicComment(method, url)
    ) {
      return super.canActivate(context);
    }

    return true;
  }

  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    if (!req.org) {
      return 'ip_' + getClientIp(req);
    }

    return (
      req.org.id + '_' + (req.url.indexOf('/posts') > -1 ? 'posts' : 'other')
    );
  }
}

// route-level guard for public endpoints, keyed by the client address the
// proxy forwards rather than the org the global guard expects
@Injectable()
export class ThrottlerRealIpGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    return getClientIp(req);
  }
}
