import { isRecord } from '../config-files';
import { ConformanceError } from '../errors';

/**
 * Which of several things in a deploy tool's config the generator's output belongs to.
 */
export interface DeploySelector {
  /**
   * The binding of the database, when the config declares more than one.
   */
  readonly database?: string;
  /**
   * The named environment whose settings apply instead of the top-level ones.
   */
  readonly environment?: string;
}

/**
 * What a deploy tool's config says about the directory it applies migrations from.
 */
export type DeployDirectory =
  | { readonly directory: string; readonly none?: never }
  // `none` is the reason, in words, that the config declares nothing to apply migrations to.
  | { readonly none: string; readonly directory?: never };

/**
 * A schema generator, for the cross-check between where it writes migrations and where the deploy tool applies them from. The data of a config file is already read; an adapter only knows where in it the directory is.
 */
export interface GeneratorAdapter {
  /**
   * The names the config file may have, by precedence. The extension decides how the file is read.
   */
  readonly configFiles: readonly [string, ...string[]];
  /**
   * Matches a shell command that applies migrations with the generator itself, bypassing the deploy tool.
   */
  readonly applyCommand: RegExp;
  /**
   * The command as it is written, for messages.
   */
  readonly applyCommandName: string;
  /**
   * The directory the generator writes migrations to, as the config writes it (relative to the config file's directory) or the generator's default when the config sets none. Throws `ConformanceError` when the config is not of a shape the adapter can read.
   */
  readonly outputDirectory: (config: unknown, file: string) => string;
}

/**
 * A deploy tool that applies migrations from a directory.
 */
export interface DeployToolAdapter {
  /**
   * The names the config file may have, by precedence. The extension decides how the file is read.
   */
  readonly configFiles: readonly [string, ...string[]];
  /**
   * The directory the tool applies migrations from, as the config writes it (relative to the config file's directory) or the tool's default when the config sets none. Throws `ConformanceError` when the config is not of a shape the adapter can read or `selector` is needed and absent.
   */
  readonly migrationsDirectory: (config: unknown, file: string, selector: DeploySelector) => DeployDirectory;
}

/**
 * The generators that have an adapter.
 */
export const generatorNames = ['drizzle-kit'] as const;

/**
 * The deploy tools that have an adapter.
 */
export const deployToolNames = ['wrangler'] as const;

export type GeneratorName = (typeof generatorNames)[number];
export type DeployToolName = (typeof deployToolNames)[number];

function recordOf(config: unknown, file: string): Readonly<Record<string, unknown>> {
  if (!isRecord(config)) {
    throw new ConformanceError(`${file}: the config must be an object for the migrations directory to be read`);
  }

  return config;
}

const DRIZZLE_DEFAULT_OUT = 'drizzle';

/**
 * drizzle-kit: `out` of `drizzle.config.{ts,js,json}`, `drizzle` when unset. An empty `out` is a configuration error, not the default. Migrations are applied with `drizzle-kit migrate`; `push` writes no migration files and is not an apply command here.
 */
const drizzleKit: GeneratorAdapter = {
  configFiles: ['drizzle.config.ts', 'drizzle.config.js', 'drizzle.config.json'],
  applyCommand: /(?:^|[\s;&|(])drizzle-kit\s+migrate(?![\w:-])/u,
  applyCommandName: 'drizzle-kit migrate',
  outputDirectory: (config, file) => {
    const out = recordOf(config, file)['out'];
    if (out === undefined) {
      return DRIZZLE_DEFAULT_OUT;
    }
    if (typeof out !== 'string') {
      throw new ConformanceError(`${file}: 'out' must be a string`);
    }
    if (out === '') {
      throw new ConformanceError(`${file}: 'out' must not be empty: drizzle-kit reads an empty 'out' as unset in some commands, so the directory it names is ambiguous`);
    }

    return out;
  },
};

const WRANGLER_DEFAULT_MIGRATIONS_DIR = 'migrations';

function databasesOf(scope: Readonly<Record<string, unknown>>, file: string): readonly Readonly<Record<string, unknown>>[] {
  const databases = scope['d1_databases'];
  if (databases === undefined) {
    return [];
  }
  if (!Array.isArray(databases) || !databases.every(isRecord)) {
    throw new ConformanceError(`${file}: 'd1_databases' must be an array of objects`);
  }

  return databases;
}

/**
 * wrangler: `migrations_dir` of a `d1_databases` entry of `wrangler.json`, `wrangler.jsonc` or `wrangler.toml`, `migrations` when unset, relative to the config file. D1 databases are not inherited by an environment, so a named environment is read from its own `env.<name>` table.
 */
const wrangler: DeployToolAdapter = {
  configFiles: ['wrangler.json', 'wrangler.jsonc', 'wrangler.toml'],
  migrationsDirectory: (config, file, selector) => {
    const top = recordOf(config, file);
    let scope = top;
    if (selector.environment !== undefined) {
      const environments = top['env'];
      const environment = isRecord(environments) ? environments[selector.environment] : undefined;
      if (!isRecord(environment)) {
        throw new ConformanceError(`${file} has no environment '${selector.environment}' (checks.migrations-directory.environment)`);
      }
      scope = environment;
    }
    const where = selector.environment === undefined ? file : `${file} (environment '${selector.environment}')`;
    const databases = databasesOf(scope, file);
    const chosen = selector.database === undefined ? databases : databases.filter((database) => database['binding'] === selector.database);
    if (chosen.length > 1) {
      throw new ConformanceError(`${where} declares several D1 databases; name the one the generator writes for with checks.migrations-directory.database`);
    }
    const [only] = chosen;
    if (only === undefined) {
      return { none: selector.database === undefined ? `${where} declares no D1 database` : `${where} declares no D1 database with the binding '${selector.database}'` };
    }
    const directory = only['migrations_dir'];
    if (directory === undefined) {
      return { directory: WRANGLER_DEFAULT_MIGRATIONS_DIR };
    }
    if (typeof directory !== 'string') {
      throw new ConformanceError(`${where}: 'migrations_dir' must be a string`);
    }

    return { directory };
  },
};

export const generators: Readonly<Record<GeneratorName, GeneratorAdapter>> = { 'drizzle-kit': drizzleKit };

export const deployTools: Readonly<Record<DeployToolName, DeployToolAdapter>> = { wrangler };
