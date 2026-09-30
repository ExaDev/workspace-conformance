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

  it('does not search the paths exclude names', async () => {
    const violations = await singleStorybook({ cwd: fixturePath('storybook', 'violating'), options: { exclude: ['apps/**'] } });

    expect(violations.map((violation) => violation.file)).toEqual(['packages/ui/.storybook']);
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

  it('accepts a release config that lists no types when every commit type is a preset type', async () => {
    expect(await run('preset-only')).toEqual([]);
  });

  it('accepts preset types left out of the release rules, since a type that does not release needs no rule', async () => {
    expect(await run('non-releasing-omitted')).toEqual([]);
  });

  it('reports a type no preset knows when the release config lists no rules at all, and asks for no changelog section when none are listed', async () => {
    expect((await run('custom-without-rules')).map((violation) => [violation.code, violation.file])).toEqual([['commit-types/no-release-rule', 'release.config.ts']]);
  });

  describe('a type-enum rule that does not list the accepted types', () => {
    const release = `export default { plugins: [['@semantic-release/commit-analyzer', { releaseRules: [{ type: 'feat', release: 'minor' }] }], '@semantic-release/release-notes-generator'] };`;

    async function codesOf(rule: string): Promise<readonly string[]> {
      const cwd = await makeTempDir();
      await writeFiles(cwd, {
        'commitlint.config.ts': `export default { extends: ['@commitlint/config-conventional'], rules: { 'type-enum': ${rule} } };`,
        'release.config.ts': release,
      });

      return (await commitTypes({ cwd, options: {} })).map((violation) => violation.code);
    }

    it('reads a never rule as forbidding types, so its types need no release rule or section', async () => {
      expect(await codesOf("[2, 'never', ['wip']]")).toEqual([]);
    });

    it('reports a release rule for a type a never rule forbids', async () => {
      expect(await codesOf("[2, 'never', ['feat']]")).toEqual(['commit-types/release-rule-not-a-commit-type']);
    });

    it('reads a rule that is off as accepting every type', async () => {
      expect(await codesOf("[0, 'always', ['fix', 'deps']]")).toEqual([]);
    });

    it('rejects a rule whose condition is neither always nor never', async () => {
      await expect(codesOf("[2, 'sometimes', ['feat']]")).rejects.toThrow("must be written as [level, 'always' or 'never', [types]]");
    });
  });

  it('reports a type without a release rule or a changelog section, and one that commitlint would reject', async () => {
    const violations = await run('violating');

    expect(violations.map((violation) => [violation.code, violation.file, violation.message])).toEqual([
      ['commit-types/no-release-rule', 'release.config.ts', "'deps' is a commit type in commitlint.config.ts that no preset knows, and release.config.ts has no release rule for it"],
      ['commit-types/release-rule-not-a-commit-type', 'commitlint.config.ts', "'perf' has a release rule in release.config.ts but is not a commit type in commitlint.config.ts"],
      ['commit-types/no-changelog-section', 'release.config.ts', "'deps' is a commit type in commitlint.config.ts that no preset knows, and release.config.ts has no changelog section for it"],
      ['commit-types/changelog-section-not-a-commit-type', 'commitlint.config.ts', "'docs' has a changelog section in release.config.ts but is not a commit type in commitlint.config.ts"],
    ]);
  });

  it('reports a release rule for a type no preset knows when commitlint sets no type-enum, since the commit types cannot be read', async () => {
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

  it('does not search the paths exclude names', async () => {
    const violations = await dockerfilePackageManager({ cwd: fixturePath('dockerfile', 'violating'), options: { exclude: ['docker/**'] } });

    expect(violations.map((violation) => violation.file)).toEqual(['Dockerfile']);
  });

  it('reads the Dockerfiles the options name', async () => {
    const violations = await dockerfilePackageManager({ cwd: fixturePath('dockerfile', 'violating'), options: { dockerfiles: ['Dockerfile'] } });

    expect(violations.map((violation) => violation.file)).toEqual(['Dockerfile']);
  });

  describe('a pin that refers to a variable', () => {
    const packageJson = '{ "packageManager": "pnpm@10.4.1+sha512.abc" }';

    async function violationsOf(dockerfile: string): Promise<readonly (readonly [string, number])[]> {
      const cwd = await makeTempDir();
      await writeFiles(cwd, { 'package.json': packageJson, Dockerfile: dockerfile });

      return (await dockerfilePackageManager({ cwd, options: {} })).map((violation) => [violation.message, violation.location?.line ?? 0]);
    }

    it('accepts a variable whose value is the declared version, however it is written or set', async () => {
      const dockerfile = [
        'ARG PNPM_VERSION=10.4.1',
        'RUN corepack prepare pnpm@${PNPM_VERSION} --activate',
        'RUN npm i -g pnpm@$PNPM_VERSION',
        'ENV PNPM_VERSION="10.4.1+sha512.abc"',
        'RUN npm i -g pnpm@${PNPM_VERSION}',
        'ENV OTHER 10.4.1',
        'RUN npm i -g pnpm@$OTHER',
        'ENV A=1 B=10.4.1',
        'RUN npm i -g pnpm@$B',
      ].join('\n');

      expect(await violationsOf(dockerfile)).toEqual([]);
    });

    it('compares the value in effect at the pin', async () => {
      const dockerfile = ['ARG PNPM_VERSION=10.4.1', 'RUN npm i -g pnpm@$PNPM_VERSION', 'ARG PNPM_VERSION=9.0.0', 'RUN npm i -g pnpm@$PNPM_VERSION'].join('\n');

      expect(await violationsOf(dockerfile)).toEqual([['Dockerfile pins pnpm@9.0.0 but packageManager in package.json is pnpm@10.4.1', dockerfile.split('\n').length]]);
    });

    it('does not compare a variable the file gives no value', async () => {
      const dockerfile = ['ARG PNPM_VERSION', 'RUN npm i -g pnpm@$PNPM_VERSION', 'RUN npm i -g pnpm@${UNSET}', 'ENV NESTED=$PNPM_VERSION', 'RUN npm i -g pnpm@$NESTED'].join('\n');

      expect(await violationsOf(dockerfile)).toEqual([]);
    });
  });

  describe('what counts as a pin', () => {
    it('stops the version at punctuation and does not read a longer package name as a package manager', async () => {
      const cwd = await makeTempDir();
      await writeFiles(cwd, {
        'package.json': '{ "packageManager": "pnpm@10.4.1" }',
        Dockerfile: ['RUN echo "pnpm@10.4.1," && pnpm dlx create-pnpm@1.0.0', 'RUN npm i -g @scope/pnpm@2.0.0 pnpm@10.4.1;'].join('\n'),
      });

      expect(await dockerfilePackageManager({ cwd, options: {} })).toEqual([]);
    });
  });

  it('reports a package.json with no packageManager', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, { 'package.json': '{ "name": "x" }' });

    expect((await dockerfilePackageManager({ cwd, options: {} })).map((violation) => violation.code)).toEqual(['dockerfile-package-manager/no-package-manager']);
  });
});
