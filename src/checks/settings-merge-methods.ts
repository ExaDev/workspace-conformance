import type { GitHubCheckFunction, Violation } from '../check';
import type { SettingsMergeMethodsOptions } from '../options';
import { branchOf, repositoryFile, repositoryOf } from '../settings/repository';

const METHODS = ['rebase', 'squash', 'merge'] as const;

/**
 * Only one merge method is available for a pull request into the branch, `rebase` unless the options say otherwise. A method is available when the repository allows it and no `pull_request` rule that applies to the branch leaves it out of its allowed methods.
 *
 * Limits: it reads the repository settings and the rules of rulesets that apply to the branch; classic branch protection and a merge queue's own merge method are not read, so a repository whose queue owns the strategy is judged by what it still allows for a direct merge.
 */
export const settingsMergeMethods: GitHubCheckFunction<SettingsMergeMethodsOptions> = async ({ cwd, options, github }) => {
  const slug = await repositoryOf(cwd, options);
  const file = repositoryFile(slug);
  const settings = await github.repository(slug);
  const rules = await github.branchRules(slug, await branchOf(github, slug, options));
  const wanted = options.allowed ?? 'rebase';
  const repositoryAllows = { rebase: settings.allowRebaseMerge, squash: settings.allowSquashMerge, merge: settings.allowMergeCommit };
  const available = METHODS.filter((method) => repositoryAllows[method] && rules.pullRequests.every((rule) => rule.allowedMergeMethods === undefined || rule.allowedMergeMethods.includes(method)));
  const violations: Violation[] = available.filter((method) => method !== wanted).map((method) => ({ code: 'settings-merge-methods/method-enabled', message: `${file} allows ${method} merges; only ${wanted} should be allowed`, file }));
  if (!available.includes(wanted)) {
    violations.push({ code: 'settings-merge-methods/method-unavailable', message: `${file} does not allow ${wanted} merges`, file });
  }

  return violations;
};
