import type { CheckFunction, Violation } from '../check';
import { isRecord } from '../config-files';
import type { WorkflowSkippableJobsOptions } from '../options';
import { loadWorkflows } from '../workflows/load';
import type { Job, Workflow } from '../workflows/model';
import { DEFAULT_JUNCTION_JOBS, jobsNamed, stepUses, workflowViolation } from '../workflows/shared';

const DEFAULT_PATH_FILTER_ACTIONS: readonly string[] = ['dorny/paths-filter', 'tj-actions/changed-files', 'step-security/changed-files'];

/**
 * The events whose `paths` and `paths-ignore` decide whether the whole workflow runs for a pull request.
 */
const PULL_REQUEST_EVENTS: readonly string[] = ['pull_request', 'pull_request_target'];

/**
 * The jobs a job `if` reads outputs from: `needs.<job>.outputs.<name>`.
 */
const NEEDS_OUTPUT = /\bneeds\.([\w-]+)\.outputs\./gu;

function hasPathFilter(workflow: Workflow, event: string): boolean {
  const configuration = workflow.triggers.get(event);

  return isRecord(configuration) && ('paths' in configuration || 'paths-ignore' in configuration);
}

/**
 * The jobs a job's `if` reads path filter outputs from.
 */
function filterJobsRead(workflow: Workflow, job: Job, actions: readonly string[]): readonly string[] {
  const read = [...(job.condition ?? '').matchAll(NEEDS_OUTPUT)].map((match) => match[1]);

  return workflow.jobs.filter((candidate) => read.includes(candidate.id) && candidate.steps.some((step) => actions.some((action) => stepUses(step, action)))).map((candidate) => candidate.id);
}

/**
 * Keeping work off a pull request must not leave a required check without a result. A `paths` or `paths-ignore` filter on the trigger of a workflow with a junction job skips the whole workflow, so the required check stays pending forever; a job whose own `if` reads a path filter's outputs is skipped, which is only safe when a junction job with `if: always()` needs it and reports for it. Filter the steps of the job instead and the job still runs and reports.
 *
 * Limits: a workflow is taken to produce a required check when it has a junction job, so a trigger path filter in a workflow without one is not reported; a path filter is recognised by the actions in the options, so a script that computes changed paths itself is not seen, and a job gated on the output of such a script is not reported; only `needs.<job>.outputs` in the job's own `if` is read. Whether the junction job really reports is judged by `workflow-job-ordering`.
 */
export const workflowSkippableJobs: CheckFunction<WorkflowSkippableJobsOptions> = async ({ cwd, options }) => {
  const violations: Violation[] = [];
  for (const workflow of await loadWorkflows(cwd, options)) {
    const junctions = jobsNamed(workflow, options.junctionJobs ?? DEFAULT_JUNCTION_JOBS);
    if (junctions.length > 0) {
      for (const [event, location] of workflow.triggerLocations) {
        if (PULL_REQUEST_EVENTS.includes(event) && hasPathFilter(workflow, event)) {
          violations.push(
            workflowViolation(
              workflow,
              'workflow-skippable-jobs/trigger-path-filter',
              `${event} has a paths filter, so the workflow does not run, and its required check stays pending, when no matching file changed; filter the steps of the jobs instead`,
              location,
            ),
          );
        }
      }
    }
    for (const job of workflow.jobs) {
      const filters = filterJobsRead(workflow, job, options.pathFilterActions ?? DEFAULT_PATH_FILTER_ACTIONS);
      const reported = junctions.some((junction) => junction.needs.includes(job.id));
      if (filters.length > 0 && !reported) {
        violations.push(
          workflowViolation(
            workflow,
            'workflow-skippable-jobs/job-gated-by-path-filter',
            `job '${job.id}' is skipped by an if on the path filter in '${filters.join("', '")}' and no junction job reports for it; put the condition on its steps, or add the job to the needs of a junction job with if: always()`,
            job.location,
          ),
        );
      }
    }
  }

  return violations;
};
