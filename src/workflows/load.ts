import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { excludedFrom, findFiles } from '../files';
import { parseWorkflow, type Workflow } from './model';

/**
 * Which workflow files a check reads.
 */
export interface WorkflowSelection {
  /**
   * Globs of the workflow files, relative to the directory the checks run in. `.github/workflows/*.yml` and `.github/workflows/*.yaml` when omitted.
   */
  readonly workflows?: readonly string[];
  /**
   * Globs of files that are left out.
   */
  readonly exclude?: readonly string[];
}

/**
 * Where GitHub looks for workflows: only this directory, and only the files directly in it.
 */
export const DEFAULT_WORKFLOWS: readonly string[] = ['.github/workflows/*.yml', '.github/workflows/*.yaml'];

/**
 * Read and parse the selected workflow files, sorted by path.
 */
export async function loadWorkflows(cwd: string, selection: WorkflowSelection): Promise<readonly Workflow[]> {
  const files = await findFiles(cwd, [...(selection.workflows ?? DEFAULT_WORKFLOWS), ...excludedFrom(selection.exclude)]);

  return Promise.all(files.map(async (file) => parseWorkflow(file, await readFile(resolve(cwd, file), 'utf8'))));
}
