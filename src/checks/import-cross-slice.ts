import type { LayoutCheckFunction } from '../check';
import { ConformanceError } from '../errors';
import type { ImportGraphOptions } from '../options';
import { crossSliceRules } from '../workspace/rules';
import { describePackage, describeTarget, runImportCheck } from './import-graph';

/**
 * A package imports a package in a different slice.
 */
export const importCrossSlice: LayoutCheckFunction<ImportGraphOptions> = async (context) =>
  runImportCheck(context, {
    name: 'import-cross-slice',
    reason: 'other-slice',
    rules: (packages) => {
      if (!packages.some((member) => member.slice !== undefined)) {
        throw new ConformanceError("the 'import-cross-slice' check is enabled but no package in the layout has a slice");
      }

      return crossSliceRules(packages);
    },
    message: (edge) =>
      `${describePackage(edge.from)} (slice '${String(edge.from.slice)}') imports ${describeTarget(edge)} (slice '${String(edge.to.slice)}')`,
  });
