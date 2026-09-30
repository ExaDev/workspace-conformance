import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ConfigFileOptions } from '@exadev/config';
import { createJitiLoader } from 'cosmiconfig-extends';

/**
 * A record: a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The default export of the config file at `file` (relative to `cwd`), evaluated through the shared jiti loader, with the `alias` and `fsCache` of `configFiles`, so a TypeScript config runs as its own tool would run it, or `undefined` when the file does not exist.
 */
export async function evaluateConfigFile(cwd: string, file: string, configFiles: ConfigFileOptions | undefined): Promise<unknown> {
  const absolute = resolve(cwd, file);
  if (!existsSync(absolute)) {
    return undefined;
  }

  // No on-disk transpile cache unless the caller asks for one: a check reads the workspace and leaves it as it found it.
  return createJitiLoader({ ...(configFiles?.alias === undefined ? {} : { alias: configFiles.alias }), fsCache: configFiles?.fsCache ?? false }).importer.importDefault(absolute);
}
