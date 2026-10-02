import { defineSection, type Section } from '@exadev/config';
import { z } from 'zod';

import { deployToolNames, generatorNames } from './migrations/adapters';
import type { CheckName, CheckOptionsByName } from './options';

/**
 * The `checks` map of the `conformance` section: a check runs when its name is present with an options object (`{}` for the defaults), and `false` turns it off, which lets a config that extends another switch one of its checks off.
 */
export type ChecksConfig = { readonly [Name in CheckName]?: false | CheckOptionsByName[Name] };

/**
 * The `conformance` section: which checks are enabled and their options.
 */
export interface ConformanceConfig {
  readonly checks: ChecksConfig;
}

const path = z.string().min(1);
const paths = z.array(path).min(1);
const names = z.array(z.string().min(1));

function compiles(source: string): boolean {
  try {
    new RegExp(source);

    return true;
  } catch {
    return false;
  }
}

/**
 * Source text of a regular expression that dependency-cruiser compiles as written. It is checked here because dependency-cruiser reports one that does not compile as a slow pattern and quotes it.
 */
const pattern = z.string().min(1).refine(compiles, 'not a valid regular expression');
const patterns = z.array(pattern);

const severity = z.enum(['warn', 'error']);
const requiredRules = z.record(z.string().min(1), severity);

const selection = { workflows: z.exactOptional(paths), exclude: z.exactOptional(paths) };
const pinningLevel = z.enum(['sha', 'ref']);
const settings = { repository: z.exactOptional(z.string().regex(/^[^/\s]+\/[^/\s]+$/u, 'expected owner/name')), branch: z.exactOptional(z.string().min(1)) };

const importGraph = z.strictObject({ exclude: z.exactOptional(patterns), doNotFollow: z.exactOptional(patterns), tsConfig: z.exactOptional(path) });

/**
 * A check's setting: `false`, or its options. A union reports only "Invalid input" for a setting that is wrong, so the issues of the options branch, which is the one the person meant unless they wrote `false`, are put in the message.
 */
const enabled = <Options extends z.ZodType>(options: Options): z.ZodUnion<[z.ZodLiteral<false>, Options]> =>
  z.union([z.literal(false), options], {
    error: (issue) => {
      const [, optionsIssues] = issue.errors;
      if (optionsIssues === undefined) {
        return undefined;
      }

      return `expected false or an options object: ${optionsIssues.map((found) => (found.path.length === 0 ? found.message : `${found.path.map(String).join('.')}: ${found.message}`)).join('; ')}`;
    },
  });

const checks: z.ZodType<ChecksConfig, ChecksConfig> = z.strictObject({
  'aggregate-mappers': z.exactOptional(
    enabled(
      z.strictObject({
        contracts: paths,
        mapper: path,
        adapters: z.exactOptional(path),
        exclude: z.exactOptional(names),
        tsConfig: z.exactOptional(path),
      }),
    ),
  ),
  'command-types': z.exactOptional(
    enabled(z.strictObject({ commands: paths, exclude: z.exactOptional(names), inferences: z.exactOptional(paths), tsConfig: z.exactOptional(path) })),
  ),
  'import-uphill': z.exactOptional(enabled(importGraph)),
  'import-rank-skip': z.exactOptional(enabled(importGraph)),
  'import-cross-slice': z.exactOptional(enabled(importGraph)),
  'import-isolated-groups': z.exactOptional(enabled(importGraph)),
  'import-cycles': z.exactOptional(enabled(importGraph)),
  'instruction-symlinks': z.exactOptional(
    enabled(z.strictObject({ files: z.exactOptional(paths), directories: z.exactOptional(paths), target: z.exactOptional(path) })),
  ),
  'single-storybook': z.exactOptional(enabled(z.strictObject({ location: z.exactOptional(path), exclude: z.exactOptional(paths) }))),
  'commit-types': z.exactOptional(enabled(z.strictObject({ commitlint: z.exactOptional(path), release: z.exactOptional(path) }))),
  'dockerfile-package-manager': z.exactOptional(enabled(z.strictObject({ dockerfiles: z.exactOptional(paths), exclude: z.exactOptional(paths), packageJson: z.exactOptional(path) }))),
  eslint: z.exactOptional(
    enabled(
      z.strictObject({
        samples: z.array(z.union([path, z.strictObject({ path, rules: z.exactOptional(requiredRules) })])).min(1),
        rules: z.exactOptional(requiredRules),
        configFile: z.exactOptional(path),
        lint: z.exactOptional(z.boolean()),
        lintPatterns: z.exactOptional(paths),
      }),
    ),
  ),
  'migrations-directory': z.exactOptional(
    enabled(
      z.strictObject({
        generator: z.enum(generatorNames),
        deployTool: z.enum(deployToolNames),
        generatorConfig: z.exactOptional(path),
        deployConfig: z.exactOptional(path),
        database: z.exactOptional(z.string().min(1)),
        environment: z.exactOptional(z.string().min(1)),
        packageJsons: z.exactOptional(paths),
      }),
    ),
  ),
  'workflow-job-ordering': z.exactOptional(
    enabled(
      z.strictObject({
        ...selection,
        releaseJobs: z.exactOptional(names),
        deployJobs: z.exactOptional(names),
        docsDeployJobs: z.exactOptional(names),
        junctionJobs: z.exactOptional(names),
        junctionExempt: z.exactOptional(names),
        defaultBranch: z.exactOptional(z.string().min(1)),
      }),
    ),
  ),
  'workflow-skippable-jobs': z.exactOptional(enabled(z.strictObject({ ...selection, junctionJobs: z.exactOptional(names), pathFilterActions: z.exactOptional(names) }))),
  'workflow-runner-resolution': z.exactOptional(enabled(z.strictObject({ ...selection, hostedLabels: z.exactOptional(patterns) }))),
  'workflow-version-single-source': z.exactOptional(enabled(z.strictObject(selection))),
  'workflow-credentials': z.exactOptional(enabled(z.strictObject(selection))),
  'workflow-repository-dispatch': z.exactOptional(enabled(z.strictObject({ ...selection, defaultBranches: z.exactOptional(names), assumeRequiredChecks: z.exactOptional(z.boolean()) }))),
  'workflow-update-bot-cooldown': z.exactOptional(enabled(z.strictObject({ dependabot: z.exactOptional(path), renovate: z.exactOptional(path) }))),
  'workflow-merge-group': z.exactOptional(enabled(z.strictObject(selection))),
  'workflow-action-pinning': z.exactOptional(
    enabled(z.strictObject({ ...selection, thirdParty: z.exactOptional(pinningLevel), sameOrganisation: z.exactOptional(pinningLevel), organisations: z.exactOptional(names), allow: z.exactOptional(names) })),
  ),
  'settings-merge-methods': z.exactOptional(enabled(z.strictObject({ ...settings, allowed: z.exactOptional(z.enum(['rebase', 'squash', 'merge'])) }))),
  'settings-required-checks': z.exactOptional(enabled(z.strictObject({ ...settings, ...selection, junctionJobs: z.exactOptional(names) }))),
  'settings-review-thread-resolution': z.exactOptional(enabled(z.strictObject(settings))),
});

/**
 * The Standard Schema for {@link ConformanceConfig}. It rejects unknown keys at every level, so a misspelt check name or option fails when the section loads.
 */
export const conformanceSchema: z.ZodType<ConformanceConfig, ConformanceConfig> = z.strictObject({ checks });

/**
 * The `conformance` section. Pass it to `withSections` beside `layoutSection` when authoring `exadev.config.ts`.
 */
export const conformanceSection: Section<'conformance', z.ZodType<ConformanceConfig, ConformanceConfig>> = defineSection('conformance', conformanceSchema);
