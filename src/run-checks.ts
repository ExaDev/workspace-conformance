import { resolve } from 'node:path';

import { type ConfigFileOptions, type LayoutConfig, layoutSection, loadSection } from '@exadev/config';
import { validateStandard } from 'cosmiconfig-extends';

import type { Violation } from './check';
import type { GitHubClient } from './github';
import { type ImportCheckEntry, runImportChecks } from './checks/import-graph';
import { type ChecksConfig, type ConformanceConfig, conformanceSection } from './config';
import { ConformanceError } from './errors';
import type { CheckName } from './options';
import { checkNames, type RegisteredCheck, registry } from './registry';

/**
 * The process exit codes of the command line: nothing found, something found, or the checks could not run.
 */
export const EXIT_CODES = { clean: 0, violations: 1, failed: 2 } as const;

/**
 * Options of {@link runChecks}.
 */
export interface RunChecksOptions {
  /**
   * The directory that holds the config files and that every path option is relative to. A relative path is resolved against the working directory of the process, once, before any check runs.
   */
  readonly cwd: string;
  /**
   * Run only these checks. Each must be enabled. Every enabled check runs when omitted.
   */
  readonly checks?: readonly CheckName[];
  /**
   * The `conformance` section, instead of loading it from `cwd`. It is validated against the section's schema.
   */
  readonly config?: ConformanceConfig;
  /**
   * The `layout` section, instead of loading it from `cwd`. It is validated against the section's schema. Read only by the checks that need it.
   */
  readonly layout?: LayoutConfig;
  /**
   * How config files are loaded: the sections loaded from `cwd` and the config files a check evaluates itself, such as the commitlint and release configs of `commit-types`. Only `alias` and `fsCache` apply to the latter.
   */
  readonly configFiles?: ConfigFileOptions;
  /**
   * The client the settings checks (`settings-*`) read the repository through. They run only when it is given, so a run without it stays offline and needs no token; naming one of them in `checks` without a client is an error.
   */
  readonly github?: GitHubClient;
}

/**
 * The violations of one check.
 */
export interface CheckResult {
  readonly check: CheckName;
  readonly violations: readonly Violation[];
}

/**
 * The outcome of running checks.
 */
export interface RunResult {
  /**
   * One entry per check that ran, in the order they ran.
   */
  readonly results: readonly CheckResult[];
  /**
   * Every violation of every check, by check.
   */
  readonly violations: readonly Violation[];
  /**
   * {@link EXIT_CODES}`.clean` when there are no violations, else {@link EXIT_CODES}`.violations`.
   */
  readonly exitCode: typeof EXIT_CODES.clean | typeof EXIT_CODES.violations;
}

async function conformanceOf(options: RunChecksOptions): Promise<ConformanceConfig> {
  if (options.config !== undefined) {
    return validateStandard(conformanceSection.schema, options.config, `'${conformanceSection.name}' section passed to runChecks`);
  }
  const loaded = await loadSection(conformanceSection, { ...options.configFiles, cwd: options.cwd });
  if (loaded === undefined) {
    throw new ConformanceError(`no 'conformance' section in ${options.cwd}; define it in exadev.config.ts or in exadev.conformance.config.ts`);
  }

  return loaded.value;
}

async function layoutOf(options: RunChecksOptions, needed: readonly CheckName[]): Promise<LayoutConfig | undefined> {
  if (options.layout !== undefined) {
    return validateStandard(layoutSection.schema, options.layout, `'${layoutSection.name}' section passed to runChecks`);
  }
  if (needed.length === 0) {
    return undefined;
  }
  const loaded = await loadSection(layoutSection, { ...options.configFiles, cwd: options.cwd });
  if (loaded === undefined) {
    throw new ConformanceError(`${needed.join(', ')} read the workspace layout, and there is no 'layout' section in ${options.cwd}; define it in exadev.config.ts or in exadev.layout.config.ts`);
  }

  return loaded.value;
}

function selected(config: ConformanceConfig, requested: readonly CheckName[] | undefined, online: boolean): readonly CheckName[] {
  const enabled = checkNames.filter((name) => registry[name].isEnabled(config.checks));
  if (requested === undefined) {
    if (enabled.length === 0) {
      throw new ConformanceError("no check is enabled; add one to the 'checks' of the 'conformance' section");
    }
    const runnable = enabled.filter((name) => online || !registry[name].requiresGitHub);
    if (runnable.length === 0) {
      throw new ConformanceError(`only checks that read the repository's settings are enabled (${enabled.join(', ')}); they run only with a GitHub client (--settings on the command line)`);
    }

    return runnable;
  }
  const disabled = requested.filter((name) => !enabled.includes(name));
  if (disabled.length > 0) {
    throw new ConformanceError(`${disabled.join(', ')} ${disabled.length === 1 ? 'is' : 'are'} not enabled in the 'conformance' section`);
  }
  const offline = requested.filter((name) => !online && registry[name].requiresGitHub);
  if (offline.length > 0) {
    throw new ConformanceError(`${offline.join(', ')} read${offline.length === 1 ? 's' : ''} the repository's settings and need${offline.length === 1 ? 's' : ''} a GitHub client (--settings on the command line)`);
  }

  return checkNames.filter((name) => requested.includes(name));
}

/**
 * Run the import checks among `names` together, so checks with the same graph options share one cruise. The result has an entry for each of them and none for the other checks.
 */
async function runImportGraphChecks(
  cwd: string,
  layout: LayoutConfig | undefined,
  names: readonly CheckName[],
  checks: ChecksConfig,
): Promise<ReadonlyMap<string, readonly Violation[]>> {
  const entries = names.flatMap((name): readonly ImportCheckEntry[] => {
    const check: RegisteredCheck<CheckName> = registry[name];
    if (!('importGraph' in check)) {
      return [];
    }
    const options = check.importGraph.optionsOf(checks);

    return options === undefined ? [] : [{ spec: check.importGraph.spec, options }];
  });
  if (entries.length === 0) {
    return new Map();
  }
  if (layout === undefined) {
    throw new ConformanceError(`${entries.map((entry) => entry.spec.name).join(', ')} read the workspace layout, which was not supplied`);
  }

  return runImportChecks({ cwd, layout, entries });
}

/**
 * The findings of an import check that `runImportGraphChecks` ran. Every import check among the selected names has an entry, so a missing one is a defect.
 */
function readImported(imported: ReadonlyMap<string, readonly Violation[]>, name: CheckName): readonly Violation[] {
  const found = imported.get(name);
  if (found === undefined) {
    throw new ConformanceError(`the import check '${name}' produced no result`);
  }

  return found;
}

/**
 * Run the enabled checks, or the enabled ones among `checks`, and return what they found. Sections not supplied in the options are loaded from `cwd` with `@exadev/config`.
 *
 * Violations do not throw. It throws `ConformanceError` when the checks cannot run (nothing enabled, a requested check disabled, a section missing) and `ConfigValidationError` when a section fails its schema, whether it was loaded from `cwd` or passed in.
 */
export async function runChecks(given: RunChecksOptions): Promise<RunResult> {
  const options: RunChecksOptions = { ...given, cwd: resolve(given.cwd) };
  const config = await conformanceOf(options);
  const names = selected(config, options.checks, options.github !== undefined);
  const layout = await layoutOf(
    options,
    names.filter((name) => registry[name].requiresLayout),
  );

  const imported = await runImportGraphChecks(options.cwd, layout, names, config.checks);

  const results: CheckResult[] = [];
  for (const name of names) {
    const check: RegisteredCheck<CheckName> = registry[name];
    const violations = 'run' in check ? await check.run({ cwd: options.cwd, checks: config.checks, layout, configFiles: options.configFiles, github: options.github }) : readImported(imported, name);
    results.push({ check: name, violations });
  }
  const violations = results.flatMap((result) => result.violations);

  return { results, violations, exitCode: violations.length === 0 ? EXIT_CODES.clean : EXIT_CODES.violations };
}
