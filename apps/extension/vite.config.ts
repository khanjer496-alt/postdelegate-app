import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, Plugin } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));

// manifest.json is the source of truth for permissions; the version always
// comes from package.json so the zip name and the manifest cannot drift.
const emitManifest = (): Plugin => ({
  name: 'postdelegate-emit-manifest',
  generateBundle() {
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, 'manifest.json'), 'utf8')
    );
    manifest.version = pkg.version;
    this.emitFile({
      type: 'asset',
      fileName: 'manifest.json',
      source: JSON.stringify(manifest, null, 2) + '\n',
    });
  },
});

export default defineConfig(({ mode }) => ({
  root: __dirname,
  base: './',
  publicDir: resolve(__dirname, 'public'),
  resolve: {
    alias: {
      '@postdelegate/node': resolve(__dirname, '../sdk/src/index.ts'),
    },
  },
  plugins: [emitManifest()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'esnext',
    sourcemap: mode === 'development',
    modulePreload: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        background: resolve(__dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
}));
