import type { CheckFunction, FileViolation } from '../check';
import type { PinningLevel, WorkflowActionPinningOptions } from '../options';
import { loadWorkflows } from '../workflows/load';
import { parseUses, type UsesReference } from '../workflows/model';
import { workflowViolation } from '../workflows/shared';

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/u;
const DOCKER_DIGEST = /^sha256:[0-9a-f]{64}$/u;

/**
 * Whether `repository` (`owner/repository`) matches an `allow` entry, which is `owner/repository` or `owner/*`.
 */
function allowed(owner: string, repository: string, allow: readonly string[]): boolean {
  return allow.some((entry) => entry.toLowerCase() === `${owner}/${repository}`.toLowerCase() || entry.toLowerCase() === `${owner}/*`.toLowerCase());
}

/**
 * Why a reference breaks the policy, with the code of the violation, or `undefined` when it follows it.
 */
function problem(reference: UsesReference, options: WorkflowActionPinningOptions): { readonly code: string; readonly reason: string } | undefined {
  if (reference.kind === 'local') {
    return undefined;
  }
  if (reference.kind === 'docker') {
    return reference.digest !== undefined && DOCKER_DIGEST.test(reference.digest)
      ? undefined
      : { code: 'docker-not-pinned', reason: 'a Docker image must be pinned by digest (@sha256:...), because a tag can be moved' };
  }
  const { owner, repository, ref } = reference;
  if (allowed(owner, repository, options.allow ?? [])) {
    return undefined;
  }
  if (ref === undefined || ref === '') {
    return { code: 'missing-ref', reason: 'it names no ref' };
  }
  const level: PinningLevel = (options.organisations ?? []).some((organisation) => organisation.toLowerCase() === owner.toLowerCase()) ? (options.sameOrganisation ?? 'ref') : (options.thirdParty ?? 'sha');

  return level === 'sha' && !FULL_COMMIT_SHA.test(ref) ? { code: 'not-pinned', reason: `ref '${ref}' is not a full commit SHA, and a tag or branch can be moved to different code` } : undefined;
}

/**
 * Every `uses` of a step or job follows the pinning policy. By default an action or reusable workflow from outside the organisations in the options must be pinned by full commit SHA (a Docker image by digest), and one owned by an organisation listed in `organisations` may use any ref; `thirdParty` and `sameOrganisation` set either to `sha` or `ref`, and `allow` exempts repositories. Local actions and workflows (`./...`) are not judged.
 *
 * The check encodes whichever policy the options state and is never silent about it: with nothing configured every remote reference must be a SHA. Limits: it checks the form of the ref, not that the SHA belongs to the repository or to a release; a SHA written with a trailing version comment is read as the SHA; composite actions are not read.
 */
export const workflowActionPinning: CheckFunction<WorkflowActionPinningOptions> = async ({ cwd, options }) => {
  const violations: FileViolation[] = [];
  for (const workflow of await loadWorkflows(cwd, options)) {
    const uses = [
      ...workflow.jobs.flatMap((job) => (job.uses === undefined ? [] : [{ value: job.uses, location: job.location }])),
      ...workflow.jobs.flatMap((job) => job.steps.flatMap((step) => (step.uses === undefined ? [] : [{ value: step.uses, location: step.location }]))),
    ].sort((left, right) => left.location.line - right.location.line || left.location.column - right.location.column);
    for (const { value, location } of uses) {
      const found = problem(parseUses(value), options);
      if (found !== undefined) {
        violations.push(workflowViolation(workflow, `workflow-action-pinning/${found.code}`, `${value}: ${found.reason}`, location));
      }
    }
  }

  return violations;
};
