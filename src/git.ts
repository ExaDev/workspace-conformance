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

/**
 * The most output a git command may print: a diff of a large branch lists tens of thousands of paths, past Node's default of 1 MiB.
 */
// 64 MiB.
const GIT_MAX_BUFFER = 67_108_864;

const INDEX_READER = 'this check reads the git index, so it needs a git working tree';

/**
 * Run git in `cwd` and return what it printed. A failure names the command, what git said, and `why` git was needed.
 */
async function git(cwd: string, args: readonly string[], why: string = INDEX_READER): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile('git', [...args], { cwd, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER }, (error, stdout, stderr) => {
      if (error === null) {
        resolve(stdout);
      } else {
        const said = stderr.trim();
        reject(new ConformanceError(`git ${args.join(' ')} failed in ${cwd}${said === '' ? '' : ` (${said})`}; ${why}`, { cause: error }));
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

/**
 * The URL of the remote `name` as configured, before any `url.<base>.insteadOf` rewriting (which `git remote get-url` applies and which can turn a GitHub address into a host alias), or `undefined` when the working tree has no such remote.
 */
export async function remoteUrl(cwd: string, name: string): Promise<string | undefined> {
  const remotes = (await git(cwd, ['remote'])).split('\n');
  if (!remotes.includes(name)) {
    return undefined;
  }

  return (await git(cwd, ['config', '--get', `remote.${name}.url`])).trim();
}

/**
 * What a run is scoped to: the changes staged in the index, or the changes the commits since the merge base of `base` and `HEAD` make.
 */
export type ChangeScope = { readonly staged: true } | { readonly base: string };

/**
 * The files `scope` changes (added, modified or deleted, a rename counting as both paths), relative to `cwd` with `/` separators and sorted; files outside `cwd` are left out.
 */
export async function changedFiles(cwd: string, scope: ChangeScope): Promise<readonly string[]> {
  const range = 'staged' in scope ? ['--cached'] : [`${scope.base}...HEAD`];
  const why =
    'staged' in scope
      ? 'a run on the staged files reads the git index, so it needs a git working tree'
      : `a run against a base lists the files changed since the merge base of ${scope.base} and HEAD, so the base must be a revision git knows that shares history with HEAD (a shallow clone may lack it)`;
  const listing = await git(cwd, ['diff', '--name-only', '--no-renames', '--relative', '-z', ...range, '--'], why);

  return listing
    .split('\0')
    .filter((file) => file !== '')
    .sort();
}
