import { afterEach, describe, expect, it, vi } from 'vitest';

import { addRemote, createGitWorkspace } from '../../test/support/git-workspace';
import { fixturePath, removeTempDirs } from '../../test/support/temp';
import { type BranchRules, type GitHubClient, type RepositorySettings, type RepositorySlug, RulesetsUnavailableError } from '../github';
import { settingsMergeMethods } from './settings-merge-methods';
import { settingsRequiredChecks } from './settings-required-checks';
import { settingsReviewThreadResolution } from './settings-review-thread-resolution';

afterEach(removeTempDirs);

const REPOSITORY = 'example-org/example-repo';
const SLUG: RepositorySlug = { owner: 'example-org', name: 'example-repo' };
const REBASE_ONLY: RepositorySettings = { defaultBranch: 'main', allowRebaseMerge: true, allowSquashMerge: false, allowMergeCommit: false };
const NO_RULES: BranchRules = { requiredStatusChecks: [], pullRequests: [], requiredLinearHistory: false, mergeQueue: false };

interface Requests {
  readonly repositories: () => readonly RepositorySlug[];
  readonly branches: () => readonly string[];
}

/**
 * A client that answers from memory and records what it was asked.
 */
function clientOf(settings: RepositorySettings, rules: BranchRules): { readonly client: GitHubClient; readonly requests: Requests } {
  const repository = vi.fn<GitHubClient['repository']>().mockResolvedValue(settings);
  const branchRules = vi.fn<GitHubClient['branchRules']>().mockResolvedValue(rules);

  return {
    client: { repository, branchRules },
    requests: { repositories: () => repository.mock.calls.map(([slug]) => slug), branches: () => branchRules.mock.calls.map(([, branch]) => branch) },
  };
}

describe('settings-merge-methods', () => {
  it('accepts a repository that allows rebase merges only', async () => {
    const { client } = clientOf(REBASE_ONLY, NO_RULES);

    expect(await settingsMergeMethods({ cwd: '.', options: { repository: REPOSITORY }, github: client })).toEqual([]);
  });

  it('reports each other method the repository allows', async () => {
    const { client } = clientOf({ ...REBASE_ONLY, allowSquashMerge: true, allowMergeCommit: true }, NO_RULES);

    expect(await settingsMergeMethods({ cwd: '.', options: { repository: REPOSITORY }, github: client })).toEqual([
      { code: 'settings-merge-methods/method-enabled', message: `${REPOSITORY} allows squash merging; only rebase merging should be allowed`, file: REPOSITORY },
      { code: 'settings-merge-methods/method-enabled', message: `${REPOSITORY} allows merge commits; only rebase merging should be allowed`, file: REPOSITORY },
    ]);
  });

  it('does not report merge commits on a branch whose rules require linear history, which blocks them', async () => {
    const linear = clientOf({ ...REBASE_ONLY, allowMergeCommit: true }, { ...NO_RULES, requiredLinearHistory: true });
    const mergeOnly = clientOf({ ...REBASE_ONLY, allowRebaseMerge: false, allowMergeCommit: true }, { ...NO_RULES, requiredLinearHistory: true });

    expect(await settingsMergeMethods({ cwd: '.', options: { repository: REPOSITORY }, github: linear.client })).toEqual([]);
    expect(await settingsMergeMethods({ cwd: '.', options: { repository: REPOSITORY, allowed: 'merge' }, github: mergeOnly.client })).toEqual([
      { code: 'settings-merge-methods/method-unavailable', message: `${REPOSITORY} does not allow merge commits`, file: REPOSITORY },
    ]);
  });

  it('reports a wanted method the repository does not allow, and one a pull request rule leaves out', async () => {
    const closed = clientOf({ ...REBASE_ONLY, allowRebaseMerge: false, allowSquashMerge: true }, NO_RULES);
    const restricted = clientOf(REBASE_ONLY, { ...NO_RULES, pullRequests: [{ requiredReviewThreadResolution: false, allowedMergeMethods: ['squash'] }] });

    expect((await settingsMergeMethods({ cwd: '.', options: { repository: REPOSITORY }, github: closed.client })).map((violation) => violation.code)).toEqual([
      'settings-merge-methods/method-enabled',
      'settings-merge-methods/method-unavailable',
    ]);
    expect((await settingsMergeMethods({ cwd: '.', options: { repository: REPOSITORY }, github: restricted.client })).map((violation) => violation.code)).toEqual([
      'settings-merge-methods/method-unavailable',
    ]);
  });

  it('judges against the method the options name, reading the rules of the default branch', async () => {
    const { client, requests } = clientOf({ ...REBASE_ONLY, defaultBranch: 'trunk', allowRebaseMerge: false, allowSquashMerge: true }, NO_RULES);

    expect(await settingsMergeMethods({ cwd: '.', options: { repository: REPOSITORY, allowed: 'squash' }, github: client })).toEqual([]);
    expect(requests.branches()).toEqual(['trunk']);
    expect(requests.repositories()).toEqual([SLUG, SLUG]);
  });

  it('reads the branch named in the options without asking for the default', async () => {
    const { client, requests } = clientOf(REBASE_ONLY, NO_RULES);

    await settingsMergeMethods({ cwd: '.', options: { repository: REPOSITORY, branch: 'release' }, github: client });

    expect(requests.branches()).toEqual(['release']);
  });
});

describe('settings-required-checks', () => {
  const cwd = fixturePath('workflows', 'settings-required-checks', 'with-junction');

  it('accepts a branch that requires the junction check and up-to-date branches', async () => {
    const { client } = clientOf(REBASE_ONLY, { ...NO_RULES, requiredStatusChecks: [{ contexts: ['Required Checks'], strict: true }] });

    expect(await settingsRequiredChecks({ cwd, options: { repository: REPOSITORY }, github: client })).toEqual([]);
  });

  it('reports a junction check that is not required, and a branch that need not be up to date', async () => {
    const { client } = clientOf(REBASE_ONLY, { ...NO_RULES, requiredStatusChecks: [{ contexts: ['test'], strict: false }] });

    expect(await settingsRequiredChecks({ cwd, options: { repository: REPOSITORY }, github: client })).toEqual([
      { code: 'settings-required-checks/required-check-missing', message: `${REPOSITORY} does not require the check 'Required Checks' of .github/workflows/ci.yml`, file: REPOSITORY },
      { code: 'settings-required-checks/not-strict', message: `${REPOSITORY} does not require branches to be up to date before merging`, file: REPOSITORY },
    ]);
  });

  it('accepts strict mode set by any one of the rules that apply', async () => {
    const { client } = clientOf(REBASE_ONLY, {
      ...NO_RULES,
      requiredStatusChecks: [
        { contexts: ['Required Checks'], strict: false },
        { contexts: [], strict: true },
      ],
    });

    expect(await settingsRequiredChecks({ cwd, options: { repository: REPOSITORY }, github: client })).toEqual([]);
  });

  it('reports a branch with no rule requiring checks', async () => {
    const { client } = clientOf(REBASE_ONLY, NO_RULES);

    expect((await settingsRequiredChecks({ cwd, options: { repository: REPOSITORY }, github: client })).map((violation) => violation.code)).toEqual(['settings-required-checks/no-required-checks']);
  });

  it('reports workflows with no junction job, and names the check by the job id when it has no name', async () => {
    const { client } = clientOf(REBASE_ONLY, { ...NO_RULES, requiredStatusChecks: [{ contexts: ['required-checks'], strict: true }] });

    expect((await settingsRequiredChecks({ cwd: fixturePath('workflows', 'settings-required-checks', 'no-junction'), options: { repository: REPOSITORY }, github: client })).map((violation) => violation.code)).toEqual([
      'settings-required-checks/no-junction-job',
    ]);
    expect(await settingsRequiredChecks({ cwd, options: { repository: REPOSITORY, junctionJobs: ['test'] }, github: clientOf(REBASE_ONLY, { ...NO_RULES, requiredStatusChecks: [{ contexts: ['test'], strict: true }] }).client })).toEqual([]);
  });
});

describe('settings-review-thread-resolution', () => {
  it('accepts a branch whose pull request rule requires conversations to be resolved', async () => {
    const { client } = clientOf(REBASE_ONLY, { ...NO_RULES, pullRequests: [{ requiredReviewThreadResolution: true, allowedMergeMethods: undefined }] });

    expect(await settingsReviewThreadResolution({ cwd: '.', options: { repository: REPOSITORY }, github: client })).toEqual([]);
  });

  it('reports a branch with no pull request rule, and one that does not require it', async () => {
    const none = clientOf(REBASE_ONLY, NO_RULES);
    const lax = clientOf(REBASE_ONLY, { ...NO_RULES, pullRequests: [{ requiredReviewThreadResolution: false, allowedMergeMethods: undefined }] });
    const expected = [
      {
        code: 'settings-review-thread-resolution/not-required',
        message: `no rule requires review conversations to be resolved before merging on the branch of ${REPOSITORY}`,
        file: REPOSITORY,
      },
    ];

    expect(await settingsReviewThreadResolution({ cwd: '.', options: { repository: REPOSITORY }, github: none.client })).toEqual(expected);
    expect(await settingsReviewThreadResolution({ cwd: '.', options: { repository: REPOSITORY }, github: lax.client })).toEqual(expected);
  });
});

describe('the repository a settings check reads', () => {
  it('is the origin remote of the working directory when the options do not name one', async () => {
    const cwd = await createGitWorkspace({ 'README.md': '# x\n' });
    const { client, requests } = clientOf(REBASE_ONLY, NO_RULES);

    await expect(settingsReviewThreadResolution({ cwd, options: {}, github: client })).rejects.toThrow(/has no 'origin' remote on github\.com/u);

    addRemote(cwd, 'origin', 'git@github.com:example-org/example-repo.git');
    await settingsReviewThreadResolution({ cwd, options: {}, github: client });

    expect(requests.repositories()).toEqual([SLUG]);
  });

  it('is read from an https remote too, and an option that is not owner/name fails', async () => {
    const cwd = await createGitWorkspace({ 'README.md': '# x\n' });
    const { client, requests } = clientOf(REBASE_ONLY, NO_RULES);
    addRemote(cwd, 'origin', 'https://github.com/example-org/example-repo');

    await settingsReviewThreadResolution({ cwd, options: {}, github: client });

    expect(requests.repositories()).toEqual([SLUG]);
    await expect(settingsReviewThreadResolution({ cwd, options: { repository: 'example' }, github: client })).rejects.toThrow(/not written owner\/name/u);
  });
});

describe('a repository whose plan has no rulesets', () => {
  const PLAN_LIMIT = 'Upgrade to GitHub Pro or make this repository public to enable this feature.';

  function planLimited(settings: RepositorySettings): GitHubClient {
    return { repository: vi.fn<GitHubClient['repository']>().mockResolvedValue(settings), branchRules: vi.fn<GitHubClient['branchRules']>().mockRejectedValue(new RulesetsUnavailableError(PLAN_LIMIT)) };
  }

  it('reports that settings-required-checks cannot apply, with GitHub\'s message, instead of failing the run', async () => {
    const violations = await settingsRequiredChecks({ cwd: fixturePath('workflows', 'settings-required-checks', 'with-junction'), options: { repository: REPOSITORY }, github: planLimited(REBASE_ONLY) });

    expect(violations).toEqual([
      {
        code: 'settings-required-checks/rules-unavailable',
        message: `the branch rules of ${REPOSITORY} cannot be read or enforced on its plan, so a status check cannot be required (GitHub: ${PLAN_LIMIT})`,
        file: REPOSITORY,
      },
    ]);
  });

  it('reports that settings-review-thread-resolution cannot apply, with GitHub\'s message', async () => {
    const violations = await settingsReviewThreadResolution({ cwd: '.', options: { repository: REPOSITORY }, github: planLimited(REBASE_ONLY) });

    expect(violations).toEqual([
      {
        code: 'settings-review-thread-resolution/rules-unavailable',
        message: `the branch rules of ${REPOSITORY} cannot be read or enforced on its plan, so resolving review conversations cannot be required (GitHub: ${PLAN_LIMIT})`,
        file: REPOSITORY,
      },
    ]);
  });

  it('judges settings-merge-methods by the repository settings alone, since no rule applies to the branch', async () => {
    expect(await settingsMergeMethods({ cwd: '.', options: { repository: REPOSITORY }, github: planLimited(REBASE_ONLY) })).toEqual([]);
    expect(await settingsMergeMethods({ cwd: '.', options: { repository: REPOSITORY }, github: planLimited({ ...REBASE_ONLY, allowSquashMerge: true }) })).toEqual([
      { code: 'settings-merge-methods/method-enabled', message: `${REPOSITORY} allows squash merges; only rebase should be allowed`, file: REPOSITORY },
    ]);
  });

  it('still fails the run on any other refusal', async () => {
    const github: GitHubClient = { repository: vi.fn<GitHubClient['repository']>().mockResolvedValue(REBASE_ONLY), branchRules: vi.fn<GitHubClient['branchRules']>().mockRejectedValue(new Error('GET failed: 403 Forbidden: Resource not accessible by personal access token')) };

    await expect(settingsReviewThreadResolution({ cwd: '.', options: { repository: REPOSITORY }, github })).rejects.toThrow('Resource not accessible');
  });
});
