import { join } from 'node:path';

import type { LayoutCheckFunction, Violation } from '../check';
import { ConformanceError } from '../errors';
import type { ImportGraphOptions } from '../options';
import { relativePosix } from '../paths';
import type { WorkspacePackage } from '../workspace/packages';
import { CYCLE_RULE_NAME, cycleRule, UNRESOLVED_NAME_IMPORT_RULE_NAME, unresolvedNameImportRule } from '../workspace/rules';
import { describePackage, type ImportCheckSpec, packageOfPath, runImportCheck } from './import-graph';

/**
 * `items` rotated to start at the one with the smallest key, so the same ring found from any of its elements has one form.
 */
function rotatedToSmallest<Item>(items: readonly Item[], keyOf: (item: Item) => string): readonly Item[] {
  const keys = items.map(keyOf);
  const smallest = keys.toSorted()[0];
  if (smallest === undefined) {
    throw new ConformanceError('an import cycle with no members was reported');
  }
  const start = keys.indexOf(smallest);

  return [...items.slice(start), ...items.slice(0, start)];
}

/**
 * The cycles among files that dependency-cruiser found, each as its files in import order from its smallest path. A cycle is one ring of files, so two distinct rings over the same files are two cycles.
 */
function fileCycles(findings: readonly { readonly from: string; readonly cycle?: readonly { readonly name: string }[] }[]): ReadonlyMap<string, readonly string[]> {
  const cycles = new Map<string, readonly string[]>();
  for (const finding of findings) {
    const ring = [finding.from, ...(finding.cycle ?? []).map((step) => step.name)];
    const members = ring[ring.length - 1] === finding.from ? ring.slice(0, -1) : ring;
    const ordered = rotatedToSmallest(members, (file) => file);
    cycles.set(ordered.join('\n'), ordered);
  }

  return cycles;
}

/**
 * An import of package `to` by a name that resolves to no file, written in a file of package `from`.
 */
interface NameImport {
  readonly from: WorkspacePackage;
  readonly to: WorkspacePackage;
  readonly file: string;
}

/**
 * The shortest ring of packages that starts and ends at the package in `startDir` along the name imports, or `undefined` when none returns to it.
 */
function shortestRing(startDir: string, edges: ReadonlyMap<string, readonly NameImport[]>): readonly NameImport[] | undefined {
  const reached = new Map<string, readonly NameImport[]>();
  let frontier: readonly (readonly NameImport[])[] = [[]];
  while (frontier.length > 0) {
    const next: (readonly NameImport[])[] = [];
    for (const path of frontier) {
      const last = path[path.length - 1];
      for (const edge of edges.get(last === undefined ? startDir : last.to.dir) ?? []) {
        const ring = [...path, edge];
        if (edge.to.dir === startDir) {
          return ring;
        }
        if (!reached.has(edge.to.dir)) {
          reached.set(edge.to.dir, ring);
          next.push(ring);
        }
      }
    }
    frontier = next;
  }

  return undefined;
}

/**
 * The cycles among packages that import each other by a name that resolves to no file (a workspace that is not installed, or whose entry points are not built). There is no file to follow, so the packages stand for their files, and a package importing its own name is not a cycle.
 */
function nameCycles(imports: readonly NameImport[]): ReadonlyMap<string, readonly NameImport[]> {
  const edges = new Map<string, NameImport[]>();
  for (const edge of imports) {
    if (edge.from.dir === edge.to.dir) {
      continue;
    }
    const existing = edges.get(edge.from.dir);
    if (existing === undefined) {
      edges.set(edge.from.dir, [edge]);
    } else if (!existing.some((known) => known.to.dir === edge.to.dir)) {
      existing.push(edge);
    }
  }

  const cycles = new Map<string, readonly NameImport[]>();
  for (const dir of [...edges.keys()].sort()) {
    const ring = shortestRing(dir, edges);
    if (ring !== undefined) {
      const ordered = rotatedToSmallest(ring, (edge) => edge.from.dir);
      cycles.set(ordered.map((edge) => edge.from.dir).join('\n'), ordered);
    }
  }

  return cycles;
}

/**
 * How `import-cycles` joins a shared cruise.
 */
export const importCyclesSpec: ImportCheckSpec = {
  name: 'import-cycles',
  rules: (packages) => {
    const nameRule = unresolvedNameImportRule(packages);

    return nameRule === undefined ? [cycleRule()] : [cycleRule(), nameRule];
  },
  report: (found, { cwd, root, packages }) => {
    const inFiles = fileCycles(found.filter((finding) => finding.rule.name === CYCLE_RULE_NAME));
    const imports = found
      .filter((finding) => finding.rule.name === UNRESOLVED_NAME_IMPORT_RULE_NAME)
      .map((finding): NameImport => ({ from: packageOfPath(packages, finding.from), to: packageOfPath(packages, finding.to), file: finding.from }));
    const inPackages = nameCycles(imports);

    const violations = [
      ...[...inFiles.values()].map((ordered): Violation => {
        const [first] = ordered;
        if (first === undefined) {
          throw new ConformanceError('an import cycle with no files was reported');
        }

        return { code: 'import-cycles/cycle', message: `import cycle: ${[...ordered, first].join(' -> ')}`, file: relativePosix(cwd, join(root, first)) };
      }),
      ...[...inPackages.values()].map((ring): Violation => {
        const [first] = ring;
        if (first === undefined) {
          throw new ConformanceError('an import cycle with no packages was reported');
        }
        const names = [...ring.map((edge) => describePackage(edge.from)), describePackage(first.from)];

        return {
          code: 'import-cycles/cycle',
          message: `import cycle between packages that import each other by a name that resolves to no file: ${names.join(' -> ')}`,
          file: relativePosix(cwd, join(root, first.file)),
        };
      }),
    ];

    return violations.sort((a, b) => a.file.localeCompare(b.file) || a.message.localeCompare(b.message));
  },
};

/**
 * Files of the workspace's packages import each other in a cycle, and so do packages that import each other by a name that resolves to no file. Each cycle is reported once, at its first file (or, for packages, the file of the first import), starting from its smallest path.
 *
 * Cycles among packages are found only when every import in the ring is by a name that resolves to no file. A ring that mixes such imports with imports that do resolve to files has no complete path through either graph and is not seen.
 */
export const importCycles: LayoutCheckFunction<ImportGraphOptions> = async (context) => runImportCheck(context, importCyclesSpec);
