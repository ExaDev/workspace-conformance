import type { CheckFunction } from '../check';
import type { WorkflowMergeGroupOptions } from '../options';
import { loadWorkflows } from '../workflows/load';
import { workflowViolation } from '../workflows/shared';

/**
 * A workflow that checks pull requests also runs for the merge queue: GitHub starts no run of it for a queued pull request unless the workflow has a `merge_group` trigger, and a required check that never reports blocks the queue.
 *
 * A workflow is taken to produce required checks when it is triggered by `pull_request`; `pull_request_target` is left out, since it runs trusted code against untrusted input and is not a place for required checks. The file cannot show which checks are required, so a `pull_request` workflow whose checks are not required is reported too: narrow the check with `workflows` and `exclude`. A `merge_group` trigger on a workflow with no `pull_request` trigger is not judged.
 */
export const workflowMergeGroup: CheckFunction<WorkflowMergeGroupOptions> = async ({ cwd, options }) =>
  (await loadWorkflows(cwd, options))
    .filter((workflow) => workflow.triggers.has('pull_request') && !workflow.triggers.has('merge_group'))
    .map((workflow) =>
      workflowViolation(
        workflow,
        'workflow-merge-group/missing-trigger',
        'the workflow runs for pull requests but has no merge_group trigger, so its checks do not report for a pull request in the merge queue',
        workflow.triggerLocations.get('pull_request') ?? { line: 1, column: 1 },
      ),
    );
