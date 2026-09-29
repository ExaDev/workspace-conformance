import type { StrykerOptions } from '@stryker-mutator/api/core';

const config: Partial<StrykerOptions> = {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  // Explicit, not Stryker's auto-discovery, which resolves `@stryker-mutator/*` plugins relative to where `@stryker-mutator/core` physically lives; under pnpm's isolated node_modules that is a different resolution root than this config's own directory.
  plugins: ['@stryker-mutator/typescript-checker', '@stryker-mutator/vitest-runner'],
  checkers: ['typescript'],
  coverageAnalysis: 'perTest',
  // cli.ts only forwards process arguments and streams to runCommand, so no test in this project can observe a mutant in it; the packaged-install check runs it.
  mutate: ['src/**/*.ts', '!src/**/*.test.ts', '!src/cli.ts'],
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  reporters: ['html', 'clear-text', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  thresholds: { high: 100, low: 100, break: 100 },
};

export default config;
