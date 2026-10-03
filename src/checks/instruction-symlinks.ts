import { posix } from 'node:path';

import { isDynamicPattern } from 'tinyglobby';

import type { CheckFunction, FileViolation } from '../check';
import { findDirectories } from '../files';
import { blobContent, GIT_SYMLINK_MODE, type IndexEntry, indexEntry } from '../git';
import type { InstructionSymlinksOptions } from '../options';

/**
 * The instruction file names checked when the options name none.
 */
export const DEFAULT_INSTRUCTION_FILES: readonly string[] = ['AGENTS.md', 'CLAUDE.md'];

/**
 * The file each instruction file links to when the options name none.
 */
export const DEFAULT_INSTRUCTION_TARGET = 'README.md';

async function directoriesOf(cwd: string, patterns: readonly string[]): Promise<readonly string[]> {
  const found = await Promise.all(patterns.map(async (pattern) => (isDynamicPattern(pattern) ? findDirectories(cwd, [pattern]) : [posix.normalize(pattern)])));

  return [...new Set(found.flat())].sort();
}

/**
 * Whether the tracked symbolic link `file` (with index entry `entry`) leads to `destination`: its target, resolved against the directory of the link, is `destination`, or is another tracked symbolic link that leads there. A link back to a link already followed leads nowhere.
 */
async function leadsTo(cwd: string, file: string, entry: IndexEntry, destination: string): Promise<boolean> {
  const followed = new Set<string>();
  let current = { file, entry };
  for (;;) {
    const linked = (await blobContent(cwd, current.entry.blob)).trim();
    if (posix.isAbsolute(linked)) {
      return false;
    }
    const resolved = posix.join(posix.dirname(current.file), linked);
    if (resolved === destination) {
      return true;
    }
    const next = followed.has(resolved) ? undefined : await indexEntry(cwd, resolved);
    if (next?.mode !== GIT_SYMLINK_MODE) {
      return false;
    }
    followed.add(resolved);
    current = { file: resolved, entry: next };
  }
}

/**
 * Each agent instruction file is tracked by git as a symbolic link (mode 120000) whose target is the README beside it, so the two cannot diverge. A directory without a tracked README has nothing to link to, so a missing instruction file there is not reported; one that exists is still judged. The link may be written in any form that resolves there (`./README.md`), and may lead through other tracked links, as in `CLAUDE.md` to `AGENTS.md` to `README.md`. It reads the index, not the working tree, so a checkout with `core.symlinks` false, where a link is written out as a plain file, is judged by what is committed.
 */
export const instructionSymlinks: CheckFunction<InstructionSymlinksOptions> = async ({ cwd, options }) => {
  const files = options.files ?? DEFAULT_INSTRUCTION_FILES;
  const target = options.target ?? DEFAULT_INSTRUCTION_TARGET;
  const violations: FileViolation[] = [];

  for (const directory of await directoriesOf(cwd, options.directories ?? ['.'])) {
    const readme = posix.join(directory, target);
    const readmeTracked = (await indexEntry(cwd, readme)) !== undefined;
    for (const name of files) {
      const file = posix.join(directory, name);
      const entry = await indexEntry(cwd, file);
      if (entry === undefined) {
        // A link asked for beside an untracked README would point at nothing; such a directory has no README for the instruction files to mirror.
        if (readmeTracked) {
          violations.push({ code: 'instruction-symlinks/missing', message: `${file} is not tracked; commit it as a symbolic link to ${target}`, file });
        }
      } else if (entry.mode !== GIT_SYMLINK_MODE) {
        violations.push({ code: 'instruction-symlinks/not-a-symlink', message: `${file} is committed as a regular file (mode ${entry.mode}); commit it as a symbolic link to ${target}`, file });
      } else {
        if (!(await leadsTo(cwd, file, entry, readme))) {
          const linked = (await blobContent(cwd, entry.blob)).trim();
          violations.push({ code: 'instruction-symlinks/wrong-target', message: `${file} links to ${linked}; it should link to ${target}`, file });
        } else if (!readmeTracked) {
          violations.push({ code: 'instruction-symlinks/dangling', message: `${file} links to ${target}, which is not tracked`, file });
        }
      }
    }
  }

  return violations;
};
