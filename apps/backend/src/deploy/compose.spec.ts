import { readFileSync } from 'fs';
import { join } from 'path';

// deploy/postdelegate/compose.yaml is the committed copy of what runs in
// production. Audit findings A5 and A7: Redis had no password and was reachable
// from every container on the network, and nothing stopped a process gaining
// privileges. These assert the hardening is still there, since a merge or an
// edit on the server can quietly undo it.
// (The spec lives here because jest only looks under apps/*/src and
// libraries/*/src.)

const deploy = join(__dirname, '..', '..', '..', '..', 'deploy', 'postdelegate');
const compose = readFileSync(join(deploy, 'compose.yaml'), 'utf8');
// staging is a separate Compose project with its own Redis, so the same
// hardening has to be asserted there or staging quietly keeps an open one
const staging = readFileSync(join(deploy, 'staging', 'compose.yaml'), 'utf8');

describe('the committed compose file', () => {
  it('denies privilege escalation for every service, via the shared anchor', () => {
    expect(compose).toContain('no-new-privileges:true');
    // on the anchor rather than one service, so a new service inherits it
    const anchor = compose.slice(
      compose.indexOf('x-service: &service'),
      compose.indexOf('services:')
    );
    expect(anchor).toContain('no-new-privileges:true');
  });

  it('requires a Redis password, with no default to fall back to', () => {
    expect(compose).toContain('--requirepass');
    // ":?" makes Compose refuse to start rather than run an open Redis
    expect(compose).toMatch(/POSTIZ_REDIS_PASSWORD:\?/);
    expect(compose).not.toMatch(/POSTIZ_REDIS_PASSWORD:-/);
  });

  it('points the app at Redis with credentials', () => {
    const url = compose.match(/REDIS_URL: (\S+)/)?.[1] ?? '';
    expect(url).toContain('POSTIZ_REDIS_PASSWORD');
    expect(url).not.toBe('redis://redis:6379');
  });

  it('keeps the password out of the healthcheck command', () => {
    const healthchecks = compose
      .split('\n')
      .filter((line) => line.includes('redis-cli'));
    expect(healthchecks.length).toBeGreaterThan(0);
    for (const line of healthchecks) {
      expect(line).not.toContain('POSTIZ_REDIS_PASSWORD');
      expect(line).not.toContain('-a ');
    }
  });

  it('drops all capabilities from redis, which needs none', () => {
    const redis = compose.slice(
      compose.indexOf('\n  redis:'),
      compose.indexOf('\n  temporal-postgresql:')
    );
    expect(redis).toContain('cap_drop');
    expect(redis).toContain('- ALL');
  });

  // The trap this test exists for: the redis image's entrypoint starts as root
  // and switches user with gosu, which needs SETUID/SETGID. cap_drop ALL on its
  // own makes Redis exit with "setpriv: setresuid failed", and because the app
  // depends_on redis being healthy, the whole stack fails to start. Running as
  // the redis user skips the switch, so the two settings only work together.
  it('runs redis as the redis user wherever it drops capabilities', () => {
    const redis = compose.slice(
      compose.indexOf('\n  redis:'),
      compose.indexOf('\n  temporal-postgresql:')
    );
    if (redis.includes('cap_drop')) {
      expect(redis).toMatch(/\n\s+user: (redis|"?999)/);
    }
  });

  // The committed Caddyfile keeps the staging basic-auth login as a
  // {$PLACEHOLDER}. Caddy expands an unset placeholder to an empty string and
  // still reports a valid config, so a missing env_file does not fail loudly -
  // it silently removes staging's gate.
  it('gives caddy the env file its Caddyfile placeholders need', () => {
    const caddy = compose.slice(compose.indexOf('\n  caddy:'));
    expect(caddy).toContain('env_file');
    expect(caddy).toContain('/etc/postiz/caddy.env');
  });

  // Caddy reverse-proxies staging.postdelegate.com to a container in the
  // separate staging project. While this was an attachment made by hand,
  // recreating caddy dropped it and every staging page became a 502.
  it('puts caddy on the staging project network as well as its own', () => {
    const caddy = compose.slice(
      compose.indexOf('\n  caddy:'),
      compose.indexOf('\nnetworks:')
    );
    expect(caddy).toMatch(/networks:\s*\n\s*- default\s*\n\s*- staging/);
    const networks = compose.slice(compose.indexOf('\nnetworks:'));
    // external, so this project never creates or removes the staging network
    expect(networks).toMatch(/staging:\s*\n\s*external: true\s*\n\s*name: postdelegate-staging/);
  });

  it('publishes no database or cache port to the host', () => {
    // only Caddy may be reachable from outside the Compose network
    const published = compose
      .split('\n')
      .filter((line) => /^\s+- \d+:\d+|^\s+- "\d+:\d+/.test(line));
    for (const line of published) {
      expect(line).toMatch(/- "?(80|443):/);
    }
    expect(compose).not.toMatch(/\n\s+- \d+:5432/);
    expect(compose).not.toMatch(/\n\s+- \d+:6379/);
  });
}
  describe('staging mirrors the production hardening', () => {
    it('denies privilege escalation on its shared anchor', () => {
      const anchor = staging.slice(
        staging.indexOf('x-service: &service'),
        staging.indexOf('services:')
      );
      expect(anchor).toContain('no-new-privileges:true');
    });

    it('requires a Redis password, with no default', () => {
      expect(staging).toContain('--requirepass');
      expect(staging).toMatch(/POSTIZ_REDIS_PASSWORD:\?/);
      expect(staging).not.toMatch(/POSTIZ_REDIS_PASSWORD:-/);
    });

    it('runs its redis as the redis user wherever it drops capabilities', () => {
      const redis = staging.slice(
        staging.indexOf('\n  app-redis:'),
        staging.indexOf('\n  temporal-db:')
      );
      if (redis.includes('cap_drop')) {
        expect(redis).toMatch(/\n\s+user: (redis|"?999)/);
      }
    });

    it('publishes no host ports at all', () => {
      expect(staging).not.toMatch(/\n\s+ports:/);
    });
  });
});
