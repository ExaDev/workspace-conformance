import { realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { IViolation } from 'dependency-cruiser';

import type { LayoutCheckContext, Violation } from '../check';
import { ConformanceError } from '../errors';
import type { ImportGraphOptions } from '../options';
import { relativePosix } from '../paths';
import { type WorkspacePackage, readWorkspacePackages, workspaceRoot } from '../workspace/packages';
import { type ImportRule, packagesPattern } from '../workspace/rules';

/**
 * Paths left out of the import graph unless the options say otherwise: a package's own installed dependencies, and build output, which repeats the sources it was built from.
 */
export const DEFAULT_GRAPH_EXCLUDES: readonly string[] = ['(^|/)node_modules/', '(^|/)dist/'];

/**
 * One import that broke a rule, both ends resolved to the package they are in.
 */
export interface ImportEdge {
  readonly from: WorkspacePackage;
  readonly to: WorkspacePackage;
  readonly fromFile: string;
  readonly toFile: string;
}

/**
 * How an import check turns the layout into rules and the rule's findings into violations.
 */
export interface ImportCheckSpec {
  /**
   * The check's name; the violation code is `<name>/<reason>`.
   */
  readonly name: string;
  readonly reason: string;
  /**
   * The forbidden rules for the workspace's packages. Throws `ConformanceError` when the layout does not configure what the check needs.
   */
  readonly rules: (packages: readonly WorkspacePackage[], context: LayoutCheckContext<ImportGraphOptions>) => readonly ImportRule[];
  readonly message: (edge: ImportEdge) => string;
}

function packageOfFile(packages: readonly WorkspacePackage[], file: string): WorkspacePackage {
  const found = packages.find((member) => file.startsWith(`${member.dir}/`));
  if (found === undefined) {
    throw new ConformanceError(`${file} is in no workspace package, although the graph is limited to the packages' files`);
  }

  return found;
}

/**
 * The violations of `rules` among the files of `packages`. The graph is limited to the packages' own files, so nothing outside them is a dependant or a dependency.
 *
 * The base directory is the real path of the root: dependency-cruiser resolves symbolic links, so the path of a file behind one would otherwise not be relative to it.
 *
 * The result is read from the cruise summary: `cruise()` reports success in its exit code whatever the summary holds, so the code is not consulted.
 */
export async function cruiseViolations(input: {
  readonly cwd: string;
  readonly root: string;
  readonly packages: readonly WorkspacePackage[];
  readonly rules: readonly ImportRule[];
  readonly options: ImportGraphOptions;
}): Promise<readonly IViolation[]> {
  const { cwd, root, packages, rules, options } = input;
  if (rules.length === 0) {
    return [];
  }
  const tsConfigFile = options.tsConfig === undefined ? undefined : resolve(cwd, options.tsConfig);
  // dependency-cruiser is an ES module only, so it is imported dynamically: a static import would make the CommonJS build of this package fail to load.
  const { cruise } = await import('dependency-cruiser');
  const { default: extractTsConfig } = await import('dependency-cruiser/config-utl/extract-ts-config');
  const result = await cruise(
    packages.map((member) => member.dir),
    {
      baseDir: await realpath(root),
      exclude: { path: [...(options.exclude ?? DEFAULT_GRAPH_EXCLUDES)] },
      includeOnly: { path: packagesPattern(packages) },
      ruleSet: { forbidden: [...rules] },
      tsPreCompilationDeps: true,
      validate: true,
      ...(tsConfigFile === undefined ? {} : { tsConfig: { fileName: tsConfigFile } }),
    },
    {},
    tsConfigFile === undefined ? {} : { tsConfig: extractTsConfig(tsConfigFile) },
  );
  if (typeof result.output === 'string') {
    throw new ConformanceError('dependency-cruiser returned text where a result object was requested');
  }

  return result.output.summary.violations;
}

/**
 * Run one import check: generate its rules from the layout, cruise the packages and report each finding.
 */
export async function runImportCheck(context: LayoutCheckContext<ImportGraphOptions>, spec: ImportCheckSpec): Promise<readonly Violation[]> {
  const root = workspaceRoot(context.cwd, context.layout);
  const packages = await readWorkspacePackages(context.cwd, context.layout);
  const rules = spec.rules(packages, context);
  const found = await cruiseViolations({ cwd: context.cwd, root, packages, rules, options: context.options });

  return found
    .map((finding): Violation => {
      const from = packageOfFile(packages, finding.from);
      const to = packageOfFile(packages, finding.to);

      return {
        code: `${spec.name}/${spec.reason}`,
        message: spec.message({ from, to, fromFile: finding.from, toFile: finding.to }),
        file: relativePosix(context.cwd, join(root, finding.from)),
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.message.localeCompare(b.message));
}

/**
 * How a package is named in a message: its declared name, else its directory.
 */
export function describePackage(member: WorkspacePackage): string {
  return member.name ?? member.dir;
}
