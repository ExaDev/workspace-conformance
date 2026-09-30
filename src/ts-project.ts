import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { Project } from 'ts-morph';

import { ConformanceError } from './errors';
import { findFiles } from './files';
import type { CheckName } from './options';

/**
 * The tsconfig used for compiler options and module resolution when the options name none.
 */
export const DEFAULT_TS_CONFIG = 'tsconfig.json';

/**
 * Which options of which check a project is created from, so an error names the option and not the value a person wrote in it.
 */
export interface ProjectOptionNames {
  readonly check: CheckName;
  /**
   * The name of the option that holds the globs of the files.
   */
  readonly files: string;
}

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
 * A ts-morph project for the files matching `patterns`. Compiler options come from the tsconfig; its file list is not used, so only these files and what they import are loaded. Throws `ConformanceError` when the tsconfig does not exist or no file matches, naming the options and not their values.
 */
export async function createProject(cwd: string, tsConfig: string | undefined, patterns: readonly string[], names: ProjectOptionNames): Promise<FileProject> {
  const tsConfigFilePath = resolve(cwd, tsConfig ?? DEFAULT_TS_CONFIG);
  if (!existsSync(tsConfigFilePath)) {
    throw new ConformanceError(
      tsConfig === undefined
        ? `checks.${names.check}: the working directory has no ${DEFAULT_TS_CONFIG}; name one with the 'tsConfig' option`
        : `checks.${names.check}.tsConfig: the file does not exist`,
    );
  }
  const files = await findFiles(cwd, patterns);
  if (files.length === 0) {
    throw new ConformanceError(`checks.${names.check}.${names.files}: no file matches`);
  }
  const project = new Project({ tsConfigFilePath, skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths(files.map((file) => resolve(cwd, file)));

  return { project, files };
}
