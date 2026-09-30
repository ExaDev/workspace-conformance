import { escapePath, glob } from 'tinyglobby';

/**
 * Directories no check descends into: installed dependencies are not the workspace's own files.
 */
export const INSTALLED_DEPENDENCIES_GLOB = '**/node_modules/**';

/**
 * The name of the entry git puts at the top of a checkout: a directory in a clone, a file in a linked worktree.
 */
const GIT_ENTRY = '.git';

/**
 * Directories no check descends into besides installed dependencies: git's own data, and every other checkout below `cwd` (a linked worktree or a nested clone, found by its own `.git` entry). Such a checkout is another copy of a repository, and its files would be judged as if they were part of this workspace.
 */
async function ignoredDirectories(cwd: string): Promise<readonly string[]> {
  // The ignore keeps the crawl out of git's object store and refs while still listing the `.git` entries themselves, which a pattern for their whole contents would hide.
  const entries = await glob([`**/${GIT_ENTRY}`], { cwd, dot: true, onlyFiles: false, expandDirectories: false, ignore: [INSTALLED_DEPENDENCIES_GLOB, `**/${GIT_ENTRY}/*/**`] });
  const nested = entries.map((entry) => entry.replace(/\/$/u, '')).filter((entry) => entry !== GIT_ENTRY);

  return [`**/${GIT_ENTRY}/**`, ...nested.map((entry) => `${escapePath(entry.slice(0, -GIT_ENTRY.length))}**`)];
}

/**
 * The negative patterns that leave the paths matching `exclude` out of a search; none when there is no `exclude`.
 */
export function excludedFrom(exclude: readonly string[] | undefined): readonly string[] {
  return exclude === undefined ? [] : exclude.map((pattern) => `!${pattern}`);
}

/**
 * The files under `cwd` matching any of `patterns`, relative to `cwd` with `/` separators and sorted, so results do not depend on directory order. Dotfiles match; installed dependencies, git's own data and other checkouts below `cwd` never do.
 */
export async function findFiles(cwd: string, patterns: readonly string[]): Promise<readonly string[]> {
  const found = await glob([...patterns], { cwd, dot: true, ignore: [INSTALLED_DEPENDENCIES_GLOB, ...(await ignoredDirectories(cwd))], onlyFiles: true });

  return found.sort();
}

/**
 * The directories under `cwd` matching any of `patterns`, relative to `cwd` with `/` separators, without a trailing separator, and sorted.
 */
export async function findDirectories(cwd: string, patterns: readonly string[]): Promise<readonly string[]> {
  const found = await glob([...patterns], { cwd, dot: true, ignore: [INSTALLED_DEPENDENCIES_GLOB, ...(await ignoredDirectories(cwd))], onlyDirectories: true });

  return found.map((directory) => directory.replace(/\/$/u, '')).sort();
}
