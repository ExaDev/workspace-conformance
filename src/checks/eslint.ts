import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

import type { ESLint } from 'eslint';

import type { CheckFunction, SourceLocation, Violation } from '../check';
import { isRecord } from '../config-files';
import { findFiles } from '../files';
import { ConformanceError } from '../errors';
import type { EslintOptions, EslintRequiredSeverity, EslintSample } from '../options';
import { relativePosix } from '../paths';

type EffectiveSeverity = 'off' | EslintRequiredSeverity;

/**
 * The patterns the full level lints when the options name none.
 */
export const DEFAULT_LINT_PATTERNS: readonly string[] = ['.'];

const SEVERITY_RANK: Readonly<Record<EffectiveSeverity, number>> = { off: 0, warn: 1, error: 2 };

function hasEslintClass(value: unknown): value is { readonly ESLint: typeof ESLint } {
  return isRecord(value) && typeof value['ESLint'] === 'function';
}

/**
 * The `ESLint` class of the ESLint installed where the checks run, found the way a module in `cwd` finds it. It is not this package's own copy, so the results agree with the repository's own lint script.
 */
function loadEslint(cwd: string): typeof ESLint {
  const requireFromCwd = createRequire(join(cwd, 'package.json'));
  try {
    requireFromCwd.resolve('eslint');
  } catch (error) {
    throw new ConformanceError(`the eslint check uses the repository's own ESLint, and 'eslint' does not resolve from ${cwd}; install it there`, { cause: error });
  }
  const loaded: unknown = requireFromCwd('eslint');
  if (!hasEslintClass(loaded)) {
    throw new ConformanceError(`the 'eslint' that resolves from ${cwd} does not export the ESLint class of the Node API`);
  }

  return loaded.ESLint;
}

/**
 * The severity a rule entry resolves to. An entry is a severity or an array whose first element is one, and a severity is `0`, `1`, `2`, `'off'`, `'warn'` or `'error'`; `calculateConfigForFile` returns whichever form the config was written in.
 */
export function normaliseSeverity(entry: unknown): EffectiveSeverity {
  const severity: unknown = Array.isArray(entry) ? entry[0] : entry;
  if (severity === 0 || severity === 'off') {
    return 'off';
  }
  if (severity === 1 || severity === 'warn') {
    return 'warn';
  }
  if (severity === 2 || severity === 'error') {
    return 'error';
  }

  throw new ConformanceError(`ESLint resolved ${JSON.stringify(entry)} as a rule entry, which is not a severity or an array that starts with one`);
}

/**
 * The severity of each rule in a resolved configuration.
 */
function resolvedSeverities(config: unknown): ReadonlyMap<string, EffectiveSeverity> {
  if (!isRecord(config)) {
    throw new ConformanceError('ESLint resolved a configuration that is not an object');
  }
  const { rules } = config;
  if (rules !== undefined && !isRecord(rules)) {
    throw new ConformanceError("ESLint resolved a configuration whose 'rules' is not an object");
  }

  return new Map(Object.entries(rules ?? {}).map(([rule, entry]) => [rule, normaliseSeverity(entry)]));
}

/**
 * Whether `error` is the one `calculateConfigForFile` throws when ESLint finds no config file for the path.
 */
function isMissingConfig(error: unknown): boolean {
  return isRecord(error) && error['messageTemplate'] === 'config-file-missing';
}

function sampleOf(sample: string | EslintSample): EslintSample {
  return typeof sample === 'string' ? { path: sample } : sample;
}

function ruleViolations(file: string, required: Readonly<Record<string, EslintRequiredSeverity>>, actual: ReadonlyMap<string, EffectiveSeverity>): readonly Violation[] {
  return Object.entries(required).flatMap(([rule, severity]): readonly Violation[] => {
    const found = actual.get(rule);
    if (found === undefined) {
      return [{ code: 'eslint/rule-missing', message: `the rule '${rule}' is not configured for ${file} (required: ${severity})`, file }];
    }
    if (found === 'off') {
      return [{ code: 'eslint/rule-off', message: `the rule '${rule}' is off for ${file} (required: ${severity})`, file }];
    }
    if (SEVERITY_RANK[found] < SEVERITY_RANK[severity]) {
      return [{ code: 'eslint/rule-too-weak', message: `the rule '${rule}' is '${found}' for ${file} (required: ${severity})`, file }];
    }

    return [];
  });
}

async function sampleViolations(eslint: ESLint, sample: EslintSample, shared: Readonly<Record<string, EslintRequiredSeverity>>): Promise<readonly Violation[]> {
  const file = sample.path;
  let config: unknown;
  try {
    // `isPathIgnored` is `calculateConfigForFile` that returned nothing, so this one call answers both questions.
    config = await eslint.calculateConfigForFile(file);
  } catch (error) {
    if (isMissingConfig(error)) {
      return [{ code: 'eslint/no-config', message: `ESLint finds no config file for ${file}; the check does not fall back to a config of its own`, file }];
    }

    throw new ConformanceError(`ESLint could not resolve its configuration for ${file}`, { cause: error });
  }
  if (config === undefined) {
    return [{ code: 'eslint/not-linted', message: `${file} is not linted: it is ignored, or no configuration block matches it`, file }];
  }

  return ruleViolations(file, { ...shared, ...sample.rules }, resolvedSeverities(config));
}

/**
 * Whether `error` is ESLint refusing a pattern because it selects no file that is linted.
 */
function isNothingLinted(error: unknown): error is Error {
  return error instanceof Error && isRecord(error) && (error['messageTemplate'] === 'file-not-found' || error['messageTemplate'] === 'all-matched-files-ignored');
}

type LintMessage = ESLint.LintResult['messages'][number];

/**
 * Where a message is, or `undefined` for a message about the whole file. ESLint types `line` and `column` as numbers, but a parsing error copies them from the parser's error, which may carry none: typescript-eslint's project service reports a file outside every tsconfig that way.
 */
function locationOf(message: LintMessage): SourceLocation | undefined {
  const line: unknown = message.line;
  const column: unknown = message.column;

  return typeof line === 'number' && typeof column === 'number' ? { line, column } : undefined;
}

function messageViolation(cwd: string, result: ESLint.LintResult, message: LintMessage): Violation {
  const file = relativePosix(cwd, result.filePath);
  const location = locationOf(message);
  const at = location === undefined ? { file } : { file, location };
  if (message.ruleId !== null) {
    const severity = message.severity === 1 ? 'warn' : 'error';

    return { code: `eslint/lint/${message.ruleId}`, message: `${message.ruleId} (${severity}): ${message.message}`, ...at };
  }

  return message.fatal === true ? { code: 'eslint/fatal', message: message.message, ...at } : { code: 'eslint/lint-message', message: message.message, ...at };
}

function byPosition(left: Violation, right: Violation): number {
  return (
    left.file.localeCompare(right.file) ||
    (left.location?.line ?? 0) - (right.location?.line ?? 0) ||
    (left.location?.column ?? 0) - (right.location?.column ?? 0) ||
    left.code.localeCompare(right.code)
  );
}

function files(count: number): string {
  return count === 1 ? '1 file' : `${String(count)} files`;
}

/**
 * The files below `cwd` that ESLint has a configuration for (not ignored, and matched by a configuration block) and that the lint did not reach: the patterns are narrower than what the config covers.
 */
async function unreachedFiles(cwd: string, eslint: ESLint, linted: ReadonlySet<string>): Promise<readonly string[]> {
  const candidates = (await findFiles(cwd, ['**'])).filter((file) => !linted.has(resolve(cwd, file)));
  const unreached: string[] = [];
  for (const file of candidates) {
    if (!(await eslint.isPathIgnored(file))) {
      unreached.push(file);
    }
  }

  return unreached;
}

/**
 * Lints the workspace through the Node API, with the repository's own config, and maps every message to a violation. A pattern that selects no linted file is itself a violation, since the workspace is then not linted at all. It notes how many files it linted and how many files the config covers that the patterns did not reach.
 */
async function lintViolations(cwd: string, eslint: ESLint, patterns: readonly string[], note: ((text: string) => void) | undefined): Promise<readonly Violation[]> {
  const violations: Violation[] = [];
  const results = new Map<string, ESLint.LintResult>();
  for (const pattern of patterns) {
    try {
      for (const result of await eslint.lintFiles([pattern])) {
        results.set(result.filePath, result);
      }
    } catch (error) {
      if (!isNothingLinted(error)) {
        throw new ConformanceError(`ESLint could not lint '${pattern}'`, { cause: error });
      }
      violations.push({ code: 'eslint/nothing-linted', message: error.message, file: pattern });
    }
  }
  for (const result of results.values()) {
    for (const message of result.messages) {
      violations.push(messageViolation(cwd, result, message));
    }
  }
  if (note !== undefined) {
    const unreached = await unreachedFiles(cwd, eslint, new Set(results.keys()));
    note(
      unreached.length === 0
        ? `linted ${files(results.size)}`
        : `linted ${files(results.size)}; ${unreached.length === 1 ? '1 other file has' : `${String(unreached.length)} other files have`} an ESLint configuration and ${unreached.length === 1 ? 'was' : 'were'} not reached by lintPatterns (${patterns.join(', ')})`,
    );
  }

  return violations.sort(byPosition);
}

/**
 * Proves the repository's own ESLint is applied, which no check that runs inside ESLint can notice: a config that dropped a shared preset, switched its rules off or narrowed `ignores` until nothing is linted still passes its own lint.
 *
 * It loads the ESLint that resolves from the directory the checks run in and resolves the repository's own config through the Node API, so the answer is the one the repository's lint script gets. By default it lints nothing: for each sample it reads the resolved configuration (the object `--print-config` prints) and reports a sample that is not linted, and each required rule that is missing, off or weaker than required. With `lint` it also lints the workspace and reports every message.
 *
 * The config is a black box: the check sees which rules are active on a file, not why. It does not embed a config, so a repository without one is reported and nothing is substituted.
 */
export const eslint: CheckFunction<EslintOptions> = async (context) => {
  const { options } = context;
  // ESLint's Node API takes only an absolute cwd, while every check accepts one relative to the process.
  const cwd = resolve(context.cwd);
  const EslintClass = loadEslint(cwd);
  const instance = new EslintClass({ cwd, ...(options.configFile === undefined ? {} : { overrideConfigFile: resolve(cwd, options.configFile) }) });
  const shared = options.rules ?? {};
  const violations: Violation[] = [];
  for (const sample of options.samples.map(sampleOf)) {
    violations.push(...(await sampleViolations(instance, sample, shared)));
  }
  if (options.lint === true) {
    violations.push(...(await lintViolations(cwd, instance, options.lintPatterns ?? DEFAULT_LINT_PATTERNS, context.note)));
  }

  return violations;
};
