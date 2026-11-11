import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createGitWorkspace } from '../../test/support/git-workspace';
import { makeTempDir, removeTempDirs } from '../../test/support/temp';
import { ConformanceError } from '../errors';
import { DEFAULT_MAX_INSTRUCTION_CHARACTERS, importsOf, instructionFileSize } from './instruction-file-size';

afterEach(removeTempDirs);

/**
 * The limit the cases set, small enough to write files over it by hand.
 */
const LIMIT = 10;

describe('importsOf', () => {
  it('reads @path imports at the start of a line or after whitespace, and none inside code', () => {
    const content = ['@docs/a.md', 'See @docs/b.md for more.', 'mail me@example.com', '`@docs/c.md`', '```', '@docs/d.md', '```', '~~~', '@docs/e.md', '~~~', '- @f.md'].join('\n');

    expect(importsOf(content)).toEqual(['docs/a.md', 'docs/b.md', 'f.md']);
  });

  it('closes a fence only with a run of the same character at least as long, so a fence shown inside another stays code', () => {
    const content = ['````', '```', '@inside-a.md', '```', '````', '~~~', '```', '@inside-b.md', '~~~', '@after.md'].join('\n');

    expect(importsOf(content)).toEqual(['after.md']);
  });
});

describe('instruction-file-size', () => {
  it('reports nothing when each instruction file is within the limit', async () => {
    const cwd = await createGitWorkspace({ 'AGENTS.md': 'a'.repeat(LIMIT), 'CLAUDE.md': 'b'.repeat(LIMIT) });

    expect(await instructionFileSize({ cwd, options: { maxCharacters: LIMIT } })).toEqual([]);
  });

  it('reports a file over the limit, naming its size and the limit', async () => {
    const cwd = await createGitWorkspace({ 'CLAUDE.md': 'x'.repeat(DEFAULT_MAX_INSTRUCTION_CHARACTERS + 1) });

    expect(await instructionFileSize({ cwd, options: {} })).toEqual([
      {
        code: 'instruction-file-size/too-large',
        message: 'CLAUDE.md is 40,001 characters, over the limit of 40,000; move detail into docs/ and leave a pointer to it',
        file: 'CLAUDE.md',
      },
    ]);
  });

  it('measures instruction files that link to the same file once, at that file', async () => {
    const cwd = await createGitWorkspace({ 'README.md': 'x'.repeat(LIMIT + 1), 'AGENTS.md': { symlink: 'README.md' }, 'CLAUDE.md': { indexedSymlink: 'AGENTS.md' } });

    expect(await instructionFileSize({ cwd, options: { maxCharacters: LIMIT } })).toEqual([
      {
        code: 'instruction-file-size/too-large',
        message: 'README.md (loaded as AGENTS.md, CLAUDE.md) is 11 characters, over the limit of 10; move detail into docs/ and leave a pointer to it',
        file: 'README.md',
      },
    ]);
  });

  it('counts the files an instruction file imports, transitively and each once, so a cycle ends', async () => {
    const cwd = await createGitWorkspace({
      'CLAUDE.md': '@docs/a.md\n',
      'docs/a.md': '@b.md @a.md\n',
      'docs/b.md': '@../CLAUDE.md @a.md\n',
    });

    expect(await instructionFileSize({ cwd, options: { maxCharacters: 30 } })).toEqual([
      {
        code: 'instruction-file-size/too-large',
        message: 'CLAUDE.md is 43 characters with its imports (docs/a.md: 12, docs/b.md: 20), over the limit of 30; move detail into docs/ and leave a pointer to it',
        file: 'CLAUDE.md',
      },
    ]);
    expect(await instructionFileSize({ cwd, options: { maxCharacters: 30, followImports: false } })).toEqual([]);
  });

  it('ignores what follows an @ when it is not a tracked file inside the repository', async () => {
    const cwd = await createGitWorkspace({ 'CLAUDE.md': '@exadev/config @~/notes.md @/etc/hosts @../outside.md @untracked.md\n' });
    await writeFile(join(cwd, 'untracked.md'), 'x'.repeat(DEFAULT_MAX_INSTRUCTION_CHARACTERS));

    expect(await instructionFileSize({ cwd, options: {} })).toEqual([]);
  });

  it('follows an import that is itself a link, and counts nothing for a directory, a pattern or the parent directory', async () => {
    const cwd = await createGitWorkspace({
      'CLAUDE.md': '@docs @docs/ @*.md @.. @. @guide.md\n',
      'guide.md': { symlink: 'docs/guide.md' },
      'docs/guide.md': 'x'.repeat(LIMIT),
      'docs/other.md': 'y'.repeat(LIMIT),
    });

    expect(await instructionFileSize({ cwd, options: { maxCharacters: LIMIT + 1 } })).toEqual([
      {
        code: 'instruction-file-size/too-large',
        message: `CLAUDE.md is 46 characters with its imports (docs/guide.md: ${String(LIMIT)}), over the limit of ${String(LIMIT + 1)}; move detail into docs/ and leave a pointer to it`,
        file: 'CLAUDE.md',
      },
    ]);
  });

  it('judges the index, so content staged over a smaller working tree file counts', async () => {
    const cwd = await createGitWorkspace({ 'CLAUDE.md': 'x'.repeat(LIMIT + 1) });
    await writeFile(join(cwd, 'CLAUDE.md'), 'x');

    expect((await instructionFileSize({ cwd, options: { maxCharacters: LIMIT } })).map((violation) => violation.code)).toEqual(['instruction-file-size/too-large']);
  });

  it('skips a missing file, a link that leads nowhere, and finds files in the directories named', async () => {
    const cwd = await createGitWorkspace({
      'AGENTS.md': { symlink: 'MISSING.md' },
      'CLAUDE.md': { symlink: '../outside.md' },
      'packages/a/GEMINI.md': 'x'.repeat(LIMIT + 1),
      'packages/b/GEMINI.md': { symlink: 'GEMINI.md' },
    });

    expect(await instructionFileSize({ cwd, options: { maxCharacters: LIMIT } })).toEqual([]);
    expect((await instructionFileSize({ cwd, options: { files: ['GEMINI.md'], directories: ['packages/*'], maxCharacters: LIMIT } })).map((violation) => violation.file)).toEqual([
      'packages/a/GEMINI.md',
    ]);
  });

  it('fails outside a git working tree, since it reads the index', async () => {
    const cwd = await makeTempDir();

    await expect(instructionFileSize({ cwd, options: {} })).rejects.toThrow(ConformanceError);
  });
});
