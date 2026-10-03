import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { Violation } from './check';
import { ConformanceError } from './errors';
import { createGitHubClient, type GitHubClient } from './github';
import { relativePosix } from './paths';
import type { CheckName } from './options';
import { checkNames, isCheckName, registry } from './registry';
import { EXIT_CODES, type RunResult, runChecks } from './run-checks';

/**
 * Where the command writes, so a caller can capture the output.
 */
export interface CommandOutput {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/**
 * How the command prints a result.
 */
const FORMATS = ['text', 'json', 'github'] as const;

type Format = (typeof FORMATS)[number];

function isFormat(value: string): value is Format {
  return FORMATS.some((format) => format === value);
}

const USAGE = `Usage: workspace-conformance check [--cwd <directory>] [--check <name>]... [--list] [--settings] [--format <text|json|github>]

Runs the conformance checks enabled in the 'conformance' section of exadev.config.ts (or exadev.conformance.config.ts).

  --cwd <directory>   Directory that holds the config files. Defaults to the current directory.
  --check <name>      Run only this check, which must be enabled. Repeatable.
  --list              Print the names of all checks and stop.
  --settings          Also run the enabled settings-* checks, which read the repository's settings through the GitHub API with the token in GITHUB_TOKEN or GH_TOKEN. Offline otherwise.
  --format <format>   text (the default): violations on standard error, notes on standard output. json: the result as one JSON document on standard output. github: a GitHub Actions error annotation per violation on standard output.
  --help, -h          Show this message.

Exit status: ${String(EXIT_CODES.clean)} when nothing is found, ${String(EXIT_CODES.violations)} when a check finds a violation, ${String(EXIT_CODES.failed)} when the checks could not run.
`;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatViolation(violation: Violation): string {
  const place = violation.location === undefined ? violation.file : `${violation.file}:${String(violation.location.line)}:${String(violation.location.column)}`;

  return `${place}: ${violation.code}: ${violation.message}\n`;
}

/**
 * A workflow command property value with the characters the runner reserves percent-encoded, as `escapeProperty` of `@actions/core` encodes them.
 */
function escapeProperty(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A').replaceAll(':', '%3A').replaceAll(',', '%2C');
}

/**
 * A workflow command message with the characters the runner reserves percent-encoded, as `escapeData` of `@actions/core` encodes them.
 */
function escapeData(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

/**
 * The GitHub Actions `error` workflow command for a violation at `file` (relative to the directory the job runs in, which is how the runner places an annotation), with the violation's code as its title and its position when it has one.
 */
export function githubAnnotation(violation: Violation, file: string): string {
  const position = violation.location === undefined ? '' : `,line=${String(violation.location.line)},col=${String(violation.location.column)}`;

  return `::error file=${escapeProperty(file)}${position},title=${escapeProperty(violation.code)}::${escapeData(violation.message)}\n`;
}

function formatOf(value: string | undefined): Format {
  if (value === undefined) {
    return 'text';
  }
  if (!isFormat(value)) {
    throw new TypeError(`unknown format '${value}'; the formats are ${FORMATS.join(', ')}`);
  }

  return value;
}

function summaryOf(result: RunResult): string {
  return `no violations from ${result.results.map((entry) => entry.check).join(', ')}\n`;
}

/**
 * Print `result` in `format`. A violation's file is relative to `cwd`; an annotation needs it relative to the directory the command runs in.
 */
function printResult(result: RunResult, format: Format, cwd: string, output: CommandOutput): void {
  if (format === 'json') {
    output.stdout(`${JSON.stringify(result, undefined, 2)}\n`);

    return;
  }
  for (const entry of result.results) {
    for (const note of entry.notes) {
      output.stdout(format === 'github' ? `::notice title=${escapeProperty(entry.check)}::${escapeData(note)}\n` : `${entry.check}: ${note}\n`);
    }
  }
  for (const violation of result.violations) {
    if (format === 'github') {
      output.stdout(githubAnnotation(violation, relativePosix(process.cwd(), resolve(cwd, violation.file))));
    } else {
      output.stderr(formatViolation(violation));
    }
  }
  if (result.violations.length === 0) {
    output.stdout(summaryOf(result));
  }
}

function requestedChecks(names: readonly string[]): readonly CheckName[] {
  return names.map((name) => {
    if (!isCheckName(name)) {
      throw new TypeError(`unknown check '${name}'; the checks are ${checkNames.join(', ')}`);
    }

    return name;
  });
}

/**
 * The client the settings checks read through, authenticated by the first non-empty token of `GITHUB_TOKEN` and `GH_TOKEN`.
 */
function clientFromEnvironment(): GitHubClient {
  const token = [process.env['GITHUB_TOKEN'], process.env['GH_TOKEN']].find((value) => value !== undefined && value !== '');
  if (token === undefined) {
    throw new ConformanceError('--settings needs a token in GITHUB_TOKEN or GH_TOKEN');
  }

  return createGitHubClient({ token });
}

async function runCheck(args: readonly string[], output: CommandOutput): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { cwd: { type: 'string' }, check: { type: 'string', multiple: true }, list: { type: 'boolean' }, settings: { type: 'boolean' }, format: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
    allowPositionals: false,
  });
  if (values.help === true) {
    output.stdout(USAGE);

    return EXIT_CODES.clean;
  }
  const requested = values.check === undefined ? undefined : requestedChecks(values.check);
  if (values.list === true) {
    for (const name of checkNames) {
      output.stdout(`${name}\t${registry[name].description}\n`);
    }

    return EXIT_CODES.clean;
  }
  const format = formatOf(values.format);
  const cwd = values.cwd ?? process.cwd();
  const result = await runChecks({ cwd, ...(requested === undefined ? {} : { checks: requested }), ...(values.settings === true ? { github: clientFromEnvironment() } : {}) });
  printResult(result, format, cwd, output);

  return result.exitCode;
}

/**
 * Run the `workspace-conformance` command with the arguments after the program name and return the exit code. A failure to run (missing or unknown command or option, unknown check, unloadable config) is reported on `stderr` and returns {@link EXIT_CODES}`.failed`.
 */
export async function runCommand(args: readonly string[], output: CommandOutput): Promise<number> {
  try {
    const [command, ...rest] = args;
    if (command === 'check') {
      return await runCheck(rest, output);
    }
    if (command === '--help' || command === '-h' || command === 'help') {
      output.stdout(USAGE);

      return EXIT_CODES.clean;
    }
    if (command === undefined) {
      throw new TypeError(`missing command\n\n${USAGE}`);
    }
    throw new TypeError(`unknown command '${command}'\n\n${USAGE}`);
  } catch (error) {
    output.stderr(`${messageOf(error)}\n`);

    return EXIT_CODES.failed;
  }
}
