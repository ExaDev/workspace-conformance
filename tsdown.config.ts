import { defineConfig, type UserConfig } from 'tsdown';

const shared: UserConfig = {
  root: 'src',
  platform: 'node',
  // Keeps the .js (ESM) and .cjs (CJS) extensions package.json's exports map names; on the node platform tsdown would otherwise emit .mjs.
  fixedExtension: false,
};

const config: UserConfig[] = defineConfig([
  { ...shared, entry: ['src/index.ts'], format: ['esm', 'cjs'], dts: true, clean: true },
  // The command line entry is only ever run as the bin, which is an ES module because the package is `type: module`, so it needs neither a CommonJS build nor declarations.
  { ...shared, entry: ['src/cli.ts'], format: ['esm'], dts: false, clean: false },
]);

export default config;
