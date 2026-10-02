import type { CheckFunction, Violation } from '../check';
import type { WorkflowJobOrderingOptions } from '../options';
import { loadWorkflows } from '../workflows/load';
import { type Job, transitiveNeeds, type Workflow } from '../workflows/model';
import { callsAlways, DEFAULT_JUNCTION_JOBS, jobsNamed, stepUses, workflowViolation } from '../workflows/shared';

const DEFAULT_RELEASE_JOBS: readonly string[] = ['release'];
const DEFAULT_DEPLOY_JOBS: readonly string[] = ['deploy'];
const DEFAULT_DOCS_DEPLOY_JOBS: readonly string[] = ['docs-deploy'];
const DEFAULT_BRANCH = 'main';

/**
 * The expression that always names the repository's default branch.
 */
const DEFAULT_BRANCH_EXPRESSION = /^\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}$/u;

/**
 * The text a junction job decides on: its `if`, and the conditions and scripts of its steps.
 */
function decisionText(job: Job): string {
  return [job.condition, ...job.steps.flatMap((step) => [step.condition, step.run, ...Object.values(step.env), ...Object.values(step.with)])].filter((text) => text !== undefined).join('\n');
}

/**
 * Where a script gets the results of the jobs it needs from: `needs.*.result`, one job's `needs.<job>.result` or the whole of `needs`.
 */
const RESULT_SOURCE = /needs\.(?:\*|[\w-]+)\.result|toJSON\(\s*needs\s*\)/u;
const FAILURE_WORD = /['"]failure['"]/u;
const CANCELLED_WORD = /['"]cancelled['"]/u;
const SKIPPED_OR_NOT_SUCCESS = /needs\.(?:\*|[\w-]+)\.result[^\n]*(?:['"]skipped['"]|!==?\s*['"]success['"])|!\s*contains\(\s*needs\.\*\.result\s*,\s*['"]success['"]/u;

/**
 * An `if` that compares the ref or the event name.
 */
const COMPARES_REF_OR_EVENT = /github\.(?:ref|ref_name|event_name)\s*==/u;

/**
 * Whether an `if` keeps a job out of the runs the required check decides on, which are those for a pull request and for a merge group. The `if` must compare the ref or the event name, name neither `pull_request` nor `merge_group`, and have no `||`, since a disjunction can hold for a pull request through another operand.
 */
function keepsOutOfPullRequests(condition: string | undefined): boolean {
  return condition !== undefined && COMPARES_REF_OR_EVENT.test(condition) && !condition.includes('pull_request') && !condition.includes('merge_group') && !condition.includes('||');
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
    const text = decisionText(junction);
    const reportsOutcome = junction.steps.some((step) => stepUses(step, OUTCOME_ACTION));
    if (SKIPPED_OR_NOT_SUCCESS.test(text)) {
      violations.push(workflowViolation(workflow, 'workflow-job-ordering/junction-fails-on-skipped', `junction job '${junction.id}' fails when a needed job is skipped, but a skipped job is how a path filter or an if keeps a job out; fail only on 'failure' and 'cancelled'`, junction.location));
    }
    if (!reportsOutcome && !(RESULT_SOURCE.test(text) && FAILURE_WORD.test(text) && CANCELLED_WORD.test(text))) {
      violations.push(workflowViolation(workflow, 'workflow-job-ordering/junction-no-failure-condition', `junction job '${junction.id}' does not test the results of its needs for both 'failure' and 'cancelled', so it can pass when a job it needs did not succeed`, junction.location));
    }
  }

  return violations;
}

/**
 * The jobs that release, deploy and report a required check are ordered so that a failure stops what follows: a release job needs the deploy job, a documentation deploy job needs the release job and checks out the default branch afresh, and one junction job with `if: always()` needs every other job and fails only on `failure` or `cancelled`.
 *
 * Jobs are recognised by id (see the options), and a role with no job in a workflow is not judged there. Ordering is judged through the transitive `needs` graph; the junction job must list every job directly, because `needs.*.result` only covers direct needs, except jobs that never run for a pull request or a merge group (an `if` on `github.ref` or `github.event_name` that mentions neither `pull_request` nor `merge_group` and has no `||`), jobs that need such a job or the junction job itself, and the ids in `junctionExempt`. What the junction job decides on is read as text: it must read the results of its needs (`needs.*.result`, `needs.<job>.result` or `toJSON(needs)`) and name both `'failure'` and `'cancelled'`, or use the `re-actors/alls-green` action; a result read in a way the text does not show is reported as incomplete.
 */
export const workflowJobOrdering: CheckFunction<WorkflowJobOrderingOptions> = async ({ cwd, options }) =>
  (await loadWorkflows(cwd, options)).flatMap((workflow) => [...releaseAndDocsOrdering(workflow, options), ...junctionOrdering(workflow, options)]);
