import type { LayoutCheckFunction } from '../check';
import { ConformanceError } from '../errors';
import type { ImportGraphOptions } from '../options';
import { isolatedGroupRules } from '../workspace/rules';
import { describePackage, describeTarget, runImportCheck } from './import-graph';

/**
 * A package imports a package in a group the layout isolates from its own.
 */
export const importIsolatedGroups: LayoutCheckFunction<ImportGraphOptions> = async (context) =>
  runImportCheck(context, {
    name: 'import-isolated-groups',
    reason: 'isolated-group',
    rules: (packages) => {
      if (context.layout.isolatedGroups === undefined) {
        throw new ConformanceError("the 'import-isolated-groups' check is enabled but the layout has no 'isolatedGroups'");
      }

      return isolatedGroupRules(packages, context.layout.isolatedGroups);
    },
    message: (edge) =>
      `${describePackage(edge.from)} (group '${edge.from.group}') imports ${describeTarget(edge)} (group '${edge.to.group}'), which the layout isolates from it`,
  });
