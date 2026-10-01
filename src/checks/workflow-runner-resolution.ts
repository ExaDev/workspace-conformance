import type { CheckFunction, Violation } from '../check';
import { ConformanceError } from '../errors';
import type { WorkflowRunnerResolutionOptions } from '../options';
import { DEFAULT_WORKFLOWS, loadWorkflows } from '../workflows/load';
import { type Job, parseUses, type Workflow } from '../workflows/model';
import { workflowViolation } from '../workflows/shared';

/**
 * GitHub's own images: `ubuntu`, `windows` and `macos`, as `-latest`, a version, or a version with an architecture or size suffix, and `ubuntu-slim`.
 */
const DEFAULT_HOSTED_LABELS: readonly string[] = ['^(?:ubuntu|windows|macos)-(?:latest|slim|[0-9][0-9.]*)(?:-(?:arm|intel|xlarge|large))*$'];

/**
 * `fromJson(needs.<job>.outputs.<name>)` in a `runs-on`.
 */
const RESOLVED_RUNNER = /fromJSON\(\s*needs\.([\w-]+)\.outputs\.([\w-]+)\s*\)/giu;

/**
 * `${{ jobs.<job>.outputs.<name> }}` as the value of a reusable workflow's output.
 */
const JOB_OUTPUT_REFERENCE = /^\$\{\{\s*jobs\.([\w-]+)\.outputs\.([\w-]+)\s*\}\}$/u;

/**
 * A fallback in an output expression: `||` followed by a string literal, whose body may hold `''` for a quote.
 */
const LITERAL_FALLBACK = /\|\|\s*'((?:[^']|'')*)'/gu;

interface Resolver {
  readonly workflow: Workflow;
  readonly job: Job;
  readonly output: string;
}

/**
 * The resolver behind each `fromJson(needs.<job>.outputs.<name>)` in a `runs-on` of the workflow; none for one this check cannot read.
 */
function resolversOf(workflow: Workflow, workflows: readonly Workflow[]): readonly Resolver[] {
  return workflow.jobs.flatMap((job) =>
    job.runsOn.expressions.flatMap((expression) =>
      [...expression.matchAll(RESOLVED_RUNNER)].flatMap((match) => {
        const caller = workflow.jobs.find((candidate) => candidate.id === match[1]);
        const output = match[2];
        const resolver = caller === undefined || output === undefined ? undefined : implementation(workflow, workflows, caller, output);

        return resolver === undefined ? [] : [resolver];
      }),
    ),
  );
}

/**
 * The job that produces `output` for `caller`: the job itself, or for a call of a local reusable workflow the job in that workflow the output is forwarded from. `undefined` when the reusable workflow is not a file of this repository, which this check cannot read.
 */
function implementation(workflow: Workflow, workflows: readonly Workflow[], caller: Job, output: string): Resolver | undefined {
  if (caller.uses === undefined) {
    return { workflow, job: caller, output };
  }
  const reference = parseUses(caller.uses);
  if (reference.kind !== 'local') {
    return undefined;
  }
  const called = workflows.find((candidate) => `./${candidate.file}` === reference.path);
  if (called === undefined) {
    throw new ConformanceError(`${workflow.file}: job '${caller.id}' calls ${caller.uses}, which is not a workflow file`);
  }
  const forwarded = JOB_OUTPUT_REFERENCE.exec(called.callOutputs[output] ?? '');
  const job = called.jobs.find((candidate) => candidate.id === forwarded?.[1]);
  const jobOutput = forwarded?.[2];

  return job === undefined || jobOutput === undefined ? undefined : { workflow: called, job, output: jobOutput };
}

/**
 * The runner labels the last literal fallback of an output expression names, read as the JSON the `fromJson` that consumes it expects: a label or a list of labels. `undefined` when there is no literal fallback, and an empty list when the literal is not labels.
 */
function fallbackLabels(expression: string): readonly string[] | undefined {
  const literal = [...expression.matchAll(LITERAL_FALLBACK)].at(-1)?.[1]?.replaceAll("''", "'");
  if (literal === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(literal);
  } catch {
    return [];
  }
  const items: readonly unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const labels = items.filter((item): item is string => typeof item === 'string');

  return labels.length === items.length ? labels : [];
}

function resolverViolations(resolver: Resolver, hosted: readonly RegExp[]): readonly Violation[] {
  const violations: Violation[] = [];
  if (resolver.job.timeoutMinutes === undefined) {
    violations.push(
      workflowViolation(resolver.workflow, 'workflow-runner-resolution/resolver-no-timeout', `resolver job '${resolver.job.id}' has no timeout-minutes, so a runner that never starts holds every job waiting for it until the default six hours`, resolver.job.location),
    );
  }
  const fallback = fallbackLabels(resolver.job.outputs[resolver.output] ?? '');
  if (fallback === undefined) {
    violations.push(
      workflowViolation(resolver.workflow, 'workflow-runner-resolution/resolver-no-fallback', `output '${resolver.output}' of resolver job '${resolver.job.id}' has no literal fallback (\`|| '["<hosted label>"]'\`), so the jobs that read it have no runner when resolution produces nothing`, resolver.job.location),
    );
  } else if (fallback.length === 0 || !fallback.every((label) => hosted.some((pattern) => pattern.test(label)))) {
    violations.push(
      workflowViolation(
        resolver.workflow,
        'workflow-runner-resolution/resolver-fallback-not-hosted',
        `the literal fallback of output '${resolver.output}' of resolver job '${resolver.job.id}' does not name only hosted runner labels, so it offers no runner when the self-hosted fleet is down`,
        resolver.job.location,
      ),
    );
  }

  return violations;
}

function customLabels(job: Job, hosted: readonly RegExp[]): ReadonlySet<string> {
  return new Set([...job.runsOn.labels.filter((label) => !hosted.some((pattern) => pattern.test(label))), ...(job.runsOn.group === undefined ? [] : [`group:${job.runsOn.group}`])]);
}

function repeatedLabels(workflow: Workflow, hosted: readonly RegExp[]): readonly Violation[] {
  const labelsByJob = workflow.jobs.map((job) => ({ job, labels: customLabels(job, hosted) }));
  const users = (label: string): readonly string[] => labelsByJob.filter((entry) => entry.labels.has(label)).map((entry) => entry.job.id);

  return labelsByJob.flatMap(({ job, labels }) => {
    const repeated = [...labels].filter((label) => users(label).length > 1);

    return repeated.length === 0
      ? []
      : [
          workflowViolation(
            workflow,
            'workflow-runner-resolution/repeated-label',
            `job '${job.id}' names the runner label${repeated.length === 1 ? '' : 's'} ${repeated.map((label) => `'${label}'`).join(', ')} literally, like ${[...new Set(repeated.flatMap(users))].filter((id) => id !== job.id).map((id) => `'${id}'`).join(', ')}; resolve it once in a resolver job and read it with fromJson`,
            job.location,
          ),
        ];
  });
}

/**
 * A self-hosted or custom runner label named literally in more than one job of a workflow is resolved once instead: a resolver job decides the runner and the others read it with `fromJson(needs.<resolver>.outputs.<name>)`. The resolver must have a `timeout-minutes` and its output a literal fallback that names only hosted runner labels, so jobs still get a runner when resolution fails or the self-hosted fleet is down.
 *
 * A label is custom when it matches none of `hostedLabels`; the default patterns recognise GitHub's standard images, so a larger runner is named by a custom label and counts. Labels are compared within a workflow file, not across files. A resolver that is a reusable workflow is followed when it is a file of this repository (the output is traced through `on.workflow_call.outputs` to the job that sets it); a resolver in another repository cannot be read and is not judged. An output is taken to have a fallback when its expression has `||` followed by a string literal, and the last such literal is read as JSON (a label or a list of labels) and matched against `hostedLabels`; a fallback that is not valid JSON, or names any other label, is reported.
 */
export const workflowRunnerResolution: CheckFunction<WorkflowRunnerResolutionOptions> = async ({ cwd, options }) => {
  const hosted = (options.hostedLabels ?? DEFAULT_HOSTED_LABELS).map((source) => new RegExp(source, 'u'));
  const selected = await loadWorkflows(cwd, options);
  const available = await loadWorkflows(cwd, { workflows: DEFAULT_WORKFLOWS });
  const resolvers = new Map<string, Resolver>();
  for (const workflow of selected) {
    for (const resolver of resolversOf(workflow, available)) {
      resolvers.set(`${resolver.workflow.file}#${resolver.job.id}#${resolver.output}`, resolver);
    }
  }

  return [...selected.flatMap((workflow) => repeatedLabels(workflow, hosted)), ...[...resolvers.values()].flatMap((resolver) => resolverViolations(resolver, hosted))];
};
