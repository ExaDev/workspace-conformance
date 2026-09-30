import { afterEach, describe, expect, it } from 'vitest';

import { createGitWorkspace } from '../../test/support/git-workspace';
import { fixturePath, makeTempDir, removeTempDirs, writeFiles } from '../../test/support/temp';
import { ConformanceError } from '../errors';
import { commitTypes } from './commit-types';
import { dockerfilePackageManager } from './dockerfile-package-manager';
import { instructionSymlinks } from './instruction-symlinks';
import { singleStorybook } from './single-storybook';

afterEach(removeTempDirs);

describe('instruction-symlinks', () => {
  it('reports nothing when each instruction file is a git symlink to the README', async () => {
    const cwd = await createGitWorkspace({ 'README.md': '# x\n', 'AGENTS.md': { symlink: 'README.md' }, 'CLAUDE.md': { symlink: 'README.md' } });

    expect(await instructionSymlinks({ cwd, options: {} })).toEqual([]);
  });

  it('judges the index, so a link that a checkout wrote as a plain file is still a link', async () => {
    const cwd = await createGitWorkspace({
      'README.md': '# x\n',
      'AGENTS.md': { indexedSymlink: 'README.md' },
      'CLAUDE.md': { indexedSymlink: 'README.md' },
    });

    expect(await instructionSymlinks({ cwd, options: {} })).toEqual([]);
  });

  it('reports a file that is committed as a regular file, even when it has the README content', async () => {
    const cwd = await createGitWorkspace({ 'README.md': '# x\n', 'AGENTS.md': '# x\n', 'CLAUDE.md': { symlink: 'README.md' } });

    expect(await instructionSymlinks({ cwd, options: {} })).toEqual([
      {
        code: 'instruction-symlinks/not-a-symlink',
        message: 'AGENTS.md is committed as a regular file (mode 100644); commit it as a symbolic link to README.md',
        file: 'AGENTS.md',
      },
    ]);
  });

  it('reports a file that is not tracked at all', async () => {
    const cwd = await createGitWorkspace({ 'README.md': '# x\n', 'CLAUDE.md': { symlink: 'README.md' } });

    expect((await instructionSymlinks({ cwd, options: {} })).map((violation) => [violation.code, violation.file])).toEqual([['instruction-symlinks/missing', 'AGENTS.md']]);
  });

  it('reports a link that points somewhere other than the README', async () => {
    const cwd = await createGitWorkspace({ 'README.md': '# x\n', 'OTHER.md': '# y\n', 'AGENTS.md': { symlink: 'OTHER.md' }, 'CLAUDE.md': { symlink: 'README.md' } });

    expect(await instructionSymlinks({ cwd, options: {} })).toEqual([
      { code: 'instruction-symlinks/wrong-target', message: 'AGENTS.md links to OTHER.md; it should link to README.md', file: 'AGENTS.md' },
    ]);
  });

  it('reports a link to a README that is not tracked', async () => {
    const cwd = await createGitWorkspace({ 'AGENTS.md': { indexedSymlink: 'README.md' }, 'CLAUDE.md': { indexedSymlink: 'README.md' } });

    expect((await instructionSymlinks({ cwd, options: {} })).map((violation) => [violation.code, violation.file])).toEqual([
      ['instruction-symlinks/dangling', 'AGENTS.md'],
      ['instruction-symlinks/dangling', 'CLAUDE.md'],
    ]);
  });

  it('checks the configured files in the configured directories', async () => {
    const cwd = await createGitWorkspace({
      'packages/a/README.md': '# a\n',
      'packages/a/GEMINI.md': { symlink: 'README.md' },
      'packages/b/README.md': '# b\n',
      'packages/b/GEMINI.md': '# b\n',
    });

    const violations = await instructionSymlinks({ cwd, options: { files: ['GEMINI.md'], directories: ['packages/*'] } });

    expect(violations.map((violation) => [violation.code, violation.file])).toEqual([['instruction-symlinks/not-a-symlink', 'packages/b/GEMINI.md']]);
  });

  it('takes the target from the options', async () => {
    const cwd = await createGitWorkspace({ 'GUIDE.md': '# x\n', 'AGENTS.md': { symlink: 'GUIDE.md' }, 'CLAUDE.md': { symlink: 'GUIDE.md' } });

    expect(await instructionSymlinks({ cwd, options: { target: 'GUIDE.md' } })).toEqual([]);
  });

  it('fails outside a git working tree', async () => {
    const cwd = await makeTempDir();

    await expect(instructionSymlinks({ cwd, options: {} })).rejects.toThrow(ConformanceError);
  });
});

describe('single-storybook', () => {
  it('accepts one Storybook at the workspace root', async () => {
    expect(await singleStorybook({ cwd: fixturePath('storybook', 'clean'), options: {} })).toEqual([]);
  });

  it('reports each Storybook outside the root, including one inside a package', async () => {
    const violations = await singleStorybook({ cwd: fixturePath('storybook', 'violating'), options: {} });

    expect(violations.map((violation) => [violation.code, violation.file])).toEqual([
      ['single-storybook/misplaced', 'apps/docs/.storybook'],
      ['single-storybook/misplaced', 'packages/ui/.storybook'],
    ]);
  });

  it('permits the Storybook in the directory the options name instead of the root', async () => {
    const violations = await singleStorybook({ cwd: fixturePath('storybook', 'violating'), options: { location: 'packages/ui' } });

    expect(violations.map((violation) => violation.file)).toEqual(['.storybook', 'apps/docs/.storybook']);
  });
});

describe('commit-types', () => {
  const run = async (name: string) => commitTypes({ cwd: fixturePath('commit-types', name), options: {} });

  it('accepts lists that agree, ignoring rules that name no type', async () => {
    expect(await run('clean')).toEqual([]);
  });

  it('accepts lists derived from one shared constant, since both configs are evaluated', async () => {
    expect(await run('derived')).toEqual([]);
  });

  it('accepts a release config that lists no types, since there is nothing to compare', async () => {
    expect(await run('preset-only')).toEqual([]);
  });

  it('reports a type without a release rule or a changelog section, and one that commitlint would reject', async () => {
    const violations = await run('violating');

    expect(violations.map((violation) => [violation.code, violation.file, violation.message])).toEqual([
      ['commit-types/no-release-rule', 'release.config.ts', "'deps' is a commit type in commitlint.config.ts with no release rule in release.config.ts"],
      ['commit-types/release-rule-not-a-commit-type', 'commitlint.config.ts', "'perf' has a release rule in release.config.ts but is not a commit type in commitlint.config.ts"],
      ['commit-types/no-changelog-section', 'release.config.ts', "'deps' is a commit type in commitlint.config.ts with no changelog section in release.config.ts"],
      ['commit-types/changelog-section-not-a-commit-type', 'commitlint.config.ts', "'docs' has a changelog section in release.config.ts but is not a commit type in commitlint.config.ts"],
    ]);
  });

  it('reports release rules that cannot be compared with a commitlint config that sets no type-enum', async () => {
    expect((await run('no-type-enum')).map((violation) => violation.code)).toEqual(['commit-types/no-type-enum']);
  });

  it('reports a config file that does not exist', async () => {
    expect(await run('missing-release')).toEqual([{ code: 'commit-types/missing-config', message: 'release.config.ts does not exist', file: 'release.config.ts' }]);
  });

  it('reads the config files the options name', async () => {
    const violations = await commitTypes({ cwd: fixturePath('commit-types', 'clean'), options: { commitlint: 'nowhere.ts', release: 'release.config.ts' } });

    expect(violations.map((violation) => violation.code)).toEqual(['commit-types/missing-config']);
  });
});

describe('dockerfile-package-manager', () => {
  it('accepts pins equal to packageManager, ignoring the +sha suffix, comments and other package managers', async () => {
    expect(await dockerfilePackageManager({ cwd: fixturePath('dockerfile', 'clean'), options: {} })).toEqual([]);
  });

  it('reports each pin that differs, with its position', async () => {
    const violations = await dockerfilePackageManager({ cwd: fixturePath('dockerfile', 'violating'), options: {} });

    expect(violations).toEqual([
      {
        code: 'dockerfile-package-manager/version-mismatch',
        message: 'Dockerfile pins pnpm@10.0.0 but packageManager in package.json is pnpm@12.4.1',
        file: 'Dockerfile',
        location: { line: 2, column: 22 },
      },
      {
        code: 'dockerfile-package-manager/version-mismatch',
        message: 'docker/app.Dockerfile pins pnpm@latest but packageManager in package.json is pnpm@12.4.1',
        file: 'docker/app.Dockerfile',
        location: { line: 1, column: 20 },
      },
    ]);
  });

  it('reads the Dockerfiles the options name', async () => {
    const violations = await dockerfilePackageManager({ cwd: fixturePath('dockerfile', 'violating'), options: { dockerfiles: ['Dockerfile'] } });

    expect(violations.map((violation) => violation.file)).toEqual(['Dockerfile']);
  });

  it('reports a package.json with no packageManager', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, { 'package.json': '{ "name": "x" }' });

    expect((await dockerfilePackageManager({ cwd, options: {} })).map((violation) => violation.code)).toEqual(['dockerfile-package-manager/no-package-manager']);
  });
});
