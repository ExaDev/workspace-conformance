import type { GitHubCheckFunction, Violation } from '../check';
import type { SettingsMergeMethodsOptions } from '../options';
import { branchRulesOf, repositoryFile, repositoryOf } from '../settings/repository';

const METHODS = ['rebase', 'squash', 'merge'] as const;

type MergeMethod = (typeof METHODS)[number];

/**
 * How a message names each method, in the words GitHub's settings page uses.
 */
const METHOD_NAMES: Readonly<Record<MergeMethod, string>> = { rebase: 'rebase merging', squash: 'squash merging', merge: 'merge commits' };

/**
 * Only one merge method is available for a pull request into the branch, `rebase` unless the options say otherwise. A method is available when the repository allows it, no `pull_request` rule that applies to the branch leaves it out of its allowed methods, and, for a merge commit, no `required_linear_history` rule applies, since that rule keeps merge commits off the branch.
 *
 * When the repository's plan has no rulesets, no rule applies to the branch and the repository settings alone decide.
 *
 * Limits: it reads the repository settings and the rules of rulesets that apply to the branch; classic branch protection and a merge queue's own merge method are not read, so a repository whose queue owns the strategy is judged by what it still allows for a direct merge.
 */
export const settingsMergeMethods: GitHubCheckFunction<SettingsMergeMethodsOptions> = async ({ cwd, options, github }) => {
  const slug = await repositoryOf(cwd, options);
  const file = repositoryFile(slug);
  const settings = await github.repository(slug);
  const read = await branchRulesOf(github, slug, options);
  // A plan without rulesets applies no rule to the branch, so the repository settings alone decide which methods are available.
  const pullRequests = 'unavailable' in read ? [] : read.rules.pullRequests;
  const wanted = options.allowed ?? 'rebase';
  const repositoryAllows = { rebase: settings.allowRebaseMerge, squash: settings.allowSquashMerge, merge: settings.allowMergeCommit };
  // A plan without rulesets applies no rule to the branch, so no linear-history rule either.
  const requiredLinearHistory = 'unavailable' in read ? false : read.rules.requiredLinearHistory;
  const rulesAllow = (method: MergeMethod): boolean => !(method === 'merge' && requiredLinearHistory) && pullRequests.every((rule) => rule.allowedMergeMethods === undefined || rule.allowedMergeMethods.includes(method));
  const available = METHODS.filter((method) => repositoryAllows[method] && rulesAllow(method));
  const violations: Violation[] = available
    .filter((method) => method !== wanted)
    .map((method) => ({ code: 'settings-merge-methods/method-enabled', message: `${file} allows ${METHOD_NAMES[method]}; only ${METHOD_NAMES[wanted]} should be allowed`, file }));
  if (!available.includes(wanted)) {
    violations.push({ code: 'settings-merge-methods/method-unavailable', message: `${file} does not allow ${METHOD_NAMES[wanted]}`, file });
  }

  return violations;
};
