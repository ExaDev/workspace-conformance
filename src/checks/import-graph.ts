import { realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { LayoutConfig } from '@exadev/config';
import type { IAvailableTranspiler, IViolation } from 'dependency-cruiser';
import type { ParsedCommandLine } from 'typescript';

import type { LayoutCheckContext, Violation } from '../check';
import { ConformanceError } from '../errors';
import type { ImportGraphOptions } from '../options';
import { relativePosix } from '../paths';
import { DEFAULT_DEPENDENCY_FIELDS, isInPackage, readDeclaredDependencies, type WorkspacePackage, readWorkspacePackages, workspaceRoot } from '../workspace/packages';
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
 * What a check's report may need to know about the workspace the graph was cruised over.
 */
export interface ImportScope {
  readonly cwd: string;
  /**
   * The workspace root; finding paths are relative to it.
   */
  readonly root: string;
  readonly packages: readonly WorkspacePackage[];
  /**
   * Whether an import from one package of another is judged: unless the importer declares the imported package, and only in fields the layout's `dependencyFields` does not read. The ESLint workspace rules read the same layout and do not see such a declaration, so a test-only `devDependencies` edge is exempt from both by default. An import of a package not declared at all is judged, since it is what a declaration would have hidden from ESLint.
   */
  readonly judged: (from: WorkspacePackage, to: WorkspacePackage) => boolean;
}

/**
 * How an import check takes part in a shared cruise: the rules it adds and how it reads its own findings. Findings are routed to a check by the names of the rules it generated, so those names must differ from every other check's.
 */
export interface ImportCheckSpec {
  /**
   * The check's name; the violation code is `<name>/<reason>`.
   */
  readonly name: string;
  /**
   * The forbidden rules for the workspace's packages. Throws `ConformanceError` when the layout does not configure what the check needs.
   */
  readonly rules: (packages: readonly WorkspacePackage[], layout: LayoutConfig) => readonly ImportRule[];
  /**
   * The violations for the findings of this check's rules, in a stable order.
   */
  readonly report: (findings: readonly IViolation[], scope: ImportScope) => readonly Violation[];
}

/**
 * The package a path in the graph belongs to: the one whose directory holds the file, and only when no directory does, the one whose name the path is (an import that resolved to no file is known only by the name it was written with, or a subpath of it). The directory wins because an unscoped package name can equal the leading directory of another package's files. It throws `ConformanceError` for a path the graph should not contain.
 */
export function packageOfPath(packages: readonly WorkspacePackage[], path: string): WorkspacePackage {
  const found =
    packages.find((member) => isInPackage(member.dir, path)) ??
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
 * The graph-wide options that decide what a cruise sees, with their defaults filled in. Checks whose settings are equal share a cruise; the key is the serialised form.
 */
function cruiseKey(cwd: string, options: ImportGraphOptions): string {
  return JSON.stringify({
    exclude: options.exclude ?? DEFAULT_GRAPH_EXCLUDES,
    doNotFollow: options.doNotFollow ?? DEFAULT_DO_NOT_FOLLOW,
    tsConfig: options.tsConfig === undefined ? null : resolve(cwd, options.tsConfig),
  });
}

/**
 * One cruise of the packages' files with `rules`, whose findings are read from the cruise summary: `cruise()` reports success in its exit code whatever the summary holds, so the code is not consulted.
 *
 * The graph is limited to the packages' own files, so nothing outside them is a dependant or a dependency. The base directory is the real path of the root: dependency-cruiser resolves symbolic links, so the path of a file behind one would otherwise not be relative to it.
 */
async function cruiseViolations(input: {
  readonly cwd: string;
  readonly root: string;
  readonly packages: readonly WorkspacePackage[];
  readonly rules: readonly ImportRule[];
  readonly options: ImportGraphOptions;
}): Promise<readonly IViolation[]> {
  const { cwd, root, packages, rules, options } = input;
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
 * An import check bound to the options it was enabled with.
 */
export interface ImportCheckEntry {
  readonly spec: ImportCheckSpec;
  readonly options: ImportGraphOptions;
}

/**
 * Run import checks over one read of the workspace's packages, and cruise once for each distinct combination of `exclude`, `doNotFollow` and `tsConfig` among them rather than once per check. Every check adds its rules to its group's cruise and gets back the findings of its own rules, which are the same as a cruise of that check alone would give: each rule is matched against each import independently.
 *
 * The result has an entry for every check, in the order of `entries`. A check whose layout yields no rules reports nothing and adds nothing to a cruise; a group none of whose checks has rules is not cruised.
 */
export async function runImportChecks(input: {
  readonly cwd: string;
  readonly layout: LayoutConfig;
  readonly entries: readonly ImportCheckEntry[];
}): Promise<ReadonlyMap<string, readonly Violation[]>> {
  const { cwd, layout, entries } = input;
  const root = workspaceRoot(cwd, layout);
  const packages = await readWorkspacePackages(cwd, layout);
  const declared = await readDeclaredDependencies(root, packages, layout);
  const read = new Set(layout.dependencyFields ?? DEFAULT_DEPENDENCY_FIELDS);
  const judged = (from: WorkspacePackage, to: WorkspacePackage): boolean => {
    const fields = to.name === undefined ? undefined : declared.get(from.dir)?.get(to.name);

    return fields === undefined || fields.some((field) => read.has(field));
  };
  const scope: ImportScope = { cwd, root, packages, judged };
  const contributions = entries.map((entry) => ({ ...entry, rules: entry.spec.rules(packages, layout) }));

  const groups = new Map<string, { readonly options: ImportGraphOptions; readonly members: typeof contributions[number][] }>();
  for (const contribution of contributions) {
    const key = cruiseKey(cwd, contribution.options);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { options: contribution.options, members: [contribution] });
    } else {
      group.members.push(contribution);
    }
  }

  const found = new Map<string, IViolation[]>();
  for (const { options, members } of groups.values()) {
    const rules = members.flatMap((member) => member.rules);
    if (rules.length === 0) {
      continue;
    }
    const owner = new Map<string, string>();
    for (const member of members) {
      for (const rule of member.rules) {
        const existing = owner.get(rule.name);
        if (existing !== undefined && existing !== member.spec.name) {
          throw new ConformanceError(`the checks ${existing} and ${member.spec.name} both generate a rule named '${rule.name}', so their findings cannot be told apart`);
        }
        owner.set(rule.name, member.spec.name);
      }
    }
    for (const finding of await cruiseViolations({ cwd, root, packages, rules, options })) {
      const name = owner.get(finding.rule.name);
      if (name === undefined) {
        throw new ConformanceError(`dependency-cruiser reported the rule '${finding.rule.name}', which no check generated`);
      }
      const own = found.get(name);
      if (own === undefined) {
        found.set(name, [finding]);
      } else {
        own.push(finding);
      }
    }
  }

  return new Map(contributions.map(({ spec }) => [spec.name, spec.report(found.get(spec.name) ?? [], scope)]));
}

/**
 * Run one import check on its own.
 */
export async function runImportCheck(context: LayoutCheckContext<ImportGraphOptions>, spec: ImportCheckSpec): Promise<readonly Violation[]> {
  const results = await runImportChecks({ cwd: context.cwd, layout: context.layout, entries: [{ spec, options: context.options }] });

  return results.get(spec.name) ?? [];
}

/**
 * The report of a check whose every rule forbids one package importing another: one violation per finding the scope judges, at the importing file, ordered by file and message.
 */
export function edgeReport(spec: {
  readonly name: string;
  readonly reason: string;
  readonly message: (edge: ImportEdge) => string;
}): ImportCheckSpec['report'] {
  return (findings, { cwd, root, packages, judged }) =>
    findings
      .flatMap((finding): readonly Violation[] => {
        const from = packageOfPath(packages, finding.from);
        const to = packageOfPath(packages, finding.to);

        return judged(from, to)
          ? [
              {
                code: `${spec.name}/${spec.reason}`,
                message: spec.message({ from, to, fromFile: finding.from, toFile: finding.to }),
                file: relativePosix(cwd, join(root, finding.from)),
              },
            ]
          : [];
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
  const byName = !isInPackage(to.dir, toFile) && to.name !== undefined && (toFile === to.name || toFile.startsWith(`${to.name}/`));

  return byName ? toFile : `${toFile} in ${describePackage(to)}`;
}
