import { type Config, defineConfig } from 'eslint/config';
import js from '@eslint/js';
import exadev from '@exadev/eslint-config';

const config: Config[] = defineConfig(
  {
    ignores: [
      'dist',
      'coverage',
      'node_modules',
      'reports',
      '.stryker-tmp',
      // Workspaces the checks are run against on purpose, each with deliberate violations; the project's own typecheck and lint must not see them.
      'test/fixtures',
      // Plain Node scripts that run in a scratch project against the installed tarball, outside this project's TypeScript program.
      'test/package',
    ],
  },
  {
    languageOptions: {
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
  },
  { ...js.configs.recommended, files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'] },
  ...exadev,
);

export default config;
