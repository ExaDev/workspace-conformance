import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';

import { subset, validRange } from 'semver';

import type { CheckFunction, Violation } from '../check';
import { isRecord } from '../config-files';
import { ConformanceError } from '../errors';
import type { EnginesFloorOptions } from '../options';
import { relativePosix } from '../paths';
import { discoverPackages, pnpmWorkspacePatterns } from '../workspace/packages';

/**
 * The pattern that selects the root package, the `package.json` in the directory the checks run in.
 */
const ROOT_PACKAGE = '.';

const MANIFEST = 'package.json';

/**
 * A manifest field whose packages a consumer installs beside the package, and so whose `engines.node` bounds the Node versions the package can run on. `devDependencies` are not among them: a consumer never installs them, and the Node the development toolchain needs is the repository's own concern, not a claim the published package makes.
 */
interface DependencyField {
  readonly field: string;
  /**
   * How a dependency from the field is named in a message.
   */
  readonly noun: string;
  /**
   * Whether the dependency may legitimately be absent from `node_modules`, so an absent one is skipped rather than failing the run.
   */
  readonly mayBeAbsent: (manifest: Readonly<Record<string, unknown>>, name: string) => boolean;
}

const DEPENDENCY_FIELDS: readonly DependencyField[] = [
  { field: 'dependencies', noun: 'dependency', mayBeAbsent: () => false },
  // An optional dependency that fails to install, as one built for another platform does, is left out without failing the install.
  { field: 'optionalDependencies', noun: 'optional dependency', mayBeAbsent: () => true },
  {
    field: 'peerDependencies',
    noun: 'peer dependency',
    mayBeAbsent: (manifest, name) => {
      const meta = manifest['peerDependenciesMeta'];
      const entry = isRecord(meta) ? meta[name] : undefined;

      return isRecord(entry) && entry['optional'] === true;
    },
  },
];

async function readManifest(cwd: string, file: string): Promise<Readonly<Record<string, unknown>>> {
  let content: unknown;
  try {
    content = JSON.parse(await readFile(resolve(cwd, file), 'utf8'));
  } catch (error) {
    throw new ConformanceError(`${file} cannot be read as JSON`, { cause: error });
  }
  if (!isRecord(content)) {
    throw new ConformanceError(`${file} is not a JSON object`);
  }

  return content;
}

/**
 * The `engines.node` range the manifest at `file` declares, or `undefined` when it declares none. A range semver cannot parse is a configuration error, since nothing can be said about the versions it admits.
 */
function nodeRange(manifest: Readonly<Record<string, unknown>>, file: string): string | undefined {
  const engines = manifest['engines'];
  if (engines === undefined) {
    return undefined;
  }
  if (!isRecord(engines)) {
    throw new ConformanceError(`${file}: engines must be an object`);
  }
  const node = engines['node'];
  if (node === undefined) {
    return undefined;
  }
  if (typeof node !== 'string') {
    throw new ConformanceError(`${file}: engines.node must be a string, not ${JSON.stringify(node)}`);
  }
  if (validRange(node) === null) {
    throw new ConformanceError(`${file}: engines.node '${node}' is not a valid semver range`);
  }

  return node;
}

/**
 * The names a dependency field of the manifest at `file` lists; none when the field is absent.
 */
function dependencyNames(manifest: Readonly<Record<string, unknown>>, field: string, file: string): readonly string[] {
  const listed = manifest[field];
  if (listed === undefined) {
    return [];
  }
  if (!isRecord(listed)) {
    throw new ConformanceError(`${file}: ${field} must be an object`);
  }

  return Object.keys(listed).sort();
}

/**
 * The `package.json` of the dependency `name` as installed for the package in `packageDirectory`, found the way Node finds a package directory: in `node_modules` of the package's own directory, then of each directory above it, stopping at the working directory, since a copy above the workspace is not one its install put there. A symbolic link, as pnpm installs every dependency, is followed. `undefined` when no directory has it.
 */
function installedManifest(cwd: string, packageDirectory: string, name: string): string | undefined {
  const top = resolve(cwd);
  for (let directory = resolve(cwd, packageDirectory); ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', name, MANIFEST);
    if (existsSync(candidate)) {
      return relativePosix(cwd, candidate);
    }
    if (directory === top) {
      return undefined;
    }
  }
}

/**
 * The directories of the packages to judge: those `packages` selects, else the root package and the `packages` of `pnpm-workspace.yaml`. Selecting none is a configuration error, so a pattern that matches nothing never reads as a pass.
 */
async function packageDirectories(cwd: string, options: EnginesFloorOptions): Promise<readonly string[]> {
  const patterns = options.packages ?? [ROOT_PACKAGE, ...((await pnpmWorkspacePatterns(cwd)) ?? [])];
  const members = await discoverPackages(
    cwd,
    patterns.filter((pattern) => pattern !== ROOT_PACKAGE),
  );
  const directories = [...(patterns.includes(ROOT_PACKAGE) ? [ROOT_PACKAGE] : []), ...members.map((member) => member.dir)];
  if (directories.length === 0) {
    throw new ConformanceError(`no package.json is selected by ${patterns.join(', ')}`);
  }

  return directories;
}

/**
 * The `engines.node` range of each package is a subset of the `engines.node` range of each dependency, optional dependency and peer dependency it lists, as installed in `node_modules`, so the package admits no Node version that something it needs at run time rejects. A package that declares no range admits every version, so it is reported for each dependency that declares one. A dependency that declares no range constrains nothing and is ignored.
 *
 * The comparison is `semver.subset(package, dependency)`: every version the package's range admits satisfies the dependency's range. A floor alone is not enough, because a range of several lines (`^20.19.0 || ^22.13.0 || >=24`) also rejects the versions between them, which `>=20.19.0` admits. semver compares a range of several comparator sets set by set, so each set of the package's range must lie within one set of the dependency's; a set that only two adjacent dependency sets cover together (`>=22` against `^22.0.0 || >=23`) is reported, and splitting it the same way (`^22.0.0 || >=23`) satisfies the check.
 *
 * A dependency that is not installed fails the run: its range cannot be read, and passing it unjudged would read as a pass. An optional dependency and a peer dependency marked optional in `peerDependenciesMeta` may be absent and are then skipped. A peer dependency is judged by the copy installed in the workspace, which is one version of its peer range; a consumer that installs another version may meet another range.
 */
export const enginesFloor: CheckFunction<EnginesFloorOptions> = async ({ cwd, options }) => {
  const violations: Violation[] = [];

  for (const directory of await packageDirectories(cwd, options)) {
    const file = posix.join(directory, MANIFEST);
    const manifest = await readManifest(cwd, file);
    const own = nodeRange(manifest, file);
    const judged = new Set<string>();
    for (const { field, noun, mayBeAbsent } of DEPENDENCY_FIELDS) {
      for (const name of dependencyNames(manifest, field, file).filter((candidate) => !judged.has(candidate))) {
        judged.add(name);
        const installed = installedManifest(cwd, directory, name);
        if (installed === undefined) {
          if (mayBeAbsent(manifest, name)) {
            continue;
          }
          throw new ConformanceError(
            `${file}: the ${noun} '${name}' is not installed (no node_modules/${name}/package.json in its directory or any directory above it up to the working directory); install the workspace before running engines-floor`,
          );
        }
        const theirs = nodeRange(await readManifest(cwd, installed), installed);
        if (theirs === undefined) {
          continue;
        }
        if (own === undefined) {
          violations.push({
            code: 'engines-floor/no-engines',
            message: `no engines.node is declared, so every Node version is admitted, but the ${noun} '${name}' requires engines.node '${theirs}'; declare a subset of that range`,
            file,
          });
        } else if (!subset(own, theirs)) {
          violations.push({
            code: 'engines-floor/wider-than-dependency',
            message: `engines.node '${own}' admits Node versions that the ${noun} '${name}' rejects with engines.node '${theirs}'; narrow it to a subset of that range`,
            file,
          });
        }
      }
    }
  }

  return violations;
};
