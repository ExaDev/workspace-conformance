import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createJitiLoader } from 'cosmiconfig-extends';

/**
 * A record: a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The default export of the config file at `file` (relative to `cwd`), evaluated through the shared jiti loader so a TypeScript config runs as its own tool would run it, or `undefined` when the file does not exist.
 */
export async function evaluateConfigFile(cwd: string, file: string): Promise<unknown> {
  const absolute = resolve(cwd, file);
  if (!existsSync(absolute)) {
    return undefined;
  }

  return createJitiLoader().importer.importDefault(absolute);
}
