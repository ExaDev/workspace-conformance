import type { CheckFunction, Violation } from '../check';
import type { WorkflowJobOrderingOptions } from '../options';
import { loadWorkflows } from '../workflows/load';
import { effectiveEnv, type Job, transitiveNeeds, type Workflow } from '../workflows/model';
import { operands, unwrapped } from '../workflows/expressions';
import { callsAlways, DEFAULT_JUNCTION_JOBS, DEFAULT_RELEASE_JOBS, jobsNamed, stepUses, workflowViolation } from '../workflows/shared';

const DEFAULT_DEPLOY_JOBS: readonly string[] = ['deploy'];
const DEFAULT_DOCS_DEPLOY_JOBS: readonly string[] = ['docs-deploy'];
const DEFAULT_BRANCH = 'main';

/**
 * The expression that always names the repository's default branch.
 */
const DEFAULT_BRANCH_EXPRESSION = /^\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}$/u;

/**
 * The whole of an environment value that is one expression, `${{ <expression> }}`.
 */
const WHOLE_EXPRESSION = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/u;

/**
 * A reference to an environment variable in a script, `$NAME` or `${NAME}`, and in an expression, `env.NAME`.
 */
const SCRIPT_VARIABLE = /\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/gu;
const EXPRESSION_VARIABLE = /\benv\.([A-Za-z_]\w*)/gu;

/**
 * A script or condition with each environment variable whose value is a whole expression replaced by that expression, so `"$RESULT" != "success"` with `RESULT: ${{ needs.test.result }}` reads as the test of `needs.test.result` it is.
 */
function withVariablesResolved(text: string, env: Readonly<Record<string, string>>, reference: Readonly<RegExp>): string {
  return text.replaceAll(reference, (match: string, ...names: readonly unknown[]) => {
    const name = names.find((candidate): candidate is string => typeof candidate === 'string');
    const value = name === undefined ? undefined : env[name];

    return (value === undefined ? undefined : WHOLE_EXPRESSION.exec(value.trim())?.[1]) ?? match;
  });
}

/**
 * The text a junction job decides on: its `if`, and the conditions, scripts and inputs of its steps, with the environment variables they read replaced by the expressions that set them, and the values of their environments.
 */
function decisionText(workflow: Workflow, job: Job): string {
  return [
    job.condition === undefined ? undefined : withVariablesResolved(job.condition, effectiveEnv(workflow, job, undefined), EXPRESSION_VARIABLE),
    ...job.steps.flatMap((step) => {
      const env = effectiveEnv(workflow, job, step);

      return [
        step.condition === undefined ? undefined : withVariablesResolved(step.condition, env, EXPRESSION_VARIABLE),
        step.run === undefined ? undefined : withVariablesResolved(step.run, env, SCRIPT_VARIABLE),
        ...Object.values(env),
        ...Object.values(step.with),
      ];
    }),
  ]
    .filter((text) => text !== undefined)
    .join('\n');
}

/**
 * Where a script gets the results of the jobs it needs from: `needs.*.result`, one job's `needs.<job>.result` or the whole of `needs`.
 */
const RESULT_SOURCE = /needs\.(?:\*|[\w-]+)\.result|toJSON\(\s*needs\s*\)/u;
const FAILURE_WORD = /['"]failure['"]/u;
const CANCELLED_WORD = /['"]cancelled['"]/u;

/**
 * A test that a result is not `success`, which fails on `failure` and `cancelled`, and on `skipped` too. The group is the job, or `*`.
 */
const NOT_SUCCESS = /needs\.(\*|[\w-]+)\.result[^\n]*?!==?\s*['"]success['"]/gu;

/**
 * A test that names `skipped`, or that fails unless some result is `success`.
 */
const SKIPPED_TEST = /needs\.(?:\*|[\w-]+)\.result[^\n]*['"]skipped['"]|!\s*contains\(\s*needs\.\*\.result\s*,\s*['"]success['"]/u;

/**
 * A read of a job's output, which is what an `if` that skips a job on the result of an earlier one reads.
 */
const OUTPUT_READ = /needs\.[\w-]+\.outputs\.[\w-]+/gu;

/**
 * Whether an `if` can skip the job, its own or that of a job it needs, without the junction job seeing why: a job runs unless an `if` other than `always()` stops it, and a skip that comes only from a need that failed is a failure the junction rightly fails on. A skip is seen when the junction reads every job output those conditions read, as a junction that tests `has-packages` before the result of a job skipped on it does.
 */
function skippableUnseen(workflow: Workflow, jobId: string, text: string): boolean {
  const conditions = workflow.jobs
    .filter((job) => job.id === jobId || transitiveNeeds(workflow, jobId).has(job.id))
    .flatMap((job) => (job.condition === undefined || callsAlways(job.condition) ? [] : [job.condition]));

  return conditions.some((condition) => {
    const reads = [...condition.matchAll(OUTPUT_READ)].map((read) => read[0]);

    return reads.length === 0 || !reads.every((read) => text.includes(read));
  });
}

/**
 * Whether the junction fails when a job it needs is skipped: it names `skipped`, or tests a result for not being `success` where an `if` can skip that job (any of its needs, for `needs.*.result`) unseen.
 */
function failsOnSkipped(workflow: Workflow, junction: Job, text: string): boolean {
  const tested = [...text.matchAll(NOT_SUCCESS)].flatMap((match) => (match[1] === '*' ? junction.needs : (match[1] ?? [])));

  return SKIPPED_TEST.test(text) || tested.some((id) => skippableUnseen(workflow, id, text));
}

/**
 * An `if` that compares the ref or the event name.
 */
const COMPARES_REF_OR_EVENT = /github\.(?:ref|ref_name|event_name)\s*==/u;

/**
 * Whether an expression can only hold in runs other than those of a pull request and of a merge group, which are the runs the required check decides on: an operand of an `&&` that does so is enough, every operand of an `||` must, and a comparison of the ref or the event name does so when it names neither `pull_request` nor `merge_group`.
 */
function keepsOutOfPullRequests(expression: string | undefined): boolean {
  if (expression === undefined) {
    return false;
  }
  const text = unwrapped(expression);
  const alternatives = operands(text, '||');
  if (alternatives.length > 1) {
    return alternatives.every(keepsOutOfPullRequests);
  }
  const conjuncts = operands(text, '&&');
  if (conjuncts.length > 1) {
    return conjuncts.some(keepsOutOfPullRequests);
  }

  return COMPARES_REF_OR_EVENT.test(text) && !text.includes('pull_request') && !text.includes('merge_group');
}

const OUTCOME_ACTION = 're-actors/alls-green';

function releaseAndDocsOrdering(workflow: Workflow, options: WorkflowJobOrderingOptions): readonly Violation[] {
  const releases = jobsNamed(workflow, options.releaseJobs ?? DEFAULT_RELEASE_JOBS);
  const deploys = jobsNamed(workflow, options.deployJobs ?? DEFAULT_DEPLOY_JOBS);
  const docs = jobsNamed(workflow, options.docsDeployJobs ?? DEFAULT_DOCS_DEPLOY_JOBS);
  const violations: Violation[] = [];
  for (const release of releases) {
    const waitsFor = transitiveNeeds(workflow, release.id);
    for (const deploy of deploys.filter((candidate) => candidate.id !== release.id && !waitsFor.has(candidate.id))) {
      violations.push(workflowViolation(workflow, 'workflow-job-ordering/release-before-deploy', `release job '${release.id}' does not need deploy job '${deploy.id}', so a release can be published after a failed deploy`, release.location));
    }
  }
  for (const doc of docs) {
    const waitsFor = transitiveNeeds(workflow, doc.id);
    for (const release of releases.filter((candidate) => candidate.id !== doc.id && !waitsFor.has(candidate.id))) {
      violations.push(workflowViolation(workflow, 'workflow-job-ordering/docs-deploy-before-release', `documentation job '${doc.id}' does not need release job '${release.id}', so it can publish documentation for a release that did not happen`, doc.location));
    }
    const branch = options.defaultBranch ?? DEFAULT_BRANCH;
    for (const checkout of doc.steps.filter((step) => stepUses(step, 'actions/checkout'))) {
      const ref = checkout.with['ref']?.trim();
      const names = ref !== undefined && (DEFAULT_BRANCH_EXPRESSION.test(ref) || ref === branch || ref === `refs/heads/${branch}`);
      if (!names) {
        violations.push(
          workflowViolation(
            workflow,
            'workflow-job-ordering/docs-deploy-stale-checkout',
            `documentation job '${doc.id}' checks out ${ref === undefined ? 'the triggering commit' : `'${ref}'`}, which predates the release commit; check out the default branch afresh with ref: \${{ github.event.repository.default_branch }}`,
            checkout.location,
          ),
        );
      }
    }
  }

  return violations;
}

/**
 * The jobs a pull request's required check need not wait for: those the options exempt, those whose `if` keeps them to events other than pull requests and merge groups, and those that need such a job and so are skipped with it.
 */
function exemptFromJunction(workflow: Workflow, junctionExempt: readonly string[]): ReadonlySet<string> {
  const direct = new Set([
    ...junctionExempt,
    ...workflow.jobs.filter((job) => keepsOutOfPullRequests(job.condition)).map((job) => job.id),
  ]);

  return new Set(workflow.jobs.filter((job) => direct.has(job.id) || [...transitiveNeeds(workflow, job.id)].some((needed) => direct.has(needed))).map((job) => job.id));
}

function junctionOrdering(workflow: Workflow, options: WorkflowJobOrderingOptions): readonly Violation[] {
  const violations: Violation[] = [];
  const exempt = exemptFromJunction(workflow, options.junctionExempt ?? []);
  for (const junction of jobsNamed(workflow, options.junctionJobs ?? DEFAULT_JUNCTION_JOBS)) {
    if (!callsAlways(junction.condition)) {
      violations.push(workflowViolation(workflow, 'workflow-job-ordering/junction-not-always', `junction job '${junction.id}' has no if: always(), so it is skipped, and its required check never reports, when a job it needs fails`, junction.location));
    }
    const missing = workflow.jobs.filter((job) => job.id !== junction.id && !exempt.has(job.id) && !junction.needs.includes(job.id) && !transitiveNeeds(workflow, job.id).has(junction.id));
    for (const job of missing) {
      violations.push(workflowViolation(workflow, 'workflow-job-ordering/junction-missing-need', `junction job '${junction.id}' does not list job '${job.id}' in needs, so its result is not part of the required check`, junction.location));
    }
    const text = decisionText(workflow, junction);
    const reportsOutcome = junction.steps.some((step) => stepUses(step, OUTCOME_ACTION));
    if (failsOnSkipped(workflow, junction, text)) {
      violations.push(workflowViolation(workflow, 'workflow-job-ordering/junction-fails-on-skipped', `junction job '${junction.id}' fails when a needed job is skipped, but a skipped job is how a path filter or an if keeps a job out; fail only on 'failure' and 'cancelled'`, junction.location));
    }
    if (!reportsOutcome && !(RESULT_SOURCE.test(text) && ((FAILURE_WORD.test(text) && CANCELLED_WORD.test(text)) || [...text.matchAll(NOT_SUCCESS)].length > 0))) {
      violations.push(workflowViolation(workflow, 'workflow-job-ordering/junction-no-failure-condition', `junction job '${junction.id}' does not test the results of its needs for both 'failure' and 'cancelled', so it can pass when a job it needs did not succeed`, junction.location));
    }
  }

  return violations;
}

/**
 * The jobs that release, deploy and report a required check are ordered so that a failure stops what follows: a release job needs the deploy job, a documentation deploy job needs the release job and checks out the default branch afresh, and one junction job with `if: always()` needs every other job and fails only on `failure` or `cancelled`.
 *
 * Jobs are recognised by id (see the options), and a role with no job in a workflow is not judged there. Ordering is judged through the transitive `needs` graph; the junction job must list every job directly, because `needs.*.result` only covers direct needs, except jobs that never run for a pull request or a merge group (an `if` on `github.ref` or `github.event_name` that mentions neither `pull_request` nor `merge_group`, where an `&&` needs one such operand and an `||` needs every operand to be), jobs that need such a job or the junction job itself, and the ids in `junctionExempt`. What the junction job decides on is read as text, with the environment variables its scripts and conditions read replaced by the expressions that set them: it must read the results of its needs (`needs.*.result`, `needs.<job>.result` or `toJSON(needs)`) and name both `'failure'` and `'cancelled'` or test a result for `!= 'success'`, or use the `re-actors/alls-green` action; a result read in a way the text does not show is reported as incomplete. A `!= 'success'` test fails on a skip too, which is reported only for a job an `if` can skip without the junction reading what that `if` reads.
 */
export const workflowJobOrdering: CheckFunction<WorkflowJobOrderingOptions> = async ({ cwd, options }) =>
  (await loadWorkflows(cwd, options)).flatMap((workflow) => [...releaseAndDocsOrdering(workflow, options), ...junctionOrdering(workflow, options)]);
