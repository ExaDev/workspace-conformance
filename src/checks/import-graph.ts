import { realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { IAvailableTranspiler, IViolation } from 'dependency-cruiser';
import type { ParsedCommandLine } from 'typescript';

import type { LayoutCheckContext, Violation } from '../check';
import { ConformanceError } from '../errors';
import type { ImportGraphOptions } from '../options';
import { relativePosix } from '../paths';
import { type WorkspacePackage, readWorkspacePackages, workspaceRoot } from '../workspace/packages';
import { graphScopePattern, type ImportRule } from '../workspace/rules';

/**
 * Paths left out of the import graph unless the options say otherwise: a package's own installed dependencies.
 */
export const DEFAULT_GRAPH_EXCLUDES: readonly string[] = ['(^|/)node_modules/'];

/**
 * Paths whose files are imported but whose own imports are not followed unless the options say otherwise: build output, which repeats the sources it was built from. A package that exports its build output is imported through it, so the output has to stay in the graph as a target.
 */
export const DEFAULT_DO_NOT_FOLLOW: readonly string[] = ['(^|/)dist/'];

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

/**
 * The package a path in the graph belongs to: the one whose directory holds the file, and only when no directory does, the one whose name the path is (an import that resolved to no file is known only by the name it was written with, or a subpath of it). The directory wins because an unscoped package name can equal the leading directory of another package's files. It throws `ConformanceError` for a path the graph should not contain.
 */
export function packageOfPath(packages: readonly WorkspacePackage[], path: string): WorkspacePackage {
  const found =
    packages.find((member) => path.startsWith(`${member.dir}/`)) ??
    packages.find((member) => member.name !== undefined && (path === member.name || path.startsWith(`${member.name}/`)));
  if (found === undefined) {
    throw new ConformanceError(`${path} is in no workspace package, although the graph is limited to the packages' files and names`);
  }

  return found;
}

/**
 * The tsconfig as dependency-cruiser should read its compiler options, with `baseUrl` set when the tsconfig has none.
 *
 * dependency-cruiser hands its path alias resolver a `baseUrl` of `./` when the parsed tsconfig has none, and that resolves against the working directory of the process, not against the tsconfig. `paths` without `baseUrl` is the form TypeScript 4.1 and later accepts (`baseUrl` is deprecated), and it means relative to the tsconfig. Given any `baseUrl`, dependency-cruiser leaves the alias resolver to read the tsconfig file itself, which applies that meaning wherever the process runs. The value set here is only that signal and is never used as a directory.
 */
function withBaseUrl(parsed: ParsedCommandLine, tsConfigFile: string): ParsedCommandLine {
  return 'baseUrl' in parsed.options ? parsed : { ...parsed, options: { ...parsed.options, baseUrl: dirname(tsConfigFile) } };
}

/**
 * Throws `ConformanceError` unless dependency-cruiser can load the installed TypeScript. Without it dependency-cruiser cruises no `.ts` file and reports success, so every import check would pass whatever the workspace imports.
 */
function assertTypeScriptAvailable(transpilers: readonly IAvailableTranspiler[]): void {
  const typescript = transpilers.find((transpiler) => transpiler.name === 'typescript');
  if (typescript?.available !== true) {
    const supported = typescript === undefined ? 'a version it supports' : `a version in ${typescript.version}`;
    throw new ConformanceError(`dependency-cruiser cannot load TypeScript, so the import checks would find no TypeScript file and report nothing; install ${supported} as the 'typescript' of this workspace`);
  }
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
  const { cruise, getAvailableTranspilers } = await import('dependency-cruiser');
  assertTypeScriptAvailable(getAvailableTranspilers());
  const { default: extractTsConfig } = await import('dependency-cruiser/config-utl/extract-ts-config');
  const result = await cruise(
    packages.map((member) => member.dir),
    {
      baseDir: await realpath(root),
      exclude: { path: [...(options.exclude ?? DEFAULT_GRAPH_EXCLUDES)] },
      doNotFollow: { path: [...(options.doNotFollow ?? DEFAULT_DO_NOT_FOLLOW)] },
      includeOnly: { path: graphScopePattern(packages) },
      ruleSet: { forbidden: [...rules] },
      tsPreCompilationDeps: true,
      validate: true,
      ...(tsConfigFile === undefined ? {} : { tsConfig: { fileName: tsConfigFile } }),
    },
    {},
    tsConfigFile === undefined ? {} : { tsConfig: withBaseUrl(extractTsConfig(tsConfigFile), tsConfigFile) },
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
      const from = packageOfPath(packages, finding.from);
      const to = packageOfPath(packages, finding.to);

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

/**
 * How an import's target is named in a message: the file and the package it is in, or just the name when the import resolved to no file and is known only by the name it was written with.
 */
export function describeTarget(edge: ImportEdge): string {
  const { to, toFile } = edge;
  const byName = !toFile.startsWith(`${to.dir}/`) && to.name !== undefined && (toFile === to.name || toFile.startsWith(`${to.name}/`));

  return byName ? toFile : `${toFile} in ${describePackage(to)}`;
}
