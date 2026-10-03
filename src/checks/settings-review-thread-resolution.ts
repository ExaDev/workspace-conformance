import type { GitHubCheckFunction } from '../check';
import type { SettingsReviewThreadResolutionOptions } from '../options';
import { branchRulesOf, repositoryName, repositoryOf, rulesUnavailableMessage } from '../settings/repository';

/**
 * A pull request cannot merge while a review conversation is unresolved: a `pull_request` rule that applies to the branch sets `required_review_thread_resolution`.
 *
 * When the repository's plan has no rulesets it reports `rules-unavailable` with GitHub's message, since nothing can require it.
 *
 * Limits: it reads the rules of rulesets; classic branch protection is not read.
 */
export const settingsReviewThreadResolution: GitHubCheckFunction<SettingsReviewThreadResolutionOptions> = async ({ cwd, options, github }) => {
  const slug = await repositoryOf(cwd, options);
  const read = await branchRulesOf(github, slug, options);
  const repository = repositoryName(slug);
  if ('unavailable' in read) {
    return [{ code: 'settings-review-thread-resolution/rules-unavailable', message: rulesUnavailableMessage(repository, 'resolving review conversations', read.unavailable), repository }];
  }

  return read.rules.pullRequests.some((rule) => rule.requiredReviewThreadResolution) ? [] : [{ code: 'settings-review-thread-resolution/not-required', message: `no rule requires review conversations to be resolved before merging on the branch of ${repository}`, repository }];
};
