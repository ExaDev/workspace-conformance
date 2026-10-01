import { ConformanceError } from '../errors';
import type { RepositorySlug } from '../github';
import { remoteUrl } from '../git';
import type { GitHubClient } from '../github';
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
export async function branchOf(github: GitHubClient, slug: RepositorySlug, options: SettingsOptions): Promise<string> {
  return options.branch ?? (await github.repository(slug)).defaultBranch;
}

/**
 * What a violation of a settings check names as its file.
 */
export function repositoryFile(slug: RepositorySlug): string {
  return `${slug.owner}/${slug.name}`;
}
