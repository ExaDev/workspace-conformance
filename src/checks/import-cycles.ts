import { join } from 'node:path';

import type { LayoutCheckFunction, Violation } from '../check';
import type { ImportGraphOptions } from '../options';
import { relativePosix } from '../paths';
import { readWorkspacePackages, workspaceRoot } from '../workspace/packages';
import { cycleRule } from '../workspace/rules';
import { cruiseViolations } from './import-graph';

/**
 * Files of the workspace's packages import each other in a cycle. Each cycle is reported once, at its first file in sorted order, with the files in import order from there.
 */
export const importCycles: LayoutCheckFunction<ImportGraphOptions> = async (context) => {
  const root = workspaceRoot(context.cwd, context.layout);
  const packages = await readWorkspacePackages(context.cwd, context.layout);
  const found = await cruiseViolations({ cwd: context.cwd, root, packages, rules: [cycleRule()], options: context.options });

  const cycles = new Map<string, readonly string[]>();
  for (const finding of found) {
    const ring = [finding.from, ...(finding.cycle ?? []).map((step) => step.name)];
    const members = ring[ring.length - 1] === finding.from ? ring.slice(0, -1) : ring;
    const start = members.indexOf([...members].sort()[0] ?? finding.from);
    const ordered = [...members.slice(start), ...members.slice(0, start)];
    cycles.set([...members].sort().join('\n'), ordered);
  }

  return [...cycles.values()]
    .map((ordered): Violation => {
      const first = ordered[0] ?? '';

      return {
        code: 'import-cycles/cycle',
        message: `import cycle: ${[...ordered, first].join(' -> ')}`,
        file: relativePosix(context.cwd, join(root, first)),
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
};
