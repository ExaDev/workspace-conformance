import type { FileViolation } from '../../src/check';

/**
 * What a violation is, without its prose: the code, then the file and the line.
 */
export function where(violations: readonly FileViolation[]): readonly string[] {
  return violations.map((violation) => `${violation.code} ${violation.file}${violation.location === undefined ? '' : `:${String(violation.location.line)}`}`);
}
