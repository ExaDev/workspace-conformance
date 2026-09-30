#!/usr/bin/env node
import { runCommand } from './cli-command';
import { onReaderClosed } from './closed-reader';
import { EXIT_CODES } from './run-checks';

// The output could not be delivered, which says nothing about the workspace, so it must not read as a violation.
let undelivered = false;
const markUndelivered = (): void => {
  undelivered = true;
  process.exitCode = EXIT_CODES.failed;
};
onReaderClosed(process.stdout, markUndelivered);
onReaderClosed(process.stderr, markUndelivered);

// runCommand reports its own failures through the exit code and never rejects.
void runCommand(process.argv.slice(2), {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
}).then((code) => {
  process.exitCode = undelivered ? EXIT_CODES.failed : code;
});
