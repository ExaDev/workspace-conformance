import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const created: string[] = [];

/**
 * The absolute path of a directory or file under `test/fixtures`.
 */
export function fixturePath(...segments: readonly string[]): string {
  return join(import.meta.dirname, '..', 'fixtures', ...segments);
}

/**
 * A new empty directory outside the repository, removed by {@link removeTempDirs}.
 */
export async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-conformance-'));
  created.push(directory);

  return directory;
}

/**
 * A copy of a fixture in a new directory outside the repository, so it has no `node_modules` above it and the checks cannot lean on the repository's own.
 */
export async function copyFixture(...segments: readonly string[]): Promise<string> {
  const directory = await makeTempDir();
  await cp(fixturePath(...segments), directory, { recursive: true });

  return directory;
}

/**
 * Write `files` (paths relative to `directory`) into it, creating parent directories.
 */
export async function writeFiles(directory: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, name)), { recursive: true });
    await writeFile(join(directory, name), content);
  }
}

/**
 * Remove every directory created since the last call. Call it from `afterEach`.
 */
export async function removeTempDirs(): Promise<void> {
  await Promise.all(created.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })));
}
