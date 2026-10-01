import { afterAll, bench, describe } from 'vitest';

import { importCrossSlice } from '../../src/checks/import-cross-slice';
import { importCycles } from '../../src/checks/import-cycles';
import { importIsolatedGroups } from '../../src/checks/import-isolated-groups';
import { importRankSkip } from '../../src/checks/import-rank-skip';
import { importUphill } from '../../src/checks/import-uphill';
import type { ConformanceConfig } from '../../src/config';
import { runChecks } from '../../src/run-checks';
import { syntheticLayout, writeSyntheticWorkspace } from '../support/synthetic-workspace';
import { makeTempDir, removeTempDirs } from '../support/temp';

const shape = { corePackages: 10, slices: 25, filesPerPackage: 40, importsPerFile: 3 };
const config: ConformanceConfig = {
  checks: { 'import-uphill': {}, 'import-rank-skip': {}, 'import-cross-slice': {}, 'import-isolated-groups': {}, 'import-cycles': {} },
};
const cwd = await makeTempDir();
await writeSyntheticWorkspace(cwd, shape);
// A cruise of a workspace this size takes seconds, so each case runs a fixed number of times and not for a fixed duration.
const sampling = { iterations: 5, warmupIterations: 1, time: 0, warmupTime: 0 };

afterAll(removeTempDirs);

describe('every import check with default options, on a generated workspace', () => {
  bench(
    'each check on its own, one after the other',
    async () => {
      const context = { cwd, layout: syntheticLayout, options: {} };
      await importUphill(context);
      await importRankSkip(context);
      await importCrossSlice(context);
      await importIsolatedGroups(context);
      await importCycles(context);
    },
    sampling,
  );

  bench(
    'runChecks',
    async () => {
      await runChecks({ cwd, config, layout: syntheticLayout });
    },
    sampling,
  );
});
