import type { LayoutCheckFunction } from '../check';
import type { ImportGraphOptions } from '../options';
import { uphillRules } from '../workspace/rules';
import { describePackage, describeTarget, edgeReport, type ImportCheckSpec, runImportCheck } from './import-graph';

/**
 * How `import-uphill` joins a shared cruise.
 */
export const importUphillSpec: ImportCheckSpec = {
  name: 'import-uphill',
  rules: (packages) => uphillRules(packages),
  report: edgeReport({
    name: 'import-uphill',
    reason: 'higher-rank',
    message: (edge) => `${describePackage(edge.from)} (rank ${String(edge.from.rank)}) imports ${describeTarget(edge)} (rank ${String(edge.to.rank)}), a higher rank`,
  }),
};

/**
 * A package imports a package of a strictly higher rank: dependencies run downhill only.
 */
export const importUphill: LayoutCheckFunction<ImportGraphOptions> = async (context) => runImportCheck(context, importUphillSpec);
