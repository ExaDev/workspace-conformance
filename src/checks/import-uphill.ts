import type { LayoutCheckFunction } from '../check';
import type { ImportGraphOptions } from '../options';
import { uphillRules } from '../workspace/rules';
import { describePackage, describeTarget, runImportCheck } from './import-graph';

/**
 * A package imports a package of a strictly higher rank: dependencies run downhill only.
 */
export const importUphill: LayoutCheckFunction<ImportGraphOptions> = async (context) =>
  runImportCheck(context, {
    name: 'import-uphill',
    reason: 'higher-rank',
    rules: (packages) => uphillRules(packages),
    message: (edge) =>
      `${describePackage(edge.from)} (rank ${String(edge.from.rank)}) imports ${describeTarget(edge)} (rank ${String(edge.to.rank)}), a higher rank`,
  });
