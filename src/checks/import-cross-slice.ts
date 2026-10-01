import type { LayoutCheckFunction } from '../check';
import { ConformanceError } from '../errors';
import type { ImportGraphOptions } from '../options';
import { crossSliceRules } from '../workspace/rules';
import { describePackage, describeTarget, edgeReport, type ImportCheckSpec, runImportCheck } from './import-graph';

/**
 * How `import-cross-slice` joins a shared cruise.
 */
export const importCrossSliceSpec: ImportCheckSpec = {
  name: 'import-cross-slice',
  rules: (packages) => {
    if (!packages.some((member) => member.slice !== undefined)) {
      throw new ConformanceError("the 'import-cross-slice' check is enabled but no package in the layout has a slice");
    }

    return crossSliceRules(packages);
  },
  report: edgeReport({
    name: 'import-cross-slice',
    reason: 'other-slice',
    message: (edge) => `${describePackage(edge.from)} (slice '${String(edge.from.slice)}') imports ${describeTarget(edge)} (slice '${String(edge.to.slice)}')`,
  }),
};

/**
 * A package imports a package in a different slice.
 */
export const importCrossSlice: LayoutCheckFunction<ImportGraphOptions> = async (context) => runImportCheck(context, importCrossSliceSpec);
