import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  platform: 'node',
  splitting: false,
  noExternal: ['commander', '@inquirer/prompts', 'chalk', 'ora', 'smol-toml'],
  banner: {
    // Shim CJS require() for bundled dependencies that use it for Node builtins
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
});
