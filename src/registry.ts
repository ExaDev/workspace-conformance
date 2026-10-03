import type { ConfigFileOptions, LayoutConfig } from '@exadev/config';

import type { CheckFunction, GitHubCheckFunction, Violation } from './check';
import { aggregateMappers } from './checks/aggregate-mappers';
import { commandTypes } from './checks/command-types';
import { commitTypes } from './checks/commit-types';
import { derivedTypes } from './checks/derived-types';
import { dockerfilePackageManager } from './checks/dockerfile-package-manager';
import { settingsMergeMethods } from './checks/settings-merge-methods';
import { settingsRequiredChecks } from './checks/settings-required-checks';
import { settingsReviewThreadResolution } from './checks/settings-review-thread-resolution';
import { workflowActionPinning } from './checks/workflow-action-pinning';
import { workflowCredentials } from './checks/workflow-credentials';
import { workflowJobOrdering } from './checks/workflow-job-ordering';
import { workflowMergeGroup } from './checks/workflow-merge-group';
import { workflowRepositoryDispatch } from './checks/workflow-repository-dispatch';
import { workflowRunnerResolution } from './checks/workflow-runner-resolution';
import { workflowSkippableJobs } from './checks/workflow-skippable-jobs';
import { workflowUpdateBotCooldown } from './checks/workflow-update-bot-cooldown';
import { workflowVersionSingleSource } from './checks/workflow-version-single-source';
import { importCrossSliceSpec } from './checks/import-cross-slice';
import { importCyclesSpec } from './checks/import-cycles';
import type { ImportCheckSpec } from './checks/import-graph';
import { importIsolatedGroupsSpec } from './checks/import-isolated-groups';
import { importRankSkipSpec } from './checks/import-rank-skip';
import { importUphillSpec } from './checks/import-uphill';
import { eslint } from './checks/eslint';
import { instructionSymlinks } from './checks/instruction-symlinks';
import { migrationsDirectory } from './checks/migrations-directory';
import { singleStorybook } from './checks/single-storybook';
import type { ChecksConfig } from './config';
import { ConformanceError } from './errors';
import type { GitHubClient } from './github';
import type { CheckName, ImportGraphOptions } from './options';

/**
 * What a check needs to run once the configuration is loaded.
 */
export interface RunInput {
  readonly cwd: string;
  readonly checks: ChecksConfig;
  readonly layout: LayoutConfig | undefined;
  readonly configFiles: ConfigFileOptions | undefined;
  /**
   * The client the settings checks read through; `undefined` when the run is offline.
   */
  readonly github: GitHubClient | undefined;
}

/**
 * What every registered check has, whichever way it runs.
 */
interface RegisteredCheckBase<Name extends CheckName> {
  readonly name: Name;
  readonly description: string;
  /**
   * Whether the check reads the workspace layout, and so needs the `layout` section.
   */
  readonly requiresLayout: boolean;
  /**
   * Whether the check reads the repository's settings through the GitHub API, and so runs only when the run is given a client.
   */
  readonly requiresGitHub: boolean;
  /**
   * Whether the `checks` map turns this check on.
   */
  readonly isEnabled: (checks: ChecksConfig) => boolean;
}

/**
 * A check that runs on its own.
 */
export interface StandaloneCheck<Name extends CheckName> extends RegisteredCheckBase<Name> {
  readonly run: (input: RunInput) => Promise<readonly Violation[]>;
}

/**
 * An import check. It has no `run` of its own: it always joins a cruise shared with the other import checks of the run, so there is one path from the registry to dependency-cruiser.
 */
export interface ImportGraphCheck<Name extends CheckName> extends RegisteredCheckBase<Name> {
  readonly importGraph: {
    readonly spec: ImportCheckSpec;
    readonly optionsOf: (checks: ChecksConfig) => ImportGraphOptions | undefined;
  };
}

/**
 * A check bound to its place in the `checks` map.
 */
export type RegisteredCheck<Name extends CheckName> = StandaloneCheck<Name> | ImportGraphCheck<Name>;

/**
 * The options of an enabled check, or `undefined` when the setting is absent or `false`.
 */
function enabledOptions<Options>(setting: false | Options | undefined): Options | undefined {
  return setting === false ? undefined : setting;
}

function plain<Name extends CheckName, Options>(spec: {
  readonly name: Name;
  readonly description: string;
  readonly select: (checks: ChecksConfig) => Options | undefined;
  readonly check: CheckFunction<Options>;
}): StandaloneCheck<Name> {
  return {
    name: spec.name,
    description: spec.description,
    requiresLayout: false,
    requiresGitHub: false,
    isEnabled: (checks) => spec.select(checks) !== undefined,
    run: async ({ cwd, checks, configFiles }) => {
      const options = spec.select(checks);
      if (options === undefined) {
        throw new ConformanceError(`the check '${spec.name}' is not enabled`);
      }

      return spec.check({ cwd, options, ...(configFiles === undefined ? {} : { configFiles }) });
    },
  };
}

function online<Name extends CheckName, Options>(spec: {
  readonly name: Name;
  readonly description: string;
  readonly select: (checks: ChecksConfig) => Options | undefined;
  readonly check: GitHubCheckFunction<Options>;
}): StandaloneCheck<Name> {
  return {
    name: spec.name,
    description: spec.description,
    requiresLayout: false,
    requiresGitHub: true,
    isEnabled: (checks) => spec.select(checks) !== undefined,
    run: async ({ cwd, checks, configFiles, github }) => {
      const options = spec.select(checks);
      if (options === undefined) {
        throw new ConformanceError(`the check '${spec.name}' is not enabled`);
      }
      if (github === undefined) {
        throw new ConformanceError(`the check '${spec.name}' reads the repository's settings and needs a GitHub client`);
      }

      return spec.check({ cwd, options, github, ...(configFiles === undefined ? {} : { configFiles }) });
    },
  };
}

function importCheck<Name extends CheckName>(spec: {
  readonly name: Name;
  readonly description: string;
  readonly select: (checks: ChecksConfig) => ImportGraphOptions | undefined;
  readonly importSpec: ImportCheckSpec;
}): ImportGraphCheck<Name> {
  return {
    name: spec.name,
    description: spec.description,
    requiresLayout: true,
    requiresGitHub: false,
    isEnabled: (checks) => spec.select(checks) !== undefined,
    importGraph: { spec: spec.importSpec, optionsOf: spec.select },
  };
}

/**
 * Every check, by name, in the order they run. The key is the name used in the `checks` map, on the command line and in violation codes.
 */
export const registry: { readonly [Name in CheckName]: RegisteredCheck<Name> } = {
  'aggregate-mappers': plain({
    name: 'aggregate-mappers',
    description: 'Every exported aggregate type in a contract file has a mapper file where the template puts it',
    select: (checks) => enabledOptions(checks['aggregate-mappers']),
    check: aggregateMappers,
  }),
  'command-types': plain({
    name: 'command-types',
    description: 'Every exported command type is derived from a schema, not hand-written',
    select: (checks) => enabledOptions(checks['command-types']),
    check: commandTypes,
  }),
  'derived-types': plain({
    name: 'derived-types',
    description: 'Every exported type in a file paired with schema files is derived from one of those schemas, not hand-written',
    select: (checks) => enabledOptions(checks['derived-types']),
    check: derivedTypes,
  }),
  'import-uphill': importCheck({
    name: 'import-uphill',
    description: 'No package imports a package of a higher rank',
    select: (checks) => enabledOptions(checks['import-uphill']),
    importSpec: importUphillSpec,
  }),
  'import-rank-skip': importCheck({
    name: 'import-rank-skip',
    description: 'No package imports further below itself than the layout allows',
    select: (checks) => enabledOptions(checks['import-rank-skip']),
    importSpec: importRankSkipSpec,
  }),
  'import-cross-slice': importCheck({
    name: 'import-cross-slice',
    description: 'No package imports a package in a different slice',
    select: (checks) => enabledOptions(checks['import-cross-slice']),
    importSpec: importCrossSliceSpec,
  }),
  'import-isolated-groups': importCheck({
    name: 'import-isolated-groups',
    description: 'No package imports a package in a group the layout isolates from its own',
    select: (checks) => enabledOptions(checks['import-isolated-groups']),
    importSpec: importIsolatedGroupsSpec,
  }),
  'import-cycles': importCheck({
    name: 'import-cycles',
    description: 'No files of the workspace packages import each other in a cycle',
    select: (checks) => enabledOptions(checks['import-cycles']),
    importSpec: importCyclesSpec,
  }),
  'instruction-symlinks': plain({
    name: 'instruction-symlinks',
    description: 'Agent instruction files are git symlinks to the README beside them',
    select: (checks) => enabledOptions(checks['instruction-symlinks']),
    check: instructionSymlinks,
  }),
  'single-storybook': plain({
    name: 'single-storybook',
    description: 'At most one Storybook exists, at the workspace root, and none inside a package',
    select: (checks) => enabledOptions(checks['single-storybook']),
    check: singleStorybook,
  }),
  'commit-types': plain({
    name: 'commit-types',
    description: 'The commit types commitlint accepts match the release rules and changelog sections',
    select: (checks) => enabledOptions(checks['commit-types']),
    check: commitTypes,
  }),
  'dockerfile-package-manager': plain({
    name: 'dockerfile-package-manager',
    description: 'A package manager version pinned in a Dockerfile is the version packageManager names',
    select: (checks) => enabledOptions(checks['dockerfile-package-manager']),
    check: dockerfilePackageManager,
  }),
  'migrations-directory': plain({
    name: 'migrations-directory',
    description: "The directory a schema generator writes migrations to is the one the deploy tool applies them from, and no script applies them with the generator",
    select: (checks) => enabledOptions(checks['migrations-directory']),
    check: migrationsDirectory,
  }),
  eslint: plain({
    name: 'eslint',
    description: "The repository's own ESLint lints the sample files with the required rules enabled at the required severity",
    select: (checks) => enabledOptions(checks.eslint),
    check: eslint,
  }),
  'workflow-job-ordering': plain({
    name: 'workflow-job-ordering',
    description: 'Release, deploy and junction jobs are ordered so a failure stops what follows',
    select: (checks) => enabledOptions(checks['workflow-job-ordering']),
    check: workflowJobOrdering,
  }),
  'workflow-skippable-jobs': plain({
    name: 'workflow-skippable-jobs',
    description: 'A path filter does not leave a required check pending or skip a job no junction job reports for',
    select: (checks) => enabledOptions(checks['workflow-skippable-jobs']),
    check: workflowSkippableJobs,
  }),
  'workflow-runner-resolution': plain({
    name: 'workflow-runner-resolution',
    description: 'A self-hosted or custom runner label is resolved once by a resolver job, not repeated in several jobs',
    select: (checks) => enabledOptions(checks['workflow-runner-resolution']),
    check: workflowRunnerResolution,
  }),
  'workflow-version-single-source': plain({
    name: 'workflow-version-single-source',
    description: 'Setup steps read a runtime version from .nvmrc or .tool-versions instead of holding a literal',
    select: (checks) => enabledOptions(checks['workflow-version-single-source']),
    check: workflowVersionSingleSource,
  }),
  'workflow-credentials': plain({
    name: 'workflow-credentials',
    description: 'Attestation steps have the permissions they need, and a tokenless publish cannot quietly use a token',
    select: (checks) => enabledOptions(checks['workflow-credentials']),
    check: workflowCredentials,
  }),
  'workflow-repository-dispatch': plain({
    name: 'workflow-repository-dispatch',
    description: 'A repository_dispatch handler does not push to the default branch, auto-merge unguarded, or rely on the default token',
    select: (checks) => enabledOptions(checks['workflow-repository-dispatch']),
    check: workflowRepositoryDispatch,
  }),
  'workflow-update-bot-cooldown': plain({
    name: 'workflow-update-bot-cooldown',
    description: 'Dependabot and Renovate wait before proposing a new release',
    select: (checks) => enabledOptions(checks['workflow-update-bot-cooldown']),
    check: workflowUpdateBotCooldown,
  }),
  'workflow-merge-group': plain({
    name: 'workflow-merge-group',
    description: 'A workflow that runs for pull requests also runs for the merge queue',
    select: (checks) => enabledOptions(checks['workflow-merge-group']),
    check: workflowMergeGroup,
  }),
  'workflow-action-pinning': plain({
    name: 'workflow-action-pinning',
    description: 'Actions and reusable workflows are pinned as the configured policy requires',
    select: (checks) => enabledOptions(checks['workflow-action-pinning']),
    check: workflowActionPinning,
  }),
  'settings-merge-methods': online({
    name: 'settings-merge-methods',
    description: 'The repository allows only one merge method',
    select: (checks) => enabledOptions(checks['settings-merge-methods']),
    check: settingsMergeMethods,
  }),
  'settings-required-checks': online({
    name: 'settings-required-checks',
    description: 'The default branch requires the junction job check, up to date with the base',
    select: (checks) => enabledOptions(checks['settings-required-checks']),
    check: settingsRequiredChecks,
  }),
  'settings-review-thread-resolution': online({
    name: 'settings-review-thread-resolution',
    description: 'A pull request cannot merge while a review conversation is unresolved',
    select: (checks) => enabledOptions(checks['settings-review-thread-resolution']),
    check: settingsReviewThreadResolution,
  }),
};

/**
 * The names of all checks, in the order they run.
 */
export const checkNames: readonly CheckName[] = Object.keys(registry).filter(isCheckName);

/**
 * Whether `name` is the name of a check.
 */
export function isCheckName(name: string): name is CheckName {
  return Object.hasOwn(registry, name);
}
