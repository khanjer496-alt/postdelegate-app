import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// Password logins are limited per account, on top of the per client address
// limits: after MAX_FAILURES failed logins for the same email within WINDOW
// seconds the email is locked for WINDOW seconds, and every attempt is
// rejected with the normal "invalid user name or password" error whether or
// not the account exists. A successful login clears the counter. Redis is the
// only state; when it is unavailable logins keep working (fail open).
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_LOCKOUT_SECONDS = 15 * 60;

@Injectable()
export class LoginLockoutService {
  // replaced in tests
  public redis = ioRedis;

  // the email is hashed so no address is kept in Redis keys
  private key(kind: 'failures' | 'locked', email: string) {
    const hash = createHash('sha256')
      .update(email.trim().toLowerCase())
      .digest('hex');
    return `login-${kind}:${hash}`;
  }

  async isLocked(email: string): Promise<boolean> {
    try {
      return !!(await this.redis.get(this.key('locked', email)));
    } catch (err) {
      console.error('Login lockout check failed', (err as Error).message);
      return false;
    }
  }

  async recordFailure(email: string): Promise<void> {
    try {
      const failures = this.key('failures', email);
      const count = await this.redis.incr(failures);
      if (count === 1) {
        await this.redis.expire(failures, LOGIN_LOCKOUT_SECONDS);
      }
      if (count >= LOGIN_MAX_FAILURES) {
        await this.redis.set(
          this.key('locked', email),
          '1',
          'EX',
          LOGIN_LOCKOUT_SECONDS
        );
        await this.redis.del(failures);
      }
    } catch (err) {
      console.error('Login failure was not recorded', (err as Error).message);
    }
  }

  async clear(email: string): Promise<void> {
    try {
      await this.redis.del(
        this.key('failures', email),
        this.key('locked', email)
      );
    } catch (err) {
      console.error('Login counter was not cleared', (err as Error).message);
    }
  }
}
