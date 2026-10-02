import type { Options } from 'semantic-release';

type ReleaseLevel = 'major' | 'minor' | 'patch' | false;

interface CommitType {
  readonly type: string;
  readonly release: ReleaseLevel;
}

/**
 * Single source of truth for the conventional-commit types this project uses. commitlint's allowed type-enum (commitlint.config.ts imports this) and commit-analyzer's releaseRules below both derive from it, so a type cannot trigger a release without also being accepted by commit-msg validation, or the reverse.
 */
export const commitTypes: readonly CommitType[] = [
  { type: 'feat', release: 'minor' },
  { type: 'fix', release: 'patch' },
  { type: 'perf', release: 'patch' },
  { type: 'revert', release: 'patch' },
  { type: 'refactor', release: 'patch' },
  { type: 'docs', release: 'patch' },
  { type: 'style', release: 'patch' },
  { type: 'test', release: 'patch' },
  { type: 'build', release: 'patch' },
  { type: 'ci', release: 'patch' },
  { type: 'chore', release: 'patch' },
];

/**
 * Runs on `main`. Analyses commits since the last tag, bumps the version, publishes to npmjs.org through trusted OIDC publishing (no stored token, see .github/workflows/ci.yml), creates a versioned tag and GitHub Release with generated notes, and commits CHANGELOG.md and package.json back to main.
 */
const config: Options = {
  branches: ['main'],
  // Deliberately the SSH form, not package.json's own git+https:// repository field (that field stays https://; it is public consumer-facing metadata, unrelated to how this release pushes). semantic-release pushes to repositoryUrl as written when a dry-run push succeeds, and otherwise rewrites it to https with the GITHUB_TOKEN embedded. With an https URL, or with the SSH key missing, the push therefore uses the default token, which cannot bypass main's branch ruleset and is rejected. With the SSH form the dry-run authenticates with the deploy key the Release job's checkout wires into core.sshCommand (checkout@v7 writes that config only while persist-credentials is true; see .github/workflows/ci.yml), which the ruleset lists as a DeployKey bypass actor.
  repositoryUrl: 'git@github.com:ExaDev/workspace-conformance.git',
  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
        releaseRules: [{ breaking: true, release: 'major' }, ...commitTypes.map((t) => ({ type: t.type, release: t.release }))],
      },
    ],
    [
      '@semantic-release/release-notes-generator',
      {
        // Deliberately angular, not conventionalcommits: conventional-changelog-writer's bundled commit partial does not match the conventionalcommits preset's function-based partial signature, producing a changelog with a version header and nothing under it.
        preset: 'angular',
      },
    ],
    '@semantic-release/changelog',
    ['@semantic-release/npm', { npmPublish: true }],
    '@semantic-release/github',
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json'],
        message: 'chore(release): ${nextRelease.version} [skip ci]',
      },
    ],
  ],
};

export default config;
