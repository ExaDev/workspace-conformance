import type { CheckFunction, FileViolation } from '../check';
import type { WorkflowReleaseJobOptions } from '../options';
import { loadWorkflows } from '../workflows/load';
import { accessOf, effectiveEnv, effectivePermissions, type Job, type Step, type Workflow } from '../workflows/model';
import { DEFAULT_RELEASE_JOBS, jobsNamed, REGISTRY_TOKEN_VARIABLES, stepUses, workflowViolation } from '../workflows/shared';

const CHECKOUT_ACTION = 'actions/checkout';

/**
 * A value that reads the `secrets` context inside an expression.
 */
const FROM_SECRET = /\$\{\{[^}]*\bsecrets\./u;

/**
 * The release jobs named for a message: `release job 'a'` or `release jobs 'a' and 'b'`.
 */
function releaseJobsText(releases: readonly Job[]): string {
  const ids = releases.map((job) => `'${job.id}'`);

  return `release job${ids.length === 1 ? '' : 's'} ${ids.join(' and ')}`;
}

function grantsIdToken(permissions: Job['permissions']): boolean {
  return accessOf(permissions, 'id-token') === 'write';
}

function idTokenViolations(workflow: Workflow, releases: readonly Job[]): readonly FileViolation[] {
  const releaseIds = new Set(releases.map((job) => job.id));
  const named = releaseJobsText(releases);
  const workflowLevel =
    grantsIdToken(workflow.permissions) && workflow.permissionsLocation !== undefined
      ? [workflowViolation(workflow, 'workflow-release-job/id-token-workflow-level', `the workflow's permissions grant id-token: write to every job that declares none of its own; grant it on ${named} only`, workflow.permissionsLocation)]
      : [];
  const jobLevel = workflow.jobs
    .filter((job) => !releaseIds.has(job.id) && grantsIdToken(job.permissions))
    .map((job) =>
      workflowViolation(
        workflow,
        'workflow-release-job/id-token-outside-release',
        `job '${job.id}' is granted id-token: write but is not a release job, so it can mint the OIDC identity npm trusted publishing accepts for this workflow; only ${named} may hold it`,
        job.location,
      ),
    );

  return [...workflowLevel, ...jobLevel];
}

/**
 * What a checkout that does not set `persist-credentials: false` leaves in git config.
 */
function persistedCredential(step: Step): string {
  if (step.with['ssh-key'] !== undefined) {
    return 'the SSH key';
  }

  return step.with['token'] === undefined ? 'the job token' : 'the token it was given';
}

function releaseJobViolations(workflow: Workflow, job: Job): readonly FileViolation[] {
  if (job.uses !== undefined) {
    return [];
  }
  const environment =
    job.environment === undefined
      ? [
          workflowViolation(
            workflow,
            'workflow-release-job/missing-environment',
            `release job '${job.id}' declares no environment, so nothing outside the workflow file stops a branch's copy of it publishing; run it in a protected environment restricted to the default branch`,
            job.location,
          ),
        ]
      : [];
  const checkouts = job.steps
    .filter((step) => stepUses(step, CHECKOUT_ACTION) && step.with['persist-credentials'] !== 'false')
    .map((step) =>
      workflowViolation(
        workflow,
        'workflow-release-job/persisted-credentials',
        `release job '${job.id}' checks out without persist-credentials: false, which leaves ${persistedCredential(step)} in git config for every later step`,
        step.location,
      ),
    );

  return [...environment, ...checkouts];
}

/**
 * The token variables an environment sets from a secret.
 */
function secretTokens(env: Readonly<Record<string, string>>): readonly string[] {
  return REGISTRY_TOKEN_VARIABLES.filter((variable) => FROM_SECRET.test(env[variable] ?? ''));
}

function tokenBesideOidcViolations(workflow: Workflow, job: Job): readonly FileViolation[] {
  if (!grantsIdToken(effectivePermissions(workflow, job))) {
    return [];
  }
  const report = (variables: readonly string[], location: Job['location']): readonly FileViolation[] =>
    variables.length === 0
      ? []
      : [
          workflowViolation(
            workflow,
            'workflow-release-job/token-beside-oidc',
            `job '${job.id}' holds id-token: write and passes ${variables.join(' and ')} from a secret, a long-lived npm token beside the OIDC identity; publish through trusted publishing and blank the token variables`,
            location,
          ),
        ];

  return [...report(secretTokens(effectiveEnv(workflow, job, undefined)), job.location), ...job.steps.flatMap((step) => report(secretTokens(step.env), step.location))];
}

/**
 * npm binds a trusted publisher to the repository and the workflow file, not to a branch, so anyone who can push a branch can edit that branch's copy of the workflow, drop an `if` that keeps publishing to the default branch, and publish. What stops that has to live outside the file: a protected environment that only the default branch may deploy to, named in npm's trusted publisher too. This check holds the release job to the shape that makes that protection hold.
 *
 * In a workflow with a release job (by id, `releaseJobs`, `release` by default): `workflow-release-job/id-token-workflow-level`, the workflow's own `permissions` grant `id-token: write` (directly or through `write-all`), which every job that declares none inherits; `id-token-outside-release`, a job that is not a release job declares `id-token: write` itself, a job that calls a reusable workflow included; `missing-environment`, a release job declares no `environment`; `persisted-credentials`, a release job runs `actions/checkout` without `persist-credentials: false` (literally; an expression is unknown and reported), so the job token, a `token` input or an `ssh-key` stays in git config for every later step. A release job that pushes as a deploy key provisions the key in a step and hands it to git through that step's `GIT_SSH_COMMAND`, after a checkout that persists nothing, and is accepted as written; semantic-release authenticates its own push (`repositoryUrl` as written, else the URL with `GITHUB_TOKEN` or `GH_TOKEN` from the environment), so it needs nothing from the checkout.
 *
 * In every workflow: `token-beside-oidc`, a job whose effective permissions grant `id-token: write` sets `NODE_AUTH_TOKEN` or `NPM_TOKEN` from the `secrets` context in its workflow, job or step `env`.
 *
 * Limits: the environment's protection rules and npm's trusted publisher settings are not visible in the file and are not read; a release job that calls a reusable workflow is judged only for `id-token`, since `environment` and steps belong to the called workflow; a token passed through `with`, written to an `.npmrc` by a script, or inherited through a composite action is not seen.
 */
export const workflowReleaseJob: CheckFunction<WorkflowReleaseJobOptions> = async ({ cwd, options }) => {
  return (await loadWorkflows(cwd, options)).flatMap((workflow) => {
    const releases = jobsNamed(workflow, options.releaseJobs ?? DEFAULT_RELEASE_JOBS);
    const releaseFindings = releases.length === 0 ? [] : idTokenViolations(workflow, releases);
    const jobFindings = workflow.jobs.flatMap((job) => [...(releases.includes(job) ? releaseJobViolations(workflow, job) : []), ...tokenBesideOidcViolations(workflow, job)]);

    return [...releaseFindings, ...jobFindings];
  });
};
