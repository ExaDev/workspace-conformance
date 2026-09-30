import { glob } from 'tinyglobby';

/**
 * Directories no check descends into: installed dependencies are not the workspace's own files.
 */
export const INSTALLED_DEPENDENCIES_GLOB = '**/node_modules/**';

/**
 * The negative patterns that leave the paths matching `exclude` out of a search; none when there is no `exclude`.
 */
export function excludedFrom(exclude: readonly string[] | undefined): readonly string[] {
  return exclude === undefined ? [] : exclude.map((pattern) => `!${pattern}`);
}

/**
 * The files under `cwd` matching any of `patterns`, relative to `cwd` with `/` separators and sorted, so results do not depend on directory order. Dotfiles match, and installed dependencies never do.
 */
export async function findFiles(cwd: string, patterns: readonly string[]): Promise<readonly string[]> {
  const found = await glob([...patterns], { cwd, dot: true, ignore: [INSTALLED_DEPENDENCIES_GLOB], onlyFiles: true });

  return found.sort();
}

/**
 * The directories under `cwd` matching any of `patterns`, relative to `cwd` with `/` separators, without a trailing separator, and sorted.
 */
export async function findDirectories(cwd: string, patterns: readonly string[]): Promise<readonly string[]> {
  const found = await glob([...patterns], { cwd, dot: true, ignore: [INSTALLED_DEPENDENCIES_GLOB], onlyDirectories: true });

  return found.map((directory) => directory.replace(/\/$/u, '')).sort();
}
