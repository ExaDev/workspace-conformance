import { ConfigValidationError, type LayoutConfig } from '@exadev/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { importsLayout } from '../test/support/layouts';
import { fixturePath, makeTempDir, removeTempDirs, writeFiles } from '../test/support/temp';
import type { ConformanceConfig } from './config';
import { ConformanceError } from './errors';
import type { GitHubClient } from './github';
import { EXIT_CODES, runChecks } from './run-checks';

const violating = fixturePath('imports', 'violating');
const clean = fixturePath('imports', 'clean');
const importChecks: ConformanceConfig = {
  checks: { 'import-uphill': {}, 'import-rank-skip': {}, 'import-cross-slice': {}, 'import-isolated-groups': {}, 'import-cycles': {} },
};

afterEach(removeTempDirs);

describe('runChecks with the sections supplied', () => {
  it('runs every enabled check in registry order and exits 1 when any finds a violation', async () => {
    const result = await runChecks({ cwd: violating, config: importChecks, layout: importsLayout });

    expect(result.results.map((entry) => entry.check)).toEqual(['import-uphill', 'import-rank-skip', 'import-cross-slice', 'import-isolated-groups', 'import-cycles']);
    expect(result.results.map((entry) => entry.violations.length)).toEqual([1, 1, 2, 1, 1]);
    expect(result.violations).toEqual(result.results.flatMap((entry) => entry.violations));
    expect(result.exitCode).toBe(EXIT_CODES.violations);
  });

  it('validates the sections passed in as it does the ones it loads', async () => {
    const isolatingUndeclared = { ...importsLayout, isolatedGroups: [['core', 'undeclared']] satisfies LayoutConfig['isolatedGroups'] };
    const emptyContracts: ConformanceConfig = { checks: { 'aggregate-mappers': { contracts: [], mapper: 'x' } } };

    await expect(runChecks({ cwd: clean, config: importChecks, layout: isolatingUndeclared })).rejects.toThrow(ConfigValidationError);
    await expect(runChecks({ cwd: clean, config: emptyContracts })).rejects.toThrow(ConfigValidationError);
  });

  it('exits 0 when nothing is found', async () => {
    const result = await runChecks({ cwd: clean, config: importChecks, layout: importsLayout });

    expect(result.violations).toEqual([]);
    expect(result.exitCode).toBe(EXIT_CODES.clean);
  });

  it('runs only the requested checks, in registry order', async () => {
    const result = await runChecks({ cwd: violating, config: importChecks, layout: importsLayout, checks: ['import-cycles', 'import-uphill'] });

    expect(result.results.map((entry) => entry.check)).toEqual(['import-uphill', 'import-cycles']);
  });

  it('does not run a check that is switched off', async () => {
    const result = await runChecks({ cwd: violating, config: { checks: { ...importChecks.checks, 'import-cycles': false } }, layout: importsLayout });

    expect(result.results.map((entry) => entry.check)).not.toContain('import-cycles');
  });

  it('fails when no check is enabled', async () => {
    await expect(runChecks({ cwd: clean, config: { checks: {} } })).rejects.toThrow("no check is enabled");
  });

  it('fails when a requested check is not enabled', async () => {
    await expect(runChecks({ cwd: clean, config: { checks: { 'import-uphill': {} } }, layout: importsLayout, checks: ['import-cycles', 'import-rank-skip'] })).rejects.toThrow(
      'import-cycles, import-rank-skip are not enabled',
    );
    await expect(runChecks({ cwd: clean, config: { checks: { 'import-uphill': {} } }, layout: importsLayout, checks: ['import-cycles'] })).rejects.toThrow('import-cycles is not enabled');
  });

  it('needs no layout for checks that do not read it', async () => {
    const result = await runChecks({ cwd: fixturePath('storybook', 'clean'), config: { checks: { 'single-storybook': {} } } });

    expect(result.exitCode).toBe(EXIT_CODES.clean);
  });
});

describe('runChecks loading the sections from the working directory', () => {
  it('reads standalone exadev.conformance.config.ts and exadev.layout.config.ts', async () => {
    const result = await runChecks({ cwd: violating });

    expect(result.results).toHaveLength(Object.keys(importChecks.checks).length);
    expect(result.exitCode).toBe(EXIT_CODES.violations);
  });

  it('reads both sections from exadev.config.ts, where the authoring file imports the tool by name', async () => {
    const result = await runChecks({ cwd: fixturePath('unified'), configFiles: { alias: { 'workspace-conformance': fixturePath('..', '..', 'src') } } });

    expect(result.results.map((entry) => entry.check)).toEqual(['import-uphill', 'single-storybook']);
    expect(result.violations.map((violation) => violation.file)).toEqual(['../imports/violating/core/kernel/src/index.ts']);
  });

  it('fails when a directory has no conformance section', async () => {
    await expect(runChecks({ cwd: fixturePath('storybook', 'clean') })).rejects.toThrow("no 'conformance' section");
  });

  it('fails when a check reads the layout and the directory has none', async () => {
    const config: ConformanceConfig = { checks: { 'import-uphill': {} } };

    await expect(runChecks({ cwd: fixturePath('storybook', 'clean'), config })).rejects.toThrow(ConformanceError);
    await expect(runChecks({ cwd: fixturePath('storybook', 'clean'), config })).rejects.toThrow("no 'layout' section");
  });

  it('fails when a section is defined in both files', async () => {
    await expect(runChecks({ cwd: fixturePath('duplicate') })).rejects.toThrow('defined in both');
  });
});

describe('runChecks with configFiles', () => {
  it('applies the alias to the config files a check evaluates, as it does to the sections', async () => {
    const shared = await makeTempDir();
    const workspace = await makeTempDir();
    await writeFiles(shared, { 'types.ts': "export const types = ['feat', 'fix'];\n" });
    await writeFiles(workspace, {
      'commitlint.config.ts': "import { types } from '@shared/types';\nexport default { rules: { 'type-enum': [2, 'always', types] } };\n",
      'release.config.ts': 'export default {};\n',
    });
    const config: ConformanceConfig = { checks: { 'commit-types': {} } };

    expect((await runChecks({ cwd: workspace, config, configFiles: { alias: { '@shared': shared } } })).violations).toEqual([]);
    await expect(runChecks({ cwd: workspace, config })).rejects.toThrow();
  });
});

describe('runChecks with the settings checks', () => {
  const settings: ConformanceConfig = { checks: { 'workflow-merge-group': {}, 'settings-review-thread-resolution': { repository: 'example-org/example-repo' } } };
  const github: GitHubClient = {
    repository: vi.fn<GitHubClient['repository']>().mockResolvedValue({ defaultBranch: 'main', allowRebaseMerge: true, allowSquashMerge: false, allowMergeCommit: false }),
    branchRules: vi.fn<GitHubClient['branchRules']>().mockResolvedValue({ requiredStatusChecks: [], pullRequests: [] }),
  };

  it('stays offline without a client, running only the checks that read files', async () => {
    const result = await runChecks({ cwd: fixturePath('workflows', 'merge-group', 'clean'), config: settings });

    expect(result.results.map((entry) => entry.check)).toEqual(['workflow-merge-group']);
  });

  it('runs them in registry order when it is given a client', async () => {
    const result = await runChecks({ cwd: fixturePath('workflows', 'merge-group', 'clean'), config: settings, github });

    expect(result.results.map((entry) => entry.check)).toEqual(['workflow-merge-group', 'settings-review-thread-resolution']);
    expect(result.violations.map((violation) => violation.code)).toEqual(['settings-review-thread-resolution/not-required']);
  });

  it('fails when only settings checks are enabled and there is no client, rather than reporting a pass', async () => {
    await expect(runChecks({ cwd: clean, config: { checks: { 'settings-review-thread-resolution': {} } } })).rejects.toThrow(/only checks that read the repository's settings are enabled/u);
  });

  it('fails when a settings check is requested without a client', async () => {
    await expect(runChecks({ cwd: clean, config: settings, checks: ['settings-review-thread-resolution'] })).rejects.toThrow(/settings-review-thread-resolution reads the repository's settings and needs a GitHub client/u);
    await expect(runChecks({ cwd: clean, config: settings, checks: ['settings-review-thread-resolution', 'workflow-merge-group'] })).rejects.toThrow(/needs a GitHub client/u);
  });
});
