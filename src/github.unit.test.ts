import { describe, expect, it, vi } from 'vitest';

import { ConformanceError } from './errors';
import { createGitHubClient, RulesetsUnavailableError } from './github';

interface Call {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * A refusal: the status, its text and the body GitHub sends with it.
 */
class Refusal {
  public constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: unknown,
  ) {}
}

/**
 * A `fetch` that answers each request with the next of `responses` (a status number refuses the request with it and an empty object, a {@link Refusal} with its own text and body) and records what was asked.
 */
function fakeFetch(responses: readonly unknown[]): { readonly fetch: typeof fetch; readonly calls: () => readonly Call[] } {
  const mock = vi.fn<typeof fetch>();
  for (const response of responses) {
    if (response instanceof Refusal) {
      mock.mockResolvedValueOnce(Response.json(response.body, { status: response.status, statusText: response.statusText }));
    } else {
      mock.mockResolvedValueOnce(typeof response === 'number' ? new Response('{}', { status: response, statusText: 'Nope' }) : Response.json(response));
    }
  }

  return {
    fetch: mock,
    calls: () => mock.mock.calls.map(([input, init]) => ({ url: input instanceof Request ? input.url : String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) })),
  };
}

const NOT_FOUND = 404;
const FORBIDDEN = 403;
// The bodies GitHub sends with a 403, as `gh api repos/<owner>/<private repository>/rules/branches/main` returns it for a private repository on a plan without rulesets, and as the REST troubleshooting guide words a token without the permission.
const PLAN_LIMIT = { message: 'Upgrade to GitHub Pro or make this repository public to enable this feature.', documentation_url: 'https://docs.github.com/rest/repos/rules#get-rules-for-a-branch', status: '403' };
const NO_PERMISSION = { message: 'Resource not accessible by personal access token', documentation_url: 'https://docs.github.com/rest/repos/rules#get-rules-for-a-branch', status: '403' };
const SLUG = { owner: 'example-org', name: 'example-repo' };

describe('createGitHubClient', () => {
  it('reads the settings that decide merge methods, authenticated with the token', async () => {
    const { fetch: fake, calls } = fakeFetch([{ default_branch: 'main', allow_rebase_merge: true, allow_squash_merge: false, allow_merge_commit: false, unrelated: 1 }]);
    const client = createGitHubClient({ token: 'test-token', apiUrl: 'https://api.example.test', fetch: fake });

    expect(await client.repository(SLUG)).toEqual({ defaultBranch: 'main', allowRebaseMerge: true, allowSquashMerge: false, allowMergeCommit: false });
    expect(calls()).toEqual([
      {
        url: 'https://api.example.test/repos/example-org/example-repo',
        headers: { accept: 'application/vnd.github+json', authorization: 'Bearer test-token', 'x-github-api-version': '2022-11-28' },
      },
    ]);
  });

  it('rejects with a ConformanceError that names the cause when the token cannot see the merge-method settings', async () => {
    const { fetch: fake } = fakeFetch([{ default_branch: 'main' }, { default_branch: 'main' }]);
    const client = createGitHubClient({ token: 't', fetch: fake });

    await expect(client.repository(SLUG)).rejects.toThrow(ConformanceError);
    await expect(client.repository(SLUG)).rejects.toThrow(/write access/u);
  });

  it('reduces the rules of a branch to the required checks and the pull request rules, whichever ruleset they come from', async () => {
    const { fetch: fake, calls } = fakeFetch([
      [
        { type: 'deletion', ruleset_id: 1 },
        { type: 'required_status_checks', ruleset_id: 2, parameters: { required_status_checks: [{ context: 'Required Checks', integration_id: 9 }], strict_required_status_checks_policy: true } },
        { type: 'pull_request', ruleset_id: 3, parameters: { required_review_thread_resolution: true, allowed_merge_methods: ['rebase'], required_approving_review_count: 1 } },
        { type: 'pull_request', ruleset_id: 4, parameters: {} },
        { type: 'required_status_checks', ruleset_id: 5 },
        { type: 'required_linear_history', ruleset_id: 6 },
      ],
    ]);
    const client = createGitHubClient({ token: 't', fetch: fake });

    expect(await client.branchRules(SLUG, 'release/1')).toEqual({
      requiredStatusChecks: [
        { contexts: ['Required Checks'], strict: true },
        { contexts: [], strict: false },
      ],
      pullRequests: [
        { requiredReviewThreadResolution: true, allowedMergeMethods: ['rebase'] },
        { requiredReviewThreadResolution: false, allowedMergeMethods: undefined },
      ],
      requiredLinearHistory: true,
    });
    expect(calls().map((call) => call.url)).toEqual(['https://api.github.com/repos/example-org/example-repo/rules/branches/release%2F1?per_page=100&page=1']);
  });

  it('reads every page of rules', async () => {
    const full = Array.from({ length: 100 }, () => ({ type: 'deletion' }));
    const { fetch: fake, calls } = fakeFetch([full, [{ type: 'pull_request', parameters: { required_review_thread_resolution: true } }]]);
    const client = createGitHubClient({ token: 't', fetch: fake });

    const rules = await client.branchRules(SLUG, 'main');

    expect(rules.pullRequests).toEqual([{ requiredReviewThreadResolution: true, allowedMergeMethods: undefined }]);
    expect(rules.requiredLinearHistory).toBe(false);
    expect(calls().map((call) => call.url.slice(call.url.indexOf('?')))).toEqual(['?per_page=100&page=1', '?per_page=100&page=2']);
  });

  it('fails with the status of a request GitHub refuses', async () => {
    const { fetch: fake } = fakeFetch([NOT_FOUND]);
    const client = createGitHubClient({ token: 't', fetch: fake });

    await expect(client.repository(SLUG)).rejects.toThrow(new ConformanceError('GET /repos/example-org/example-repo failed: 404 Nope'));
  });

  it("names GitHub's own message when it refuses a request", async () => {
    const { fetch: fake } = fakeFetch([new Refusal(FORBIDDEN, 'Forbidden', NO_PERMISSION)]);
    const client = createGitHubClient({ token: 't', fetch: fake });

    await expect(client.repository(SLUG)).rejects.toThrow(new ConformanceError('GET /repos/example-org/example-repo failed: 403 Forbidden: Resource not accessible by personal access token'));
  });

  it('rejects with RulesetsUnavailableError, carrying the message, when the plan of the repository has no rulesets', async () => {
    const { fetch: fake } = fakeFetch([new Refusal(FORBIDDEN, 'Forbidden', PLAN_LIMIT)]);
    const client = createGitHubClient({ token: 't', fetch: fake });

    const refused = client.branchRules(SLUG, 'main');

    await expect(refused).rejects.toThrow(RulesetsUnavailableError);
    await expect(refused).rejects.toThrow(PLAN_LIMIT.message);
  });

  it('keeps a 403 for a missing permission an ordinary error, not an unavailable feature', async () => {
    const { fetch: fake } = fakeFetch([new Refusal(FORBIDDEN, 'Forbidden', NO_PERMISSION)]);
    const client = createGitHubClient({ token: 't', fetch: fake });

    const refused = client.branchRules(SLUG, 'main').catch((error: unknown) => error);

    expect(await refused).toBeInstanceOf(ConformanceError);
    expect(await refused).not.toBeInstanceOf(RulesetsUnavailableError);
    expect(String(await refused)).toContain(NO_PERMISSION.message);
  });

  it('fails on a response that is not the shape it reads', async () => {
    const { fetch: fake } = fakeFetch([{ default_branch: 'main' }]);
    const client = createGitHubClient({ token: 't', fetch: fake });

    await expect(client.repository(SLUG)).rejects.toThrow();
  });
});
