// Zips dist/ into postdelegate-extension-<version>.zip for the Chrome Web Store.
// The manifest must sit at the root of the archive, so zip from inside dist/.
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const out = resolve(root, `postdelegate-extension-${version}.zip`);

if (!existsSync(resolve(dist, 'manifest.json'))) {
  console.error('dist/manifest.json not found, run "pnpm run build" first.');
  process.exit(1);
}

rmSync(out, { force: true });
execFileSync('zip', ['-r', '-X', out, '.', '-x', '*.map', '-x', '.DS_Store'], {
  cwd: dist,
  stdio: 'inherit',
});
console.log(`\n${out} (${(statSync(out).size / 1024).toFixed(1)} KB)`);
