import { defineConfig, type ViteUserConfig } from 'vitest/config';

// Every case that builds a ts-morph program, evaluates a TypeScript config through jiti or runs dependency-cruiser pays a first-load cost, and the command line cases spawn a child process, so hooks get the same allowance.
const SLOW_WORK_TIMEOUT_MS = 30_000;

const config: ViteUserConfig = defineConfig({
  test: {
    // Runs first in every test worker, before any fixture touches git.
    setupFiles: ['test/support/isolate-git.ts'],
    testTimeout: SLOW_WORK_TIMEOUT_MS,
    hookTimeout: SLOW_WORK_TIMEOUT_MS,
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // cli.ts only forwards process arguments and streams to runCommand; the packaged-install check runs it.
      exclude: ['src/**/*.test.ts', 'src/cli.ts'],
    },
  },
});

export default config;
