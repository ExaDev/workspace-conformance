import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { CheckFunction, Violation } from '../check';
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
 * `<manager>@<version>` wherever a Dockerfile installs or activates a package manager.
 */
const PIN = /\b(pnpm|yarn|npm)@([^\s"'\\;&|)+]+)/gu;

/**
 * Every pin of the package manager that `packageManager` names, in each Dockerfile, is the version `packageManager` names, with any `+sha` integrity suffix ignored on both sides. Pins of other package managers are not the workspace's package manager and are left alone.
 *
 * It reads `<manager>@<version>` as written on a line that is not a comment, so a version held in an `ARG` or an environment variable and interpolated elsewhere is not seen.
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

  const violations: Violation[] = [];
  for (const file of await findFiles(cwd, [...(options.dockerfiles ?? DEFAULT_DOCKERFILES), ...excludedFrom(options.exclude)])) {
    (await readFile(resolve(cwd, file), 'utf8')).split('\n').forEach((text, index) => {
      if (text.trimStart().startsWith('#')) {
        return;
      }
      for (const match of text.matchAll(PIN)) {
        if (match[1] === name && match[2] !== version) {
          violations.push({
            code: 'dockerfile-package-manager/version-mismatch',
            message: `${file} pins ${name}@${String(match[2])} but packageManager in ${packageJson} is ${name}@${version}`,
            file,
            location: { line: index + 1, column: match.index + 1 },
          });
        }
      }
    });
  }

  return violations;
};
