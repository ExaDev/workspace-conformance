import { z } from 'zod';

import { ConformanceError } from './errors';

/**
 * A repository on GitHub.
 */
export interface RepositorySlug {
  readonly owner: string;
  readonly name: string;
}

/**
 * The repository settings the settings checks read.
 */
export interface RepositorySettings {
  readonly defaultBranch: string;
  readonly allowRebaseMerge: boolean;
  readonly allowSquashMerge: boolean;
  readonly allowMergeCommit: boolean;
}

/**
 * The rules that apply to a branch, whichever ruleset they come from, reduced to what the settings checks read.
 */
export interface BranchRules {
  /**
   * One entry per `required_status_checks` rule.
   */
  readonly requiredStatusChecks: readonly { readonly contexts: readonly string[]; readonly strict: boolean }[];
  /**
   * One entry per `pull_request` rule. `allowedMergeMethods` is undefined when the rule does not restrict them.
   */
  readonly pullRequests: readonly { readonly requiredReviewThreadResolution: boolean; readonly allowedMergeMethods: readonly string[] | undefined }[];
}

/**
 * What the settings checks need from GitHub, so a test or another host can supply it without a network. The real implementation is {@link createGitHubClient}. Both methods reject when the repository or branch cannot be read.
 */
export interface GitHubClient {
  readonly repository: (slug: RepositorySlug) => Promise<RepositorySettings>;
  readonly branchRules: (slug: RepositorySlug, branch: string) => Promise<BranchRules>;
}

const repositorySchema = z.object({
  default_branch: z.string(),
  allow_rebase_merge: z.boolean(),
  allow_squash_merge: z.boolean(),
  allow_merge_commit: z.boolean(),
});

const rulesSchema = z.array(
  z.looseObject({
    type: z.string(),
    parameters: z.optional(
      z.looseObject({
        required_status_checks: z.optional(z.array(z.object({ context: z.string() }))),
        strict_required_status_checks_policy: z.optional(z.boolean()),
        required_review_thread_resolution: z.optional(z.boolean()),
        allowed_merge_methods: z.optional(z.array(z.string())),
      }),
    ),
  }),
);

/**
 * Options of {@link createGitHubClient}.
 */
export interface GitHubClientOptions {
  /**
   * A token that can read the repository's settings and rulesets.
   */
  readonly token: string;
  /**
   * The API root. `https://api.github.com` when omitted.
   */
  readonly apiUrl?: string;
  /**
   * The `fetch` to use. The global one when omitted.
   */
  readonly fetch?: typeof fetch;
}

const API_ROOT = 'https://api.github.com';
const API_VERSION = '2022-11-28';

/**
 * How many rules the API returns in one page, its maximum.
 */
const PAGE_SIZE = 100;

/**
 * A {@link GitHubClient} over the REST API.
 */
export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const request = options.fetch ?? fetch;
  const root = options.apiUrl ?? API_ROOT;

  async function get(path: string): Promise<unknown> {
    const response = await request(`${root}${path}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${options.token}`, 'X-GitHub-Api-Version': API_VERSION } });
    if (!response.ok) {
      throw new ConformanceError(`GET ${path} failed: ${String(response.status)} ${response.statusText}`);
    }

    return response.json();
  }

  return {
    repository: async (slug) => {
      const parsed = repositorySchema.parse(await get(`/repos/${slug.owner}/${slug.name}`));

      return { defaultBranch: parsed.default_branch, allowRebaseMerge: parsed.allow_rebase_merge, allowSquashMerge: parsed.allow_squash_merge, allowMergeCommit: parsed.allow_merge_commit };
    },
    branchRules: async (slug, branch) => {
      const rules: z.output<typeof rulesSchema> = [];
      for (let page = 1, more = true; more; page += 1) {
        const found = rulesSchema.parse(await get(`/repos/${slug.owner}/${slug.name}/rules/branches/${encodeURIComponent(branch)}?per_page=${String(PAGE_SIZE)}&page=${String(page)}`));
        rules.push(...found);
        more = found.length === PAGE_SIZE;
      }

      return {
        requiredStatusChecks: rules
          .filter((rule) => rule.type === 'required_status_checks')
          .map((rule) => ({ contexts: (rule.parameters?.required_status_checks ?? []).map((check) => check.context), strict: rule.parameters?.strict_required_status_checks_policy === true })),
        pullRequests: rules
          .filter((rule) => rule.type === 'pull_request')
          .map((rule) => ({ requiredReviewThreadResolution: rule.parameters?.required_review_thread_resolution === true, allowedMergeMethods: rule.parameters?.allowed_merge_methods })),
      };
    },
  };
}
