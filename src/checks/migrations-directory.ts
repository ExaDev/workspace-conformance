import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { findNodeAtLocation } from 'jsonc-parser';

import type { CheckFunction, Violation } from '../check';
import { findFiles } from '../files';
import { deployTools, generators } from '../migrations/adapters';
import { firstExisting, parseJsoncTree, readConfigData } from '../migrations/config-data';
import type { MigrationsDirectoryOptions } from '../options';
import { relativePosix } from '../paths';

const DEFAULT_PACKAGE_JSONS: readonly string[] = ['**/package.json'];

/**
 * The 1-based line and column of the character at `offset` in `text`, which is not the first character.
 */
function positionOf(text: string, offset: number): { readonly line: number; readonly column: number } {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;

  return { line: text.slice(0, lineStart).split('\n').length, column: offset - lineStart + 1 };
}

/**
 * The config file a check reads: the one the option names, else the first of the adapter's file names that exists. `undefined` when there is none.
 */
function locate(cwd: string, explicit: string | undefined, candidates: readonly string[]): string | undefined {
  return explicit === undefined ? firstExisting(cwd, candidates) : firstExisting(cwd, [explicit]);
}

function missingConfig(explicit: string | undefined, candidates: readonly [string, ...string[]]): Violation {
  return explicit === undefined
    ? { code: 'migrations-directory/missing-config', message: `none of ${candidates.join(', ')} exists`, file: candidates[0] }
    : { code: 'migrations-directory/missing-config', message: `${explicit} does not exist`, file: explicit };
}

/**
 * Violations for every script of the `package.json` at `file` that matches `command`.
 */
async function scriptViolations(cwd: string, file: string, command: Readonly<RegExp>, describe: (script: string, name: string) => string): Promise<readonly Violation[]> {
  const text = await readFile(resolve(cwd, file), 'utf8');
  const scripts = findNodeAtLocation(parseJsoncTree(text, file), ['scripts']);
  const violations: Violation[] = [];
  for (const entry of scripts?.children ?? []) {
    const [key, value] = entry.children ?? [];
    if (key?.type === 'string' && value?.type === 'string' && typeof value.value === 'string' && command.test(value.value)) {
      violations.push({
        code: 'migrations-directory/generator-apply-command',
        message: describe(value.value, String(key.value)),
        file,
        location: positionOf(text, value.offset),
      });
    }
  }

  return violations;
}

/**
 * The directory a schema generator writes migrations to is the one the deploy tool applies them from, and no script applies them with the generator instead of the deploy tool. The generator and the deploy tool are named in the options and each has an adapter that knows its config file names and where in them the directory is; both directories are resolved against the directory of the file that sets them.
 *
 * The config files are read as data: JSON, JSONC and TOML are parsed, and a module (a generator's TypeScript config) is evaluated, so it must be trusted.
 */
export const migrationsDirectory: CheckFunction<MigrationsDirectoryOptions> = async ({ cwd, options, configFiles }) => {
  const generator = generators[options.generator];
  const deployTool = deployTools[options.deployTool];
  const violations: Violation[] = [];

  const generatorFile = locate(cwd, options.generatorConfig, generator.configFiles);
  const deployFile = locate(cwd, options.deployConfig, deployTool.configFiles);
  if (generatorFile === undefined) {
    violations.push(missingConfig(options.generatorConfig, generator.configFiles));
  }
  if (deployFile === undefined) {
    violations.push(missingConfig(options.deployConfig, deployTool.configFiles));
  }

  if (generatorFile !== undefined && deployFile !== undefined) {
    const written = generator.outputDirectory(await readConfigData(cwd, generatorFile, configFiles), generatorFile);
    const applied = deployTool.migrationsDirectory(await readConfigData(cwd, deployFile, configFiles), deployFile, {
      ...(options.database === undefined ? {} : { database: options.database }),
      ...(options.environment === undefined ? {} : { environment: options.environment }),
    });
    if (applied.none !== undefined) {
      violations.push({ code: 'migrations-directory/no-database', message: applied.none, file: deployFile });
    } else {
      const generated = resolve(cwd, dirname(generatorFile), written);
      const deployed = resolve(cwd, dirname(deployFile), applied.directory);
      if (generated !== deployed) {
        violations.push({
          code: 'migrations-directory/mismatch',
          message: `${generatorFile} writes migrations to ${relativePosix(cwd, generated)}, but ${deployFile} applies them from ${relativePosix(cwd, deployed)}`,
          file: generatorFile,
        });
      }
    }
  }

  for (const file of await findFiles(cwd, options.packageJsons ?? DEFAULT_PACKAGE_JSONS)) {
    violations.push(
      ...(await scriptViolations(
        cwd,
        file,
        generator.applyCommand,
        (script, name) => `the script '${name}' runs '${generator.applyCommandName}' (${script}) where migrations are applied by ${options.deployTool}`,
      )),
    );
  }

  return violations;
};
