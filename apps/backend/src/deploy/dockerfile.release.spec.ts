import { readFileSync } from 'fs';
import { join } from 'path';

// deploy/postdelegate/Dockerfile.release builds the apps against the PINNED
// upstream image's node_modules and never copies this repo's package.json, so a
// version bumped in package.json alone does not reach production. Anything this
// repo needs at a specific version has to be installed explicitly in that
// Dockerfile, and this spec is what notices when the two drift apart - which is
// how the @sentry security upgrade nearly shipped as a no-op.

const root = join(__dirname, '..', '..', '..', '..');
const dockerfile = readFileSync(
  join(root, 'deploy', 'postdelegate', 'Dockerfile.release'),
  'utf8'
);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// Packages the release image installs over the base image, and therefore has to
// pin to whatever this repo declares.
const PINNED_IN_RELEASE = [
  '@aws-sdk/client-sesv2',
  '@sentry/nestjs',
  '@sentry/nextjs',
  '@sentry/profiling-node',
  '@sentry/react',
];

describe('the release image dependency pins', () => {
  it.each(PINNED_IN_RELEASE)(
    '%s is installed at exactly the version package.json declares',
    (name) => {
      const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
      expect(declared).toBeDefined();
      // package.json may carry a range (^3.1003.0); the Dockerfile must pin the
      // exact version, or the image and the repo can resolve differently
      const exact = declared.replace(/^[\^~]/, '');
      expect(exact).toMatch(/^\d+\.\d+\.\d+$/);
      expect(dockerfile).toContain(`${name}@${exact}`);
    }
  );

  it.each(PINNED_IN_RELEASE)('%s has its installed version asserted', (name) => {
    const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
    // either named in its own assertion or covered by the loop over @sentry/*
    const asserted =
      dockerfile.includes(`${name}/package.json`) ||
      (name.startsWith('@sentry/') && dockerfile.includes("'@sentry/nestjs',"));
    expect(asserted).toBe(true);
    expect(dockerfile).toContain(declared.replace(/^[\^~]/, ''));
  });
});
