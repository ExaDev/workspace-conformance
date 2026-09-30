import type { LayoutCheckFunction } from '../check';
import { ConformanceError } from '../errors';
import type { ImportGraphOptions } from '../options';
import { rankSkipRules } from '../workspace/rules';
import { describePackage, runImportCheck } from './import-graph';

/**
 * A package imports a package more than `rankSkip.maxDistance` ranks below it that is not in `rankSkip.exemptRanks`.
 */
export const importRankSkip: LayoutCheckFunction<ImportGraphOptions> = async (context) =>
  runImportCheck(context, {
    name: 'import-rank-skip',
    reason: 'skipped-rank',
    rules: (packages) => {
      if (context.layout.rankSkip === undefined) {
        throw new ConformanceError("the 'import-rank-skip' check is enabled but the layout has no 'rankSkip'");
      }

      return rankSkipRules(packages, context.layout.rankSkip);
    },
    message: ({ from, to, toFile }) =>
      `${describePackage(from)} (rank ${String(from.rank)}) imports ${toFile} in ${describePackage(to)} (rank ${String(to.rank)}), further below than the layout allows`,
  });
