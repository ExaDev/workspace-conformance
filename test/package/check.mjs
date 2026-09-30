// Runs in a scratch project that has the packed tarball installed. It runs the checks through the installed package as an ES module and through its command line.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EXIT_CODES, checkNames, proveExhaustive, runChecks } from 'workspace-conformance';

const cwd = process.cwd();

const result = await runChecks({ cwd });
assert.deepEqual(
  result.violations.map((violation) => [violation.code, violation.file]),
  [
    ['command-types/hand-written-interface', 'contract/commands.ts'],
    ['import-uphill/higher-rank', 'libs/core/src/index.ts'],
  ],
);
assert.equal(result.exitCode, EXIT_CODES.violations);

const handlers = `
type Command = { readonly type: 'a' } | { readonly type: 'b' };
type Handlers = { readonly [Type in Command['type']]: () => void };
export const handlers: Handlers = { a: () => undefined, b: () => undefined };
`;
assert.deepEqual(proveExhaustive({ files: { 'handlers.ts': handlers }, file: 'handlers.ts', map: 'handlers' }).removals.map((removal) => removal.case), ['a', 'b']);

const run = (args) => spawnSync('node_modules/.bin/workspace-conformance', args, { cwd, encoding: 'utf8' });
const violating = run(['check']);
assert.equal(violating.status, EXIT_CODES.violations);
assert.match(violating.stderr, /libs\/core\/src\/index\.ts: import-uphill\/higher-rank: /u);
assert.equal(run(['check', '--check', 'single-storybook']).status, EXIT_CODES.clean);
assert.equal(run(['check', '--check', 'instruction-symlinks']).status, EXIT_CODES.clean);
const listed = run(['check', '--list']);
assert.equal(listed.status, EXIT_CODES.clean);
assert.deepEqual(
  listed.stdout.split('\n').filter((line) => line !== '').map((line) => line.split('\t')[0]),
  checkNames,
);
assert.equal(run(['check', '--check', 'nope']).status, EXIT_CODES.failed);
assert.equal(run([]).status, EXIT_CODES.failed);
assert.equal(run(['--help']).status, EXIT_CODES.clean);
