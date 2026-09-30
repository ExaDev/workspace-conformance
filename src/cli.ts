#!/usr/bin/env node
import { runCommand } from './cli-command';

// runCommand reports its own failures through the exit code and never rejects.
void runCommand(process.argv.slice(2), {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
}).then((code) => {
  process.exitCode = code;
});
