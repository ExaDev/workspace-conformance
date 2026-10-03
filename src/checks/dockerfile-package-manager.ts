import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { CheckFunction, FileViolation } from '../check';
import { isRecord } from '../config-files';
import { excludedFrom, findFiles } from '../files';
import type { DockerfilePackageManagerOptions } from '../options';

const DEFAULT_DOCKERFILES: readonly string[] = ['**/Dockerfile', '**/Dockerfile.*', '**/*.Dockerfile'];
const DEFAULT_PACKAGE_JSON = 'package.json';

/**
 * A package manager and a version, `pnpm@12.4.1` or `pnpm@12.4.1+sha512.abc`, as `packageManager` and corepack write them.
 */
const PACKAGE_MANAGER = /^([a-z]+)@([^+\s]+)/u;

/**
 * A variable reference in a version: `$NAME` or `${NAME}`, capturing the name.
 */
const VARIABLE = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/gu;

/**
 * `<manager>@<version>` wherever a Dockerfile installs or activates a package manager. The manager is not the end of a longer name (`create-pnpm`, `@scope/pnpm`). The version is what a version is made of, plus variable references, and stops at anything else, such as a comma or a quote; a `+` suffix such as `+sha512.abc` is not part of it.
 */
const PIN = /(?<![\w./@-])(pnpm|yarn|npm)@((?:\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*|[0-9A-Za-z._-])+)/gu;

const INSTRUCTION = /^\s*(ARG|ENV)\s+(.*)$/iu;
const ASSIGNMENT = /([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S*)/gu;

function unquoted(value: string): string {
  return value.replace(/^(["'])(.*)\1$/u, '$2');
}

/**
 * The variables an `ARG` or `ENV` instruction sets, with the value it gives each, or `undefined` for an `ARG` without a default. `ARG NAME=value`, `ENV NAME=value NAME2=value2` and `ENV NAME value` are read; any other line sets nothing.
 */
function variablesSetBy(line: string): ReadonlyMap<string, string | undefined> {
  const [, instruction, body] = INSTRUCTION.exec(line) ?? [];
  const variables = new Map<string, string | undefined>();
  if (instruction === undefined || body === undefined) {
    return variables;
  }
  for (const [, name, value] of body.matchAll(ASSIGNMENT)) {
    if (name !== undefined && value !== undefined) {
      variables.set(name, unquoted(value));
    }
  }
  if (variables.size === 0) {
    const [name, ...value] = body.trim().split(/\s+/u);
    if (name !== undefined && name !== '') {
      variables.set(name, instruction.toUpperCase() === 'ENV' && value.length > 0 ? unquoted(value.join(' ')) : undefined);
    }
  }

  return variables;
}

/**
 * The version a pin names once the variables it refers to are replaced by the values in effect, or `undefined` when a variable has no value there (an `ARG` without a default, or a variable this file does not set) or its value refers to another variable, which makes the version unknowable from the file. A `+sha` suffix is dropped.
 */
function versionOf(token: string, variables: ReadonlyMap<string, string | undefined>): string | undefined {
  const unknown: string[] = [];
  const replaced = token.replace(VARIABLE, (_reference, variable: string) => {
    const value = variables.get(variable);
    if (value === undefined || value.includes('$')) {
      unknown.push(variable);

      return '';
    }

    return value;
  });

  return unknown.length === 0 ? replaced.split('+')[0] : undefined;
}

/**
 * Every pin of the package manager that `packageManager` names, in each Dockerfile, is the version `packageManager` names, with any `+sha` integrity suffix ignored on both sides. Pins of other package managers are not the workspace's package manager and are left alone.
 *
 * It reads `<manager>@<version>` as written on a line that is not a comment. A version that refers to a variable is compared with the value the file gives that variable by an `ARG` or `ENV` before the pin (the latest such value, whichever build stage it was in); one whose variable has no value in the file is not compared, since the build supplies it.
 */
export const dockerfilePackageManager: CheckFunction<DockerfilePackageManagerOptions> = async ({ cwd, options }) => {
  const packageJson = options.packageJson ?? DEFAULT_PACKAGE_JSON;
  const manifest: unknown = JSON.parse(await readFile(resolve(cwd, packageJson), 'utf8'));
  const declared = isRecord(manifest) && typeof manifest['packageManager'] === 'string' ? PACKAGE_MANAGER.exec(manifest['packageManager']) : null;
  const name = declared?.[1];
  const version = declared?.[2];
  if (name === undefined || version === undefined) {
    return [{ code: 'dockerfile-package-manager/no-package-manager', message: `${packageJson} has no valid 'packageManager' field to compare Dockerfile pins with`, file: packageJson }];
  }

  const violations: FileViolation[] = [];
  for (const file of await findFiles(cwd, [...(options.dockerfiles ?? DEFAULT_DOCKERFILES), ...excludedFrom(options.exclude)])) {
    const variables = new Map<string, string | undefined>();
    (await readFile(resolve(cwd, file), 'utf8')).split('\n').forEach((text, index) => {
      if (text.trimStart().startsWith('#')) {
        return;
      }
      for (const [variable, value] of variablesSetBy(text)) {
        variables.set(variable, value);
      }
      for (const match of text.matchAll(PIN)) {
        const pinned = versionOf(String(match[2]), variables);
        if (match[1] === name && pinned !== undefined && pinned !== version) {
          violations.push({
            code: 'dockerfile-package-manager/version-mismatch',
            message: `${file} pins ${name}@${pinned} but packageManager in ${packageJson} is ${name}@${version}`,
            file,
            location: { line: index + 1, column: match.index + 1 },
          });
        }
      }
    });
  }

  return violations;
};
