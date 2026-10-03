import { afterEach, describe, expect, it } from 'vitest';

import { fixturePath, makeTempDir, removeTempDirs, writeFiles } from '../../test/support/temp';
import { where } from '../../test/support/violations';
import { workflowReleaseJob } from './workflow-release-job';

afterEach(removeTempDirs);

function fixture(kind: string): string {
  return fixturePath('workflows', 'release-job', kind);
}

const CI = '.github/workflows/ci.yml';

describe('workflow-release-job', () => {
  const release = '.github/workflows/release.yml';

  it('reports id-token granted beyond the release job, a release job with no environment or with persisted credentials, and a token secret beside id-token', async () => {
    const violations = await workflowReleaseJob({ cwd: fixture('violating'), options: {} });

    expect(where(violations)).toEqual([
      `workflow-release-job/id-token-workflow-level ${release}:5`,
      `workflow-release-job/id-token-outside-release ${release}:9`,
      `workflow-release-job/missing-environment ${release}:18`,
      `workflow-release-job/persisted-credentials ${release}:24`,
      `workflow-release-job/token-beside-oidc ${release}:25`,
    ]);
    expect(violations.map((violation) => violation.message)).toEqual([
      "the workflow's permissions grant id-token: write to every job that declares none of its own; grant it on release job 'release' only",
      "job 'attest' is granted id-token: write but is not a release job, so it can mint the OIDC identity npm trusted publishing accepts for this workflow; only release job 'release' may hold it",
      "release job 'release' declares no environment, so nothing outside the workflow file stops a branch's copy of it publishing; run it in a protected environment restricted to the default branch",
      "release job 'release' checks out without persist-credentials: false, which leaves the job token in git config for every later step",
      "job 'release' holds id-token: write and passes NODE_AUTH_TOKEN from a secret, a long-lived npm token beside the OIDC identity; publish through trusted publishing and blank the token variables",
    ]);
  });

  it('accepts a release job that alone holds id-token, runs in an environment and persists no credentials, including the deploy-key shape that pushes over SSH from a step', async () => {
    expect(await workflowReleaseJob({ cwd: fixture('clean'), options: {} })).toEqual([]);
  });

  it('reports a second job granted id-token at job level when the workflow grants it nothing', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: push
permissions: {}
jobs:
  docs:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
  release:
    runs-on: ubuntu-latest
    environment: release
    permissions:
      id-token: write
`,
    });

    expect(where(await workflowReleaseJob({ cwd, options: {} }))).toEqual([`workflow-release-job/id-token-outside-release ${CI}:5`]);
  });

  it('reports a grant of write-all as id-token, and a job that calls a reusable workflow with it', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: push
permissions: write-all
jobs:
  call:
    uses: ./.github/workflows/other.yml
    permissions:
      id-token: write
  release:
    runs-on: ubuntu-latest
    environment: release
`,
    });

    expect(where(await workflowReleaseJob({ cwd, options: {} }))).toEqual([`workflow-release-job/id-token-workflow-level ${CI}:3`, `workflow-release-job/id-token-outside-release ${CI}:5`]);
  });

  it('reports a release job with no environment even when it holds no id-token', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, { [CI]: 'on: push\njobs:\n  release:\n    runs-on: ubuntu-latest\n' });

    expect(where(await workflowReleaseJob({ cwd, options: {} }))).toEqual([`workflow-release-job/missing-environment ${CI}:3`]);
  });

  it('reports a checkout that persists a deploy key through ssh-key, and one whose persist-credentials is an expression', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: push
jobs:
  release:
    runs-on: ubuntu-latest
    environment: release
    steps:
      - uses: actions/checkout@v6
        with:
          ssh-key: \${{ secrets.RELEASE_DEPLOY_KEY }}
      - uses: actions/checkout@v6
        with:
          persist-credentials: \${{ inputs.persist }}
      - run: HUSKY=0 pnpm exec semantic-release
`,
    });

    expect(where(await workflowReleaseJob({ cwd, options: {} }))).toEqual([`workflow-release-job/persisted-credentials ${CI}:8`, `workflow-release-job/persisted-credentials ${CI}:11`]);
  });

  it('reports NPM_TOKEN from a secret at workflow or job level in any job with id-token, and accepts blanked or non-secret values', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: push
env:
  NPM_TOKEN: \${{ secrets.NPM_TOKEN }}
jobs:
  release:
    runs-on: ubuntu-latest
    environment: release
    permissions:
      id-token: write
    env:
      NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
    steps:
      - run: npm publish
        env:
          NPM_TOKEN: ''
          NODE_AUTH_TOKEN: ''
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm pack
`,
    });

    expect(where(await workflowReleaseJob({ cwd, options: {} }))).toEqual([`workflow-release-job/token-beside-oidc ${CI}:6`]);
  });

  it('reports a token secret beside id-token in a workflow that has no release job', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: push
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
    steps:
      - run: npm publish
        env:
          NPM_TOKEN: \${{ secrets.NPM_TOKEN }}
`,
    });

    expect(where(await workflowReleaseJob({ cwd, options: {} }))).toEqual([`workflow-release-job/token-beside-oidc ${CI}:9`]);
  });

  it('names release jobs by the ids in the options, and judges no other rule in a workflow without one', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: push
permissions:
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
`,
    });

    expect(await workflowReleaseJob({ cwd, options: {} })).toEqual([]);
    expect(where(await workflowReleaseJob({ cwd, options: { releaseJobs: ['publish'] } }))).toEqual([
      `workflow-release-job/id-token-workflow-level ${CI}:3`,
      `workflow-release-job/missing-environment ${CI}:6`,
      `workflow-release-job/persisted-credentials ${CI}:9`,
    ]);
  });
});
