import { afterEach, describe, expect, it } from 'vitest';

import { fixturePath, makeTempDir, removeTempDirs, writeFiles } from '../../test/support/temp';
import type { Violation } from '../check';
import { DEFAULT_HOSTED_LABELS, workflowRunnerResolution } from './workflow-runner-resolution';

afterEach(removeTempDirs);

/**
 * What a violation is, without its prose: the code, then the file and the line.
 */
function where(violations: readonly Violation[]): readonly string[] {
  return violations.map((violation) => `${violation.code} ${violation.file}${violation.location === undefined ? '' : `:${String(violation.location.line)}`}`);
}

function fixture(check: string, kind: string): string {
  return fixturePath('workflows', check, kind);
}

const CI = '.github/workflows/ci.yml';

describe('workflow-runner-resolution', () => {
  it('reports custom labels named in several jobs, and an inline resolver without a timeout or a fallback', async () => {
    const violations = await workflowRunnerResolution({ cwd: fixture('runner-resolution', 'violating'), options: {} });

    expect(where(violations)).toEqual([
      `workflow-runner-resolution/repeated-label ${CI}:16`,
      `workflow-runner-resolution/repeated-label ${CI}:20`,
      `workflow-runner-resolution/resolver-no-timeout ${CI}:4`,
      `workflow-runner-resolution/resolver-no-fallback ${CI}:4`,
    ]);
    expect(violations[0]?.message).toBe("job 'lint' names the runner labels 'self-hosted', 'fleet' literally, like 'test'; resolve it once in a resolver job and read it with fromJson");
  });

  it('follows a resolver that is a local reusable workflow to the job that sets the output', async () => {
    const violations = await workflowRunnerResolution({ cwd: fixture('runner-resolution', 'violating-reusable'), options: {} });

    expect(where(violations)).toEqual([
      'workflow-runner-resolution/resolver-no-timeout .github/workflows/resolve.yml:9',
      'workflow-runner-resolution/resolver-no-fallback .github/workflows/resolve.yml:9',
    ]);
  });

  it('accepts a resolver with a timeout and a fallback, hosted labels repeated freely and a custom label named once', async () => {
    expect(await workflowRunnerResolution({ cwd: fixture('runner-resolution', 'clean'), options: {} })).toEqual([]);
  });

  it('reports a fallback that names a label which is not hosted, an empty fallback and one that is not JSON, and accepts a bare hosted label', async () => {
    const cwd = await makeTempDir();
    const workflow = (fallback: string): string => `on: push
jobs:
  resolve:
    timeout-minutes: 5
    runs-on: ubuntu-latest
    outputs:
      runner: >-
        \${{ steps.r.outputs.runner || ${fallback} }}
    steps:
      - id: r
        run: echo
  build:
    needs: resolve
    runs-on: \${{ fromJson(needs.resolve.outputs.runner) }}
`;
    const reported: string[] = [];
    for (const fallback of [`'["self-hosted"]'`, `'["ubuntu-latest", "self-hosted"]'`, `'[]'`, `'ubuntu-latest'`, `'["ubuntu-latest"]'`, `'"ubuntu-24.04"'`, `'[{"group": "fleet"}]'`]) {
      await writeFiles(cwd, { [CI]: workflow(fallback) });
      if ((await workflowRunnerResolution({ cwd, options: {} })).length > 0) {
        reported.push(fallback);
      }
    }

    expect(reported).toEqual([`'["self-hosted"]'`, `'["ubuntu-latest", "self-hosted"]'`, `'[]'`, `'ubuntu-latest'`, `'[{"group": "fleet"}]'`]);

    await writeFiles(cwd, { [CI]: workflow(`'["self-hosted"]'`) });
    const [notHosted] = await workflowRunnerResolution({ cwd, options: {} });

    expect(notHosted === undefined ? [] : where([notHosted])).toEqual([`workflow-runner-resolution/resolver-fallback-not-hosted ${CI}:3`]);
    expect(notHosted?.message).toBe(
      "the literal fallback of output 'runner' of resolver job 'resolve' names 'self-hosted', which matches no pattern of hostedLabels, so it is not known to offer a runner when resolution produces nothing; name a hosted label, or add the label's pattern to hostedLabels (extending DEFAULT_HOSTED_LABELS) if it is hosted, by GitHub or by a third party",
    );

    await writeFiles(cwd, { [CI]: workflow(`'[]'`) });

    expect((await workflowRunnerResolution({ cwd, options: {} }))[0]?.message).toBe(
      "the literal fallback of output 'runner' of resolver job 'resolve' is not a runner label or a non-empty list of them, so the jobs that read it have no runner when resolution produces nothing",
    );
  });

  it('accepts a fallback to a third-party hosted label once its pattern extends the exported default', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `on: push
jobs:
  resolve:
    timeout-minutes: 5
    runs-on: blacksmith-2vcpu-ubuntu-2404
    outputs:
      runner: \${{ steps.r.outputs.runner || '["blacksmith-2vcpu-ubuntu-2404"]' }}
    steps:
      - id: r
        run: echo
  build:
    needs: resolve
    runs-on: \${{ fromJson(needs.resolve.outputs.runner) }}
  test:
    runs-on: ubuntu-latest
  lint:
    runs-on: ubuntu-latest
`,
    });

    expect(where(await workflowRunnerResolution({ cwd, options: {} }))).toEqual([`workflow-runner-resolution/resolver-fallback-not-hosted ${CI}:3`]);
    expect(await workflowRunnerResolution({ cwd, options: { hostedLabels: [...DEFAULT_HOSTED_LABELS, '^blacksmith-'] } })).toEqual([]);
  });

  it('counts a runner group, and takes the hosted labels from the options', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: push
jobs:
  a:
    runs-on:
      group: fleet
  b:
    runs-on:
      group: fleet
  c:
    runs-on: blacksmith-2vcpu-ubuntu-2404
  d:
    runs-on: blacksmith-2vcpu-ubuntu-2404
`,
    });

    expect(where(await workflowRunnerResolution({ cwd, options: { hostedLabels: ['^blacksmith-'] } }))).toEqual([
      `workflow-runner-resolution/repeated-label ${CI}:4`,
      `workflow-runner-resolution/repeated-label ${CI}:7`,
    ]);
  });

  it('does not judge a resolver in another repository, which it cannot read', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: push
jobs:
  resolve:
    uses: example-org/shared/.github/workflows/runner.yml@v1
  build:
    needs: resolve
    runs-on: \${{ fromJson(needs.resolve.outputs.runner) }}
`,
    });

    expect(await workflowRunnerResolution({ cwd, options: {} })).toEqual([]);
  });

  it('fails when a local reusable workflow it has to read is not a workflow file', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: push
jobs:
  resolve:
    uses: ./.github/workflows/missing.yml
  build:
    needs: resolve
    runs-on: \${{ fromJson(needs.resolve.outputs.runner) }}
`,
    });

    await expect(workflowRunnerResolution({ cwd, options: {} })).rejects.toThrow(/missing\.yml, which is not a workflow file/u);
  });
});
