// Runs in the same scratch project as check.mjs and runs the checks through the installed package as CommonJS.
const assert = require('node:assert/strict');
const { EXIT_CODES, conformanceSection, runChecks } = require('workspace-conformance');

assert.equal(conformanceSection.name, 'conformance');
runChecks({ cwd: process.cwd() }).then((result) => {
  assert.deepEqual(
    result.violations.map((violation) => violation.code),
    ['command-types/hand-written-interface', 'import-uphill/higher-rank'],
  );
  assert.equal(result.exitCode, EXIT_CODES.violations);
});
