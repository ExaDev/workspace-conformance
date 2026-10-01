import type { CheckFunction, Violation } from '../check';
import type { WorkflowRepositoryDispatchOptions } from '../options';
import { loadWorkflows } from '../workflows/load';
import { effectiveEnv, type Job, type Step, type Workflow } from '../workflows/model';
import { scriptCommands, stepUses, workflowViolation } from '../workflows/shared';

const DEFAULT_BRANCHES: readonly string[] = ['main', 'master'];
const DEFAULT_BRANCH_EXPRESSION = /\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/u;
const DEFAULT_TOKEN = /\b(?:secrets\.GITHUB_TOKEN|github\.token)\b/u;

const PUSH = /^git\s+push\b(.*)$/u;
const BRANCH_CREATION = /^git\s+(?:checkout\s+-[bB]|switch\s+-[cC])\b/u;
const AUTO_MERGE = /^gh\s+pr\s+merge\b.*\s--auto\b/u;
const PULL_REQUEST_CREATION = /^gh\s+pr\s+create\b|^gh\s+api\b.*\brepos\/[^\s]+\/pulls\b/u;
const DISPATCH_TARGETS: readonly RegExp[] = [/^(?:gh\s+api|curl)\b.*\brepos\/([^\s/]+\/[^\s/]+)\/dispatches\b/u, /^gh\s+workflow\s+run\b.*\s(?:-R|--repo)[\s=]+(\S+)/u];

const AUTO_COMMIT_ACTION = 'stefanzweifel/git-auto-commit-action';
const PULL_REQUEST_ACTION = 'peter-evans/create-pull-request';
const DISPATCH_ACTION = 'peter-evans/repository-dispatch';
const CHECKOUT_ACTION = 'actions/checkout';

interface Context {
  readonly workflow: Workflow;
  readonly job: Job;
  readonly branches: readonly string[];
  readonly assumeRequiredChecks: boolean;
}

function isDefaultBranch(branch: string, branches: readonly string[]): boolean {
  const name = branch.replace(/^refs\/heads\//u, '');

  return branches.includes(name) || DEFAULT_BRANCH_EXPRESSION.test(name);
}

/**
 * The `git push` options that take their value as the next word, which would otherwise be read as the remote.
 */
const PUSH_OPTIONS_WITH_VALUE: ReadonlySet<string> = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);

/**
 * A URL with credentials in it (an expression such as `${{ secrets.TOKEN }}` may be part of them), which authenticates a push itself instead of using what the checkout left in git config.
 */
const URL_WITH_CREDENTIALS = /[a-z][a-z0-9+.-]*:\/\/(?:[^\s/@{]|\$\{\{[^}]*\}\})*@/iu;

/**
 * The refspecs of a `git push` command line, after the remote, the options and the values of the options that take one.
 */
function pushRefspecs(line: string): readonly string[] {
  const words = (PUSH.exec(line)?.[1] ?? '').split(/\s+/u).filter((word) => word !== '');
  const positional: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === undefined) {
      continue;
    }
    if (PUSH_OPTIONS_WITH_VALUE.has(word)) {
      index += 1;
    } else if (!word.startsWith('-')) {
      positional.push(word);
    }
  }

  return positional.slice(1);
}

/**
 * Whether a `git push` command line pushes to the default branch. With a refspec it is the destination (a leading `+` only forces the update, and a bare `HEAD` is the checked-out branch); without one it is the branch the handler has checked out, which is the default branch unless the job created another or checked one out by `ref`.
 */
function pushesToDefault(line: string, onOtherBranch: boolean, branches: readonly string[]): boolean {
  const refspecs = pushRefspecs(line);
  if (refspecs.length === 0) {
    return !onOtherBranch;
  }

  return refspecs.some((refspec) => {
    const destination = refspec.replace(/^\+/u, '');
    const named = destination.includes(':') ? destination.slice(destination.lastIndexOf(':') + 1) : destination;

    return named === 'HEAD' ? !onOtherBranch : isDefaultBranch(named, branches);
  });
}

/**
 * Whether a `git push` command line authenticates with what the checkout left in git config, which it does unless the command line names a URL carrying its own credentials.
 */
function pushesWithGitConfig(line: string): boolean {
  return !URL_WITH_CREDENTIALS.test(line);
}

function usesDefaultToken(workflow: Workflow, job: Job, step: Step): boolean {
  return DEFAULT_TOKEN.test([step.run, ...Object.values(effectiveEnv(workflow, job, step)), ...Object.values(step.with)].filter((text) => text !== undefined).join('\n'));
}

/**
 * Whether the job's checkout leaves the default token in the git config, so a `git push` authenticates as it.
 */
function checkoutKeepsDefaultToken(job: Job): boolean {
  return job.steps.some((step) => stepUses(step, CHECKOUT_ACTION) && (step.with['token'] === undefined || DEFAULT_TOKEN.test(step.with['token'])) && step.with['persist-credentials'] !== 'false');
}

function checkoutRefOtherThanDefault(job: Job, branches: readonly string[]): boolean {
  return job.steps.some((step) => stepUses(step, CHECKOUT_ACTION) && step.with['ref'] !== undefined && !isDefaultBranch(step.with['ref'], branches));
}

function stepViolations(context: Context, step: Step, onOtherBranch: boolean): readonly Violation[] {
  const { workflow, job, branches } = context;
  const lines = scriptCommands(step.run);
  const found: Violation[] = [];
  const report = (reason: string, message: string): void => {
    found.push(workflowViolation(workflow, `workflow-repository-dispatch/${reason}`, message, step.location));
  };
  const pushes = lines.filter((line) => PUSH.test(line));
  const autoCommits = stepUses(step, AUTO_COMMIT_ACTION);
  const autoCommitBranch = step.with['branch'];
  const autoCommitsToDefault = autoCommits && !onOtherBranch && (autoCommitBranch === undefined || isDefaultBranch(autoCommitBranch, branches));

  if (autoCommitsToDefault || pushes.some((line) => pushesToDefault(line, onOtherBranch, branches))) {
    report('pushes-default-branch', `job '${job.id}' pushes to the default branch from a repository_dispatch handler, which anyone who can dispatch can trigger, bypassing review; push a branch and open a pull request`);
  }
  if (!context.assumeRequiredChecks && lines.some((line) => AUTO_MERGE.test(line))) {
    report('auto-merge-without-required-checks', `job '${job.id}' merges with --auto, which merges at once when the base branch has no required checks; require status checks on the default branch (or set assumeRequiredChecks once it does)`);
  }
  const pushesAsDefaultToken = (pushes.some(pushesWithGitConfig) || autoCommits) && checkoutKeepsDefaultToken(job);
  const createsPullRequestAsDefaultToken =
    (lines.some((line) => PULL_REQUEST_CREATION.test(line)) && usesDefaultToken(workflow, job, step)) ||
    (stepUses(step, PULL_REQUEST_ACTION) && (step.with['token'] === undefined || DEFAULT_TOKEN.test(step.with['token'])));
  if (pushesAsDefaultToken || createsPullRequestAsDefaultToken) {
    report('default-token-triggers-nothing', `job '${job.id}' pushes or opens a pull request as GITHUB_TOKEN, and events GitHub Actions creates with that token start no workflows, so nothing validates the result; use a token from a GitHub App or a personal access token`);
  }
  const targets = [
    ...lines.flatMap((line) => DISPATCH_TARGETS.map((pattern) => pattern.exec(line)?.[1])),
    ...(stepUses(step, DISPATCH_ACTION) ? [step.with['repository']] : []),
  ].filter((target) => target !== undefined);
  for (const target of targets.filter((candidate) => !candidate.includes('github.repository'))) {
    if (usesDefaultToken(workflow, job, step)) {
      report('dispatch-other-repository-with-default-token', `job '${job.id}' dispatches to ${target} with GITHUB_TOKEN, which is limited to this repository; use a token that has access to ${target}`);
    }
  }

  return found;
}

function jobViolations(context: Context): readonly Violation[] {
  let onOtherBranch = checkoutRefOtherThanDefault(context.job, context.branches);
  const found: Violation[] = [];
  for (const step of context.job.steps) {
    found.push(...stepViolations(context, step, onOtherBranch));
    onOtherBranch ||= scriptCommands(step.run).some((line) => BRANCH_CREATION.test(line));
  }

  return found;
}

/**
 * A workflow that handles `repository_dispatch` can be started by anyone with write access through the API, so what it does with the repository is held to a higher bar.
 *
 * `workflow-repository-dispatch/pushes-default-branch`: a `git push` to the default branch, or one with no refspec while the default branch is checked out, or `git-auto-commit-action` on it. `auto-merge-without-required-checks`: `gh pr merge --auto`, which merges at once when the base branch requires no checks (the file cannot show the rule; `assumeRequiredChecks` states it, and `settings-required-checks` verifies it). `default-token-triggers-nothing`: a push (the checkout leaves `GITHUB_TOKEN` in git config unless it is given a `token`, and a push to a URL carrying its own credentials does not use it) or a pull request opened as `GITHUB_TOKEN`; events created with it start no workflows, apart from `workflow_dispatch` and `repository_dispatch`, so the pushed commit gets no checks. `dispatch-other-repository-with-default-token`: a dispatch to a repository other than `github.repository` with `GITHUB_TOKEN`, whose access is limited to its own repository. Dispatching in the same repository with `GITHUB_TOKEN` is allowed by GitHub and is not reported.
 *
 * Limits: commands are read as text, so a script file or composite action is not seen; a push is judged by its command line, so a branch created by a helper is not seen; a dispatch target written literally as this repository's own name is reported, since the file does not know the name; a job that calls a reusable workflow is not read.
 */
export const workflowRepositoryDispatch: CheckFunction<WorkflowRepositoryDispatchOptions> = async ({ cwd, options }) =>
  (await loadWorkflows(cwd, options))
    .filter((workflow) => workflow.triggers.has('repository_dispatch'))
    .flatMap((workflow) => workflow.jobs.flatMap((job) => jobViolations({ workflow, job, branches: options.defaultBranches ?? DEFAULT_BRANCHES, assumeRequiredChecks: options.assumeRequiredChecks === true })));
