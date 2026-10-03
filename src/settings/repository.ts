import { ConformanceError } from '../errors';
import { remoteUrl } from '../git';
import { type BranchRules, type GitHubClient, type RepositorySlug, RulesetsUnavailableError } from '../github';
import type { SettingsOptions } from '../options';

const SLUG = /^([^/\s]+)\/([^/\s]+)$/u;
const REMOTE = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/u;
const REMOTE_NAME = 'origin';

/**
 * The repository the settings checks read: `repository` from the options, else the one the `origin` remote of `cwd` points at.
 */
export async function repositoryOf(cwd: string, options: SettingsOptions): Promise<RepositorySlug> {
  if (options.repository !== undefined) {
    const [, owner, name] = SLUG.exec(options.repository) ?? [];
    if (owner === undefined || name === undefined) {
      throw new ConformanceError(`the repository '${options.repository}' is not written owner/name`);
    }

    return { owner, name };
  }
  const url = await remoteUrl(cwd, REMOTE_NAME);
  const [, owner, name] = REMOTE.exec(url ?? '') ?? [];
  if (owner === undefined || name === undefined) {
    throw new ConformanceError(`${cwd} has no '${REMOTE_NAME}' remote on github.com; set the repository option`);
  }

  return { owner, name };
}

/**
 * The branch whose rules are read: `branch` from the options, else the repository's default branch.
 */
async function branchOf(github: GitHubClient, slug: RepositorySlug, options: SettingsOptions): Promise<string> {
  return options.branch ?? (await github.repository(slug)).defaultBranch;
}

/**
 * The repository a violation of a settings check names, `owner/name`.
 */
export function repositoryName(slug: RepositorySlug): string {
  return `${slug.owner}/${slug.name}`;
}

/**
 * The rules of the branch, or GitHub's message when the repository's plan has no rulesets, in which case no rule applies to the branch and none can be added. Any other refusal rejects.
 */
export async function branchRulesOf(github: GitHubClient, slug: RepositorySlug, options: SettingsOptions): Promise<{ readonly rules: BranchRules } | { readonly unavailable: string }> {
  const branch = await branchOf(github, slug, options);
  try {
    return { rules: await github.branchRules(slug, branch) };
  } catch (error) {
    if (error instanceof RulesetsUnavailableError) {
      return { unavailable: error.message };
    }
    throw error;
  }
}

/**
 * The message of a `rules-unavailable` violation: the branch rules of the repository cannot be read or enforced on its plan, so `what` cannot be required.
 */
export function rulesUnavailableMessage(repository: string, what: string, githubMessage: string): string {
  return `the branch rules of ${repository} cannot be read or enforced on its plan, so ${what} cannot be required (GitHub: ${githubMessage})`;
}
