import type { GitHubCheckFunction } from '../check';
import type { SettingsReviewThreadResolutionOptions } from '../options';
import { branchOf, repositoryFile, repositoryOf } from '../settings/repository';

/**
 * A pull request cannot merge while a review conversation is unresolved: a `pull_request` rule that applies to the branch sets `required_review_thread_resolution`.
 *
 * Limits: it reads the rules of rulesets; classic branch protection is not read.
 */
export const settingsReviewThreadResolution: GitHubCheckFunction<SettingsReviewThreadResolutionOptions> = async ({ cwd, options, github }) => {
  const slug = await repositoryOf(cwd, options);
  const rules = await github.branchRules(slug, await branchOf(github, slug, options));
  const file = repositoryFile(slug);

  return rules.pullRequests.some((rule) => rule.requiredReviewThreadResolution) ? [] : [{ code: 'settings-review-thread-resolution/not-required', message: `no rule requires review conversations to be resolved before merging on the branch of ${file}`, file }];
};
