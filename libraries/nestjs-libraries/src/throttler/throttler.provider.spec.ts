import { getClientIp } from './throttler.provider';

const req = (headers: Record<string, string>, ip = '127.0.0.1') =>
  ({ headers, ip } as any);

describe('getClientIp', () => {
  afterEach(() => {
    delete process.env.TRUST_CF_CONNECTING_IP;
  });

  it('does not trust the first X-Forwarded-For entry', () => {
    // client sent 1.1.1.1, nginx appended the real peer
    expect(getClientIp(req({ 'x-forwarded-for': '1.1.1.1, 203.0.113.7' }))).toBe(
      '203.0.113.7'
    );
  });

  it('skips our own private hops from the right', () => {
    expect(
      getClientIp(
        req({ 'x-forwarded-for': '9.9.9.9, 198.51.100.4, 172.18.0.5' })
      )
    ).toBe('198.51.100.4');
    expect(getClientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2' }))).toBe(
      '203.0.113.7'
    );
  });

  it('cannot be spoofed with a forged cf-connecting-ip by default', () => {
    expect(
      getClientIp(
        req({
          'cf-connecting-ip': '8.8.8.8',
          'x-forwarded-for': '198.51.100.4, 172.18.0.5',
        })
      )
    ).toBe('198.51.100.4');
  });

  it('uses cf-connecting-ip only when it is trusted', () => {
    process.env.TRUST_CF_CONNECTING_IP = 'true';
    expect(
      getClientIp(
        req({
          'cf-connecting-ip': '8.8.8.8',
          'x-forwarded-for': '198.51.100.4, 172.18.0.5',
        })
      )
    ).toBe('8.8.8.8');
    expect(
      getClientIp(
        req({
          'cf-connecting-ip': 'not-an-ip',
          'x-forwarded-for': '198.51.100.4, 172.18.0.5',
        })
      )
    ).toBe('198.51.100.4');
  });

  it('falls back to the socket address', () => {
    expect(getClientIp(req({}, '203.0.113.9'))).toBe('203.0.113.9');
    expect(getClientIp(req({ 'x-forwarded-for': '10.0.0.1' }, '::ffff:192.0.2.1'))).toBe(
      '192.0.2.1'
    );
  });

  it('stops trusting a chain with a garbage entry', () => {
    expect(
      getClientIp(req({ 'x-forwarded-for': 'garbage, 172.18.0.5' }, '127.0.0.1'))
    ).toBe('127.0.0.1');
  });

  it('keys IPv6 clients by their /64', () => {
    const a = getClientIp(
      req({ 'x-forwarded-for': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' })
    );
    const b = getClientIp(req({ 'x-forwarded-for': '2001:db8:1:2::1' }));
    expect(a).toBe('2001:db8:1:2');
    expect(b).toBe(a);
    expect(getClientIp(req({ 'x-forwarded-for': '2001:db8:1:3::1' }))).not.toBe(a);
  });
});

describe('ThrottlerRealIpGuard', () => {
  // end to end: a forged leading X-Forwarded-For entry does not buy a new allowance
  it('limits per client even when the first X-Forwarded-For entry changes', async () => {
    const { Controller, Get, UseGuards } = await import('@nestjs/common');
    const { Test } = await import('@nestjs/testing');
    const { Throttle, ThrottlerModule } = await import('@nestjs/throttler');
    const { ThrottlerRealIpGuard } = await import('./throttler.provider');

    @Controller('/limited')
    class LimitedController {
      @UseGuards(ThrottlerRealIpGuard)
      @Throttle({ default: { limit: 2, ttl: 60000 } })
      @Get('/')
      hit() {
        return { ok: true };
      }
    }

    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }])],
      controllers: [LimitedController],
      providers: [ThrottlerRealIpGuard],
    }).compile();
    const app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const url = (await app.getUrl()).replace('[::1]', '127.0.0.1') + '/limited';

    const hit = async (forwarded: string) =>
      (await fetch(url, { headers: { 'x-forwarded-for': forwarded } })).status;

    try {
      // nginx appended the real peer 203.0.113.7, the client invented the rest
      expect(await hit('1.1.1.1, 203.0.113.7')).toBe(200);
      expect(await hit('2.2.2.2, 203.0.113.7')).toBe(200);
      expect(await hit('3.3.3.3, 203.0.113.7')).toBe(429);
      // another real client has its own allowance
      expect(await hit('1.1.1.1, 198.51.100.9')).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe('ClientIp', () => {
  afterEach(() => {
    delete process.env.TRUST_CF_CONNECTING_IP;
  });

  // the controller parameter must not trust the leftmost X-Forwarded-For entry
  // the way @RealIP() did
  it('gives controllers the hardened client address', async () => {
    const { Controller, Get } = await import('@nestjs/common');
    const { Test } = await import('@nestjs/testing');
    const { ClientIp } = await import('./throttler.provider');

    @Controller('/ip')
    class IpController {
      @Get('/')
      ip(@ClientIp() ip: string) {
        return { ip };
      }
    }

    const module = await Test.createTestingModule({
      controllers: [IpController],
    }).compile();
    const app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const url = (await app.getUrl()).replace('[::1]', '127.0.0.1') + '/ip';
    const ask = async (headers: Record<string, string>) =>
      ((await (await fetch(url, { headers })).json()) as { ip: string }).ip;

    try {
      expect(await ask({ 'x-forwarded-for': '1.1.1.1, 203.0.113.7' })).toBe(
        '203.0.113.7'
      );
      expect(
        await ask({
          'cf-connecting-ip': '8.8.8.8',
          'x-forwarded-for': '198.51.100.4, 172.18.0.5',
        })
      ).toBe('198.51.100.4');
      process.env.TRUST_CF_CONNECTING_IP = 'true';
      expect(
        await ask({
          'cf-connecting-ip': '8.8.8.8',
          'x-forwarded-for': '198.51.100.4, 172.18.0.5',
        })
      ).toBe('8.8.8.8');
    } finally {
      await app.close();
    }
  });
});

describe('ThrottlerBehindProxyGuard', () => {
  // starting a Studio render is capped per workspace like creating posts;
  // reading or cancelling a render is not
  it('limits starting Studio renders and nothing else of Studio', async () => {
    const { Controller, Get, Param, Post } = await import('@nestjs/common');
    const { APP_GUARD } = await import('@nestjs/core');
    const { Test } = await import('@nestjs/testing');
    const { Throttle, ThrottlerModule } = await import('@nestjs/throttler');
    const { ThrottlerBehindProxyGuard } = await import('./throttler.provider');

    @Controller('/public/v1')
    class StudioRoutes {
      @Throttle({ default: { limit: 2, ttl: 60000 } })
      @Post('/studio/renders')
      start() {
        return { id: 'render-1' };
      }

      @Get('/studio/renders/:id')
      get(@Param('id') id: string) {
        return { id };
      }

      @Post('/studio/renders/:id/cancel')
      cancel(@Param('id') id: string) {
        return { id };
      }
    }

    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 1 }])],
      controllers: [StudioRoutes],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerBehindProxyGuard }],
    }).compile();
    const app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    const call = async (method: string, path: string) =>
      (await fetch(base + path, { method })).status;

    try {
      expect(await call('POST', '/public/v1/studio/renders')).toBe(201);
      expect(await call('POST', '/public/v1/studio/renders')).toBe(201);
      expect(await call('POST', '/public/v1/studio/renders')).toBe(429);
      // the default limit is 1, so these would be refused if they were counted
      for (let i = 0; i < 3; i++) {
        expect(await call('GET', '/public/v1/studio/renders/render-1')).toBe(
          200
        );
        expect(
          await call('POST', '/public/v1/studio/renders/render-1/cancel')
        ).toBe(201);
      }
    } finally {
      await app.close();
    }
  });
});
