import { afterEach, describe, expect, it, vi } from 'vitest';

import { fixturePath, makeTempDir, removeTempDirs, writeFiles } from '../../test/support/temp';
import { where } from '../../test/support/violations';
import { ConformanceError } from '../errors';
import { type BranchRules, type GitHubClient, RulesetsUnavailableError } from '../github';
import { workflowActionPinning } from './workflow-action-pinning';
import { workflowCredentials } from './workflow-credentials';
import { workflowJobOrdering } from './workflow-job-ordering';
import { workflowMergeGroup } from './workflow-merge-group';
import { workflowRepositoryDispatch } from './workflow-repository-dispatch';
import { workflowSkippableJobs } from './workflow-skippable-jobs';
import { workflowUpdateBotCooldown } from './workflow-update-bot-cooldown';
import { workflowVersionSingleSource } from './workflow-version-single-source';

afterEach(removeTempDirs);

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

  it('accepts a junction job that loops over the joined results, and does not require it to wait for jobs that never run for a pull request', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
  required-checks:
    needs: [test]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: |
          for result in \${{ join(needs.*.result, ' ') }}; do
            if [[ "$result" == "failure" || "$result" == "cancelled" ]]; then exit 1; fi
          done
  mutation:
    if: github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
  release:
    needs: [required-checks]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
  after-mutation:
    needs: [mutation]
    runs-on: ubuntu-latest
`,
    });

    expect(await workflowJobOrdering({ cwd, options: {} })).toEqual([]);
  });

  it('still requires the junction job to wait for a job whose if allows pull requests', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: [push, pull_request]
jobs:
  required-checks:
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: test "\${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') }}" != true
  e2e:
    if: github.event_name == 'push' || github.event_name == 'pull_request'
    runs-on: ubuntu-latest
`,
    });

    expect(where(await workflowJobOrdering({ cwd, options: {} }))).toEqual([`workflow-job-ordering/junction-missing-need ${CI}:4`]);
  });

  it('still requires the junction job to wait for a job that runs in the merge queue, or whose if is a disjunction that can hold for a pull request', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: [pull_request, merge_group]
jobs:
  required-checks:
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: test "\${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') }}" != true
  e2e:
    if: github.event_name == 'merge_group'
    runs-on: ubuntu-latest
  audit:
    if: github.ref == 'refs/heads/main' || github.actor == 'dependabot[bot]'
    runs-on: ubuntu-latest
`,
    });

    expect(where(await workflowJobOrdering({ cwd, options: {} }))).toEqual([`workflow-job-ordering/junction-missing-need ${CI}:4`, `workflow-job-ordering/junction-missing-need ${CI}:4`]);
  });

  it('reads the structure of an if: an && needs one operand that keeps a job off pull requests, an || needs every operand to', async () => {
    const cwd = await makeTempDir();
    const exempt = ["github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')", "${{ (github.event_name == 'push') }}", "(github.ref == 'refs/heads/main') && (github.actor == 'a')"];
    const required = ["(github.ref == 'refs/heads/main' || github.actor == 'a') && github.actor == 'b'", "(github.ref == 'refs/heads/main') || (github.actor == 'a')"];
    const reported: string[] = [];
    for (const condition of [...exempt, ...required]) {
      await writeFiles(cwd, {
        [CI]: `on: [push, pull_request]\njobs:\n  required-checks:\n    if: always()\n    runs-on: ubuntu-latest\n    steps:\n      - run: test "\${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') }}" != true\n  other:\n    if: "${condition.replaceAll('"', '\\"')}"\n    runs-on: ubuntu-latest\n`,
      });
      if ((await workflowJobOrdering({ cwd, options: {} })).length > 0) {
        reported.push(condition);
      }
    }

    expect(reported).toEqual(required);
  });

  it('does not require the junction job to wait for a job that needs it', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: [push, pull_request]
jobs:
  required-checks:
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: test "\${{ contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') }}" != true
  publish:
    needs: [required-checks]
    runs-on: ubuntu-latest
`,
    });

    expect(await workflowJobOrdering({ cwd, options: {} })).toEqual([]);
  });

  it('reports a junction job that fails on a skipped result read from one job, as well as from needs.*.result', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      [CI]: `
on: [push, pull_request]
jobs:
  test:
    if: github.actor != 'dependabot[bot]'
    runs-on: ubuntu-latest
  required-checks:
    needs: [test]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - run: |
          [[ "\${{ needs.test.result }}" != "success" ]] && exit 1
          echo 'failure' 'cancelled'
`,
    });

    expect(where(await workflowJobOrdering({ cwd, options: {} }))).toEqual([`workflow-job-ordering/junction-fails-on-skipped ${CI}:7`]);
  });

  describe('a result tested with != "success"', () => {
    const junction = (jobs: string, steps: string): string => `on: [push, pull_request]
jobs:
${jobs}  required-checks:
    needs: [plan, test]
    if: always()
    runs-on: ubuntu-latest
    steps:
${steps}`;
    const plain = '  plan:\n    runs-on: ubuntu-latest\n  test:\n    needs: plan\n    runs-on: ubuntu-latest\n';
    const skippable = "  plan:\n    runs-on: ubuntu-latest\n  test:\n    needs: plan\n    if: needs.plan.outputs.has-packages == 'true'\n    runs-on: ubuntu-latest\n";
    const throughEnv = '      - env:\n          PLAN_RESULT: ${{ needs.plan.result }}\n          TEST_RESULT: ${{ needs.test.result }}\n        run: |\n          if [ "$PLAN_RESULT" != "success" ]; then exit 1; fi\n          if [ "${TEST_RESULT}" != "success" ]; then exit 1; fi\n';
    const inExpressions = "      - if: needs.plan.result != 'success' || needs.test.result != 'success'\n        run: exit 1\n";

    async function codes(jobs: string, steps: string): Promise<readonly string[]> {
      const cwd = await makeTempDir();
      await writeFiles(cwd, { [CI]: junction(jobs, steps) });

      return (await workflowJobOrdering({ cwd, options: {} })).map((violation) => violation.code);
    }

    it('is a failure condition, whether the result is read through an environment variable or in the expression itself', async () => {
      expect(await codes(plain, throughEnv)).toEqual([]);
      expect(await codes(plain, inExpressions)).toEqual([]);
    });

    it('fails on a skip when an if can skip the job and the junction does not read what that if reads', async () => {
      expect(await codes(skippable, throughEnv)).toEqual(['workflow-job-ordering/junction-fails-on-skipped']);
      expect(await codes(skippable, inExpressions)).toEqual(['workflow-job-ordering/junction-fails-on-skipped']);
    });

    it('does not fail on a skip the junction handles by reading what the if reads', async () => {
      const guarded = `      - env:\n          HAS_PACKAGES: \${{ needs.plan.outputs.has-packages }}\n          TEST_RESULT: \${{ needs.test.result }}\n        run: |\n          if [ "$HAS_PACKAGES" != "true" ]; then exit 0; fi\n          if [ "$TEST_RESULT" != "success" ]; then exit 1; fi\n`;

      expect(await codes(skippable, guarded)).toEqual([]);
    });
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
  /**
   * A setup step whose `.npmrc` reads `NODE_AUTH_TOKEN`, so a publish after it has a token variable to protect.
   */
  const SETUP_NODE_WITH_REGISTRY = '      - uses: actions/setup-node@v4\n        with:\n          registry-url: https://registry.npmjs.org\n';
  const tokenlessJob = (steps: string): string => `on: push\npermissions:\n  id-token: write\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;

  it('names only the token variables that something in the job reads and that are not blanked', async () => {
    const cwd = await makeTempDir();
    const reported = async (steps: string): Promise<readonly string[]> => {
      await writeFiles(cwd, { [CI]: tokenlessJob(steps) });

      return (await workflowCredentials({ cwd, options: {} })).map((violation) => violation.message);
    };

    expect(await reported('      - run: pnpm publish\n        env:\n          NODE_AUTH_TOKEN: ""\n')).toEqual([]);
    expect(await reported('      - run: npm publish\n')).toEqual([]);
    expect(await reported(`${SETUP_NODE_WITH_REGISTRY}      - run: npm publish\n        env:\n          NODE_AUTH_TOKEN: ""\n`)).toEqual([]);
    expect(await reported('      - run: npm publish\n' + SETUP_NODE_WITH_REGISTRY)).toEqual([]);
    expect(await reported(`${SETUP_NODE_WITH_REGISTRY}      - run: npm publish\n`)).toEqual([
      "job 'publish' publishes with an OIDC identity and no token, but does not set NODE_AUTH_TOKEN (read by the .npmrc actions/setup-node writes for registry-url) to the empty string, so a token inherited from the environment is used when the OIDC exchange fails; set it to the empty string to prevent that, or request provenance so that such a publish at least carries a traceable attestation",
    ]);
    expect(await reported('      - run: pnpm exec semantic-release\n        env:\n          NODE_AUTH_TOKEN: ""\n')).toEqual([
      "job 'publish' publishes with an OIDC identity and no token, but does not set NPM_TOKEN (read by semantic-release's npm plugin) to the empty string, so a token inherited from the environment is used when the OIDC exchange fails; set it to the empty string to prevent that, or request provenance so that such a publish at least carries a traceable attestation",
    ]);
  });

  it('protects the token variables the .npmrc of the working directory reads in its auth settings', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      '.npmrc': 'cache=${HOME}/.npm-cache\n# //registry.npmjs.org/:_authToken=${COMMENTED_TOKEN}\n//registry.npmjs.org/:_authToken=${EXAMPLE_TOKEN?}\n',
      [CI]: tokenlessJob('      - run: npm publish\n'),
    });

    expect((await workflowCredentials({ cwd, options: {} })).map((violation) => violation.message.split(' to the empty string')[0])).toEqual([
      "job 'publish' publishes with an OIDC identity and no token, but does not set EXAMPLE_TOKEN (read by the .npmrc of the working directory)",
    ]);

    await writeFiles(cwd, { [CI]: tokenlessJob("      - run: npm publish\n        env:\n          EXAMPLE_TOKEN: ''\n") });

    expect(await workflowCredentials({ cwd, options: {} })).toEqual([]);
  });

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

  it('accepts provenance asked for by the publishConfig of the package.json in the working directory', async () => {
    const cwd = await makeTempDir();
    await writeFiles(cwd, {
      'package.json': '{ "name": "x", "publishConfig": { "provenance": true } }',
      [CI]: `on: push\npermissions:\n  id-token: write\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n${SETUP_NODE_WITH_REGISTRY}      - run: npm publish\n`,
    });

    expect(await workflowCredentials({ cwd, options: {} })).toEqual([]);

    await writeFiles(cwd, { 'package.json': '{ "name": "x", "publishConfig": { "access": "public" } }' });

    expect(where(await workflowCredentials({ cwd, options: {} }))).toEqual([`workflow-credentials/tokenless-publish-unprotected ${CI}:11`]);
  });

  it('accepts provenance asked for by a flag or NPM_CONFIG_PROVENANCE, and not one switched off with --provenance=false', async () => {
    const cwd = await makeTempDir();
    const publish = (command: string, env = ''): string => `on: push\npermissions:\n  id-token: write\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n${SETUP_NODE_WITH_REGISTRY}      - run: ${command}\n${env}`;
    const results: Record<string, number> = {};
    const cases: readonly (readonly [string, string, string?])[] = [
      ['flag', 'npm publish --provenance'],
      ['flag with value', 'npm publish --provenance=true'],
      ['switched off', 'npm publish --provenance=false'],
      ['environment', 'npm publish', '        env:\n          NPM_CONFIG_PROVENANCE: true\n'],
      ['environment off', 'npm publish', '        env:\n          NPM_CONFIG_PROVENANCE: false\n'],
    ];
    for (const [name, command, env] of cases) {
      await writeFiles(cwd, { [CI]: publish(command, env) });
      results[name] = (await workflowCredentials({ cwd, options: {} })).length;
    }

    expect(results).toEqual({ flag: 0, 'flag with value': 0, 'switched off': 1, environment: 0, 'environment off': 1 });
  });

  it('reads a publish with package manager options before the subcommand, as a workspace publish is written', async () => {
    const cwd = await makeTempDir();
    const publish = (command: string): string => `on: push\npermissions:\n  id-token: write\njobs:\n  publish:\n    runs-on: ubuntu-latest\n    steps:\n${SETUP_NODE_WITH_REGISTRY}      - run: ${command}\n`;
    const publishes = ['pnpm publish -r', 'pnpm -r publish', 'pnpm --filter example-package publish', 'pnpm --filter=example-package publish', 'npm -w packages/example publish'];
    const releaseTools = ['semantic-release', 'pnpm semantic-release', 'pnpm exec semantic-release', 'npx semantic-release', 'changeset publish', 'pnpm changeset publish', 'yarn changeset publish', 'pnpm exec changeset publish', 'npx changeset publish', 'lerna publish'];
    const notPublishes = ['pnpm -r exec echo publish', 'pnpm changeset version'];
    const reported: string[] = [];
    for (const command of [...publishes, ...releaseTools, ...notPublishes]) {
      await writeFiles(cwd, { [CI]: publish(command) });
      if ((await workflowCredentials({ cwd, options: {} })).length > 0) {
        reported.push(command);
      }
    }

    expect(reported).toEqual([...publishes, ...releaseTools]);
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

  it('reads a push to the default branch through quotes and git global options', async () => {
    const cwd = await makeTempDir();
    const handler = (command: string): string => `on: repository_dispatch\njobs:\n  update:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          token: \${{ secrets.APP_TOKEN }}\n      - run: ${command}\n`;
    const pushes = ['git push origin "HEAD:main"', "git push origin 'main'", 'git -C . push origin main', 'git -c user.name=bot push origin main', 'git push origin main 2>&1'];
    const notPushes = ["git push origin 'update'", 'git -C . push origin update'];
    const reported: string[] = [];
    for (const command of [...pushes, ...notPushes]) {
      await writeFiles(cwd, { [CI]: handler(command) });
      if ((await workflowRepositoryDispatch({ cwd, options: {} })).some((violation) => violation.code === 'workflow-repository-dispatch/pushes-default-branch')) {
        reported.push(command);
      }
    }

    expect(reported).toEqual(pushes);
  });

  it('does not report a push as the default token when the checkout keeps no credentials, and does when it keeps them', async () => {
    const cwd = await makeTempDir();
    const handler = (persist: string): string => `on: repository_dispatch\njobs:\n  update:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          persist-credentials: ${persist}\n      - run: git push origin update\n`;
    await writeFiles(cwd, { [CI]: handler('false') });

    expect(await workflowRepositoryDispatch({ cwd, options: {} })).toEqual([]);

    await writeFiles(cwd, { [CI]: handler('true') });

    expect(where(await workflowRepositoryDispatch({ cwd, options: {} }))).toEqual([`workflow-repository-dispatch/default-token-triggers-nothing ${CI}:9`]);
  });

  it('allows a dispatch to this repository with the default token and reports one to another repository', async () => {
    const cwd = await makeTempDir();
    const handler = (repository: string): string =>
      `on: repository_dispatch\njobs:\n  update:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: peter-evans/repository-dispatch@v3\n        with:\n          token: \${{ secrets.GITHUB_TOKEN }}\n          repository: ${repository}\n          event-type: again\n`;
    await writeFiles(cwd, { [CI]: handler('${{ github.repository }}') });

    expect(await workflowRepositoryDispatch({ cwd, options: {} })).toEqual([]);

    await writeFiles(cwd, { [CI]: handler('example-org/other') });

    expect(where(await workflowRepositoryDispatch({ cwd, options: {} }))).toEqual([`workflow-repository-dispatch/dispatch-other-repository-with-default-token ${CI}:6`]);
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

  it('reads the destination of a push through HEAD, a forcing +, and options that take a value', async () => {
    const cwd = await makeTempDir();
    const job = (name: string, command: string): string => `
  ${name}:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          token: \${{ secrets.APP_TOKEN }}
      - run: ${command}`;
    await writeFiles(cwd, {
      [CI]: `on: repository_dispatch\njobs:${[
        job('head', 'git push origin HEAD'),
        job('forced', 'git push origin +main'),
        job('forced-head', 'git push --force origin +HEAD:main'),
        job('option-value', 'git push -o ci.skip origin main'),
        job('other-branch', 'git push -o ci.skip origin update'),
        job('head-to-branch', 'git push origin HEAD:update'),
        job('option-value-after-refspec', 'git push origin update -o main'),
      ].join('')}\n`,
    });

    expect(where(await workflowRepositoryDispatch({ cwd, options: {} }))).toEqual([
      `workflow-repository-dispatch/pushes-default-branch ${CI}:9`,
      `workflow-repository-dispatch/pushes-default-branch ${CI}:16`,
      `workflow-repository-dispatch/pushes-default-branch ${CI}:23`,
      `workflow-repository-dispatch/pushes-default-branch ${CI}:30`,
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

  it('reports a Renovate minimumReleaseAge that waits for nothing, like a Dependabot cooldown of zero days', async () => {
    const cwd = await makeTempDir();

    for (const config of ['{ "minimumReleaseAge": "0 days" }', '{ "minimumReleaseAge": null }', '{ "packageRules": [{ "minimumReleaseAge": "0 days" }] }']) {
      await writeFiles(cwd, { 'renovate.json': config });

      expect(where(await workflowUpdateBotCooldown({ cwd, options: {} }))).toEqual(['workflow-update-bot-cooldown/renovate-no-minimum-release-age renovate.json']);
    }

    await writeFiles(cwd, { 'renovate.json': '{ "minimumReleaseAge": "3 days" }' });

    expect(await workflowUpdateBotCooldown({ cwd, options: {} })).toEqual([]);
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

  describe('given the repository settings', () => {
    const repository = 'example-org/example-repo';
    const clientWith = (mergeQueue: boolean): { readonly github: GitHubClient; readonly branches: () => readonly string[] } => {
      const rules: BranchRules = { requiredStatusChecks: [], pullRequests: [], requiredLinearHistory: false, mergeQueue };
      const branchRules = vi.fn<GitHubClient['branchRules']>().mockResolvedValue(rules);
      const github: GitHubClient = { repository: vi.fn<GitHubClient['repository']>().mockResolvedValue({ defaultBranch: 'trunk', allowRebaseMerge: true, allowSquashMerge: false, allowMergeCommit: false }), branchRules };

      return { github, branches: () => branchRules.mock.calls.map(([, branch]) => branch) };
    };

    it('does not require the trigger when no merge queue rule applies to the branch', async () => {
      const { github, branches } = clientWith(false);

      expect(await workflowMergeGroup({ cwd: fixture('merge-group', 'violating'), options: { repository }, github })).toEqual([]);
      expect(branches()).toEqual(['trunk']);
    });

    it('requires the trigger when a merge queue rule applies to the branch the options name', async () => {
      const { github, branches } = clientWith(true);

      expect(where(await workflowMergeGroup({ cwd: fixture('merge-group', 'violating'), options: { repository, branch: 'release' }, github }))).toEqual([`workflow-merge-group/missing-trigger ${CI}:3`]);
      expect(branches()).toEqual(['release']);
    });

    it('does not read the settings when every workflow already has the trigger', async () => {
      const { github, branches } = clientWith(false);

      expect(await workflowMergeGroup({ cwd: fixture('merge-group', 'clean'), options: { repository }, github })).toEqual([]);
      expect(branches()).toEqual([]);
    });

    const rejectingWith = (error: Error): GitHubClient => ({
      repository: vi.fn<GitHubClient['repository']>().mockResolvedValue({ defaultBranch: 'trunk', allowRebaseMerge: true, allowSquashMerge: false, allowMergeCommit: false }),
      branchRules: vi.fn<GitHubClient['branchRules']>().mockRejectedValue(error),
    });

    it('does not require the trigger when the plan of the repository has no rulesets, so no merge queue', async () => {
      const github = rejectingWith(new RulesetsUnavailableError('Upgrade to GitHub Pro or make this repository public to enable this feature.'));

      expect(await workflowMergeGroup({ cwd: fixture('merge-group', 'violating'), options: { repository }, github })).toEqual([]);
    });

    it('fails the run on any other refusal of the rules of the branch', async () => {
      const refusal = new ConformanceError('GET /repos/example-org/example-repo/rules/branches/trunk failed: 403 Forbidden: Resource not accessible by personal access token');

      await expect(workflowMergeGroup({ cwd: fixture('merge-group', 'violating'), options: { repository }, github: rejectingWith(refusal) })).rejects.toBe(refusal);
    });
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
