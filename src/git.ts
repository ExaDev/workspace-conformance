import { execFile } from 'node:child_process';

import { ConformanceError } from './errors';

/**
 * The mode git records for a symbolic link. A working tree cannot tell a link from a file when `core.symlinks` is false, so the mode in the index is the only reliable answer.
 */
export const GIT_SYMLINK_MODE = '120000';

/**
 * A path as the git index records it.
 */
export interface IndexEntry {
  readonly mode: string;
  readonly blob: string;
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile('git', [...args], { cwd, encoding: 'utf8' }, (error, stdout) => {
      if (error === null) {
        resolve(stdout);
      } else {
        reject(new ConformanceError(`git ${args.join(' ')} failed in ${cwd}; this check reads the git index, so it needs a git working tree`, { cause: error }));
      }
    });
  });
}

/**
 * The index entry for `path` (relative to `cwd`), or `undefined` when git does not track it.
 */
export async function indexEntry(cwd: string, path: string): Promise<IndexEntry | undefined> {
  const listing = await git(cwd, ['ls-files', '--stage', '--', path]);
  const match = /^(\d+) ([0-9a-f]+) \d\t/u.exec(listing);
  const mode = match?.[1];
  const blob = match?.[2];

  return mode === undefined || blob === undefined ? undefined : { mode, blob };
}

/**
 * The content of a blob. For a symbolic link it is the link's target.
 */
export async function blobContent(cwd: string, blob: string): Promise<string> {
  return git(cwd, ['cat-file', 'blob', blob]);
}
