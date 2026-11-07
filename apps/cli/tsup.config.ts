import { defineConfig } from 'tsup';
import { resolve } from 'path';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node18',
  minify: true,
  clean: true,
  outDir: 'dist',
  banner: { js: '#!/usr/bin/env node' },
  // the SDK is bundled, so the published CLI has no runtime dependencies
  noExternal: ['@postdelegate/node'],
  esbuildOptions(options) {
    options.alias = {
      ...options.alias,
      '@postdelegate/node': resolve(__dirname, '../sdk/src/index.ts'),
    };
  },
});
