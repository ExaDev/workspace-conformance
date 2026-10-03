import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTempDir, removeTempDirs, writeFiles } from '../../test/support/temp';
import { ConformanceError } from '../errors';
import { enginesFloor } from './engines-floor';

afterEach(removeTempDirs);

/**
 * The range the motivating dependency declared: three Node lines, with a gap between them that a plain floor such as `>=20` does not leave.
 */
const SPLIT_RANGE = '^20.19.0 || ^22.13.0 || >=24';

function manifest(content: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(content);
}

async function workspace(files: Readonly<Record<string, string>>): Promise<string> {
  const cwd = await makeTempDir();
  await writeFiles(cwd, files);

  return cwd;
}

describe('engines-floor', () => {
  it('reports nothing when the range is a subset of every dependency range', async () => {
    const cwd = await workspace({
      'package.json': manifest({ name: 'root', engines: { node: '^22.13.0 || >=24' }, dependencies: { lib: '^1.0.0' } }),
      'node_modules/lib/package.json': manifest({ name: 'lib', engines: { node: SPLIT_RANGE } }),
    });

    expect(await enginesFloor({ cwd, options: {} })).toEqual([]);
  });

  it('reports a floor that admits versions in the gaps of a dependency range with several lines', async () => {
    const cwd = await workspace({
      'package.json': manifest({ name: 'root', engines: { node: '>=20' }, dependencies: { lib: '^1.0.0' } }),
      'node_modules/lib/package.json': manifest({ name: 'lib', engines: { node: SPLIT_RANGE } }),
    });

    expect(await enginesFloor({ cwd, options: {} })).toEqual([
      {
        code: 'engines-floor/wider-than-dependency',
        message: `engines.node '>=20' admits Node versions that the dependency 'lib' rejects with engines.node '${SPLIT_RANGE}'; narrow it to a subset of that range`,
        file: 'package.json',
      },
    ]);
  });

  it('compares set by set, so a set two adjacent dependency sets cover together is reported until it is split the same way', async () => {
    const files = (own: string): Readonly<Record<string, string>> => ({
      'package.json': manifest({ name: 'root', engines: { node: own }, dependencies: { lib: '^1.0.0' } }),
      'node_modules/lib/package.json': manifest({ name: 'lib', engines: { node: '^22.0.0 || >=23' } }),
    });

    expect((await enginesFloor({ cwd: await workspace(files('>=22')), options: {} })).map((violation) => violation.code)).toEqual(['engines-floor/wider-than-dependency']);
    expect(await enginesFloor({ cwd: await workspace(files('^22.0.0 || >=23')), options: {} })).toEqual([]);
  });

  it('reports a package without engines when a dependency declares a range', async () => {
    const cwd = await workspace({
      'package.json': manifest({ name: 'root', dependencies: { lib: '^1.0.0' } }),
      'node_modules/lib/package.json': manifest({ name: 'lib', engines: { node: '>=20' } }),
    });

    expect(await enginesFloor({ cwd, options: {} })).toEqual([
      {
        code: 'engines-floor/no-engines',
        message: "no engines.node is declared, so every Node version is admitted, but the dependency 'lib' requires engines.node '>=20'; declare a subset of that range",
        file: 'package.json',
      },
    ]);
  });

  it('ignores a dependency that declares no engines, whatever the package declares', async () => {
    const cwd = await workspace({
      'package.json': manifest({ name: 'root', dependencies: { lib: '^1.0.0', other: '^1.0.0' } }),
      'node_modules/lib/package.json': manifest({ name: 'lib' }),
      'node_modules/other/package.json': manifest({ name: 'other', engines: { npm: '>=10' } }),
    });

    expect(await enginesFloor({ cwd, options: {} })).toEqual([]);
  });

  it('does not consider devDependencies, which a consumer never installs, so need not even be installed', async () => {
    const cwd = await workspace({
      'package.json': manifest({ name: 'root', engines: { node: '>=20' }, devDependencies: { tool: '^1.0.0', installed: '^1.0.0' } }),
      'node_modules/installed/package.json': manifest({ name: 'installed', engines: { node: '>=24' } }),
    });

    expect(await enginesFloor({ cwd, options: {} })).toEqual([]);
  });

  it('fails the run when a dependency is not installed, rather than passing it unjudged', async () => {
    const cwd = await workspace({ 'package.json': manifest({ name: 'root', engines: { node: '>=20' }, dependencies: { absent: '^1.0.0' } }) });

    const run = enginesFloor({ cwd, options: {} });

    await expect(run).rejects.toThrow(ConformanceError);
    await expect(run).rejects.toThrow(
      "package.json: the dependency 'absent' is not installed (no node_modules/absent/package.json in its directory or any directory above it up to the working directory); install the workspace before running engines-floor",
    );
  });

  it('judges peer dependencies as installed, and skips an optional peer or optional dependency that is not installed', async () => {
    const cwd = await workspace({
      'package.json': manifest({
        name: 'root',
        engines: { node: '>=20' },
        peerDependencies: { host: '^1.0.0', extra: '^1.0.0' },
        peerDependenciesMeta: { extra: { optional: true } },
        optionalDependencies: { native: '^1.0.0', accelerated: '^1.0.0' },
      }),
      'node_modules/host/package.json': manifest({ name: 'host', engines: { node: '>=22' } }),
      'node_modules/accelerated/package.json': manifest({ name: 'accelerated', engines: { node: '>=24' } }),
    });

    expect((await enginesFloor({ cwd, options: {} })).map((violation) => violation.message)).toEqual([
      "engines.node '>=20' admits Node versions that the optional dependency 'accelerated' rejects with engines.node '>=24'; narrow it to a subset of that range",
      "engines.node '>=20' admits Node versions that the peer dependency 'host' rejects with engines.node '>=22'; narrow it to a subset of that range",
    ]);
  });

  it('judges the root package and each package pnpm-workspace.yaml lists, resolving a dependency from the nearest node_modules as Node does', async () => {
    const cwd = await workspace({
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n  - "!packages/ignored"\n',
      'package.json': manifest({ name: 'root', private: true }),
      'packages/a/package.json': manifest({ name: 'a', engines: { node: '>=20' }, dependencies: { lib: '^2.0.0' } }),
      'packages/a/node_modules/lib/package.json': manifest({ name: 'lib', version: '2.0.0', engines: { node: '>=22' } }),
      'packages/b/package.json': manifest({ name: 'b', engines: { node: '>=20' }, dependencies: { lib: '^1.0.0' } }),
      'packages/ignored/package.json': manifest({ name: 'ignored', dependencies: { lib: '^1.0.0' } }),
      'node_modules/lib/package.json': manifest({ name: 'lib', version: '1.0.0', engines: { node: '>=18' } }),
    });

    expect((await enginesFloor({ cwd, options: {} })).map((violation) => [violation.code, violation.file])).toEqual([['engines-floor/wider-than-dependency', 'packages/a/package.json']]);
  });

  it('reads a dependency through the symbolic link pnpm installs it as', async () => {
    const cwd = await workspace({
      'package.json': manifest({ name: 'root', engines: { node: '>=20' }, dependencies: { lib: '^1.0.0' } }),
      'node_modules/.pnpm/lib@1.0.0/node_modules/lib/package.json': manifest({ name: 'lib', engines: { node: '>=24' } }),
    });
    await mkdir(join(cwd, 'node_modules'), { recursive: true });
    await symlink(join('.pnpm', 'lib@1.0.0', 'node_modules', 'lib'), join(cwd, 'node_modules', 'lib'), 'dir');

    expect((await enginesFloor({ cwd, options: {} })).map((violation) => violation.code)).toEqual(['engines-floor/wider-than-dependency']);
  });

  it('judges only the packages that packages selects', async () => {
    const cwd = await workspace({
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      'package.json': manifest({ name: 'root', engines: { node: '>=20' }, dependencies: { lib: '^1.0.0' } }),
      'packages/a/package.json': manifest({ name: 'a', engines: { node: '>=20' }, dependencies: { lib: '^1.0.0' } }),
      'node_modules/lib/package.json': manifest({ name: 'lib', engines: { node: '>=24' } }),
    });

    expect((await enginesFloor({ cwd, options: { packages: ['packages/*'] } })).map((violation) => violation.file)).toEqual(['packages/a/package.json']);
  });

  it('fails the run when a range cannot be parsed, naming the file', async () => {
    const cwd = await workspace({
      'package.json': manifest({ name: 'root', engines: { node: '>=20' }, dependencies: { lib: '^1.0.0' } }),
      'node_modules/lib/package.json': manifest({ name: 'lib', engines: { node: 'node twenty' } }),
    });

    await expect(enginesFloor({ cwd, options: {} })).rejects.toThrow("node_modules/lib/package.json: engines.node 'node twenty' is not a valid semver range");
  });

  it('fails the run when engines or a dependency field is not shaped as npm defines it', async () => {
    const run = async (content: Readonly<Record<string, unknown>>): Promise<unknown> => enginesFloor({ cwd: await workspace({ 'package.json': manifest(content) }), options: {} });

    await expect(run({ engines: ['node >= 20'] })).rejects.toThrow('package.json: engines must be an object');
    await expect(run({ engines: { node: 20 } })).rejects.toThrow('package.json: engines.node must be a string, not 20');
    await expect(run({ dependencies: ['lib'] })).rejects.toThrow('package.json: dependencies must be an object');
  });

  it('fails the run when the options select no package, so nothing is never a pass', async () => {
    const cwd = await workspace({ 'package.json': manifest({ name: 'root' }) });

    await expect(enginesFloor({ cwd, options: { packages: ['packages/*'] } })).rejects.toThrow('no package.json is selected by packages/*');
  });
});
