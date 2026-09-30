import { type ConfigFileOptions, type LayoutConfig, layoutSection, loadSection } from '@exadev/config';
import { validateStandard } from 'cosmiconfig-extends';

import type { Violation } from './check';
import { type ConformanceConfig, conformanceSection } from './config';
import { ConformanceError } from './errors';
import type { CheckName } from './options';
import { checkNames, registry } from './registry';

/**
 * The process exit codes of the command line: nothing found, something found, or the checks could not run.
 */
export const EXIT_CODES = { clean: 0, violations: 1, failed: 2 } as const;

/**
 * Options of {@link runChecks}.
 */
export interface RunChecksOptions {
  /**
   * The directory that holds the config files and that every path option is relative to.
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

  return loaded;
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

  return loaded;
}

function selected(config: ConformanceConfig, requested: readonly CheckName[] | undefined): readonly CheckName[] {
  const enabled = checkNames.filter((name) => registry[name].isEnabled(config.checks));
  if (requested === undefined) {
    if (enabled.length === 0) {
      throw new ConformanceError("no check is enabled; add one to the 'checks' of the 'conformance' section");
    }

    return enabled;
  }
  const disabled = requested.filter((name) => !enabled.includes(name));
  if (disabled.length > 0) {
    throw new ConformanceError(`${disabled.join(', ')} ${disabled.length === 1 ? 'is' : 'are'} not enabled in the 'conformance' section`);
  }

  return checkNames.filter((name) => requested.includes(name));
}

/**
 * Run the enabled checks, or the enabled ones among `checks`, and return what they found. Sections not supplied in the options are loaded from `cwd` with `@exadev/config`.
 *
 * Violations do not throw. It throws `ConformanceError` when the checks cannot run (nothing enabled, a requested check disabled, a section missing) and `ConfigValidationError` when a section fails its schema, whether it was loaded from `cwd` or passed in.
 */
export async function runChecks(options: RunChecksOptions): Promise<RunResult> {
  const config = await conformanceOf(options);
  const names = selected(config, options.checks);
  const layout = await layoutOf(
    options,
    names.filter((name) => registry[name].requiresLayout),
  );

  const results: CheckResult[] = [];
  for (const name of names) {
    results.push({ check: name, violations: await registry[name].run({ cwd: options.cwd, checks: config.checks, layout, configFiles: options.configFiles }) });
  }
  const violations = results.flatMap((result) => result.violations);

  return { results, violations, exitCode: violations.length === 0 ? EXIT_CODES.clean : EXIT_CODES.violations };
}
