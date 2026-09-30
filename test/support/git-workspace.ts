import { execFileSync } from 'node:child_process';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { makeTempDir } from './temp';

/**
 * An entry of a git fixture: a regular file with this content, a symbolic link to a target, or a path the index records as a link although the working tree holds a regular file, which is what a checkout with `core.symlinks` false produces.
 */
export type GitEntry = string | { readonly symlink: string } | { readonly indexedSymlink: string };

function git(directory: string, args: readonly string[], input?: string): string {
  return execFileSync('git', [...args], { cwd: directory, encoding: 'utf8', input });
}

/**
 * A new git repository outside the source tree holding `entries`, all added to the index. Nothing is committed: the checks read the index.
 */
export async function createGitWorkspace(entries: Readonly<Record<string, GitEntry>>): Promise<string> {
  const directory = await makeTempDir();
  git(directory, ['init', '--quiet']);
  git(directory, ['config', 'core.symlinks', 'true']);
  for (const [name, entry] of Object.entries(entries)) {
    await mkdir(dirname(join(directory, name)), { recursive: true });
    if (typeof entry === 'string') {
      await writeFile(join(directory, name), entry);
      git(directory, ['add', '--', name]);
    } else if ('symlink' in entry) {
      await symlink(entry.symlink, join(directory, name));
      git(directory, ['add', '--', name]);
    } else {
      await writeFile(join(directory, name), entry.indexedSymlink);
      const blob = git(directory, ['hash-object', '-w', '--stdin'], entry.indexedSymlink).trim();
      git(directory, ['update-index', '--add', '--cacheinfo', `120000,${blob},${name}`]);
    }
  }

  return directory;
}
