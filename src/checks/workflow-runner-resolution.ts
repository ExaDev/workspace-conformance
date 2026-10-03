import type { CheckFunction, Violation } from '../check';
import { ConformanceError } from '../errors';
import type { WorkflowRunnerResolutionOptions } from '../options';
import { DEFAULT_WORKFLOWS, loadWorkflows } from '../workflows/load';
import { constantString, operands, unwrapped } from '../workflows/expressions';
import { hasExpression, type Job, parseUses, type Workflow } from '../workflows/model';
import { workflowViolation } from '../workflows/shared';

/**
 * The `hostedLabels` used when the options set none: GitHub's own images, `ubuntu`, `windows` and `macos`, as `-latest`, a version, or a version with an architecture or size suffix, and `ubuntu-slim`. Setting `hostedLabels` replaces it, so a workflow that also falls back to a third-party hosted runner extends it: `[...DEFAULT_HOSTED_LABELS, '^blacksmith-']`.
 */
export const DEFAULT_HOSTED_LABELS: readonly string[] = ['^(?:ubuntu|windows|macos)-(?:latest|slim|[0-9][0-9.]*)(?:-(?:arm|intel|xlarge|large))*$'];

/**
 * `fromJson(needs.<job>.outputs.<name>)` in a `runs-on`.
 */
const RESOLVED_RUNNER = /fromJSON\(\s*needs\.([\w-]+)\.outputs\.([\w-]+)\s*\)/giu;

/**
 * `${{ jobs.<job>.outputs.<name> }}` as the value of a reusable workflow's output.
 */
const JOB_OUTPUT_REFERENCE = /^\$\{\{\s*jobs\.([\w-]+)\.outputs\.([\w-]+)\s*\}\}$/u;

interface Resolver {
  readonly workflow: Workflow;
  readonly job: Job;
  readonly output: string;
  /**
   * The value each input of the resolver's workflow has in this call, when it is the same on every run: the literal the caller passes, else the input's default. Empty for a resolver that is not a reusable workflow.
   */
  readonly inputs: Readonly<Record<string, string | undefined>>;
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
    return { workflow, job: caller, output, inputs: {} };
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

  const inputs = Object.fromEntries(
    Object.entries(called.callInputs).map(([name, fallback]) => {
      const passed = caller.with[name];

      return [name, passed === undefined ? fallback : hasExpression(passed) ? undefined : passed];
    }),
  );

  return job === undefined || jobOutput === undefined ? undefined : { workflow: called, job, output: jobOutput, inputs };
}

/**
 * The runner labels the fallback of an output expression names, read as the JSON the `fromJson` that consumes it expects: a label or a list of labels. The fallback is the first operand after the first of the expression's top-level `||` chain whose value is the same on every run and not empty (see `constantString`), which is what the chain yields when the operands before it are empty. `undefined` when there is no such operand, and an empty list when its value is not labels.
 */
function fallbackLabels(expression: string, inputs: Readonly<Record<string, string | undefined>>): readonly string[] | undefined {
  const literal = operands(unwrapped(expression), '||')
    .slice(1)
    .map((operand) => constantString(operand, inputs))
    .find((value) => value !== undefined && value !== '');
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
  const fallback = fallbackLabels(resolver.job.outputs[resolver.output] ?? '', resolver.inputs);
  if (fallback === undefined) {
    violations.push(
      workflowViolation(resolver.workflow, 'workflow-runner-resolution/resolver-no-fallback', `output '${resolver.output}' of resolver job '${resolver.job.id}' has no fallback whose value is known before the run (\`|| '["<hosted label>"]'\`, or format() of literals and of inputs with a literal value), so the jobs that read it have no runner when resolution produces nothing`, resolver.job.location),
    );
  } else if (fallback.length === 0) {
    violations.push(
      workflowViolation(
        resolver.workflow,
        'workflow-runner-resolution/resolver-fallback-not-hosted',
        `the literal fallback of output '${resolver.output}' of resolver job '${resolver.job.id}' is not a runner label or a non-empty list of them, so the jobs that read it have no runner when resolution produces nothing`,
        resolver.job.location,
      ),
    );
  } else {
    const unhosted = fallback.filter((label) => !hosted.some((pattern) => pattern.test(label)));
    if (unhosted.length > 0) {
      violations.push(
        workflowViolation(
          resolver.workflow,
          'workflow-runner-resolution/resolver-fallback-not-hosted',
          `the literal fallback of output '${resolver.output}' of resolver job '${resolver.job.id}' names ${unhosted.map((label) => `'${label}'`).join(', ')}, which ${unhosted.length === 1 ? 'matches' : 'match'} no pattern of hostedLabels, so it is not known to offer a runner when resolution produces nothing; name a hosted label, or add the label's pattern to hostedLabels (extending DEFAULT_HOSTED_LABELS) if it is hosted, by GitHub or by a third party`,
          resolver.job.location,
        ),
      );
    }
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
 * A label is custom when it matches none of `hostedLabels`; the default patterns recognise GitHub's standard images, so a larger runner is named by a custom label and counts. Labels are compared within a workflow file, not across files. A resolver that is a reusable workflow is followed when it is a file of this repository (the output is traced through `on.workflow_call.outputs` to the job that sets it); a resolver in another repository cannot be read and is not judged. An output's fallback is the first operand after the first of its expression's top-level `||` chain whose value is the same on every run: a string literal, or `format()` of literals and of inputs of the reusable workflow, read from the literal the caller passes or else the input's default. It is read as JSON (a label or a list of labels) and matched against `hostedLabels`; a fallback that is not valid JSON, or names any other label, is reported, and an output with no such operand has no fallback.
 */
export const workflowRunnerResolution: CheckFunction<WorkflowRunnerResolutionOptions> = async ({ cwd, options }) => {
  const hosted = (options.hostedLabels ?? DEFAULT_HOSTED_LABELS).map((source) => new RegExp(source, 'u'));
  const selected = await loadWorkflows(cwd, options);
  const available = await loadWorkflows(cwd, { workflows: DEFAULT_WORKFLOWS });
  const resolvers = new Map<string, Resolver>();
  for (const workflow of selected) {
    for (const resolver of resolversOf(workflow, available)) {
      resolvers.set(`${resolver.workflow.file}#${resolver.job.id}#${resolver.output}#${JSON.stringify(resolver.inputs)}`, resolver);
    }
  }

  return [...selected.flatMap((workflow) => repeatedLabels(workflow, hosted)), ...[...resolvers.values()].flatMap((resolver) => resolverViolations(resolver, hosted))];
};
