# workspace-conformance

Conformance checks for a pnpm workspace that ESLint cannot express. Type-graph checks run on [ts-morph](https://ts-morph.com), import-graph checks run on [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) with rules generated from the shared `layout` section of [`@exadev/config`](https://github.com/ExaDev/config), and file-tree and cross-config checks compare two files or read git state. Each check reports violations with a stable code, a message, a file and, where it has one, a position.

It complements the workspace architecture rules of [`@exadev/eslint-config`](https://github.com/ExaDev/eslint-config), it does not replace them. Those rules run in the editor and check what `package.json` files declare (`no-uphill-dependency` and `no-dependency-cycle`), incrementally and one file at a time. This tool checks what the code does: the import statements that actually cross packages, whether written as a package name, a relative path or a path alias, and everything that needs two files, the type checker or git. Both read the same `layout` section, so one description of the workspace drives both. Naming (`package-name-mirrors-path`) and per-file lint stay in ESLint.

## Getting started

```sh
pnpm add -D workspace-conformance @exadev/config cosmiconfig 'typescript@^6'
```

`cosmiconfig` (`^9.0.0 || ^10.0.0`) is a peer dependency because `@exadev/config` loads config files through it. `typescript` (`^5.9.0 || ^6.0.0`) is a peer dependency because dependency-cruiser needs it to parse TypeScript and supports versions below 7 (the range is in the install command because an unpinned `typescript` installs a newer major, which pnpm only warns about); the import checks fail with a configuration error when dependency-cruiser cannot load it. ts-morph bundles its own compiler and does not use yours. The package supports the Node lines dependency-cruiser and its own dependencies support: 22.13 and later 22, 24, and 26 and later.

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

The import checks generate dependency-cruiser rules from the layout in a pure function, cruise the packages' files once per check, and read `summary.violations`. They never use the exit code of `cruise()`, which is 0 whatever it found. A rule cannot compare ranks, so the ordering is expanded into path alternations at generation time: one rule per rank, slice or group pair rather than per package pair.

All import checks take these options:

| Option | Meaning |
|---|---|
| `exclude` | Regular expressions, as source text, for paths relative to the workspace root that are left out of the graph: neither a dependant nor a dependency. `node_modules` directories when omitted. Setting it replaces that default. |
| `doNotFollow` | Regular expressions for paths whose files can be imported but whose own imports are not followed, so build output is a target of imports and never a dependant. `dist` directories when omitted. Setting it replaces that default. |
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

**`command-types`** verifies that every command type is derived from a schema and not written by hand. An exported alias must apply a generic named in `inferences` (`infer`, `input`, `output`, `TypeOf`, `InferInput` and `InferOutput` by default, the last name of the reference, so `z.infer` and Valibot's `v.InferOutput` both count) to `typeof schema`, where the type of `schema` has the `~standard` member every Standard Schema has. The schema is recognised by type, so it may be imported or renamed and need not come from Zod. The generic may be imported under another name (`import type { infer as Infer }`), and an alias may stand between the export and the inference (`type Base = z.infer<typeof schema>; export type Created = Base;`): a local alias without type parameters is judged by the type it is written as. An alias with type parameters is not followed and is hand-written.

| Option | Meaning |
|---|---|
| `commands` | Globs of files that declare commands. Every exported interface and type alias in them is a command. |
| `exclude` | Names of exported types that are not commands, such as a union of them. |
| `inferences` | Replaces the default list of generics. |
| `tsConfig` | See above. |

Codes: `command-types/hand-written-interface`, `command-types/hand-written-alias` (an alias that applies none of the generics, including a union or a plain object type) and `command-types/not-a-schema` (an inference applied to something whose type has no `~standard` member). Limits: a union of commands is a hand-written alias unless excluded; a type exported from several listed files is judged once; only interfaces and type aliases are judged, including those inside an exported namespace or a module re-exported as a namespace (under their qualified names), so a class, enum or value is not a command here; when the schema library is not installed the schema's type does not resolve and the alias reports `not-a-schema`.

### File tree and cross-config

**`instruction-symlinks`** verifies that agent instruction files are symbolic links to the README beside them (written in any form that resolves there, such as `./README.md`, or through other tracked links, as `CLAUDE.md` to `AGENTS.md` to `README.md`), as git records them: mode `120000` in the index, not the working tree, so a checkout with `core.symlinks` false, which writes links out as plain files, is judged by what is committed. Options: `files` (`AGENTS.md` and `CLAUDE.md`), `directories` (globs, `.`), `target` (`README.md`). Codes: `instruction-symlinks/missing` (not tracked), `not-a-symlink`, `wrong-target` (the link does not resolve to the README, including a loop or an absolute target), `dangling` (the target is not tracked). It needs a git working tree and reads the index, so a link that is staged counts before it is committed.

**`single-storybook`** verifies that at most one Storybook exists, in one permitted directory (the workspace root by default, or `location`), and none inside a package such as a UI package. A Storybook is a `.storybook` directory; one anywhere else is `single-storybook/misplaced`. `exclude` (globs) leaves paths out of the search, such as test fixtures; a directory name (`test/fixtures`) leaves out everything under it, as `test/fixtures/**` does. A Storybook that is started only from a `package.json` script or a dependency, without a `.storybook` directory, is not seen, and a fixture or template directory that holds one is reported unless `exclude` names it.

**`commit-types`** verifies that the commit types commitlint accepts are accounted for in the semantic-release config. Options: `commitlint` (`commitlint.config.ts`) and `release` (`release.config.ts`). Both files are evaluated through the shared jiti loader, so a list derived from one shared constant compares as its values. The `alias` and `fsCache` of `runChecks`' `configFiles` apply to them as to the sections; `trust` and `merge` are for `extends` and do not. A commit type that no conventional preset knows (`PRESET_COMMIT_TYPES` lists the ones that do) must have a `releaseRules` entry in the `@semantic-release/commit-analyzer` options and, when `presetConfig.types` of `@semantic-release/release-notes-generator` is set, a changelog section. Every `releaseRules` type and every changelog type must be a commit type, or it can never apply. A preset type may be left out of either list, which is how a release rule list normally omits the types that do not release. Codes: `commit-types/no-release-rule`, `release-rule-not-a-commit-type`, `no-changelog-section`, `changelog-section-not-a-commit-type`, `no-type-enum` (a type no preset knows is listed but commitlint sets no `type-enum`, so the commit types cannot be read) and `missing-config`. Without `presetConfig.types` (or without a release notes generator) no changelog sections are listed, so none is required. Limits: `type-enum` is read as `[level, 'always', [types]]`, the only accepted types; `'never'` forbids the types it lists (a release rule or section for one is reported) and enumerates none, so nothing is required of any other type, and level 0 accepts every type; any other shape of the rule fails the check; `releaseRules` given as a module path (a string, which semantic-release supports) is not read and fails the check; types that come only from an extended preset are not read; rules that name no type (`{ breaking: true }`) are ignored; a changelog list that omits a preset type is not reported; the configs are executed, so they must be trusted.

**`dockerfile-package-manager`** verifies that a package manager version pinned in a Dockerfile is the one `packageManager` names, ignoring a `+sha` suffix on either side. Options: `dockerfiles` (`Dockerfile`, `Dockerfile.*` and `*.Dockerfile` at any depth), `exclude` (globs left out of the search) and `packageJson` (`package.json`). Only pins of the package manager `packageManager` names are compared: `pnpm@12.4.1` on a `RUN` line is compared, `npm@latest` is not. Codes: `dockerfile-package-manager/version-mismatch` (with line and column) and `no-package-manager`. A version that refers to a variable (`pnpm@${PNPM_VERSION}` or `pnpm@$PNPM_VERSION`) is compared with the value an `ARG` or `ENV` earlier in the same file gives it. Limits: it reads `<manager>@<version>` as written on a line that is not a comment; a variable the file gives no value (an `ARG` without a default, whose value the build supplies) or whose value refers to another variable is not compared; the value in effect is the latest one set before the pin, whichever build stage set it; and an unpinned `pnpm@latest` is a mismatch.

Checks that compare a generator's output directory with the migrations directory a deploy tool applies are tool specific and are not built.

## Command line

```sh
workspace-conformance check [--cwd <directory>] [--check <name>]... [--list]
```

`--cwd` is the directory that holds the config files (default: the current directory). `--check` runs only that check, which must be enabled, and may be repeated. `--list` prints every check and stops without reading any configuration. Violations are printed to standard error as `file:line:column: code: message`.

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

`runChecks` loads both sections from `cwd` unless you pass `config` (the `conformance` section) or `layout`, which are validated with the same schemas as the ones it loads, and takes `checks` to run a subset and `configFiles` (`alias`, `fsCache`, `trust`, `merge`) for how config files load. Violations never throw. It throws `ConformanceError` when the checks cannot run and `ConfigValidationError` (from `@exadev/config`) when a section is invalid. Use it in a vitest test so the conformance suite runs with the rest:

```ts
import { runChecks } from 'workspace-conformance';
import { expect, it } from 'vitest';

it('conforms to the workspace layout', async () => {
  const { violations } = await runChecks({ cwd: process.cwd() });

  expect(violations).toEqual([]);
});
```

Every check is also exported as a function taking `{ cwd, options }` (and `layout` for the import checks): `aggregateMappers`, `commandTypes`, `importUphill`, `importRankSkip`, `importCrossSlice`, `importIsolatedGroups`, `importCycles`, `instructionSymlinks`, `singleStorybook`, `commitTypes` and `dockerfilePackageManager`. These take options and a layout as already validated and do not check them again; go through `runChecks` for validation. A check is a function that returns `Promise<readonly Violation[]>`, where a `Violation` is `{ code, message, file, location? }`.

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
pnpm test:mutation   # Stryker; CI runs it on manual dispatch only
```

CI also runs `pnpm exec publint` and `pnpm exec attw --pack` after the build, and installs the packed tarball into a scratch project on each supported Node line and both cosmiconfig majors (`test/package/install-check.sh`), where it runs the checks as ESM, as CommonJS and through the bin. dependency-cruiser is an ES module only, so the CommonJS build loads it with a dynamic `import()`.

Each check has a fixture that violates it and one that does not, under `test/fixtures`; the file-tree checks that need git build a repository in a temporary directory. The fixtures are excluded from the project's own typecheck and lint.

CI selects its runner with `ExaDev/runner-fallback-action` (self-hosted fleet first, Blacksmith as fallback). The release job stays on a GitHub-hosted runner because npm trusted publishing needs one, and publishes with provenance through OIDC, with no stored token. Commits follow [Conventional Commits](https://www.conventionalcommits.org); semantic-release derives the version from them.

`README.md`, `AGENTS.md` and `CLAUDE.md` are one file: the two instruction files are tracked symlinks to this one.
