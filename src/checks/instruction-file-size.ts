import { posix } from 'node:path';

import { isDynamicPattern } from 'tinyglobby';

import type { CheckFunction, FileViolation } from '../check';
import { findDirectories } from '../files';
import { blobContent, exactIndexEntry, GIT_SYMLINK_MODE, type IndexEntry } from '../git';
import type { InstructionFileSizeOptions } from '../options';
import { DEFAULT_INSTRUCTION_FILES } from './instruction-symlinks';

/**
 * The most characters an instruction file, with what it imports, may hold when the options set no limit: the size at which Claude Code warns that a large CLAUDE.md will hurt performance.
 */
export const DEFAULT_MAX_INSTRUCTION_CHARACTERS = 40_000;

/**
 * A line that opens or closes a fenced code block, whose content is not read for imports: three or more backticks or tildes, indented by at most three spaces. A fence is closed only by a run of the same character at least as long.
 */
const FENCE = /^ {0,3}(`{3,}|~{3,})/u;

/**
 * An inline code span, whose content is not read for imports.
 */
const CODE_SPAN = /`[^`]*`/gu;

/**
 * An `@path` import: an `@` at the start of the line or after whitespace, then the path up to the next whitespace.
 */
const IMPORT = /(?:^|\s)@(\S+)/gu;

/**
 * Whether `path`, relative to the directory the checks run in, stays inside it.
 */
function insideRepository(path: string): boolean {
  return path !== '..' && !path.startsWith('../');
}

async function directoriesOf(cwd: string, patterns: readonly string[]): Promise<readonly string[]> {
  const found = await Promise.all(patterns.map(async (pattern) => (isDynamicPattern(pattern) ? findDirectories(cwd, [pattern]) : [posix.normalize(pattern)])));

  return [...new Set(found.flat())].sort();
}

/**
 * The tracked regular file that `file` (with index entry `entry`) is, or leads to through tracked symbolic links, with its index entry; `undefined` when a link leads out of the repository, to a path git does not track, or back to a link already followed.
 */
async function regularFileOf(cwd: string, file: string, entry: IndexEntry): Promise<{ readonly file: string; readonly entry: IndexEntry } | undefined> {
  const followed = new Set<string>([file]);
  let current = { file, entry };
  while (current.entry.mode === GIT_SYMLINK_MODE) {
    const linked = (await blobContent(cwd, current.entry.blob)).trim();
    const resolved = posix.join(posix.dirname(current.file), linked);
    if (posix.isAbsolute(linked) || !insideRepository(resolved) || followed.has(resolved)) {
      return undefined;
    }
    const next = await exactIndexEntry(cwd, resolved);
    if (next === undefined) {
      return undefined;
    }
    followed.add(resolved);
    current = { file: resolved, entry: next };
  }

  return current;
}

/**
 * The paths `content` imports with `@path`, as written, outside fenced code blocks and inline code spans.
 */
export function importsOf(content: string): readonly string[] {
  const imports: string[] = [];
  let open: string | undefined;
  for (const line of content.split('\n')) {
    const fence = FENCE.exec(line)?.[1];
    if (fence !== undefined && (open === undefined || (fence.startsWith(open.charAt(0)) && fence.length >= open.length))) {
      open = open === undefined ? fence : undefined;
    } else if (open === undefined) {
      for (const match of line.replaceAll(CODE_SPAN, ' ').matchAll(IMPORT)) {
        const path = match[1];
        if (path !== undefined) {
          imports.push(path);
        }
      }
    }
  }

  return imports;
}

/**
 * What an instruction file loads: the tracked regular files it is and imports, each once and in the order they are reached, with the characters of each.
 */
async function loadedFiles(cwd: string, file: string, followImports: boolean): Promise<readonly { readonly file: string; readonly characters: number }[]> {
  const loaded: { readonly file: string; readonly characters: number }[] = [];
  const seen = new Set<string>();
  const pending = [file];
  for (let path = pending.shift(); path !== undefined; path = pending.shift()) {
    const entry = await exactIndexEntry(cwd, path);
    const regular = entry === undefined ? undefined : await regularFileOf(cwd, path, entry);
    if (regular !== undefined && !seen.has(regular.file)) {
      seen.add(regular.file);
      const content = await blobContent(cwd, regular.entry.blob);
      loaded.push({ file: regular.file, characters: content.length });
      if (followImports) {
        for (const imported of importsOf(content)) {
          if (!imported.startsWith('~') && !posix.isAbsolute(imported)) {
            const resolved = posix.join(posix.dirname(regular.file), imported);
            if (insideRepository(resolved)) {
              pending.push(resolved);
            }
          }
        }
      }
    }
  }

  return loaded;
}

function formatCount(count: number): string {
  return count.toLocaleString('en-GB');
}

/**
 * Each agent instruction file, with the files it pulls in through `@path` imports, holds at most `maxCharacters` characters, since everything in it is loaded into the agent's context on every session. It reads the index, not the working tree, so it judges what a commit will hold, and a link that the checkout wrote as a plain file is followed as git records it. Instruction files that are, or lead through tracked symbolic links to, the same file (as `instruction-symlinks` asks of `CLAUDE.md` and `AGENTS.md`) are measured once, and the violation is reported at that file. An import is followed when it resolves, relative to the file that holds it, to a tracked file (not a directory or a pattern) inside the directory the checks run in; anything else written after an `@` (a package name, a handle, a directory, a path outside that directory or in the home directory) is not an import of a tracked file and is ignored, as are fenced code blocks and inline code spans. Imports are followed transitively, each file counted once, so a cycle ends.
 */
export const instructionFileSize: CheckFunction<InstructionFileSizeOptions> = async ({ cwd, options }) => {
  const files = options.files ?? DEFAULT_INSTRUCTION_FILES;
  const limit = options.maxCharacters ?? DEFAULT_MAX_INSTRUCTION_CHARACTERS;
  const followImports = options.followImports ?? true;
  const loadedBy = new Map<string, string[]>();

  for (const directory of await directoriesOf(cwd, options.directories ?? ['.'])) {
    for (const name of files) {
      const file = posix.join(directory, name);
      const entry = await exactIndexEntry(cwd, file);
      const regular = entry === undefined ? undefined : await regularFileOf(cwd, file, entry);
      if (regular !== undefined) {
        loadedBy.set(regular.file, [...(loadedBy.get(regular.file) ?? []), file]);
      }
    }
  }

  const violations: FileViolation[] = [];
  for (const [file, names] of [...loadedBy].sort(([left], [right]) => left.localeCompare(right))) {
    const loaded = await loadedFiles(cwd, file, followImports);
    const total = loaded.reduce((sum, part) => sum + part.characters, 0);
    if (total > limit) {
      const others = names.filter((name) => name !== file);
      const subject = others.length === 0 ? file : `${file} (loaded as ${others.join(', ')})`;
      const imported = loaded.slice(1);
      const size = imported.length === 0 ? `${formatCount(total)} characters` : `${formatCount(total)} characters with its imports (${imported.map((part) => `${part.file}: ${formatCount(part.characters)}`).join(', ')})`;
      violations.push({
        code: 'instruction-file-size/too-large',
        message: `${subject} is ${size}, over the limit of ${formatCount(limit)}; move detail into docs/ and leave a pointer to it`,
        file,
      });
    }
  }

  return violations;
};
