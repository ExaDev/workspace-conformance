import { afterEach, describe, expect, it } from 'vitest';

import { fixturePath, makeTempDir, removeTempDirs, writeFiles } from '../../test/support/temp';
import type { Violation } from '../check';
import { ConformanceError } from '../errors';
import { workflowActionPinning } from './workflow-action-pinning';
import { workflowCredentials } from './workflow-credentials';
import { workflowJobOrdering } from './workflow-job-ordering';
import { workflowMergeGroup } from './workflow-merge-group';
import { workflowRepositoryDispatch } from './workflow-repository-dispatch';
import { workflowRunnerResolution } from './workflow-runner-resolution';
import { workflowSkippableJobs } from './workflow-skippable-jobs';
import { workflowUpdateBotCooldown } from './workflow-update-bot-cooldown';
import { workflowVersionSingleSource } from './workflow-version-single-source';

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

describe('workflow-job-ordering', () => {
  it('reports a release job that does not need the deploy job, a documentation job that does not need the release job or check out afresh, and a weak junction job', async () => {
    const violations = await workflowJobOrdering({ cwd: fixture('job-ordering', 'violating'), options: {} });

    expect(where(violations)).toEqual([
      `workflow-job-ordering/release-before-deploy ${CI}:13`,
      `workflow-job-ordering/docs-deploy-before-release ${CI}:18`,
      `workflow-job-ordering/docs-deploy-stale-checkout ${CI}:22`,
      `workflow-job-ordering/junction-not-always ${CI}:24`,
      `workflow-job-ordering/junction-missing-need ${CI}:24`,
      `workflow-job-ordering/junction-missing-need ${CI}:24`,
      `workflow-job-ordering/junction-fails-on-skipped ${CI}:24`,
      `workflow-job-ordering/junction-no-failure-condition ${CI}:24`,
    ]);
    expect(violations[0]?.message).toBe("release job 'release' does not need deploy job 'deploy', so a release can be published after a failed deploy");
    expect(violations[4]?.message).toContain("does not list job 'release'");
    expect(violations[5]?.message).toContain("does not list job 'docs-deploy'");
  });

  it('accepts ordered jobs and a junction job that is always run, needs everything and fails on failure and cancellation only', async () => {
    expect(await workflowJobOrdering({ cwd: fixture('job-ordering', 'clean'), options: {} })).toEqual([]);
  });

  it('follows the transitive needs graph, so a release behind another job that needs the deploy job is ordered', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: push
jobs:
  deploy:
    runs-on: ubuntu-latest
  verify:
    needs: deploy
    runs-on: ubuntu-latest
  release:
    needs: verify
    runs-on: ubuntu-latest
`,
    });

    expect(await workflowJobOrdering({ cwd, options: {} })).toEqual([]);
  });

  it('names jobs by the ids in the options, exempts jobs from the junction and accepts the default branch written literally', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: push
jobs:
  ship:
    needs: [build]
    runs-on: ubuntu-latest
  publish-docs:
    needs: [ship]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: trunk
  build:
    runs-on: ubuntu-latest
  gate:
    needs: [build, ship]
    if: \${{ always() }}
    runs-on: ubuntu-latest
    steps:
      - uses: re-actors/alls-green@release/v1
        with:
          jobs: \${{ toJSON(needs) }}
`,
    });

    expect(
      await workflowJobOrdering({
        cwd,
        options: { releaseJobs: ['ship'], deployJobs: ['build'], docsDeployJobs: ['publish-docs'], junctionJobs: ['gate'], junctionExempt: ['publish-docs'], defaultBranch: 'trunk' },
      }),
    ).toEqual([]);
  });

  it('does not judge a role that has no job in the workflow', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, { [CI]: 'on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n' });

    expect(await workflowJobOrdering({ cwd, options: {} })).toEqual([]);
  });

  it('fails when a workflow file is not valid YAML or not shaped like a workflow', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, { [CI]: 'on: push\njobs: [unclosed\n' });

    await expect(workflowJobOrdering({ cwd, options: {} })).rejects.toThrow(ConformanceError);

    await writeFiles(cwd, { [CI]: 'on: push\njobs:\n  build: 5\n' });

    await expect(workflowJobOrdering({ cwd, options: {} })).rejects.toThrow(/jobs\.build must be a mapping/u);
  });
});

describe('workflow-skippable-jobs', () => {
  it('reports a path filter on the trigger of a workflow with a junction job, and a job a path filter skips that no junction job reports for', async () => {
    const violations = await workflowSkippableJobs({ cwd: fixture('skippable-jobs', 'violating'), options: {} });

    expect(where(violations)).toEqual([
      `workflow-skippable-jobs/trigger-path-filter ${CI}:3`,
      `workflow-skippable-jobs/job-gated-by-path-filter ${CI}:18`,
    ]);
  });

  it('accepts a path filter that gates steps, and a gated job a junction job needs', async () => {
    expect(await workflowSkippableJobs({ cwd: fixture('skippable-jobs', 'clean'), options: {} })).toEqual([]);
  });

  it('recognises the path filter actions and junction jobs named in the options', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on:
  pull_request_target:
    paths-ignore: ['docs/**']
jobs:
  detect:
    runs-on: ubuntu-latest
    steps:
      - uses: example-org/changed@v1
  build:
    needs: detect
    if: needs.detect.outputs.code == 'true'
    runs-on: ubuntu-latest
  summary:
    needs: [detect]
    if: always()
    runs-on: ubuntu-latest
`,
    });

    expect(await workflowSkippableJobs({ cwd, options: {} })).toEqual([]);
    expect(where(await workflowSkippableJobs({ cwd, options: { junctionJobs: ['summary'], pathFilterActions: ['example-org/changed'] } }))).toEqual([
      `workflow-skippable-jobs/trigger-path-filter ${CI}:3`,
      `workflow-skippable-jobs/job-gated-by-path-filter ${CI}:10`,
    ]);
  });
});

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

describe('workflow-version-single-source', () => {
  it('reports a literal runtime version when a version file already holds it', async () => {
    const violations = await workflowVersionSingleSource({ cwd: fixture('version-single-source', 'violating'), options: {} });

    expect(where(violations)).toEqual([
      `workflow-version-single-source/literal-version ${CI}:7`,
      `workflow-version-single-source/literal-version ${CI}:10`,
    ]);
    expect(violations[0]?.message).toBe('actions/setup-node sets node-version: 22, but .nvmrc already holds the version; read it from there with node-version-file');
  });

  it('accepts steps that read the version file, a matrix expression, and a tool no version file lists', async () => {
    expect(await workflowVersionSingleSource({ cwd: fixture('version-single-source', 'clean'), options: {} })).toEqual([]);
  });

  it('has nothing to report without a version file', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, { [CI]: "on: push\njobs:\n  b:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '22'\n" });

    expect(await workflowVersionSingleSource({ cwd, options: {} })).toEqual([]);
  });

  it('reads Node from .tool-versions when there is no .nvmrc', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      '.tool-versions': 'nodejs 22.1.0 # lts\n',
      [CI]: "on: push\njobs:\n  b:\n    steps:\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '22'\n",
    });

    const [violation] = await workflowVersionSingleSource({ cwd, options: {} });

    expect(violation?.message).toContain('.tool-versions already holds the version');
  });
});

describe('workflow-credentials', () => {
  it('reports attestation steps without id-token and attestations write, and a tokenless publish that neither blanks the tokens nor sets provenance', async () => {
    const violations = await workflowCredentials({ cwd: fixture('credentials', 'violating'), options: {} });
    const release = '.github/workflows/release.yml';

    expect(where(violations)).toEqual([
      `workflow-credentials/attestation-permissions ${release}:12`,
      `workflow-credentials/attestation-permissions ${release}:18`,
      `workflow-credentials/tokenless-publish-unprotected ${release}:28`,
    ]);
    expect(violations[0]?.message).toBe("job 'attest' creates an attestation but does not grant attestations: write");
    expect(violations[1]?.message).toBe("job 'attest-default' creates an attestation but does not grant id-token: write and attestations: write");
  });

  it('accepts granted permissions, blanked tokens, provenance and a publish that passes a token', async () => {
    expect(await workflowCredentials({ cwd: fixture('credentials', 'clean'), options: {} })).toEqual([]);
  });

  it('does not ban registry-url, and takes blanked variables from the workflow or job environment', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: push
env:
  NPM_TOKEN: ''
permissions:
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    env:
      NODE_AUTH_TOKEN: ''
    steps:
      - uses: actions/setup-node@v4
        with:
          registry-url: https://registry.npmjs.org
      - run: HUSKY=0 pnpm exec semantic-release
`,
    });

    expect(await workflowCredentials({ cwd, options: {} })).toEqual([]);
  });

  it('reads a publish command only where a command starts, and the permissions a job declares in place of the workflow', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: push
permissions:
  id-token: write
  attestations: write
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo "npm publish is how a release is made"
  b:
    runs-on: ubuntu-latest
    permissions: read-all
    steps:
      - uses: actions/attest-sbom@v2
      - run: npm publish --provenance=false
  c:
    runs-on: ubuntu-latest
    permissions: write-all
    steps:
      - uses: actions/attest-sbom@v2
      - run: |
          npm publish \\
            --provenance
`,
    });

    expect(where(await workflowCredentials({ cwd, options: {} }))).toEqual([`workflow-credentials/attestation-permissions ${CI}:15`]);
  });
});

describe('workflow-repository-dispatch', () => {
  it('reports a handler that pushes to the default branch, merges with --auto, relies on the default token, or dispatches elsewhere with it', async () => {
    const violations = await workflowRepositoryDispatch({ cwd: fixture('repository-dispatch', 'violating'), options: {} });
    const update = '.github/workflows/update.yml';

    expect(where(violations)).toEqual([
      `workflow-repository-dispatch/pushes-default-branch ${update}:13`,
      `workflow-repository-dispatch/default-token-triggers-nothing ${update}:13`,
      `workflow-repository-dispatch/auto-merge-without-required-checks ${update}:19`,
      `workflow-repository-dispatch/default-token-triggers-nothing ${update}:26`,
      `workflow-repository-dispatch/dispatch-other-repository-with-default-token ${update}:35`,
    ]);
  });

  it('accepts a handler that opens a pull request with another token and dispatches within the repository, and leaves workflows that are not handlers alone', async () => {
    expect(await workflowRepositoryDispatch({ cwd: fixture('repository-dispatch', 'clean'), options: {} })).toEqual([]);
  });

  it('accepts --auto once the options say the branch requires checks', async () => {
    const cwd = fixture('repository-dispatch', 'violating');

    expect((await workflowRepositoryDispatch({ cwd, options: { assumeRequiredChecks: true } })).map((violation) => violation.code)).not.toContain(
      'workflow-repository-dispatch/auto-merge-without-required-checks',
    );
  });

  it('judges a push without a refspec by the branch the handler has checked out', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: repository_dispatch
jobs:
  bare:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: \${{ secrets.APP_TOKEN }}
      - run: git push
  branch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: \${{ secrets.APP_TOKEN }}
      - run: git switch -c update && git push -u origin update
  checked-out-branch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: update
          token: \${{ secrets.APP_TOKEN }}
      - run: git push
  trunk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: \${{ secrets.APP_TOKEN }}
      - run: git push origin HEAD:refs/heads/trunk
  auto-commit-branch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: \${{ secrets.APP_TOKEN }}
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          branch: update
  auto-commit-default:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: \${{ secrets.APP_TOKEN }}
      - uses: stefanzweifel/git-auto-commit-action@v5
`,
    });

    expect(where(await workflowRepositoryDispatch({ cwd, options: { defaultBranches: ['trunk'] } }))).toEqual([
      `workflow-repository-dispatch/pushes-default-branch ${CI}:10`,
      `workflow-repository-dispatch/pushes-default-branch ${CI}:32`,
      `workflow-repository-dispatch/pushes-default-branch ${CI}:48`,
    ]);
  });

  it('reports a pull request opened by an action with the default token, and a dispatch action aimed at another repository', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on:
  repository_dispatch:
    types: [sync]
jobs:
  pr:
    runs-on: ubuntu-latest
    steps:
      - uses: peter-evans/create-pull-request@v7
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - uses: peter-evans/repository-dispatch@v3
        with:
          repository: example-org/other
          token: \${{ secrets.GITHUB_TOKEN }}
  fine:
    runs-on: ubuntu-latest
    steps:
      - uses: peter-evans/create-pull-request@v7
        with:
          token: \${{ secrets.APP_TOKEN }}
`,
    });

    expect(where(await workflowRepositoryDispatch({ cwd, options: {} }))).toEqual([
      `workflow-repository-dispatch/default-token-triggers-nothing ${CI}:9`,
      `workflow-repository-dispatch/dispatch-other-repository-with-default-token ${CI}:13`,
    ]);
  });
});

describe('workflow-update-bot-cooldown', () => {
  it('reports a Dependabot update entry without a cooldown of days above zero and a Renovate config without minimumReleaseAge', async () => {
    const violations = await workflowUpdateBotCooldown({ cwd: fixture('update-bot-cooldown', 'violating'), options: {} });

    expect(where(violations)).toEqual([
      'workflow-update-bot-cooldown/dependabot-no-cooldown .github/dependabot.yml:3',
      'workflow-update-bot-cooldown/dependabot-no-cooldown .github/dependabot.yml:7',
      'workflow-update-bot-cooldown/renovate-no-minimum-release-age renovate.json',
    ]);
    expect(violations[1]?.message).toContain('github-actions');
  });

  it('accepts a cooldown, a minimumReleaseAge in a package rule, and a config that comments and trails commas', async () => {
    expect(await workflowUpdateBotCooldown({ cwd: fixture('update-bot-cooldown', 'clean'), options: {} })).toEqual([]);
  });

  it('accepts a Renovate preset whose name carries the setting, reads configs named in the options, and has nothing to report without a bot', async () => {
    const cwd = await makeTempDir();

    expect(await workflowUpdateBotCooldown({ cwd, options: {} })).toEqual([]);

    await writeFiles(cwd, {
      '.github/renovate.json': '{ "extends": ["security:minimumReleaseAgeNpm"] }',
      'bot/dependabot.yaml': 'version: 2\nupdates:\n  - package-ecosystem: npm\n    cooldown:\n      default-days: 3\n',
    });

    expect(await workflowUpdateBotCooldown({ cwd, options: { dependabot: 'bot/dependabot.yaml' } })).toEqual([]);
  });

  it('fails on a config named in the options that does not exist or does not parse', async () => {
    const cwd = await makeTempDir();

    await expect(workflowUpdateBotCooldown({ cwd, options: { dependabot: 'nope.yml' } })).rejects.toThrow(/nope\.yml does not exist/u);

    await writeFiles(cwd, { 'renovate.json': '{ "extends": ' });

    await expect(workflowUpdateBotCooldown({ cwd, options: {} })).rejects.toThrow(/renovate\.json: not valid JSON/u);
  });
});

describe('workflow-merge-group', () => {
  it('reports a workflow that runs for pull requests but not for the merge queue', async () => {
    expect(where(await workflowMergeGroup({ cwd: fixture('merge-group', 'violating'), options: {} }))).toEqual([`workflow-merge-group/missing-trigger ${CI}:3`]);
  });

  it('accepts a merge_group trigger, and workflows that do not run for pull requests', async () => {
    expect(await workflowMergeGroup({ cwd: fixture('merge-group', 'clean'), options: {} })).toEqual([]);
  });

  it('leaves out the workflows the options exclude', async () => {
    expect(await workflowMergeGroup({ cwd: fixture('merge-group', 'violating'), options: { exclude: ['.github/workflows/ci.yml'] } })).toEqual([]);
  });
});

describe('workflow-action-pinning', () => {
  const policy = { organisations: ['example-org'], allow: ['allowed-org/*'] };

  it('reports a tag, a branch, a missing ref and an unpinned image, and lets the same organisation use a ref', async () => {
    const violations = await workflowActionPinning({ cwd: fixture('action-pinning', 'violating'), options: policy });

    expect(where(violations)).toEqual([
      `workflow-action-pinning/not-pinned ${CI}:8`,
      `workflow-action-pinning/not-pinned ${CI}:9`,
      `workflow-action-pinning/docker-not-pinned ${CI}:10`,
      `workflow-action-pinning/missing-ref ${CI}:11`,
    ]);
    expect(violations[0]?.message).toBe("actions/checkout@v4: ref 'v4' is not a full commit SHA, and a tag or branch can be moved to different code");
  });

  it('accepts SHAs and digests, an organisation by ref, an exempt repository and local actions', async () => {
    expect(await workflowActionPinning({ cwd: fixture('action-pinning', 'clean'), options: policy })).toEqual([]);
  });

  it('pins by SHA everything that is not named when nothing is configured', async () => {
    expect((await workflowActionPinning({ cwd: fixture('action-pinning', 'clean'), options: {} })).map((violation) => violation.message.split(':')[0])).toEqual([
      'example-org/shared/.github/actions/setup@v1',
      'allowed-org/tool@v2',
      'example-org/shared/.github/workflows/build.yml@main',
    ]);
  });

  it('applies the levels the options set to either side', async () => {
    const cwd = fixture('action-pinning', 'violating');

    expect(await workflowActionPinning({ cwd, options: { ...policy, thirdParty: 'ref', allow: [] } })).toHaveLength(2);
    expect(where(await workflowActionPinning({ cwd, options: { ...policy, thirdParty: 'ref', sameOrganisation: 'sha', allow: [] } }))).toEqual([
      `workflow-action-pinning/docker-not-pinned ${CI}:10`,
      `workflow-action-pinning/missing-ref ${CI}:11`,
      `workflow-action-pinning/not-pinned ${CI}:12`,
      `workflow-action-pinning/not-pinned ${CI}:13`,
    ]);
  });
});
