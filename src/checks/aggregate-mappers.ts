import { existsSync } from 'node:fs';
import { posix, resolve } from 'node:path';

import type { CheckFunction, FileViolation } from '../check';
import { findDirectories } from '../files';
import type { AggregateMappersOptions } from '../options';
import { relativePosix } from '../paths';
import { expandTemplate } from '../template';
import { createProject } from '../ts-project';
import { declarationLocation, exportedTypes } from './exported-types';

/**
 * Every exported interface and type alias of a contract file is an aggregate and has a mapper file where the template puts it, in each adapter directory when `adapters` is set.
 *
 * It looks for the file, not for what is in it, and it counts a type as exported when the contract re-exports it.
 */
export const aggregateMappers: CheckFunction<AggregateMappersOptions> = async ({ cwd, options }) => {
  const { project, files } = await createProject(cwd, options.tsConfig, options.contracts, { check: 'aggregate-mappers', files: 'contracts' });
  const excluded = new Set(options.exclude);
  const violations: FileViolation[] = [];

  for (const contract of files) {
    const contractDir = posix.dirname(contract);
    const contractValues = { dir: contractDir, file: contract };
    let adapters: readonly (string | undefined)[] = [undefined];
    if (options.adapters !== undefined) {
      const pattern = posix.normalize(expandTemplate(options.adapters, contractValues));
      const matched = await findDirectories(cwd, [pattern]);
      if (matched.length === 0) {
        violations.push({ code: 'aggregate-mappers/no-adapters', message: `no adapter directory matches ${pattern}, so no aggregate of ${contract} can have a mapper`, file: contract });
      }
      adapters = matched;
    }

    const source = project.getSourceFileOrThrow(resolve(cwd, contract));
    for (const [name, declaration] of exportedTypes(source)) {
      if (excluded.has(name)) {
        continue;
      }
      for (const adapter of adapters) {
        const expected = posix.normalize(expandTemplate(options.mapper, adapter === undefined ? { ...contractValues, name } : { ...contractValues, name, adapter }));
        if (!existsSync(resolve(cwd, expected))) {
          violations.push({
            code: 'aggregate-mappers/missing-mapper',
            message: `${name} has no mapper at ${expected}`,
            file: relativePosix(cwd, declaration.getSourceFile().getFilePath()),
            location: declarationLocation(declaration),
          });
        }
      }
    }
  }

  return violations.sort((a, b) => a.file.localeCompare(b.file) || (a.location?.line ?? 0) - (b.location?.line ?? 0) || a.message.localeCompare(b.message));
};
