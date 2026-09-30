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
 * The options of every check, by check name.
 */
export interface CheckOptionsByName {
  readonly 'aggregate-mappers': AggregateMappersOptions;
  readonly 'command-types': CommandTypesOptions;
  readonly 'import-uphill': ImportGraphOptions;
  readonly 'import-rank-skip': ImportGraphOptions;
  readonly 'import-cross-slice': ImportGraphOptions;
  readonly 'import-isolated-groups': ImportGraphOptions;
  readonly 'import-cycles': ImportGraphOptions;
  readonly 'instruction-symlinks': InstructionSymlinksOptions;
  readonly 'single-storybook': SingleStorybookOptions;
  readonly 'commit-types': CommitTypesOptions;
  readonly 'dockerfile-package-manager': DockerfilePackageManagerOptions;
}

/**
 * The name of a check.
 */
export type CheckName = keyof CheckOptionsByName;
