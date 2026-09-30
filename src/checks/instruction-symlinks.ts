import { posix } from 'node:path';

import { isDynamicPattern } from 'tinyglobby';

import type { CheckFunction, Violation } from '../check';
import { findDirectories } from '../files';
import { blobContent, GIT_SYMLINK_MODE, indexEntry } from '../git';
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
 * Each agent instruction file is tracked by git as a symbolic link (mode 120000) whose target is the README beside it, so the two cannot diverge. It reads the index, not the working tree, so a checkout with `core.symlinks` false, where a link is written out as a plain file, is judged by what is committed.
 */
export const instructionSymlinks: CheckFunction<InstructionSymlinksOptions> = async ({ cwd, options }) => {
  const files = options.files ?? DEFAULT_INSTRUCTION_FILES;
  const target = options.target ?? DEFAULT_INSTRUCTION_TARGET;
  const violations: Violation[] = [];

  for (const directory of await directoriesOf(cwd, options.directories ?? ['.'])) {
    const readme = posix.join(directory, target);
    for (const name of files) {
      const file = posix.join(directory, name);
      const entry = await indexEntry(cwd, file);
      if (entry === undefined) {
        violations.push({ code: 'instruction-symlinks/missing', message: `${file} is not tracked; commit it as a symbolic link to ${target}`, file });
      } else if (entry.mode !== GIT_SYMLINK_MODE) {
        violations.push({ code: 'instruction-symlinks/not-a-symlink', message: `${file} is committed as a regular file (mode ${entry.mode}); commit it as a symbolic link to ${target}`, file });
      } else {
        const linked = (await blobContent(cwd, entry.blob)).trim();
        if (linked !== target) {
          violations.push({ code: 'instruction-symlinks/wrong-target', message: `${file} links to ${linked}; it should link to ${target}`, file });
        } else if ((await indexEntry(cwd, readme)) === undefined) {
          violations.push({ code: 'instruction-symlinks/dangling', message: `${file} links to ${target}, which is not tracked`, file });
        }
      }
    }
  }

  return violations;
};
