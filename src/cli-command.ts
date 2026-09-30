import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import type { Violation } from './check';
import type { CheckName } from './options';
import { checkNames, isCheckName, registry } from './registry';
import { EXIT_CODES, runChecks } from './run-checks';

/**
 * Where the command writes, so a caller can capture the output.
 */
export interface CommandOutput {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const USAGE = `Usage: workspace-conformance check [--cwd <directory>] [--check <name>]... [--list]

Runs the conformance checks enabled in the 'conformance' section of exadev.config.ts (or exadev.conformance.config.ts).

  --cwd <directory>   Directory that holds the config files. Defaults to the current directory.
  --check <name>      Run only this check, which must be enabled. Repeatable.
  --list              Print the names of all checks and stop.
  --help              Show this message.

Exit status: ${String(EXIT_CODES.clean)} when nothing is found, ${String(EXIT_CODES.violations)} when a check finds a violation, ${String(EXIT_CODES.failed)} when the checks could not run.
`;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatViolation(violation: Violation): string {
  const place = violation.location === undefined ? violation.file : `${violation.file}:${String(violation.location.line)}:${String(violation.location.column)}`;

  return `${place}: ${violation.code}: ${violation.message}\n`;
}

function requestedChecks(names: readonly string[]): readonly CheckName[] {
  return names.map((name) => {
    if (!isCheckName(name)) {
      throw new TypeError(`unknown check '${name}'; the checks are ${checkNames.join(', ')}`);
    }

    return name;
  });
}

async function runCheck(args: readonly string[], output: CommandOutput): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { cwd: { type: 'string' }, check: { type: 'string', multiple: true }, list: { type: 'boolean' }, help: { type: 'boolean' } },
    allowPositionals: false,
  });
  if (values.help === true) {
    output.stdout(USAGE);

    return EXIT_CODES.clean;
  }
  if (values.list === true) {
    for (const name of checkNames) {
      output.stdout(`${name}\t${registry[name].description}\n`);
    }

    return EXIT_CODES.clean;
  }
  const cwd = resolve(values.cwd ?? process.cwd());
  const result = await runChecks({ cwd, ...(values.check === undefined ? {} : { checks: requestedChecks(values.check) }) });
  for (const violation of result.violations) {
    output.stderr(formatViolation(violation));
  }
  if (result.violations.length === 0) {
    output.stdout(`no violations from ${result.results.map((entry) => entry.check).join(', ')}\n`);
  }

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
    if (command === '--help') {
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
