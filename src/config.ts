import { defineSection, type Section } from '@exadev/config';
import { z } from 'zod';

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

const importGraph = z.strictObject({ exclude: z.exactOptional(names), tsConfig: z.exactOptional(path) });

const enabled = <Options extends z.ZodType>(options: Options): z.ZodUnion<[z.ZodLiteral<false>, Options]> => z.union([z.literal(false), options]);

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
  'single-storybook': z.exactOptional(enabled(z.strictObject({ location: z.exactOptional(path) }))),
  'commit-types': z.exactOptional(enabled(z.strictObject({ commitlint: z.exactOptional(path), release: z.exactOptional(path) }))),
  'dockerfile-package-manager': z.exactOptional(enabled(z.strictObject({ dockerfiles: z.exactOptional(paths), packageJson: z.exactOptional(path) }))),
});

/**
 * The Standard Schema for {@link ConformanceConfig}. It rejects unknown keys at every level, so a misspelt check name or option fails when the section loads.
 */
export const conformanceSchema: z.ZodType<ConformanceConfig, ConformanceConfig> = z.strictObject({ checks });

/**
 * The `conformance` section. Pass it to `withSections` beside `layoutSection` when authoring `exadev.config.ts`.
 */
export const conformanceSection: Section<'conformance', z.ZodType<ConformanceConfig, ConformanceConfig>> = defineSection('conformance', conformanceSchema);
