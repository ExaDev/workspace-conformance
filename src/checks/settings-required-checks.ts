import type { GitHubCheckFunction, Violation } from '../check';
import type { SettingsRequiredChecksOptions } from '../options';
import { branchOf, repositoryFile, repositoryOf } from '../settings/repository';
import { loadWorkflows } from '../workflows/load';
import { DEFAULT_JUNCTION_JOBS, jobsNamed } from '../workflows/shared';

/**
 * The branch requires the check of every junction job of the workflows, and requires branches to be up to date before merging (strict mode). The check name of a job is its `name`, else its id.
 *
 * The junction job is the one that reports for the whole workflow, so requiring it requires everything it needs, including jobs a path filter may skip. Codes: `no-required-checks` (no `required_status_checks` rule applies), `required-check-missing` (a junction job's check is not among the required ones), `not-strict` (no rule sets the strict policy) and `no-junction-job` (no workflow has a job with an id from `junctionJobs`).
 *
 * Limits: it reads the rules of rulesets that apply to the branch; classic branch protection is not read, so a repository that uses it is reported as having no required checks. A junction job in a reusable workflow, or a name that is an expression, is not resolved.
 */
export const settingsRequiredChecks: GitHubCheckFunction<SettingsRequiredChecksOptions> = async ({ cwd, options, github }) => {
  const slug = await repositoryOf(cwd, options);
  const file = repositoryFile(slug);
  const rules = await github.branchRules(slug, await branchOf(github, slug, options));
  const junctions = (await loadWorkflows(cwd, options)).flatMap((workflow) => jobsNamed(workflow, options.junctionJobs ?? DEFAULT_JUNCTION_JOBS).map((job) => ({ workflow, name: job.name ?? job.id })));
  const violations: Violation[] = [];
  if (junctions.length === 0) {
    violations.push({ code: 'settings-required-checks/no-junction-job', message: 'no workflow has a junction job, so there is no check that reports for the whole workflow to require', file });
  }
  if (rules.requiredStatusChecks.length === 0) {
    violations.push({ code: 'settings-required-checks/no-required-checks', message: `no rule requires status checks on the branch of ${file}`, file });

    return violations;
  }
  const required = new Set(rules.requiredStatusChecks.flatMap((rule) => rule.contexts));
  for (const { workflow, name } of junctions.filter((junction) => !required.has(junction.name))) {
    violations.push({ code: 'settings-required-checks/required-check-missing', message: `${file} does not require the check '${name}' of ${workflow.file}`, file });
  }
  if (!rules.requiredStatusChecks.some((rule) => rule.strict)) {
    violations.push({ code: 'settings-required-checks/not-strict', message: `${file} does not require branches to be up to date before merging`, file });
  }

  return violations;
};
