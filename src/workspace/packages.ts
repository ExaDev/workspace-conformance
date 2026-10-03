import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { GroupSpec, LayoutConfig } from '@exadev/config';
import { glob } from 'tinyglobby';
import { parse } from 'yaml';

import { ConformanceError } from '../errors';
import { INSTALLED_DEPENDENCIES_GLOB } from '../files';

/**
 * A package directory found under the workspace root, before the layout classifies it.
 */
export interface DiscoveredPackage {
  /**
   * Relative to the workspace root, with `/` separators.
   */
  readonly dir: string;
  /**
   * The manifest's `name`; a manifest may omit it.
   */
  readonly name: string | undefined;
}

/**
 * A workspace package as the layout sees it.
 */
export interface WorkspacePackage extends DiscoveredPackage {
  /**
   * The name of the group whose root is the longest prefix of the package directory.
   */
  readonly group: string;
  /**
   * The rank from `nameRanks`, else the group's rank, else `defaultRank`; `undefined` when none of them applies.
   */
  readonly rank: number | undefined;
  /**
   * The slice the group's `slice` rule derives; `undefined` for a group without one and for a package that yields none.
   */
  readonly slice: string | undefined;
}

function segmentsOf(path: string): readonly string[] {
  return path.split('/').filter((segment) => segment !== '' && segment !== '.');
}

function groupRoot(group: GroupSpec): readonly string[] {
  return segmentsOf(group.path ?? group.name);
}

function startsWithSegments(segments: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((segment, index) => segments[index] === segment);
}

/**
 * The group whose root is the longest prefix of `dir`; the first declared wins a tie. `undefined` when no group owns the directory.
 */
function owningGroup(dir: string, groups: readonly GroupSpec[]): GroupSpec | undefined {
  const segments = segmentsOf(dir);
  let best: GroupSpec | undefined;
  let bestLength = -1;
  for (const group of groups) {
    const root = groupRoot(group);
    if (root.length > bestLength && startsWithSegments(segments, root)) {
      best = group;
      bestLength = root.length;
    }
  }

  return best;
}

function rankOf(name: string | undefined, group: GroupSpec, layout: LayoutConfig): number | undefined {
  if (name !== undefined) {
    const rule = layout.nameRanks?.find((candidate) => new RegExp(candidate.pattern, 'u').test(name));
    if (rule !== undefined) {
      return rule.rank;
    }
  }

  return group.rank ?? layout.defaultRank;
}

/**
 * The name without its npm scope: `@scope/store-cli` gives `store-cli`.
 */
function unscoped(name: string): string {
  return name.replace(/^@[^/]+\//u, '');
}

/**
 * The longest slice value that is the whole unscoped name or its prefix up to a `-`.
 */
function sliceByNamePrefix(name: string, known: ReadonlySet<string>): string | undefined {
  const bare = unscoped(name);
  const matches = [...known].filter((candidate) => bare === candidate || bare.startsWith(`${candidate}-`));

  return matches.sort((a, b) => b.length - a.length)[0];
}

/**
 * Classify discovered packages by the layout: group, rank and slice. Pure.
 *
 * A package no group owns is a configuration error, because every check would otherwise skip it without saying so. Nested package directories are one too: the checks attribute a file to the package whose directory is its prefix, which is ambiguous for a package inside another. A `namePrefix` slice takes the longest slice value that a `segment` group produced and that prefixes the package's unscoped name; a package without a name has no such slice.
 */
export function classifyPackages(discovered: readonly DiscoveredPackage[], layout: LayoutConfig): readonly WorkspacePackage[] {
  const owned = discovered.map((found) => {
    const group = owningGroup(found.dir, layout.groups);
    if (group === undefined) {
      throw new ConformanceError(`the package directory '${found.dir}' is not under any layout group's path; add a group whose path prefixes it, or narrow the workspace package globs`);
    }

    return { found, group };
  });

  const knownSlices = new Set<string>();
  for (const { found, group } of owned) {
    if (group.slice !== undefined && 'segment' in group.slice) {
      const value = segmentsOf(found.dir).slice(groupRoot(group).length)[group.slice.segment];
      if (value !== undefined) {
        knownSlices.add(value);
      }
    }
  }

  const packages = owned.map(({ found, group }): WorkspacePackage => {
    let slice: string | undefined;
    if (group.slice !== undefined && 'segment' in group.slice) {
      slice = segmentsOf(found.dir).slice(groupRoot(group).length)[group.slice.segment];
    } else if (group.slice !== undefined && found.name !== undefined) {
      slice = sliceByNamePrefix(found.name, knownSlices);
    }

    return { ...found, group: group.name, rank: rankOf(found.name, group, layout), slice };
  });

  for (const outer of packages) {
    const nested = packages.find((inner) => inner.dir !== outer.dir && inner.dir.startsWith(`${outer.dir}/`));
    if (nested !== undefined) {
      throw new ConformanceError(`the package directory '${nested.dir}' is inside the package directory '${outer.dir}'; workspace packages must not nest`);
    }
  }

  return packages;
}

/**
 * The workspace root: `layout.root` resolved against `cwd`, or `cwd` itself.
 */
export function workspaceRoot(cwd: string, layout: LayoutConfig): string {
  return layout.root === undefined ? cwd : resolve(cwd, layout.root);
}

const PNPM_WORKSPACE_FILE = 'pnpm-workspace.yaml';

/**
 * The `packages` list of `pnpm-workspace.yaml` in `root`, or `undefined` when there is no such file. A file that exists but cannot be read, or has no list of strings under `packages`, is a configuration error.
 */
export async function pnpmWorkspacePatterns(root: string): Promise<readonly string[] | undefined> {
  const file = join(root, PNPM_WORKSPACE_FILE);
  if (!existsSync(file)) {
    return undefined;
  }
  let source: string;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    throw new ConformanceError(`${file} cannot be read`, { cause: error });
  }
  const document: unknown = parse(source);
  if (typeof document !== 'object' || document === null || !('packages' in document) || !Array.isArray(document.packages)) {
    throw new ConformanceError(`${file} has no 'packages' list`);
  }
  const patterns: unknown[] = document.packages;
  if (!patterns.every((pattern) => typeof pattern === 'string')) {
    throw new ConformanceError(`${file}: every entry of 'packages' must be a string`);
  }

  return patterns;
}

/**
 * The package globs: `layout.packages`, else the `packages` list of `pnpm-workspace.yaml` in `root`.
 */
export async function workspacePatterns(root: string, layout: LayoutConfig): Promise<readonly string[]> {
  if (layout.packages !== undefined) {
    return layout.packages;
  }
  const patterns = await pnpmWorkspacePatterns(root);
  if (patterns === undefined) {
    throw new ConformanceError(`the layout has no 'packages' and ${join(root, PNPM_WORKSPACE_FILE)} does not exist`);
  }

  return patterns;
}

async function readName(manifest: string): Promise<string | undefined> {
  let content: unknown;
  try {
    content = JSON.parse(await readFile(manifest, 'utf8'));
  } catch (error) {
    throw new ConformanceError(`${manifest} cannot be read as JSON`, { cause: error });
  }
  if (typeof content === 'object' && content !== null && 'name' in content && typeof content.name === 'string') {
    return content.name;
  }

  return undefined;
}

/**
 * The directories under `root` that the pnpm-style `patterns` select and that hold a `package.json`, sorted. A `!` pattern excludes. The root package itself (`.`) is not a member of any group and is left out.
 */
export async function discoverPackages(root: string, patterns: readonly string[]): Promise<readonly DiscoveredPackage[]> {
  const manifests = patterns.map((pattern) => (pattern.startsWith('!') ? `!${pattern.slice(1)}/**` : `${pattern}/package.json`));
  const found = await glob(manifests, { cwd: root, dot: true, ignore: [INSTALLED_DEPENDENCIES_GLOB], onlyFiles: true });
  const dirs = found.map((manifest) => manifest.replace(/\/?package\.json$/u, '')).filter((dir) => dir !== '');

  return Promise.all(
    [...new Set(dirs)].sort().map(async (dir) => ({ dir, name: await readName(join(root, dir, 'package.json')) })),
  );
}

/**
 * The layout's packages found under the workspace root.
 */
export async function readWorkspacePackages(cwd: string, layout: LayoutConfig): Promise<readonly WorkspacePackage[]> {
  const root = workspaceRoot(cwd, layout);

  return classifyPackages(await discoverPackages(root, await workspacePatterns(root, layout)), layout);
}
