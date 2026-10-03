import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { copyFixture, fixturePath, makeTempDir, removeTempDirs, writeFiles } from '../../test/support/temp';
import { ConformanceError } from '../errors';
import { eslint } from './eslint';

afterEach(removeTempDirs);

const REPOSITORY_NODE_MODULES = join(import.meta.dirname, '..', '..', 'node_modules');

/**
 * A directory outside the repository with this repository's installed packages linked in, so ESLint resolves from it but no config file exists in or above it.
 */
async function emptyWorkspaceWithEslint(): Promise<string> {
  const cwd = await makeTempDir();
  await symlink(REPOSITORY_NODE_MODULES, join(cwd, 'node_modules'));

  return cwd;
}

describe('eslint', () => {
  it('reports nothing when the samples are linted with the required rules, whichever form the config writes a severity in', async () => {
    const violations = await eslint({
      cwd: fixturePath('eslint', 'clean'),
      options: { samples: ['src/index.js', { path: 'src/other.js', rules: { 'no-debugger': 'warn' } }], rules: { 'no-console': 'error', eqeqeq: 'error', 'no-var': 'warn' } },
    });

    expect(violations).toEqual([]);
  });

  it('reports a rule that is off, weaker than required or not configured, a sample that is ignored and one no block matches', async () => {
    const violations = await eslint({
      cwd: fixturePath('eslint', 'violating'),
      options: {
        samples: ['src/index.js', 'ignored/hidden.js', 'src/data.json', { path: 'src/index.js', rules: { 'no-debugger': 'warn' } }],
        rules: { 'no-console': 'error', eqeqeq: 'warn' },
      },
    });

    expect(violations).toEqual([
      { code: 'eslint/rule-too-weak', message: "the rule 'no-console' is 'warn' for src/index.js (required: error)", file: 'src/index.js' },
      { code: 'eslint/rule-off', message: "the rule 'eqeqeq' is off for src/index.js (required: warn)", file: 'src/index.js' },
      { code: 'eslint/not-linted', message: 'ignored/hidden.js is not linted: it is ignored, or no configuration block matches it', file: 'ignored/hidden.js' },
      { code: 'eslint/not-linted', message: 'src/data.json is not linted: it is ignored, or no configuration block matches it', file: 'src/data.json' },
      { code: 'eslint/rule-too-weak', message: "the rule 'no-console' is 'warn' for src/index.js (required: error)", file: 'src/index.js' },
      { code: 'eslint/rule-off', message: "the rule 'eqeqeq' is off for src/index.js (required: warn)", file: 'src/index.js' },
      { code: 'eslint/rule-missing', message: "the rule 'no-debugger' is not configured for src/index.js (required: warn)", file: 'src/index.js' },
    ]);
  });

  it('accepts a working directory relative to the process, as every other check does', async () => {
    const options = { samples: ['src/index.js'], rules: { 'no-console': 'error' }, lint: true } as const;
    const absolute = await eslint({ cwd: fixturePath('eslint', 'violating'), options });

    expect(await eslint({ cwd: relative(process.cwd(), fixturePath('eslint', 'violating')), options })).toEqual(absolute);
    expect(absolute.length).toBeGreaterThan(0);
  });

  it('does not judge a rule the sample is not required to have', async () => {
    const violations = await eslint({ cwd: fixturePath('eslint', 'violating'), options: { samples: ['src/index.js'], rules: { 'no-console': 'warn' } } });

    expect(violations).toEqual([]);
  });

  it('lints nothing at the default level, so a file with errors is not reported', async () => {
    const violations = await eslint({ cwd: fixturePath('eslint', 'lint'), options: { samples: ['src/dirty.js'], rules: { 'no-console': 'error' } } });

    expect(violations).toEqual([]);
  });

  it('reports every message of the workspace at the full level, with its rule, file and position', async () => {
    const violations = await eslint({ cwd: fixturePath('eslint', 'lint'), options: { samples: ['src/clean.js'], lint: true } });

    expect(violations).toEqual([
      { code: 'eslint/fatal', message: 'Parsing error: Unexpected token =', file: 'src/broken.js', location: { line: 1, column: 14 } },
      { code: 'eslint/lint/no-console', message: 'no-console (error): Unexpected console statement.', file: 'src/dirty.js', location: { line: 2, column: 3 } },
      { code: 'eslint/lint/eqeqeq', message: "eqeqeq (warn): Expected '===' and instead saw '=='.", file: 'src/dirty.js', location: { line: 2, column: 17 } },
    ]);
  });

  it('lints only the patterns it is given', async () => {
    const violations = await eslint({ cwd: fixturePath('eslint', 'lint'), options: { samples: ['src/clean.js'], lint: true, lintPatterns: ['src/clean.js'] } });

    expect(violations).toEqual([]);
  });

  it('notes how many files it linted, and how many files ESLint would lint that the patterns did not reach', async () => {
    const notes: string[] = [];
    const note = (text: string): void => {
      notes.push(text);
    };

    await eslint({ cwd: fixturePath('eslint', 'lint'), options: { samples: [], lint: true }, note });
    await eslint({ cwd: fixturePath('eslint', 'lint'), options: { samples: [], lint: true, lintPatterns: ['src/clean.js'] }, note });

    expect(notes).toEqual(['linted 4 files', 'linted 1 file; 3 other files have an ESLint configuration and were not reached by lintPatterns (src/clean.js)']);
  });

  it('notes nothing at the default level, which lints no file', async () => {
    const notes: string[] = [];

    await eslint({
      cwd: fixturePath('eslint', 'lint'),
      options: { samples: ['src/clean.js'] },
      note: (text) => {
        notes.push(text);
      },
    });

    expect(notes).toEqual([]);
  });

  it('reports a pattern whose files are all ignored, and one that matches no file, as nothing linted', async () => {
    const ignored = await eslint({ cwd: fixturePath('eslint', 'ignores-all'), options: { samples: [], lint: true, lintPatterns: ['src'] } });
    const missing = await eslint({ cwd: fixturePath('eslint', 'clean'), options: { samples: [], lint: true, lintPatterns: ['nowhere'] } });

    expect(ignored).toEqual([{ code: 'eslint/nothing-linted', message: "All files matched by 'src' are ignored.", file: 'src' }]);
    expect(missing).toEqual([{ code: 'eslint/nothing-linted', message: "No files matching 'nowhere' were found.", file: 'nowhere' }]);
  });

  it('judges the config file named in the options instead of the one ESLint finds', async () => {
    const violations = await eslint({
      cwd: fixturePath('eslint', 'clean'),
      options: { samples: ['src/index.js'], rules: { eqeqeq: 'error' }, configFile: '../violating/eslint.config.mjs' },
    });

    expect(violations).toEqual([{ code: 'eslint/rule-off', message: "the rule 'eqeqeq' is off for src/index.js (required: error)", file: 'src/index.js' }]);
  });

  it('reports a repository with no ESLint config and does not fall back to one of its own', async () => {
    const cwd = await emptyWorkspaceWithEslint();

    expect(await eslint({ cwd, options: { samples: ['src/index.js'], rules: { 'no-console': 'error' } } })).toEqual([
      { code: 'eslint/no-config', message: 'ESLint finds no config file for src/index.js; the check does not fall back to a config of its own', file: 'src/index.js' },
    ]);
  });

  it('reports a parsing error that names no position at the file, with no location', async () => {
    const cwd = await emptyWorkspaceWithEslint();
    await writeFiles(cwd, {
      // A parser that fails the way typescript-eslint's project service does for a file outside every tsconfig: an error with a message and no position.
      'eslint.config.mjs': "export default [{ files: ['**/*.js'], languageOptions: { parser: { parseForESLint() { throw new Error('not found by the project service'); } } } }];\n",
      'src/index.js': 'export {};\n',
    });

    expect(await eslint({ cwd, options: { samples: [], lint: true, lintPatterns: ['src'] } })).toEqual([
      { code: 'eslint/fatal', message: 'Parsing error: not found by the project service', file: 'src/index.js' },
    ]);
  });

  it('fails when ESLint does not resolve from the directory the checks run in', async () => {
    const cwd = await copyFixture('eslint', 'clean');

    await expect(eslint({ cwd, options: { samples: ['src/index.js'] } })).rejects.toThrow(/'eslint' does not resolve from/u);
    await expect(eslint({ cwd, options: { samples: ['src/index.js'] } })).rejects.toBeInstanceOf(ConformanceError);
  });

  it("uses the ESLint installed in the directory it checks, not this package's own", async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      'node_modules/eslint/package.json': JSON.stringify({ name: 'eslint', version: '0.0.0', main: 'index.js' }),
      'node_modules/eslint/index.js': `
        class ESLint {
          constructor(options) { this.cwd = options.cwd; }
          async calculateConfigForFile(file) { return { rules: { 'stub-rule': [2, file] } }; }
        }
        module.exports = { ESLint };
      `,
    });

    expect(await eslint({ cwd, options: { samples: ['a.js'], rules: { 'stub-rule': 'error', 'no-console': 'error' } } })).toEqual([
      { code: 'eslint/rule-missing', message: "the rule 'no-console' is not configured for a.js (required: error)", file: 'a.js' },
    ]);
  });

  it('fails when the ESLint that resolves has no Node API class', async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, 'node_modules', 'eslint'), { recursive: true });
    await writeFile(join(cwd, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ name: 'eslint', version: '0.0.0', main: 'index.js' }));
    await writeFile(join(cwd, 'node_modules', 'eslint', 'index.js'), 'module.exports = {};');

    await expect(eslint({ cwd, options: { samples: ['a.js'] } })).rejects.toThrow(/does not export the ESLint class/u);
  });
});
