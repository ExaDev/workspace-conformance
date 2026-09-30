import { relative, sep } from 'node:path';

/**
 * `path` with the platform separator replaced by `/`, the form paths take in violations and in options.
 */
export function toPosix(path: string): string {
  return path.split(sep).join('/');
}

/**
 * `absolute` relative to `cwd`, with `/` separators.
 */
export function relativePosix(cwd: string, absolute: string): string {
  return toPosix(relative(cwd, absolute));
}
