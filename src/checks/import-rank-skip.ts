import type { LayoutCheckFunction } from '../check';
import { ConformanceError } from '../errors';
import type { ImportGraphOptions } from '../options';
import { rankSkipRules } from '../workspace/rules';
import { describePackage, describeTarget, edgeReport, type ImportCheckSpec, runImportCheck } from './import-graph';

/**
 * How `import-rank-skip` joins a shared cruise.
 */
export const importRankSkipSpec: ImportCheckSpec = {
  name: 'import-rank-skip',
  rules: (packages, layout) => {
    if (layout.rankSkip === undefined) {
      throw new ConformanceError("the 'import-rank-skip' check is enabled but the layout has no 'rankSkip'");
    }

    return rankSkipRules(packages, layout.rankSkip);
  },
  report: edgeReport({
    name: 'import-rank-skip',
    reason: 'skipped-rank',
    message: (edge) =>
      `${describePackage(edge.from)} (rank ${String(edge.from.rank)}) imports ${describeTarget(edge)} (rank ${String(edge.to.rank)}), further below than the layout allows`,
  }),
};

/**
 * A package imports a package more than `rankSkip.maxDistance` ranks below it that is not in `rankSkip.exemptRanks`.
 */
export const importRankSkip: LayoutCheckFunction<ImportGraphOptions> = async (context) => runImportCheck(context, importRankSkipSpec);
