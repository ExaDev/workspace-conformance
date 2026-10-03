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
  /**
   * Whether a `required_linear_history` rule applies, which keeps merge commits off the branch.
   */
  readonly requiredLinearHistory: boolean;
}

/**
 * GitHub's refusal to read a branch's rules because the repository's plan does not offer rulesets, as for a private repository on a plan without them: no ruleset applies to its branches, so a check that requires one cannot be met. The message is GitHub's own. A {@link GitHubClient} rejects `branchRules` with it, and with any other error for every other refusal.
 */
export class RulesetsUnavailableError extends ConformanceError {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RulesetsUnavailableError';
  }
}

/**
 * What the settings checks need from GitHub, so a test or another host can supply it without a network. The real implementation is {@link createGitHubClient}. Both methods reject when the repository or branch cannot be read, `branchRules` with {@link RulesetsUnavailableError} when the repository's plan has no rulesets.
 */
export interface GitHubClient {
  readonly repository: (slug: RepositorySlug) => Promise<RepositorySettings>;
  readonly branchRules: (slug: RepositorySlug, branch: string) => Promise<BranchRules>;
}

const repositorySchema = z.object({
  default_branch: z.string(),
  allow_rebase_merge: z.optional(z.boolean()),
  allow_squash_merge: z.optional(z.boolean()),
  allow_merge_commit: z.optional(z.boolean()),
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
   * A token that can read the repository's settings and rulesets. The API reports the merge-method settings only to a token with write access to the repository, so a token without it makes {@link GitHubClient.repository} reject.
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

/**
 * The body of an error response of the REST API: `message` explains the refusal.
 */
const errorBodySchema = z.looseObject({ message: z.string() });

/**
 * The 403 status of a request that GitHub refuses, for a missing permission, a rate limit or a feature the plan lacks alike.
 */
const FORBIDDEN = 403;

/**
 * How GitHub's message starts when it refuses a request for a feature the repository's plan does not include ('Upgrade to GitHub Pro or make this repository public to enable this feature.'). The REST documentation of the branch rules endpoint lists no error status, and a 403 also means a missing permission ('Resource not accessible by personal access token') or a rate limit, so the message is the only thing that tells a plan limit apart.
 */
const PLAN_LIMIT_PREFIX = 'Upgrade to GitHub ';

/**
 * Decides the error of a refused request from its status and GitHub's message, or leaves it to the generic one by returning `undefined`.
 */
type RefusalHandler = (status: number, githubMessage: string | undefined) => Error | undefined;

/**
 * The plan-limit refusal of a branch's rules as {@link RulesetsUnavailableError}.
 */
const rulesRefusal: RefusalHandler = (status, githubMessage) =>
  status === FORBIDDEN && githubMessage?.startsWith(PLAN_LIMIT_PREFIX) === true ? new RulesetsUnavailableError(githubMessage) : undefined;

async function githubMessageOf(response: Response): Promise<string | undefined> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // A body that is not JSON carries no message to name; the status still does.
    return undefined;
  }
  const parsed = errorBodySchema.safeParse(body);

  return parsed.success ? parsed.data.message : undefined;
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

  async function get(path: string, refusal?: RefusalHandler): Promise<unknown> {
    const response = await request(`${root}${path}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${options.token}`, 'X-GitHub-Api-Version': API_VERSION } });
    if (!response.ok) {
      const githubMessage = await githubMessageOf(response);
      throw refusal?.(response.status, githubMessage) ?? new ConformanceError(`GET ${path} failed: ${String(response.status)} ${response.statusText}${githubMessage === undefined ? '' : `: ${githubMessage}`}`);
    }

    return response.json();
  }

  return {
    repository: async (slug) => {
      const parsed = repositorySchema.parse(await get(`/repos/${slug.owner}/${slug.name}`));
      const { allow_rebase_merge: allowRebaseMerge, allow_squash_merge: allowSquashMerge, allow_merge_commit: allowMergeCommit } = parsed;
      if (allowRebaseMerge === undefined || allowSquashMerge === undefined || allowMergeCommit === undefined) {
        throw new ConformanceError(`GET /repos/${slug.owner}/${slug.name} did not report the merge-method settings, which GitHub shows only to a token with write access to the repository`);
      }

      return { defaultBranch: parsed.default_branch, allowRebaseMerge, allowSquashMerge, allowMergeCommit };
    },
    branchRules: async (slug, branch) => {
      const rules: z.output<typeof rulesSchema> = [];
      for (let page = 1, more = true; more; page += 1) {
        const body = await get(`/repos/${slug.owner}/${slug.name}/rules/branches/${encodeURIComponent(branch)}?per_page=${String(PAGE_SIZE)}&page=${String(page)}`, rulesRefusal);
        const found = rulesSchema.parse(body);
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
        requiredLinearHistory: rules.some((rule) => rule.type === 'required_linear_history'),
      };
    },
  };
}
