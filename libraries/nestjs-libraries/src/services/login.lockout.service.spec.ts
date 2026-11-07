import {
  LOGIN_LOCKOUT_SECONDS,
  LOGIN_MAX_FAILURES,
  LoginLockoutService,
} from '@gitroom/nestjs-libraries/services/login.lockout.service';

// a Redis stand-in with expiry on a controllable clock
const fakeRedis = () => {
  let now = 0;
  const data = new Map<string, { value: string; expiresAt?: number }>();
  const live = (key: string) => {
    const entry = data.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= now) {
      data.delete(key);
      return undefined;
    }
    return entry;
  };
  return {
    advance: (seconds: number) => (now += seconds * 1000),
    keys: () => [...data.keys()],
    get: jest.fn(async (key: string) => live(key)?.value ?? null),
    set: jest.fn(async (key: string, value: string, _ex?: string, seconds?: number) => {
      data.set(key, { value, expiresAt: seconds ? now + seconds * 1000 : undefined });
      return 'OK';
    }),
    incr: jest.fn(async (key: string) => {
      const entry = live(key);
      const next = Number(entry?.value || 0) + 1;
      data.set(key, { value: String(next), expiresAt: entry?.expiresAt });
      return next;
    }),
    expire: jest.fn(async (key: string, seconds: number) => {
      const entry = live(key);
      if (entry) entry.expiresAt = now + seconds * 1000;
      return entry ? 1 : 0;
    }),
    del: jest.fn(async (...keys: string[]) => {
      keys.forEach((key) => data.delete(key));
      return keys.length;
    }),
  };
};

const setup = () => {
  const redis = fakeRedis();
  const service = new LoginLockoutService();
  service.redis = redis as any;
  return { service, redis };
};

const fail = async (service: LoginLockoutService, email: string, times: number) => {
  for (let i = 0; i < times; i++) await service.recordFailure(email);
};

describe('LoginLockoutService', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('locks an email after 10 failures', async () => {
    const { service } = setup();
    await fail(service, 'a@example.com', LOGIN_MAX_FAILURES - 1);
    expect(await service.isLocked('a@example.com')).toBe(false);
    await service.recordFailure('a@example.com');
    expect(await service.isLocked('a@example.com')).toBe(true);
  });

  it('is per email and ignores case and surrounding spaces', async () => {
    const { service } = setup();
    await fail(service, 'A@Example.com ', LOGIN_MAX_FAILURES);
    expect(await service.isLocked('a@example.com')).toBe(true);
    expect(await service.isLocked('b@example.com')).toBe(false);
  });

  it('unlocks after 15 minutes', async () => {
    const { service, redis } = setup();
    await fail(service, 'a@example.com', LOGIN_MAX_FAILURES);
    redis.advance(LOGIN_LOCKOUT_SECONDS - 1);
    expect(await service.isLocked('a@example.com')).toBe(true);
    redis.advance(2);
    expect(await service.isLocked('a@example.com')).toBe(false);
    // and starts counting from zero again
    await fail(service, 'a@example.com', LOGIN_MAX_FAILURES - 1);
    expect(await service.isLocked('a@example.com')).toBe(false);
  });

  it('only counts failures inside the 15 minute window', async () => {
    const { service, redis } = setup();
    await fail(service, 'a@example.com', LOGIN_MAX_FAILURES - 1);
    redis.advance(LOGIN_LOCKOUT_SECONDS + 1);
    await fail(service, 'a@example.com', LOGIN_MAX_FAILURES - 1);
    expect(await service.isLocked('a@example.com')).toBe(false);
  });

  it('does not extend the lock while it is active', async () => {
    const { service, redis } = setup();
    await fail(service, 'a@example.com', LOGIN_MAX_FAILURES);
    redis.advance(LOGIN_LOCKOUT_SECONDS / 2);
    await fail(service, 'a@example.com', 3);
    redis.advance(LOGIN_LOCKOUT_SECONDS / 2 + 1);
    expect(await service.isLocked('a@example.com')).toBe(false);
  });

  it('a successful login clears the counter and the lock', async () => {
    const { service } = setup();
    await fail(service, 'a@example.com', LOGIN_MAX_FAILURES - 1);
    await service.clear('a@example.com');
    await fail(service, 'a@example.com', LOGIN_MAX_FAILURES - 1);
    expect(await service.isLocked('a@example.com')).toBe(false);
    await service.recordFailure('a@example.com');
    expect(await service.isLocked('a@example.com')).toBe(true);
    await service.clear('a@example.com');
    expect(await service.isLocked('a@example.com')).toBe(false);
  });

  it('keeps no email address in Redis keys', async () => {
    const { service, redis } = setup();
    await fail(service, 'someone@example.com', LOGIN_MAX_FAILURES);
    expect(redis.keys().join(' ')).not.toContain('someone');
  });

  it('fails open when Redis is unavailable', async () => {
    const { service, redis } = setup();
    for (const method of ['get', 'incr', 'del'] as const) {
      redis[method].mockRejectedValue(new Error('redis down'));
    }
    expect(await service.isLocked('a@example.com')).toBe(false);
    await expect(service.recordFailure('a@example.com')).resolves.toBeUndefined();
    await expect(service.clear('a@example.com')).resolves.toBeUndefined();
  });
});
