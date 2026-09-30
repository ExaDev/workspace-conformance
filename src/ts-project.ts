import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { Project } from 'ts-morph';

import { ConformanceError } from './errors';
import { findFiles } from './files';

/**
 * The tsconfig used for compiler options and module resolution when the options name none.
 */
export const DEFAULT_TS_CONFIG = 'tsconfig.json';

/**
 * A ts-morph project and the files it was created for.
 */
export interface FileProject {
  readonly project: Project;
  /**
   * The files that matched, relative to the directory the checks run in, sorted.
   */
  readonly files: readonly string[];
}

/**
 * A ts-morph project for the files matching `patterns`. Compiler options come from the tsconfig; its file list is not used, so only these files and what they import are loaded. Throws `ConformanceError` when the tsconfig does not exist or no file matches.
 */
export async function createProject(cwd: string, tsConfig: string | undefined, patterns: readonly string[]): Promise<FileProject> {
  const tsConfigFilePath = resolve(cwd, tsConfig ?? DEFAULT_TS_CONFIG);
  if (!existsSync(tsConfigFilePath)) {
    throw new ConformanceError(`the tsconfig ${tsConfigFilePath} does not exist; name one with the 'tsConfig' option`);
  }
  const files = await findFiles(cwd, patterns);
  if (files.length === 0) {
    throw new ConformanceError(`no file matches ${patterns.join(', ')}`);
  }
  const project = new Project({ tsConfigFilePath, skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths(files.map((file) => resolve(cwd, file)));

  return { project, files };
}
