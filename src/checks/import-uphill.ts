import type { LayoutCheckFunction } from '../check';
import type { ImportGraphOptions } from '../options';
import { uphillRules } from '../workspace/rules';
import { describePackage, runImportCheck } from './import-graph';

/**
 * A package imports a package of a strictly higher rank: dependencies run downhill only.
 */
export const importUphill: LayoutCheckFunction<ImportGraphOptions> = async (context) =>
  runImportCheck(context, {
    name: 'import-uphill',
    reason: 'higher-rank',
    rules: (packages) => uphillRules(packages),
    message: ({ from, to, toFile }) =>
      `${describePackage(from)} (rank ${String(from.rank)}) imports ${toFile} in ${describePackage(to)} (rank ${String(to.rank)}), a higher rank`,
  });
