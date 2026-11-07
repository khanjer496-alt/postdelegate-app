import { readFileSync } from 'fs';
import { join } from 'path';

// deploy/postdelegate/Caddyfile is the committed copy of what runs in front of
// the app. Whether it LOADS is checked by Caddy itself, in the Caddy config
// step of .github/workflows/build.yml - it had drifted into a state Caddy
// refuses (a matcher declared twice) and nothing noticed. These are the two
// things Caddy cannot judge: what belongs in the file and what does not.
// (The spec lives here because jest only looks under apps/*/src and
// libraries/*/src.)

const caddyfile = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'deploy', 'postdelegate', 'Caddyfile'),
  'utf8'
);

describe('the committed Caddyfile security headers', () => {
  // Audit finding A9. Both site blocks get these, so a header is never only on
  // production or only on staging.
  const blocks = caddyfile
    .split(/^(?=\S.*\{$)/m)
    .filter((block) => /^(app|staging)\.postdelegate\.com \{/.test(block));

  it('has both site blocks', () => {
    expect(blocks).toHaveLength(2);
  });

  it.each(['app', 'staging'])('%s: narrows what the page may load', (name) => {
    const block = blocks.find((b) => b.startsWith(`${name}.`)) as string;
    const csp = block.match(/Content-Security-Policy "([^"]+)"/)?.[1] ?? '';
    expect(csp).toContain("frame-ancestors 'self'");
    // a stolen injection cannot retarget relative URLs or load a plugin
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  it.each(['app', 'staging'])(
    '%s: denies device APIs the app never uses',
    (name) => {
      const block = blocks.find((b) => b.startsWith(`${name}.`)) as string;
      const policy =
        block.match(/Permissions-Policy "([^"]+)"/)?.[1] ?? '';
      expect(policy).toContain('camera=()');
      expect(policy).toContain('microphone=()');
      expect(policy).toContain('geolocation=()');
    }
  );

  // Cross-Origin-Opener-Policy is deliberately absent: the social connect
  // flows are popups that talk back through window.opener, and same-origin
  // COOP severs that.
  it('does not set Cross-Origin-Opener-Policy', () => {
    // mentioning it in a comment is fine; setting it is not
    const set = caddyfile
      .split('\n')
      .filter((line) => /^\s*Cross-Origin-Opener-Policy\s+\S/.test(line));
    expect(set).toEqual([]);
  });
});

describe('the committed Caddyfile', () => {
  it('carries no credential', () => {
    // the staging login lives only in the live /opt/postiz/Caddyfile
    expect(caddyfile).not.toMatch(/\$2[aby]\$\d\d\$/);
    expect(caddyfile).toContain('{$STAGING_BASIC_AUTH_USER}');
    expect(caddyfile).toContain('{$STAGING_BASIC_AUTH_HASH}');
  });

  it('offers the source at a name a release does not have to edit', () => {
    // a per-release filename here is what made the live and committed copies
    // drift in the first place, and it cost a caddy restart every release
    expect(caddyfile).toContain('redir * /source/postdelegate-latest.tar.gz');
    expect(caddyfile).not.toMatch(
      /redir \* \/source\/postdelegate-[0-9a-f]{6,}\.tar\.gz/
    );
  });
});
