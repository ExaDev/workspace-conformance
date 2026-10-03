# workspace-conformance

Conformance checks for a pnpm workspace that ESLint cannot express. Type-graph checks run on [ts-morph](https://ts-morph.com), import-graph checks run on [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) with rules generated from the shared `layout` section of [`@exadev/config`](https://github.com/ExaDev/config), file-tree and cross-config checks compare two files or read git state, workflow checks read GitHub Actions files, and settings checks read the repository's settings through the GitHub API. Each check reports violations with a stable code, a message, a file and, where it has one, a position.

It complements the workspace architecture rules of [`@exadev/eslint-config`](https://github.com/ExaDev/eslint-config), it does not replace them. Those rules run in the editor and check what `package.json` files declare (`no-uphill-dependency` and `no-dependency-cycle`), incrementally and one file at a time. This tool checks what the code does: the import statements that actually cross packages, whether written as a package name, a relative path or a path alias, and everything that needs two files, the type checker or git. Both read the same `layout` section, so one description of the workspace drives both. Naming (`package-name-mirrors-path`) and per-file lint stay in ESLint.

## Getting started

```sh
pnpm add -D workspace-conformance '@exadev/config@^2.1.0' cosmiconfig 'typescript@^6'
```

`@exadev/config` provides `withSections` and `layoutSection` for the config file, and the tool loads its sections with it, so install the major this package depends on (`^2.1.0`): a different major installs a second copy, whose sections and errors are not the ones the tool reads. `cosmiconfig` (`^9.0.0 || ^10.0.0`) is a peer dependency because `@exadev/config` loads config files through it. `typescript` (`^5.9.0 || ^6.0.0`) is a peer dependency because dependency-cruiser needs it to parse TypeScript and supports versions below 7 (the range is in the install command because an unpinned `typescript` installs a newer major, which pnpm only warns about); the import checks fail with a configuration error when dependency-cruiser cannot load it. ts-morph bundles its own compiler and does not use yours. `eslint` (`^9.0.0 || ^10.0.0`) is an optional peer dependency, needed only by the `eslint` check, which uses the copy installed in the repository it checks. The package supports the Node lines dependency-cruiser and its own dependencies support: 22.13 and later 22, 24, and 26 and later.

Configure the checks in `exadev.config.ts`:

```ts
import { layoutSection, withSections } from '@exadev/config';
import { conformanceSection } from 'workspace-conformance';

export default withSections(layoutSection, conformanceSection)({
  layout: {
    groups: [
      { name: 'core', rank: 0 },
      { name: 'features', rank: 1, slice: { segment: 0 } },
      { name: 'product', rank: 2, slice: { segment: 0 } },
    ],
    rankSkip: { maxDistance: 1, exemptRanks: [] },
  },
  conformance: {
    checks: {
      'import-uphill': {},
      'import-rank-skip': {},
      'import-cross-slice': {},
      'import-cycles': {},
      'instruction-symlinks': {},
      'aggregate-mappers': {
        contracts: ['product/*/contract/src/aggregates.ts'],
        adapters: '{dir}/../../adapters/*',
        mapper: '{adapter}/src/{name}.mapper.ts',
      },
      'command-types': { commands: ['product/*/contract/src/commands.ts'], exclude: ['Command'] },
    },
  },
});
```

Then run it:

```sh
pnpm exec workspace-conformance check
```

## Configuration

The tool reads two sections through `@exadev/config`, each from `exadev.config.ts` under its key or from a standalone `exadev.<section>.config.ts` in the working directory, never both. See that package for `extends`, presets and how a section is found.

- **`layout`** is the shared `layoutSection`. The import checks read it: `groups` (with `path`, `rank`, `slice`), `nameRanks`, `defaultRank`, `rankSkip`, `isolatedGroups`, and where the packages are (`root`, `packages`, or the `packages` list of `pnpm-workspace.yaml`). Checks that do not read the layout need no `layout` section.
- **`conformance`** is `conformanceSection`. Its `checks` map decides what runs: a check whose name is present with an options object runs (`{}` for the defaults), and `false` switches it off, which lets a config that extends another turn one of its checks off. A key that is not a check name, or an option a check does not have, fails when the section loads.

`runChecks` and the command line fail with exit status 2 when no check is enabled, so an empty section never reads as a pass.

### How the layout maps to packages

Packages are the directories that the `packages` globs select and that hold a `package.json`. Each belongs to the group whose root is the longest prefix of its directory, and takes its rank from the first matching `nameRanks` pattern, else its group's `rank`, else `defaultRank`. A `segment` slice is the path segment below the group root; a `namePrefix` slice is the longest slice value produced by a `segment` group that prefixes the package's unscoped name. These are the same rules the ESLint architecture rules apply.

The tool fails loudly, with a configuration error, on what it cannot judge: a package directory no group owns, package directories nested inside one another, a rank check when some package resolves no rank, and a check that needs `rankSkip`, `isolatedGroups` or a slice when the layout has none.

## Checks

`workspace-conformance check --list` prints the names. Violation codes are `<check>/<reason>` and are stable; messages may change. Paths in options are relative to the working directory and use `/`. Every search by glob skips `node_modules`, git's own data and any other checkout below the working directory (a directory with its own `.git`, such as a linked worktree), so a copy of the repository nested in the tree is not judged as part of it.

### Import graph

The import checks generate dependency-cruiser rules from the layout in a pure function, cruise the packages' files, and read `summary.violations`. Every enabled import check adds its rules to a single cruise, and the findings are split back to the checks by rule name; checks whose `exclude`, `doNotFollow` and `tsConfig` are equal (after defaults) share a cruise, and checks that differ in any of them are cruised separately, since those options decide which files the graph contains. They never use the exit code of `cruise()`, which is 0 whatever it found. A rule cannot compare ranks, so the ordering is expanded into path alternations at generation time: one rule per rank, slice or group pair rather than per package pair.

All import checks take these options:

| Option | Meaning |
|---|---|
| `exclude` | Regular expressions, as source text, for paths relative to the workspace root that are left out of the graph: neither a dependant nor a dependency. `node_modules` directories when omitted. Setting it replaces that default. A pattern that does not compile fails when the section loads. |
| `doNotFollow` | Regular expressions for paths whose files can be imported but whose own imports are not followed, so build output is a target of imports and never a dependant. `dist` directories when omitted. Setting it replaces that default. A pattern that does not compile fails when the section loads. |
| `tsConfig` | A tsconfig for path aliases and other module resolution. |

How an import is attributed to a package, and the limits of that:

- An import that dependency-cruiser resolves to a file counts against the package whose directory holds the file. A relative import resolves without an install, a path alias needs `tsConfig` (`paths` without `baseUrl` resolves relative to that tsconfig, wherever the command runs), and a package name resolves through the `node_modules` link pnpm makes for a workspace package and the package's `exports` or `main`.
- An import of a workspace package by its name (or a subpath of it) that resolves to no file, because the workspace is not installed or the package's entry point is not built, is attributed to the package by name. An import that neither resolves nor names a workspace package, such as an alias without `tsConfig` that is not a package name, is not seen, so a check can look cleaner than the workspace is; give `tsConfig` when aliases are used.
- `import-cycles` follows files, so it cannot follow an import that resolves to no file. It treats packages that import each other by such names as a cycle between the packages, and finds it only when every import in the ring is of that kind; a ring that mixes such imports with imports that resolve to files is not seen until the workspace is installed and built.
- Type-only imports and dynamic `import()` count, because a type dependency is still a dependency.
- Test and tooling files inside a package are part of the package. Use `exclude` for paths that may cross layers.
- dependency-cruiser supports TypeScript below 7. With a TypeScript it cannot load, or none, every import check fails with a configuration error and exit status 2 instead of reporting a clean workspace.

| Check | Verifies |
|---|---|
| `import-uphill` | No package imports a package of a strictly higher rank. |
| `import-rank-skip` | No package imports one more than `rankSkip.maxDistance` ranks below it, except an exempt rank. Needs `rankSkip` in the layout. |
| `import-cross-slice` | No package imports a package with a different slice. A package without a slice is in none and is never restricted. Needs a slice in the layout. |
| `import-isolated-groups` | No package imports a package in a group that `isolatedGroups` pairs with its own, in either direction. Needs `isolatedGroups`. |
| `import-cycles` | No files of the workspace packages import each other in a cycle, and no packages import each other by names that resolve to no file. Each cycle is reported once, starting from its smallest path, and two different rings over the same files are two cycles. It includes type-only cycles. |

The ESLint rules and this tool overlap deliberately on rank, rank skip, slice and isolation; ESLint gives instant feedback on declared dependencies and this tool catches the imports that bypass a declaration.

### Type graph

The type-graph checks build a ts-morph program from the files their options select and what those import, with compiler options from `tsConfig` (default `tsconfig.json`; its `include` is not used). ts-morph bundles its own TypeScript, so it does not follow your compiler version. Imports must resolve, which means dependencies need to be installed: a schema imported from an uninstalled package has no type.

**`aggregate-mappers`** verifies that every aggregate type a contract file exports has a mapper file where a template says.

| Option | Meaning |
|---|---|
| `contracts` | Globs of contract files. Every exported interface and type alias in them is an aggregate. |
| `mapper` | Path template for one aggregate's mapper. Placeholders: `{name}`, `{dir}` (the contract's directory), `{file}` and, with `adapters`, `{adapter}`. `..` segments are resolved. |
| `adapters` | Optional glob template (with `{dir}` and `{file}`) for adapter directories. Each aggregate then needs a mapper in every matched adapter, and a glob that matches nothing is itself a violation. |
| `exclude` | Names of exported types that are not aggregates. |
| `tsConfig` | See above. |

Codes: `aggregate-mappers/missing-mapper` (reported at the aggregate's declaration), `aggregate-mappers/no-adapters`. Limits: it checks that a file exists, not what is in it; a type re-exported by the contract counts as an aggregate, and a type re-exported under another name (`export type { Created as CreatedAlias }`) counts once for each name it is exported as, each needing a mapper, so helper types and aliases need `exclude`; a type in an exported namespace, or in a module re-exported as a namespace (`export * as ns`), is an aggregate under its qualified name (`ns.Type`, which is also what `{name}` and `exclude` use); a placeholder with no value, a glob that matches no contract and a missing tsconfig are configuration errors, which name the option (`checks.aggregate-mappers.contracts`) and not the value written in it.

**`codec-pairs`** verifies that every encoder a codec file exports has the decoder its name implies, exported by the same file, and every decoder the encoder. A name is an encoder or a decoder when it fits that option's template: with `encoder: 'encode{name}'` and `decoder: 'decode{name}'`, `encodeInvoice` needs `decodeInvoice` and `decodeReceipt` needs `encodeReceipt`. It checks only that both halves exist; that each pair round-trips is a property test (decode after encode gives back the value) and stays the repository's own, since a type graph cannot run code.

| Option | Meaning |
|---|---|
| `codecs` | Globs of codec files. Each file is judged on its own exports, re-exports included. |
| `encoder` | Name template of an encoder, such as `encode{name}` or `{name}Encoder`. `{name}` appears exactly once, beside other text, and is the only placeholder, or the section fails to load. |
| `decoder` | Name template of a decoder, in the same form and different from `encoder`. |
| `exclude` | Names of exported encoders and decoders that need no counterpart, such as an encoder for a format that is only ever written. |
| `tsConfig` | See above. |

Codes: `codec-pairs/missing-decoder` and `codec-pairs/missing-encoder`, each reported at the declaration of the half that exists. An export whose name fits neither template is not a codec and is ignored, not reported, so a codec file may also export its helpers, schemas and types without listing them in `exclude`; `exclude` is for a half that deliberately has no counterpart. Limits: only values count (functions, constants, destructured constants, classes and enums), so an interface or type alias whose name fits a template is ignored; the counterpart is looked up by name among the same file's exports, not by signature, and a value re-exported under another name counts under each name it is exported as; a value in an exported namespace, or in a module re-exported as a namespace (`export * as ns`), is judged under its qualified name (`ns.encodeInvoice`, which is also what `exclude` uses) and pairs only with a counterpart in the same namespace; a glob that matches no codec file and a missing tsconfig are configuration errors.

**`command-types`** verifies that every command type is derived from a schema and not written by hand. An exported alias must apply a generic named in `inferences` (`infer`, `input`, `output`, `TypeOf`, `InferInput` and `InferOutput` by default, the last name of the reference, so `z.infer` and Valibot's `v.InferOutput` both count) to `typeof schema`, where the type of `schema` has the `~standard` member every Standard Schema has. The schema is recognised by type, so it may be imported or renamed and need not come from Zod. The generic may be imported under another name (`import type { infer as Infer }`), and an alias may stand between the export and the inference (`type Base = z.infer<typeof schema>; export type Created = Base;`): a local alias without type parameters is judged by the type it is written as. An alias with type parameters is not followed and is hand-written.

| Option | Meaning |
|---|---|
| `commands` | Globs of files that declare commands. Every exported interface and type alias in them is a command. |
| `exclude` | Names of exported types that are not commands, such as a union of them. |
| `inferences` | Replaces the default list of generics. |
| `tsConfig` | See above. |

Codes: `command-types/hand-written-interface`, `command-types/hand-written-alias` (an alias that applies none of the generics, including a union or a plain object type) and `command-types/not-a-schema` (an inference applied to something whose type has no `~standard` member). Limits: a union of commands is a hand-written alias unless excluded; a type exported from several listed files is judged once; only interfaces and type aliases are judged, including those inside an exported namespace or a module re-exported as a namespace (under their qualified names), so a class, enum or value is not a command here; when the schema library is not installed the schema's type does not resolve and the alias reports `not-a-schema`.

**`derived-types`** verifies that the types a file exports are derived from the schemas they belong with, for each configured pair of schema files and type files. It covers what `command-types` does not: a type written by hand next to the schema it should be inferred from, a table row type that should come from the table definition, an error type that should come from its error schema. An exported type is derived when somewhere in its definition a generic named in `inferences` is applied to `typeof schema` (`z.infer<typeof order>`, `InferSelectModel<typeof users>`), or a member named there is read from it (`typeof users.$inferSelect`), where `schema` is declared in one of the pair's schema files, through any imports and re-exports. The definition is followed through aliases and interfaces without type parameters, in any file, so an alias chain across files counts when it ends in an inference; through the type arguments of other generics (`Partial<Order>`); through an intersection with at least one derived member, a union whose members are all derived (`null` and `undefined` aside), arrays, type operators, indexed access and the `extends` clauses of an interface. A type literal is hand-written whatever its members are, and so is a schema passed to a generic that is not an inference (`Wrapper<typeof order>`) or an inference of a schema declared outside the pair's schema files.

| Option | Meaning |
|---|---|
| `pairs` | A list of `{ schemas, types }`, each a list of globs: every exported interface and type alias in the `types` files must be derived from a schema declared in the `schemas` files. A type file listed by several pairs is judged against each. |
| `exclude` | Names of exported types that are deliberately written by hand. |
| `inferences` | Replaces the default list of last names that count as inference: those of `command-types` plus Drizzle's `InferSelectModel`, `InferInsertModel`, `$inferSelect` and `$inferInsert` (`DEFAULT_DERIVED_TYPE_INFERENCES`). |
| `tsConfig` | See above. |

Code: `derived-types/not-derived`, reported at the type's declaration. Limits: a schema is recognised by where it is declared, not by its type, so anything in a schema file passed to an inference counts; a tuple type is not followed and is hand-written; a type exported from several type files of one pair is judged once; types inside an exported namespace or a module re-exported as a namespace are judged under their qualified names, which `exclude` also matches; a glob that matches no file and a missing tsconfig are configuration errors naming the option (`checks.derived-types.pairs.0.schemas`).

### File tree and cross-config

**`instruction-symlinks`** verifies that agent instruction files are symbolic links to the README beside them (written in any form that resolves there, such as `./README.md`, or through other tracked links, as `CLAUDE.md` to `AGENTS.md` to `README.md`), as git records them: mode `120000` in the index, not the working tree, so a checkout with `core.symlinks` false, which writes links out as plain files, is judged by what is committed. Options: `files` (`AGENTS.md` and `CLAUDE.md`), `directories` (globs, `.`), `target` (`README.md`). Codes: `instruction-symlinks/missing` (not tracked), `not-a-symlink`, `wrong-target` (the link does not resolve to the README, including a loop or an absolute target), `dangling` (the target is not tracked). It needs a git working tree and reads the index, so a link that is staged counts before it is committed.

**`single-storybook`** verifies that at most one Storybook exists, in one permitted directory (the workspace root by default, or `location`), and none inside a package such as a UI package. A Storybook is a `.storybook` directory; one anywhere else is `single-storybook/misplaced`. `exclude` (globs) leaves paths out of the search, such as test fixtures; a directory name (`test/fixtures`) leaves out everything under it, as `test/fixtures/**` does. A Storybook that is started only from a `package.json` script or a dependency, without a `.storybook` directory, is not seen, and a fixture or template directory that holds one is reported unless `exclude` names it.

**`commit-types`** verifies that the commit types commitlint accepts are accounted for in the semantic-release config. Options: `commitlint` (`commitlint.config.ts`) and `release` (`release.config.ts`). Both files are evaluated through the shared jiti loader, so a list derived from one shared constant compares as its values. The `alias` and `fsCache` of `runChecks`' `configFiles` apply to them as to the sections; `trust` and the per-shape `unified` and `standalone` layer options (`merge` and `presetSchema`) are for `extends` and do not. A commit type that no conventional preset knows (`PRESET_COMMIT_TYPES` lists the ones that do) must have a `releaseRules` entry in the `@semantic-release/commit-analyzer` options and, when `presetConfig.types` of `@semantic-release/release-notes-generator` is set, a changelog section. Every `releaseRules` type and every changelog type must be a commit type, or it can never apply. A preset type may be left out of either list, which is how a release rule list normally omits the types that do not release. Codes: `commit-types/no-release-rule`, `release-rule-not-a-commit-type`, `no-changelog-section`, `changelog-section-not-a-commit-type`, `no-type-enum` (a type no preset knows is listed but commitlint sets no `type-enum`, so the commit types cannot be read) and `missing-config`. Without `presetConfig.types` (or without a release notes generator) no changelog sections are listed, so none is required. Limits: `type-enum` is read as `[level, 'always', [types]]`, the only accepted types; `'never'` forbids the types it lists (a release rule or section for one is reported) and enumerates none, so nothing is required of any other type, and level 0 accepts every type; any other shape of the rule fails the check; `releaseRules` given as a module path (a string, which semantic-release supports) is not read and fails the check; types that come only from an extended preset are not read; rules that name no type (`{ breaking: true }`) are ignored; a changelog list that omits a preset type is not reported; the configs are executed, so they must be trusted.

**`engines-floor`** verifies that the `engines.node` range of each package is a subset of the `engines.node` range of each dependency and optional dependency it lists, and of each peer dependency whose range admits a single version, as installed, so the package admits no Node version that something it needs at run time rejects. A floor comparison is not enough: a package declaring `>=20` over a dependency requiring `^20.19.0 || ^22.13.0 || >=24` admits 20.0 to 20.18, 21 and 23, which the dependency rejects, so the test is `semver.subset(package, dependency)`. Option: `packages`, globs of the package directories in the form of the `packages` list of `pnpm-workspace.yaml` (a `!` pattern excludes, `.` is the root package); the root package and the `packages` of `pnpm-workspace.yaml`, when it exists, when omitted. Codes: `engines-floor/wider-than-dependency` (the range admits a version the dependency rejects) and `no-engines` (the package declares no range, so admits every version, while a dependency declares one), each reported at the package's `package.json` and naming the dependency and both ranges. A dependency that declares no range constrains nothing and is ignored. `devDependencies` are not judged: a consumer never installs them, and the Node the development toolchain needs is the repository's own concern, not a claim the published package makes. A dependency is found the way Node finds a package directory, in `node_modules` of the package's directory and then of each directory above it up to the working directory, following the symbolic links pnpm installs; it reads the dependency's `package.json` directly rather than resolving an entry point, since an `exports` map need not expose `package.json`. A peer dependency is judged only when its range is a single version (`1.2.3` or `=1.2.3`), by the installed copy, which must be that version or the run fails. The consumer, not the package, chooses which version of a peer to install, so the package's range holds when each Node version in it is accepted by some version the peer range admits. The copy installed in the workspace is one of those versions: if it rejects a Node version the package admits, another admitted version may accept it (`^9.0.0 || ^10.0.0` with cosmiconfig 10 requiring `^22.18 || >= 24` while cosmiconfig 9 accepts 22.13, and equally an earlier minor of a single major), and the versions that are not installed cannot be read without the registry, so judging the range by that copy reports packages that are correct. A range of one version leaves the consumer no choice, so its installed copy decides; a peer that is not judged need not be installed. A dependency that is not installed fails the run with a configuration error, because its range cannot be read; an optional dependency, or a peer dependency marked optional in `peerDependenciesMeta`, may be absent and is then skipped. A range semver cannot parse, in the package or a dependency, and options that select no package also fail the run. Limits: semver compares a range of several comparator sets set by set, so each set of the package's range must lie within one set of the dependency's, and a set that two adjacent dependency sets only cover together (`>=22` against `^22.0.0 || >=23`) is reported until it is split the same way; a peer dependency whose range admits more than one version is not judged at all, so a package can claim a Node version that no admitted version of a peer accepts; prerelease Node versions are not considered.

**`dockerfile-package-manager`** verifies that a package manager version pinned in a Dockerfile is the one `packageManager` names, ignoring a `+sha` suffix on either side. Options: `dockerfiles` (`Dockerfile`, `Dockerfile.*` and `*.Dockerfile` at any depth), `exclude` (globs left out of the search) and `packageJson` (`package.json`). Only pins of the package manager `packageManager` names are compared: `pnpm@12.4.1` on a `RUN` line is compared, `npm@latest` is not. Codes: `dockerfile-package-manager/version-mismatch` (with line and column) and `no-package-manager`. A version that refers to a variable (`pnpm@${PNPM_VERSION}` or `pnpm@$PNPM_VERSION`) is compared with the value an `ARG` or `ENV` earlier in the same file gives it. Limits: it reads `<manager>@<version>` as written on a line that is not a comment; a variable the file gives no value (an `ARG` without a default, whose value the build supplies) or whose value refers to another variable is not compared; the value in effect is the latest one set before the pin, whichever build stage set it; and an unpinned `pnpm@latest` is a mismatch.

**`migrations-directory`** verifies that the directory a schema generator writes migrations to is the directory the deploy tool applies them from, and that no `package.json` script applies them with the generator in place of the deploy tool. It is tool specific, so the generator and the deploy tool are named in the options, each has an adapter that knows its config file names and where in the config the directory is, and the supported pair is `drizzle-kit` (`out` of `drizzle.config.ts`, `.js` or `.json`, `drizzle` when unset) with `wrangler` (`migrations_dir` of a `d1_databases` entry of `wrangler.json`, `.jsonc` or `.toml`, `migrations` when unset). Both directories are resolved against the directory of the file that sets them, and `..` segments and trailing separators are normalised. Adapters are two small interfaces (`GeneratorAdapter` and `DeployToolAdapter`, with `generators` and `deployTools` as the registries), so another tool is one object and an entry in `generatorNames` or `deployToolNames`.

| Option | Meaning |
|---|---|
| `generator` | The generator, `drizzle-kit`. |
| `deployTool` | The deploy tool, `wrangler`. |
| `generatorConfig` | The generator's config file. The first of the adapter's default names that exists when omitted. |
| `deployConfig` | The deploy tool's config file; the defaults are `wrangler.json`, `wrangler.jsonc` and `wrangler.toml`, in the order wrangler prefers them. |
| `database` | The binding of the D1 database the generator writes for. Required when the deploy config declares more than one. |
| `environment` | A named wrangler environment to read (`env.<name>`) instead of the top-level settings. |
| `packageJsons` | Globs of the `package.json` files whose scripts are searched. Every `package.json` at any depth when omitted. |

Codes: `migrations-directory/mismatch` (reported at the generator's config), `migrations-directory/no-database` (the deploy config declares no database, or none with the binding named), `migrations-directory/missing-config`, and `migrations-directory/generator-apply-command` (reported at the script, with its position; a script running `drizzle-kit migrate`, which `drizzle-kit push` and `generate` are not). The generator's TypeScript config is evaluated, so it must be trusted; the deploy config is parsed as data. A config that cannot be read, or a deploy config with several databases and no `database`, fails the run with a configuration error and exit status 2 instead of guessing.

False positives and blind spots:

- One generator and deploy config pair is checked per run. A workspace with several pairs (a package per database) needs the library call once for each, with the pair's `generatorConfig`, `deployConfig` and `database`.
- Several databases: the generator's output is compared with the one database named by `database`, so the other databases are not checked at all, and the check cannot tell which database a generator config is for without being told.
- Environments: wrangler does not inherit `d1_databases` into an environment, so each environment has its own `migrations_dir`. Only the top level, or the one `environment`, is compared; a divergence in another environment is not seen.
- Directory resolution: wrangler resolves `migrations_dir` against the directory of its config file, but drizzle-kit resolves `out` against the directory it is run from. The check assumes drizzle-kit runs from the directory of its config, so a script that runs it from elsewhere (`--config` pointing into another directory) can differ from the answer here.
- Config variants: only the directory searched is looked at, whereas wrangler also finds a config in a parent directory and follows a redirected config; a repository with both `wrangler.json` and `wrangler.toml` is judged by the first, and a `migrations_pattern` that narrows which files are applied is not read. A generator config that computes `out` from the environment is judged by its value in the process running the check.
- Scripts: a script is matched by the text of the command, so `drizzle-kit migrate` run against a local database for tests is reported, and a command assembled in a shell variable or run from a file the script calls is not seen. Narrow `packageJsons` to exempt a package.

### ESLint

**`eslint`** proves that the repository's own ESLint is applied. Every other lint rule runs inside ESLint, so none of them can notice a config that dropped a shared preset, switched its rules off or narrowed `ignores` until nothing is linted; the repository then looks configured and enforces nothing. This check asks ESLint itself, through its Node API, and carries no ESLint config of its own: a flat config holds plugin objects, a parser and functions, and editors and CI expect `eslint.config.*` where it already is.

ESLint (`^9.0.0 || ^10.0.0`) is an optional peer dependency, needed only by this check. It is resolved from the directory the checks run in, the way a module there would find it, and not from this package, so the answer is the one the repository's own lint script gets. When `eslint` does not resolve from there the run fails with a configuration error. When ESLint finds no config file for a sample the check reports `eslint/no-config` and does not substitute one.

| Option | Meaning |
|---|---|
| `samples` | Required. One file per kind of source the repository lints (`src/index.ts`, `package.json`, `eslint.config.ts`), as a path or `{ path, rules }`. A path need not exist: ESLint resolves a file's configuration from its path alone. |
| `rules` | Rules required for every sample, each with the severity it must have at least: `warn` is met by `warn` or `error`, `error` only by `error`. Rule entries in the form `[severity, ...options]` and numeric severities are read as their severity. A sample's own `rules` are added to these and win. |
| `configFile` | A config file to judge instead of the one ESLint finds from the working directory. |
| `lint` | Also lint the workspace and report every message it produces. Off when omitted. |
| `lintPatterns` | What `lint` lints, as file and directory patterns. `.` when omitted. |

The default level lints nothing. For each sample it calls `calculateConfigForFile`, the same call the CLI's `--print-config` makes, which applies `files` and `ignores`. A file that is ignored, or that no configuration block matches, resolves to no configuration (`isPathIgnored` is that call returning nothing), and that is `eslint/not-linted`. Otherwise each required rule must be configured at the required severity: `eslint/rule-missing`, `eslint/rule-off` or `eslint/rule-too-weak`, each naming the rule and the file.

With `lint` the check also lints the workspace through `lintFiles` and maps every message to a violation at its position. The code names the rule, `eslint/lint/<rule id>`, so `eslint/lint/no-console` and `eslint/lint/@scope/plugin/rule` are stable; a parsing error is `eslint/fatal` and a message with no rule, such as an unused disable directive, is `eslint/lint-message`. A pattern that matches no file, or only ignored files, is `eslint/nothing-linted`. Warnings are reported as well as errors, since a repository that fails its lint script on warnings (`--max-warnings 0`) is judged by what that script reports.

Limits:

- An external config is a black box. The check sees which rules are active on a file, not why, so it cannot tell a rule enabled by a shared preset from one written locally. Require the rules that matter and let the repository decide how it gets them.
- It reads the config ESLint resolves for each sample, and a sample stands for the files like it. A rule can be off for one directory the samples do not cover, so choose a sample for each kind of source and each directory with its own override.
- An ignored file and a file that no configuration block matches both resolve to nothing and are reported the same way.
- Only rule severities are compared, not rule options.
- Flat config only: the ESLint 9 and later `ESLint` class. Legacy `.eslintrc` configuration is not read.
- A config that is a TypeScript file needs whatever ESLint itself needs to load it (`jiti`), installed where ESLint is.

### Workflows

The `workflow-*` checks read GitHub Actions workflow files and run offline. Each file under `.github/workflows` is parsed into a model of its events, jobs, the transitive `needs` graph, `if` conditions, effective permissions (a job's own declaration replaces the workflow's, it is not merged with it) and effective environment (workflow, then job, then step), and the checks read that model. A file that is not YAML, or is not shaped like a workflow, fails the run with a configuration error instead of being skipped. Expressions (`${{ ... }}`) are never evaluated: a value that is an expression is treated as unknown, and a check that needs a literal ignores it.

Every workflow check takes `workflows` (globs of the files to read, `.github/workflows/*.yml` and `.github/workflows/*.yaml` by default) and `exclude` (globs to leave out), except `workflow-update-bot-cooldown`, which reads the update bots' own configs. Jobs are named by id in the options. These checks live here and not in `@exadev/eslint-config` because they need the cross-job graph that a single-file lint rule cannot see (see [ExaDev/eslint-config#78](https://github.com/ExaDev/eslint-config/issues/78)). Security audits of workflow files (dangerous triggers, token scopes, expression injection) stay with an external auditor such as zizmor or actionlint and are not reimplemented.

| Check | Verifies | Codes |
|---|---|---|
| `workflow-job-ordering` | A release job needs every deploy job; a documentation deploy job needs every release job and checks out the default branch afresh; a junction job has `if: always()`, lists every other job in `needs` and fails only on `failure` and `cancelled`. | `release-before-deploy`, `docs-deploy-before-release`, `docs-deploy-stale-checkout`, `junction-not-always`, `junction-missing-need`, `junction-fails-on-skipped`, `junction-no-failure-condition` |
| `workflow-skippable-jobs` | A path filter does not leave a required check pending or skip a job that no junction job reports for. | `trigger-path-filter`, `job-gated-by-path-filter` |
| `workflow-runner-resolution` | A custom or self-hosted runner label is not named literally in several jobs; a resolver job has a `timeout-minutes` and its output a literal hosted fallback. | `repeated-label`, `resolver-no-timeout`, `resolver-no-fallback`, `resolver-fallback-not-hosted` |
| `workflow-version-single-source` | A setup step does not hold a literal runtime version when `.nvmrc` or `.tool-versions` already does. | `literal-version` |
| `workflow-credentials` | Attestation steps have `id-token: write` and `attestations: write`; a publish that passes no token blanks the token variables, or at least requests provenance so that a fallback publish is traceable. | `attestation-permissions`, `tokenless-publish-unprotected` |
| `workflow-release-job` | The release job is the only job granted `id-token: write`, runs in a deployment environment and checks out with `persist-credentials: false`; no job holding `id-token: write` passes an npm token from a secret. | `id-token-workflow-level`, `id-token-outside-release`, `missing-environment`, `persisted-credentials`, `token-beside-oidc` |
| `workflow-repository-dispatch` | A `repository_dispatch` handler does not push to the default branch, auto-merge without a required-checks rule, push or open pull requests as `GITHUB_TOKEN`, or dispatch to another repository with it. | `pushes-default-branch`, `auto-merge-without-required-checks`, `default-token-triggers-nothing`, `dispatch-other-repository-with-default-token` |
| `workflow-update-bot-cooldown` | Dependabot has a `cooldown` in every update entry, and Renovate sets `minimumReleaseAge`. | `dependabot-no-cooldown`, `renovate-no-minimum-release-age` |
| `workflow-merge-group` | A workflow that runs for `pull_request` also has a `merge_group` trigger. | `missing-trigger` |
| `workflow-action-pinning` | Every `uses` follows the pinning policy. | `not-pinned`, `docker-not-pinned`, `missing-ref` |

Codes are `<check>/<code>`, so `workflow-job-ordering/release-before-deploy`. The options and the limits of each check:

**`workflow-job-ordering`** takes `releaseJobs` (`release`), `deployJobs` (`deploy`), `docsDeployJobs` (`docs-deploy`), `junctionJobs` (`required-checks`), `junctionExempt` (jobs the junction job need not wait for) and `defaultBranch` (`main`). A role with no job in a workflow is not judged there. Ordering is judged through the transitive `needs` graph, but the junction job must list each job directly, because `needs.*.result` covers only direct needs; a job that itself needs the junction job is never required of it, nor is a job that never runs for a pull request (an `if` that compares `github.ref`, `github.ref_name` or `github.event_name`, mentions neither `pull_request` nor `merge_group`; in an `&&` one such operand is enough, in an `||` every operand must be one, since the merge queue is where the required check decides the merge and a disjunction can hold for a pull request through another operand), a job that needs such a job, or one named in `junctionExempt`. A documentation job's checkout is correct when its `ref` is `${{ github.event.repository.default_branch }}` or the default branch written literally; no `ref` means the triggering commit, which predates the release commit. The junction job's pass condition is read as text: it must read the results of its needs (`needs.*.result`, `needs.<job>.result` or `toJSON(needs)`, including a `join(needs.*.result, ' ')` looped over in a script) and name both `'failure'` and `'cancelled'`, or use the `re-actors/alls-green` action, and `'skipped'` or `!= 'success'` is reported, because a skipped job is how a path filter or an `if` keeps a job out. A decision the text does not show is reported as incomplete.

**`workflow-skippable-jobs`** takes `junctionJobs` and `pathFilterActions` (`dorny/paths-filter`, `tj-actions/changed-files`, `step-security/changed-files`). A `paths` or `paths-ignore` filter on `pull_request` or `pull_request_target` skips the whole workflow, so a required check from it stays pending; it is reported when the workflow has a junction job, the sign that it produces a required check. A job whose own `if` reads the outputs of a job that runs a path filter action is skipped; it is reported unless a junction job lists it in `needs`, and the fix is to put the condition on its steps, so the job still runs and reports. Limits: a workflow without a junction job is not judged for its trigger filter; a script that computes changed paths itself is not recognised as a path filter; only the filters of the `pull_request` and `pull_request_target` triggers are read, so a `paths` filter on `push` is not reported; only `needs.<job>.outputs` in a job's own `if` is read.

**`workflow-runner-resolution`** takes `hostedLabels`, regular expressions for the labels GitHub hosts itself (the standard `ubuntu`, `windows` and `macos` images and their `-latest`, versioned, `-arm`, `-intel`, `-large`, `-xlarge` and `-slim` forms by default; setting it replaces the default). A label that matches none, or a runner group, named literally in more than one job of a workflow is reported at each such job: resolve it once in a resolver job and read it with `runs-on: ${{ fromJson(needs.<resolver>.outputs.<name>) }}`. Each resolver (the job whose output a `fromJson` in a `runs-on` reads) must have `timeout-minutes`, so a runner that never starts does not hold the jobs waiting for it for the default six hours, and its output must carry a literal fallback (`|| '["<label>"]'`) whose labels all match `hostedLabels`, since a fallback to another self-hosted label does not help when the fleet is down. A resolver that is a call of a local reusable workflow is followed through `on.workflow_call.outputs` to the job that sets the output, and the findings are reported there; one in another repository cannot be read and is not judged. Limits: labels are compared within one file, not across files; a larger runner is named by a custom label, so it counts as one; an output is taken to have a fallback when its expression has `||` followed by a string literal, and the last such literal is read as JSON; one that is not valid JSON counts as not hosted.

**`workflow-version-single-source`** recognises the setup actions for Node, Python, Go, Java, .NET, Ruby, Bun, Deno, pnpm and Terraform. A step is reported when it gives the version input a literal while `.nvmrc` (for Node) or `.tool-versions` (for any tool it lists, by its asdf name) exists in the working directory; the message names the input that reads the file. A version containing an expression, such as a matrix value, is not a literal. An alias such as `lts/*` is. Limits: only the actions listed are recognised, only the root files are looked for, and composite actions are not read.

**`workflow-credentials`**: an attestation step (`actions/attest`, `actions/attest-build-provenance`, `actions/attest-sbom`) needs `id-token: write` and `attestations: write` in the job's effective permissions. Permissions declared nowhere are the repository's default, which the file cannot show and which does not grant `id-token`, so they are reported. A job with `id-token: write` that runs a publish command (`npm`, `pnpm` or `yarn npm publish`, with options such as `-r` or `--filter <package>` before `publish`, `semantic-release`, `changeset publish`, `lerna publish`, bare or behind `pnpm`, `pnpm exec`, `yarn` or `npx`) and passes no token must set `NODE_AUTH_TOKEN` and `NPM_TOKEN` to the empty string (at step, job or workflow level) or request provenance (`--provenance`, `NPM_CONFIG_PROVENANCE: true`, or `publishConfig.provenance: true` in the `package.json` of the working directory); provenance does not stop an inherited token being used, it makes that publish traceable. Limits: commands are read as text where a command starts, so a script file or composite action is not seen; provenance set in another `package.json` is not read; a job is tokenless only if no token variable has a non-empty value anywhere in it; a job that calls a reusable workflow is not read. `registry-url` is deliberately not reported, see below.

**`workflow-release-job`** takes `releaseJobs` (`release`, the same default as `workflow-job-ordering`). npm binds a trusted publisher to the repository and the workflow file, not to a branch ([trusted publishers](https://docs.npmjs.com/trusted-publishers), [archived](https://web.archive.org/web/20260921070919/https://docs.npmjs.com/trusted-publishers/)), so anyone who can push a branch can edit that branch's copy of the workflow, remove the `if` that keeps publishing to the default branch, and publish. The protection has to live outside the file: a deployment environment whose deployment branch policy allows only the default branch, named as the environment of the trusted publisher on npm, so an OIDC token minted anywhere else is refused. In a workflow with a release job, `id-token-workflow-level` reports workflow-level `permissions` that grant `id-token: write` (directly or through `write-all`), since every job that declares none inherits it, and `id-token-outside-release` reports any other job that declares it, a job that calls a reusable workflow included, because the OIDC identity is the publishing credential and only the release job should be able to mint it. `missing-environment` reports a release job with no `environment` (a name, or a mapping with a `name`). `persisted-credentials` reports a release job's `actions/checkout` that does not set `persist-credentials: false` literally, since the job token, a `token` input or an `ssh-key` would otherwise stay in git config for every later step, the dependency install and third-party actions included. There is no exception for a release that pushes: semantic-release pushes to its `repositoryUrl` as written and, only when that fails, to the same URL with `GITHUB_TOKEN` or `GH_TOKEN` from the environment embedded (`lib/get-git-auth-url.js` of `semantic-release`), so it never needs the checkout's credentials. A deploy-key release job, the shape ExaDev's own release jobs use, checks out with `persist-credentials: false`, writes the key to a file in the step before the release, and hands it to git only through the `GIT_SSH_COMMAND` in the `env` of the steps that push; it is accepted as written, and the clean fixture holds one. In every workflow, `token-beside-oidc` reports a job whose effective permissions grant `id-token: write` and whose workflow, job or step `env` sets `NODE_AUTH_TOKEN` or `NPM_TOKEN` from the `secrets` context: a long-lived token beside the OIDC identity is a second way to publish that no environment protection or trusted publisher setting covers. Limits: the environment's protection rules and the npm trusted publisher settings cannot be seen in the file and are not read (`missing-environment` checks only that an environment is named); a release job that calls a reusable workflow is judged only for `id-token`, since `environment` and the steps belong to the called workflow; a token passed through `with`, written to an `.npmrc` by a script, or set inside a composite action is not seen.

What zizmor already covers, and what this check adds, as observed with zizmor 1.30.1 on this check's fixtures ([audit rules](https://docs.zizmor.sh/audits/), [archived](https://web.archive.org/web/20260929212113/https://docs.zizmor.sh/audits/)): `excessive-permissions` reports a workflow-level `id-token: write`, but not `id-token: write` declared by a second job, which only `undocumented-permissions` mentions when the grant has no comment. `artipacked` reports every `actions/checkout` without `persist-credentials: false`, in every job and every persona, at `help` severity for `actions/checkout` v6 and later, which keeps the credentials under `$RUNNER_TEMP` rather than in `.git/config`; this check reports it as a violation in the release job, where a step that reads git config has the publishing job's push credential. `secrets-outside-env` (auditor persona only) reports a `secrets` reference in a job with no environment, so it catches a missing environment only when the release job reads a secret; a tokenless OIDC release job with no environment produces no zizmor finding at all. `use-trusted-publishing` reports an `npm publish` that uses a token, but is silent once the job also has `id-token: write`, so an `NPM_TOKEN` from a secret beside `id-token: write` in a job with an environment produces no zizmor finding. No zizmor audit relates the grants of one job to the others in a workflow, or requires an environment for the job that holds `id-token: write`.

**`workflow-repository-dispatch`** takes `defaultBranches` (`main` and `master`; the `github.event.repository.default_branch` expression always counts) and `assumeRequiredChecks`. It reads workflows with a `repository_dispatch` trigger, which anyone with write access can start through the API. `pushes-default-branch` reports a `git push` whose destination is the default branch (a leading `+` is ignored, a bare `HEAD` is the checked-out branch, quotes around a word are removed, `git -C <directory>` and `git -c <setting>` before `push` are read, and options that take a value such as `-o` are skipped), a push with no refspec while the default branch is checked out (no `git checkout -b` or `git switch -c` earlier in the job, no non-default `ref` on the checkout) and `stefanzweifel/git-auto-commit-action` on the default branch. `auto-merge-without-required-checks` reports `gh pr merge --auto`, which merges at once when the base branch requires no checks; the file cannot show the rule, so `assumeRequiredChecks: true` states it and `settings-required-checks` verifies it. `default-token-triggers-nothing` reports a push whose checkout kept the default token (no `token` input; a push to a URL that carries its own credentials does not use it), `gh pr create` with `GITHUB_TOKEN` and `peter-evans/create-pull-request` with the default token: events created with `GITHUB_TOKEN` start no workflows, so the result is never checked. `dispatch-other-repository-with-default-token` reports a dispatch (`gh api repos/<o>/<r>/dispatches`, `gh workflow run -R`, `peter-evans/repository-dispatch`) to a repository other than `github.repository` with `GITHUB_TOKEN`, whose access is limited to its own repository. Dispatching in the same repository with `GITHUB_TOKEN` is not reported, because GitHub documents `workflow_dispatch` and `repository_dispatch` as the events that do create runs when made with it ([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [archived](https://web.archive.org/web/20261001051219/https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)). Limits: commands are read as text, so a script file is not seen; a dispatch target written literally as this repository's own name is reported, since the file does not know the name.

**`workflow-update-bot-cooldown`** takes `dependabot` (`.github/dependabot.yml`, else `.yaml`) and `renovate` (`renovate.json`, `.renovaterc.json`, `.renovaterc` and `.github/renovate.json`, the first that exists). Every Dependabot `updates` entry needs a `cooldown` with `default-days` or one of the `semver-*-days` above zero. Renovate needs `minimumReleaseAge` at the top level or in a `packageRules` entry, as a duration above zero (`0 days` and `null` wait for nothing). Limits: Dependabot's cooldown does not apply to security updates; a Renovate preset is not resolved (an `extends` entry counts only when its name contains `minimumReleaseAge`); a Renovate config is read as JSON with comments and trailing commas, so other JSON5 syntax and a `renovate` key in `package.json` are not read. A repository with neither bot has nothing to report; a file named in the options that does not exist fails the run.

**`workflow-merge-group`** reports a workflow with a `pull_request` trigger and no `merge_group` trigger: GitHub starts no run of it for a queued pull request, so its required checks never report. The file cannot show which checks are required, so a `pull_request` workflow whose checks are not required is reported too; narrow it with `workflows` and `exclude`. `pull_request_target` is left out, since it is not a place for required checks, and a workflow with no `pull_request` trigger is not judged. Limits: a `merge_group` trigger takes only `branches` filters (`paths` is a filter of `push`, `pull_request` and `pull_request_target`), so a workflow path-filtered for pull requests still runs in the queue once it has the trigger, and the `branches` filter of a `merge_group` trigger is not read ([workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)).

**`workflow-action-pinning`** encodes a pinning policy, and does not choose a side silently: pinning to a commit SHA protects against a moved tag or branch, and a ref lets the owner of a shared workflow roll out a fix without every caller changing. The default follows the reasoning that you do not control a third party but do control your own organisation: an action or reusable workflow from outside `organisations` must be pinned by full 40-character commit SHA (`thirdParty: 'sha'`), a Docker image by digest, and one owned by a listed organisation may use any ref (`sameOrganisation: 'ref'`). With no `organisations` configured, nothing is relaxed. `thirdParty` and `sameOrganisation` each take `sha` or `ref`, so either side of the policy can be flipped, `organisations` lists the owners that count as the same organisation, and `allow` exempts `owner/repository` or `owner/*` (for example `actions/*`). Local actions and workflows (`./...`) are not judged. Limits: it checks the form of the ref, not that the SHA belongs to the repository or to a release; composite actions are not read.

#### Two conflicts the checks settle

**`registry-url` does not disable tokenless publishing, so it is not banned.** `actions/setup-node` writes an `.npmrc` with `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` when `registry-url` is set, and since v7 exports `NODE_AUTH_TOKEN` only if the workflow supplied one ([`src/authutil.ts`](https://github.com/actions/setup-node/blob/main/src/authutil.ts), [archived](https://web.archive.org/web/20260524063017/https://github.com/actions/setup-node/blob/main/src/authutil.ts); the README says trusted publishing is unaffected because it does not use the variable). Its own trusted-publishing example sets `registry-url` ([`docs/advanced-usage.md`](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md), [archived](https://web.archive.org/web/20260822101733/https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md)), as does npm's ([trusted publishers](https://docs.npmjs.com/trusted-publishers), [archived](https://web.archive.org/web/20260921070919/https://docs.npmjs.com/trusted-publishers)). In the npm CLI the exchange runs in `npm publish` before credentials are read, and on success it overrides the registry's `_authToken` for the request ([`lib/utils/oidc.js`](https://github.com/npm/cli/blob/latest/lib/utils/oidc.js), [archived](https://web.archive.org/web/20260817065212/https://github.com/npm/cli/blob/latest/lib/utils/oidc.js)). The hazard is the failure path: the same code returns without throwing when the exchange fails, and the publish then proceeds with whatever token the `.npmrc` and environment give it (older `setup-node` majors exported the placeholder `XXXXX-XXXXX-XXXXX-XXXXX`, and the runner's own environment, or a `GITHUB_ENV` write by an earlier step, can supply `NODE_AUTH_TOKEN`; a secret reaches a step only when the workflow maps it into `env` or `with`, which `workflow-credentials` already treats as a publish that is not tokenless ([using secrets](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions))). Provenance does not close that path: npm signs it through Sigstore with the CI's own OIDC identity, separately from the registry token (`libnpmpublish`, `lib/publish.js` and `lib/provenance.js`), so a publish that fell back to an inherited token still goes ahead and carries an attestation. So `workflow-credentials` asks for the token variables to be blanked, which is the only protection, or provenance to be requested, which makes a fallback publish traceable, and says nothing about `registry-url`. The semantic-release npm plugin behaves the same way: it tries its own exchange first (`lib/verify-auth.js` and `lib/trusted-publishing/token-exchange.js` of `@semantic-release/npm`) and reads token configuration only when that fails. So a workflow may keep `registry-url`, and one that omits it gains nothing against a successful exchange; the repository's own release job omits it because trusted publishing needs no registry configuration.

**Pinning is a policy option.** See `workflow-action-pinning` above.

### Repository settings

The `settings-*` checks read repository settings through the GitHub API, so they need a token and are kept apart from the file checks. They run only when the run is given a GitHub client: `runChecks({ github })` in the library, `--settings` on the command line (which reads the token from `GITHUB_TOKEN` or `GH_TOKEN`). Without one they are left out, even when enabled, so the same configuration runs offline; naming one with `--check` or `checks` without a client, or enabling only settings checks and running offline, fails the run instead of reporting a pass. The client is an interface (`GitHubClient`, with `repository` and `branchRules`); `createGitHubClient({ token })` is the implementation over the REST API (GitHub reports the merge-method settings only to a token with write access to the repository, so `repository` fails with a `ConformanceError` for a read-only token), and a test or another host can supply its own. A violation's `file` is the repository, `owner/name`.

All three take `repository` (`owner/name`; the `origin` remote of the working directory, as configured before any `insteadOf` rewriting, when omitted) and `branch` (the repository's default branch). Rules are the effective rules of the branch from `GET /repos/{owner}/{repo}/rules/branches/{branch}` ([docs](https://docs.github.com/en/rest/repos/rules), [archived](https://web.archive.org/web/20260924024404/https://docs.github.com/en/rest/repos/rules)), which covers rulesets and not classic branch protection.

| Check | Verifies | Codes |
|---|---|---|
| `settings-merge-methods` | Only one merge method (`allowed`, `rebase` by default) is available: the repository allows it and no `pull_request` rule of the branch leaves it out. | `method-enabled`, `method-unavailable` |
| `settings-required-checks` | A `required_status_checks` rule requires the check of each junction job (`junctionJobs`, found in the workflows selected by `workflows` and `exclude`; the check name is the job's `name`, else its id) and some rule sets strict mode. | `no-junction-job`, `no-required-checks`, `required-check-missing`, `not-strict` |
| `settings-review-thread-resolution` | A `pull_request` rule requires review conversations to be resolved. | `not-required` |

Limits: classic branch protection and a merge queue's own merge method are not read, so a repository that uses classic protection is reported as having no required checks; a junction job in a reusable workflow, or a name that is an expression, is not resolved.

## Command line

```sh
workspace-conformance check [--cwd <directory>] [--check <name>]... [--list] [--settings]
```

`--cwd` is the directory that holds the config files (default: the current directory). `--check` runs only that check, which must be enabled, and may be repeated. `--list` prints every check and stops without reading any configuration. `--settings` also runs the enabled `settings-*` checks, which read the repository through the GitHub API with the token in `GITHUB_TOKEN` or `GH_TOKEN`; without it they are left out and the run is offline. Violations are printed to standard error as `file:line:column: code: message`.

| Exit status | Meaning |
|---|---|
| 0 | No violations. |
| 1 | At least one check found a violation. |
| 2 | The checks could not run: a usage error, an unknown or disabled check, a missing or invalid section, or a layout the tool cannot resolve. |

## Library

```ts
import { runChecks } from 'workspace-conformance';

const result = await runChecks({ cwd: process.cwd() });
// result.results: one { check, violations } per check that ran
// result.violations: all of them; result.exitCode: 0 or 1
```

`runChecks` loads both sections from `cwd` unless you pass `config` (the `conformance` section) or `layout`, which are validated with the same schemas as the ones it loads, and takes `checks` to run a subset, `github` (a `GitHubClient`, which switches the settings checks on) and `configFiles` (`alias`, `fsCache`, `trust`, and the `unified` and `standalone` layer options, each a `{ merge, presetSchema }` pair) for how config files load, with the same meaning as in `loadSection` of `@exadev/config`. Violations never throw. It throws `ConformanceError` when the checks cannot run and `ConfigValidationError` (from `@exadev/config`) when a section is invalid. Use it in a vitest test so the conformance suite runs with the rest:

```ts
import { runChecks } from 'workspace-conformance';
import { expect, it } from 'vitest';

it('conforms to the workspace layout', async () => {
  const { violations } = await runChecks({ cwd: process.cwd() });

  expect(violations).toEqual([]);
});
```

Every check is also exported as a function taking `{ cwd, options }` (and `layout` for the import checks): `aggregateMappers`, `codecPairs`, `commandTypes`, `derivedTypes`, `importUphill`, `importRankSkip`, `importCrossSlice`, `importIsolatedGroups`, `importCycles`, `instructionSymlinks`, `singleStorybook`, `commitTypes`, `enginesFloor`, `dockerfilePackageManager`, `migrationsDirectory`, `eslint`, the workflow checks (`workflowJobOrdering`, `workflowSkippableJobs`, `workflowRunnerResolution`, `workflowVersionSingleSource`, `workflowCredentials`, `workflowReleaseJob`, `workflowRepositoryDispatch`, `workflowUpdateBotCooldown`, `workflowMergeGroup` and `workflowActionPinning`) and, taking `{ cwd, options, github }`, the settings checks (`settingsMergeMethods`, `settingsRequiredChecks` and `settingsReviewThreadResolution`). These take options and a layout as already validated and do not check them again; go through `runChecks` for validation. `parseWorkflow` and `loadWorkflows` expose the workflow model the workflow checks read. A check is a function that returns `Promise<readonly Violation[]>`, where a `Violation` is `{ code, message, file, location? }`.

### Proving a handler map is exhaustive

A handler map typed as a mapped type over a union of commands makes the compiler demand a handler for every command. `proveExhaustive` proves that in a test: it type-checks the files in memory, then deletes each case in turn from the map and requires the type check to fail. If deleting a case still compiles, the map's type does not enforce exhaustiveness and it throws `ExhaustivenessError`.

```ts
import { proveExhaustive } from 'workspace-conformance';
import { it } from 'vitest';

const source = `
type Command = { readonly type: 'create'; readonly sku: string } | { readonly type: 'cancel'; readonly orderId: string };

type Handlers = { readonly [Type in Command['type']]: (command: Extract<Command, { readonly type: Type }>) => void };

export const handlers: Handlers = {
  create: (command) => void command.sku,
  cancel: (command) => void command.orderId,
};
`;

it('requires a handler for every command', () => {
  proveExhaustive({ files: { 'handlers.ts': source }, file: 'handlers.ts', map: 'handlers' });
});
```

The map is an object literal assigned to a variable of that name, with an optional type annotation, `satisfies` or `as`. Files can import each other with relative paths, `cases` limits which cases are removed, and `compilerOptions` overrides the strict defaults. `typeErrors`, `handlerCases` and `removeCase` are the pieces it is built from. A map typed `Partial<...>` or as a loose `Record` throws, because removing a case still compiles.

## Development

Requires Node 22.13 or later for the toolchain and pnpm. The published package supports the same lines as its dependency-cruiser dependency (`engines` in `package.json`), and the packaged-install check installs it with `engine-strict`, so a wider claim than the dependency tree allows fails CI.

```sh
pnpm install
pnpm lint            # eslint, with --fix
pnpm lint:check      # eslint, check only; what CI runs
pnpm typecheck
pnpm test            # vitest, with coverage
pnpm build           # tsdown: ESM, CJS and declarations, plus the bin
pnpm bench           # vitest bench of the import checks on a generated workspace; CI does not run it
pnpm test:mutation   # Stryker; CI runs it on manual dispatch only
```

CI also runs `pnpm exec publint` and `pnpm exec attw --pack` after the build, and installs the packed tarball into a scratch project on each supported Node line and both cosmiconfig majors (`test/package/install-check.sh`), where it runs the checks as ESM, as CommonJS and through the bin. dependency-cruiser is an ES module only, so the CommonJS build loads it with a dynamic `import()`.

Each check has a fixture that violates it and one that does not, under `test/fixtures`; the file-tree checks that need git build a repository in a temporary directory, the workflow checks have their fixtures under `test/fixtures/workflows`, and the settings checks run against an in-memory `GitHubClient`. The fixtures are excluded from the project's own typecheck and lint.

### Releases

Every push to `main` runs semantic-release once the commitlint, lint, typecheck and package jobs pass. It derives the next version from the Conventional Commits since the last tag, publishes to npm through trusted publishing with provenance, creates the tag and the GitHub Release, and pushes a `chore(release)` commit that updates `CHANGELOG.md` and `package.json`. `main` is protected by a ruleset that requires the Required Checks status, a branch up to date with `main`, linear history, and forbids deletion and non-fast-forward pushes. Pull requests therefore reach `main` by rebase merge once checks pass, and the release commit and tag are pushed over SSH with the repository deploy key, which the ruleset lets bypass it (as it does organisation admins). The key exists on disk only for the release step.

CI selects its runner with `ExaDev/runner-fallback-action` (self-hosted fleet first, Blacksmith as fallback). The release job stays on a GitHub-hosted runner because npm trusted publishing needs one, and publishes with provenance through OIDC, with no stored token. The repository deploy key (the `RELEASE_DEPLOY_KEY` secret) is a ruleset bypass actor, so it is written to disk by the step immediately before the release step, and only the release step's own environment carries `GIT_SSH_COMMAND` (absolute `/usr/bin/ssh`, no ssh config, a pinned GitHub host key, only the ssh protocol allowed); the key is deleted afterwards. The build and package checks run before the key exists and the release step sets `NPM_CONFIG_IGNORE_SCRIPTS`, so no dev dependency runs beside the key, the job's actions are pinned by commit SHA, and the checkout, the action setup and the dependency install run with no write-capable credential in git config. That limits what code from those steps can read; it is not a sandbox, since a process started earlier in the job still runs as the same user. `release.config.ts` sets an SSH `repositoryUrl`, so semantic-release pushes the release commit and tag over SSH. The default `GITHUB_TOKEN` cannot bypass a branch ruleset on `main`, and semantic-release falls back to pushing as it only when the SSH push fails, so the job dry-run pushes first and fails before publishing if the key does not authenticate, and refuses the https URL outright. Commits follow [Conventional Commits](https://www.conventionalcommits.org); semantic-release derives the version from them.

`README.md`, `AGENTS.md` and `CLAUDE.md` are one file: the two instruction files are tracked symlinks to this one.
