import { describe, expect, it, vi } from 'vitest';

import { ConformanceError } from './errors';
import { createGitHubClient } from './github';

interface Call {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * A `fetch` that answers each request with the next of `responses` (a status number refuses the request with it) and records what was asked.
 */
function fakeFetch(responses: readonly unknown[]): { readonly fetch: typeof fetch; readonly calls: () => readonly Call[] } {
  const mock = vi.fn<typeof fetch>();
  for (const response of responses) {
    mock.mockResolvedValueOnce(typeof response === 'number' ? new Response('{}', { status: response, statusText: 'Nope' }) : Response.json(response));
  }

  return {
    fetch: mock,
    calls: () => mock.mock.calls.map(([input, init]) => ({ url: input instanceof Request ? input.url : String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) })),
  };
}

const NOT_FOUND = 404;
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

  it('reduces the rules of a branch to the required checks and the pull request rules, whichever ruleset they come from', async () => {
    const { fetch: fake, calls } = fakeFetch([
      [
        { type: 'deletion', ruleset_id: 1 },
        { type: 'required_status_checks', ruleset_id: 2, parameters: { required_status_checks: [{ context: 'Required Checks', integration_id: 9 }], strict_required_status_checks_policy: true } },
        { type: 'pull_request', ruleset_id: 3, parameters: { required_review_thread_resolution: true, allowed_merge_methods: ['rebase'], required_approving_review_count: 1 } },
        { type: 'pull_request', ruleset_id: 4, parameters: {} },
        { type: 'required_status_checks', ruleset_id: 5 },
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
    });
    expect(calls().map((call) => call.url)).toEqual(['https://api.github.com/repos/example-org/example-repo/rules/branches/release%2F1?per_page=100&page=1']);
  });

  it('reads every page of rules', async () => {
    const full = Array.from({ length: 100 }, () => ({ type: 'deletion' }));
    const { fetch: fake, calls } = fakeFetch([full, [{ type: 'pull_request', parameters: { required_review_thread_resolution: true } }]]);
    const client = createGitHubClient({ token: 't', fetch: fake });

    expect((await client.branchRules(SLUG, 'main')).pullRequests).toEqual([{ requiredReviewThreadResolution: true, allowedMergeMethods: undefined }]);
    expect(calls().map((call) => call.url.slice(call.url.indexOf('?')))).toEqual(['?per_page=100&page=1', '?per_page=100&page=2']);
  });

  it('fails with the status of a request GitHub refuses', async () => {
    const { fetch: fake } = fakeFetch([NOT_FOUND]);
    const client = createGitHubClient({ token: 't', fetch: fake });

    await expect(client.repository(SLUG)).rejects.toThrow(new ConformanceError('GET /repos/example-org/example-repo failed: 404 Nope'));
  });

  it('fails on a response that is not the shape it reads', async () => {
    const { fetch: fake } = fakeFetch([{ default_branch: 'main' }]);
    const client = createGitHubClient({ token: 't', fetch: fake });

    await expect(client.repository(SLUG)).rejects.toThrow();
  });
});
