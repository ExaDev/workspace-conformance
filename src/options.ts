import type { DeployToolName, GeneratorName } from './migrations/adapters';
import type { WorkflowSelection } from './workflows/load';

/**
 * Options of the `aggregate-mappers` check: every aggregate type a contract exports has a mapper file in the place the template names.
 */
export interface AggregateMappersOptions {
  /**
   * Globs of the contract files, relative to the directory the checks run in. Every exported interface and type alias in them is an aggregate.
   */
  readonly contracts: readonly string[];
  /**
   * Where the mapper of an aggregate lives. Placeholders: `{name}` (the aggregate's name), `{dir}` (the contract file's directory), `{file}` (the contract file) and, when `adapters` is set, `{adapter}` (one matched adapter directory). Relative to the directory the checks run in; `..` segments are resolved.
   */
  readonly mapper: string;
  /**
   * A glob template for the adapter directories, with the same `{dir}` and `{file}` placeholders. When set, every aggregate needs a mapper in every matched adapter, and a template that matches no directory is itself a violation.
   */
  readonly adapters?: string;
  /**
   * Names of exported types that are not aggregates and need no mapper.
   */
  readonly exclude?: readonly string[];
  /**
   * The tsconfig that supplies compiler options and module resolution, relative to the directory the checks run in; `tsconfig.json` when omitted. Its `include` is not used: only the contract files and what they import are loaded.
   */
  readonly tsConfig?: string;
}

/**
 * Options of the `command-types` check: every command type a file exports is derived from a schema.
 */
export interface CommandTypesOptions {
  /**
   * Globs of the files that declare commands, relative to the directory the checks run in. Every exported interface and type alias in them is a command.
   */
  readonly commands: readonly string[];
  /**
   * Names of exported types that are not commands, such as a union of all of them.
   */
  readonly exclude?: readonly string[];
  /**
   * The last name of the generic that turns a schema into its type, such as `infer` in `z.infer<typeof schema>`. `infer`, `input`, `output`, `TypeOf`, `InferInput` and `InferOutput` when omitted.
   */
  readonly inferences?: readonly string[];
  /**
   * The tsconfig that supplies compiler options and module resolution; `tsconfig.json` when omitted.
   */
  readonly tsConfig?: string;
}

/**
 * A set of schema files and the files whose exported types must be derived from those schemas.
 */
export interface DerivedTypesPair {
  /**
   * Globs of the files that declare the schemas, relative to the directory the checks run in.
   */
  readonly schemas: readonly string[];
  /**
   * Globs of the files whose exported interfaces and type aliases must be derived from a schema declared in `schemas`.
   */
  readonly types: readonly string[];
}

/**
 * Options of the `derived-types` check: every type a file exports is derived from a schema of its pair.
 */
export interface DerivedTypesOptions {
  /**
   * The schema files and the type files that must derive from them. Each type file is judged against the schemas of every pair that lists it.
   */
  readonly pairs: readonly DerivedTypesPair[];
  /**
   * Names of exported types that are deliberately written by hand.
   */
  readonly exclude?: readonly string[];
  /**
   * The last names of the generics that turn a schema into its type, and of the members that hold it, such as `infer` in `z.infer<typeof schema>` and `$inferSelect` in `typeof table.$inferSelect`. `infer`, `input`, `output`, `TypeOf`, `InferInput`, `InferOutput`, `InferSelectModel`, `InferInsertModel`, `$inferSelect` and `$inferInsert` when omitted.
   */
  readonly inferences?: readonly string[];
  /**
   * The tsconfig that supplies compiler options and module resolution; `tsconfig.json` when omitted.
   */
  readonly tsConfig?: string;
}

/**
 * Options shared by the checks that cruise the workspace's import graph.
 */
export interface ImportGraphOptions {
  /**
   * Regular expressions, as source text, for paths relative to the workspace root that are left out of the graph. Anything matching one is neither a dependant nor a dependency. Installed dependencies (`node_modules`) when omitted.
   */
  readonly exclude?: readonly string[];
  /**
   * Regular expressions, as source text, for paths relative to the workspace root whose files can be imported but whose own imports are not followed, so build output is a target of imports and never a dependant. `dist` directories when omitted.
   */
  readonly doNotFollow?: readonly string[];
  /**
   * A tsconfig, relative to the directory the checks run in, for path aliases and other module resolution the imports depend on.
   */
  readonly tsConfig?: string;
}

/**
 * Options of the `instruction-symlinks` check: agent instruction files are git symlinks to the README next to them.
 */
export interface InstructionSymlinksOptions {
  /**
   * The instruction file names. `AGENTS.md` and `CLAUDE.md` when omitted.
   */
  readonly files?: readonly string[];
  /**
   * Globs of the directories that hold them, relative to the directory the checks run in. The directory itself (`.`) when omitted.
   */
  readonly directories?: readonly string[];
  /**
   * What each file links to, relative to the file. `README.md` when omitted.
   */
  readonly target?: string;
}

/**
 * Options of the `single-storybook` check.
 */
export interface SingleStorybookOptions {
  /**
   * The only directory that may hold a `.storybook` directory, relative to the directory the checks run in. The directory itself (`.`) when omitted.
   */
  readonly location?: string;
  /**
   * Globs of paths that are not searched, such as directories of test fixtures that hold a Storybook on purpose.
   */
  readonly exclude?: readonly string[];
}

/**
 * Options of the `commit-types` check: the commit types commitlint accepts match the release rules and changelog sections of the release config.
 */
export interface CommitTypesOptions {
  /**
   * The commitlint config file, relative to the directory the checks run in. `commitlint.config.ts` when omitted.
   */
  readonly commitlint?: string;
  /**
   * The semantic-release config file. `release.config.ts` when omitted.
   */
  readonly release?: string;
}

/**
 * Options of the `dockerfile-package-manager` check: a package manager version pinned in a Dockerfile is the one `packageManager` names.
 */
export interface DockerfilePackageManagerOptions {
  /**
   * Globs of the Dockerfiles, relative to the directory the checks run in. `Dockerfile`, `Dockerfile.*` and `*.Dockerfile` at any depth when omitted.
   */
  readonly dockerfiles?: readonly string[];
  /**
   * Globs of paths that are not searched, such as directories of test fixtures.
   */
  readonly exclude?: readonly string[];
  /**
   * The package.json that holds the `packageManager` field. `package.json` when omitted.
   */
  readonly packageJson?: string;
}

/**
 * The severity a rule must have at least: `warn` is met by `warn` or `error`, `error` only by `error`.
 */
export type EslintRequiredSeverity = 'warn' | 'error';

/**
 * A file whose resolved ESLint configuration is checked.
 */
export interface EslintSample {
  /**
   * The file ESLint would lint, relative to the directory the checks run in. It need not exist: ESLint resolves a file's configuration from its path alone.
   */
  readonly path: string;
  /**
   * Rules required for this file on top of the check's `rules`, which this file's entries override.
   */
  readonly rules?: Readonly<Record<string, EslintRequiredSeverity>>;
}

/**
 * Options of the `eslint` check: the repository's own ESLint, resolved from the directory the checks run in, lints the sample files with the required rules.
 */
export interface EslintOptions {
  /**
   * One file per kind of source the repository lints (`src/index.ts`, `package.json`, `eslint.config.ts`). A bare string is `{ path }`. Each must be linted: not ignored, and matched by a configuration block.
   */
  readonly samples: readonly (string | EslintSample)[];
  /**
   * Rules required for every sample, with the severity each must have at least.
   */
  readonly rules?: Readonly<Record<string, EslintRequiredSeverity>>;
  /**
   * The config file under test, relative to the directory the checks run in, instead of the one ESLint finds from there.
   */
  readonly configFile?: string;
  /**
   * Also lint the workspace and report every message ESLint produces. Off when omitted: the default level lints nothing and only reads resolved configuration.
   */
  readonly lint?: boolean;
  /**
   * What the full level lints, as file and directory patterns relative to the directory the checks run in. `.` when omitted. Used only with `lint`.
   */
  readonly lintPatterns?: readonly string[];
}

/**
 * Options of the `migrations-directory` check: the directory a schema generator writes migrations to is the one the deploy tool applies them from, and no script applies them with the generator.
 */
export interface MigrationsDirectoryOptions {
  /**
   * The schema generator, which has an adapter that knows its config file and where in it the output directory is.
   */
  readonly generator: GeneratorName;
  /**
   * The deploy tool, which has an adapter that knows its config file and where in it the migrations directory is.
   */
  readonly deployTool: DeployToolName;
  /**
   * The generator's config file, relative to the directory the checks run in. The first of the adapter's default file names that exists when omitted.
   */
  readonly generatorConfig?: string;
  /**
   * The deploy tool's config file. The first of the adapter's default file names that exists when omitted.
   */
  readonly deployConfig?: string;
  /**
   * The binding of the database the generator writes migrations for. Needed when the deploy config declares more than one; the only one is used when omitted.
   */
  readonly database?: string;
  /**
   * The named environment of the deploy config to read instead of its top-level settings.
   */
  readonly environment?: string;
  /**
   * Globs of the `package.json` files whose scripts are searched for the generator's apply command. Every `package.json` at any depth when omitted.
   */
  readonly packageJsons?: readonly string[];
}

/**
 * Options of the `workflow-job-ordering` check: the jobs that release, deploy and report a required check are ordered so a failure stops what follows. Jobs are named by id; a role whose jobs are absent from a workflow is not judged there.
 */
export interface WorkflowJobOrderingOptions extends WorkflowSelection {
  /**
   * Ids of release jobs, which must wait for every deploy job. `release` when omitted.
   */
  readonly releaseJobs?: readonly string[];
  /**
   * Ids of deploy jobs. `deploy` when omitted.
   */
  readonly deployJobs?: readonly string[];
  /**
   * Ids of jobs that deploy documentation, which must wait for every release job and check out the default branch afresh. `docs-deploy` when omitted.
   */
  readonly docsDeployJobs?: readonly string[];
  /**
   * Ids of junction jobs: the one job that reports a single required check for the whole workflow. `required-checks` when omitted.
   */
  readonly junctionJobs?: readonly string[];
  /**
   * Ids of jobs a junction job need not wait for, such as a release job that only runs after the junction's own checks or a job that runs on demand only.
   */
  readonly junctionExempt?: readonly string[];
  /**
   * The default branch a documentation job must check out when it names a branch literally. `main` when omitted. The `github.event.repository.default_branch` expression is always accepted.
   */
  readonly defaultBranch?: string;
}

/**
 * Options of the `workflow-skippable-jobs` check: a path filter must not leave a required check pending or skip a job without a junction job to report for it.
 */
export interface WorkflowSkippableJobsOptions extends WorkflowSelection {
  /**
   * Ids of junction jobs. `required-checks` when omitted.
   */
  readonly junctionJobs?: readonly string[];
  /**
   * The actions whose outputs say which paths changed, as `owner/repository`. `dorny/paths-filter`, `tj-actions/changed-files` and `step-security/changed-files` when omitted.
   */
  readonly pathFilterActions?: readonly string[];
}

/**
 * Options of the `workflow-runner-resolution` check: a self-hosted or custom runner label is resolved once and read, not repeated.
 */
export interface WorkflowRunnerResolutionOptions extends WorkflowSelection {
  /**
   * Regular expressions, as source text, for the labels GitHub hosts itself and that may be repeated freely. `ubuntu`, `windows` and `macos` images, `-latest`, versioned, `-arm`, `-intel`, `-xlarge`, `-large` and `-slim` forms, when omitted. Setting it replaces that default.
   */
  readonly hostedLabels?: readonly string[];
}

/**
 * Options of the `workflow-version-single-source` check.
 */
export type WorkflowVersionSingleSourceOptions = WorkflowSelection;

/**
 * Options of the `workflow-credentials` check.
 */
export type WorkflowCredentialsOptions = WorkflowSelection;

/**
 * Options of the `workflow-repository-dispatch` check: what a handler of `repository_dispatch` may do.
 */
export interface WorkflowRepositoryDispatchOptions extends WorkflowSelection {
  /**
   * Branch names that count as the default branch when a push names one literally. `main` and `master` when omitted. The `github.event.repository.default_branch` expression always counts.
   */
  readonly defaultBranches?: readonly string[];
  /**
   * Set when the repository has a rule requiring status checks on the default branch, which is what makes `gh pr merge --auto` wait. The file cannot show it, so by default an auto merge in a handler is reported; the `settings-required-checks` check verifies the rule itself.
   */
  readonly assumeRequiredChecks?: boolean;
}

/**
 * Options of the `workflow-update-bot-cooldown` check: the update bots wait before proposing a release.
 */
export interface WorkflowUpdateBotCooldownOptions {
  /**
   * The Dependabot config, relative to the directory the checks run in. `.github/dependabot.yml`, else `.github/dependabot.yaml`, when omitted.
   */
  readonly dependabot?: string;
  /**
   * The Renovate config. `renovate.json`, `.renovaterc.json`, `.renovaterc` and `.github/renovate.json`, the first that exists, when omitted.
   */
  readonly renovate?: string;
}

/**
 * Options of the `workflow-merge-group` check.
 */
export type WorkflowMergeGroupOptions = WorkflowSelection;

/**
 * How strictly a reference must be pinned: to a full commit SHA, or any ref (tag, branch or SHA).
 */
export type PinningLevel = 'sha' | 'ref';

/**
 * Options of the `workflow-action-pinning` check: the pinning policy for what workflows `uses`.
 */
export interface WorkflowActionPinningOptions extends WorkflowSelection {
  /**
   * What an action or reusable workflow from outside `organisations` must be pinned to. `sha` when omitted.
   */
  readonly thirdParty?: PinningLevel;
  /**
   * What an action or reusable workflow owned by one of `organisations` must be pinned to. `ref` when omitted.
   */
  readonly sameOrganisation?: PinningLevel;
  /**
   * The owners (users or organisations) that count as the same organisation. None when omitted, so nothing is relaxed unless it is named.
   */
  readonly organisations?: readonly string[];
  /**
   * Repositories exempt from the policy, as `owner/repository` or `owner/*`.
   */
  readonly allow?: readonly string[];
}

/**
 * What the settings checks need to find the repository.
 */
export interface SettingsOptions {
  /**
   * The repository as `owner/name`. The `origin` remote of the working directory when omitted.
   */
  readonly repository?: string;
  /**
   * The branch whose rules are read. The repository's default branch when omitted.
   */
  readonly branch?: string;
}

/**
 * Options of the `settings-merge-methods` check.
 */
export interface SettingsMergeMethodsOptions extends SettingsOptions {
  /**
   * The only merge method the repository allows. `rebase` when omitted.
   */
  readonly allowed?: 'rebase' | 'squash' | 'merge';
}

/**
 * Options of the `settings-required-checks` check.
 */
export interface SettingsRequiredChecksOptions extends SettingsOptions, WorkflowSelection {
  /**
   * Ids of the junction jobs whose check names must be required. `required-checks` when omitted.
   */
  readonly junctionJobs?: readonly string[];
}

/**
 * Options of the `settings-review-thread-resolution` check.
 */
export type SettingsReviewThreadResolutionOptions = SettingsOptions;

/**
 * The options of every check, by check name.
 */
export interface CheckOptionsByName {
  readonly 'aggregate-mappers': AggregateMappersOptions;
  readonly 'command-types': CommandTypesOptions;
  readonly 'derived-types': DerivedTypesOptions;
  readonly 'import-uphill': ImportGraphOptions;
  readonly 'import-rank-skip': ImportGraphOptions;
  readonly 'import-cross-slice': ImportGraphOptions;
  readonly 'import-isolated-groups': ImportGraphOptions;
  readonly 'import-cycles': ImportGraphOptions;
  readonly 'instruction-symlinks': InstructionSymlinksOptions;
  readonly 'single-storybook': SingleStorybookOptions;
  readonly 'commit-types': CommitTypesOptions;
  readonly 'dockerfile-package-manager': DockerfilePackageManagerOptions;
  readonly 'migrations-directory': MigrationsDirectoryOptions;
  readonly eslint: EslintOptions;
  readonly 'workflow-job-ordering': WorkflowJobOrderingOptions;
  readonly 'workflow-skippable-jobs': WorkflowSkippableJobsOptions;
  readonly 'workflow-runner-resolution': WorkflowRunnerResolutionOptions;
  readonly 'workflow-version-single-source': WorkflowVersionSingleSourceOptions;
  readonly 'workflow-credentials': WorkflowCredentialsOptions;
  readonly 'workflow-repository-dispatch': WorkflowRepositoryDispatchOptions;
  readonly 'workflow-update-bot-cooldown': WorkflowUpdateBotCooldownOptions;
  readonly 'workflow-merge-group': WorkflowMergeGroupOptions;
  readonly 'workflow-action-pinning': WorkflowActionPinningOptions;
  readonly 'settings-merge-methods': SettingsMergeMethodsOptions;
  readonly 'settings-required-checks': SettingsRequiredChecksOptions;
  readonly 'settings-review-thread-resolution': SettingsReviewThreadResolutionOptions;
}

/**
 * The name of a check.
 */
export type CheckName = keyof CheckOptionsByName;
