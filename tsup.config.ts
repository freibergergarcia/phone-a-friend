import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  platform: 'node',
  noExternal: ['commander'],
  banner: {
    // Shim CJS require() for bundled dependencies that use it for Node builtins
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
});
