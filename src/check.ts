import type { ConfigFileOptions, LayoutConfig } from '@exadev/config';

/**
 * A position in a file, both numbers counted from 1.
 */
export interface SourceLocation {
  readonly line: number;
  readonly column: number;
}

/**
 * One way the workspace fails a check.
 */
export interface Violation {
  /**
   * Stable identifier of the rule that was broken, `<check name>/<reason>`. Callers may match on it; the message may change.
   */
  readonly code: string;
  readonly message: string;
  /**
   * The file the violation is about, relative to the directory the checks ran in, with `/` separators. For a violation about a file that should exist and does not, the file that is missing or the file that requires it.
   */
  readonly file: string;
  readonly location?: SourceLocation;
}

/**
 * What every check receives.
 */
export interface CheckContext<Options> {
  /**
   * The directory the checks run in; every path option is relative to it.
   */
  readonly cwd: string;
  readonly options: Options;
  /**
   * How config files that a check evaluates itself (the commitlint and release configs of `commit-types`) are loaded. Only `alias` and `fsCache` apply to evaluating a file; `trust` and `merge` are for `extends`. No transpile cache is written when omitted.
   */
  readonly configFiles?: ConfigFileOptions;
}

/**
 * What a check that reads the workspace layout receives.
 */
export interface LayoutCheckContext<Options> extends CheckContext<Options> {
  readonly layout: LayoutConfig;
}

/**
 * A check: reads the workspace and returns everything it finds wrong, in a stable order. It throws `ConformanceError` when it cannot run.
 */
export type CheckFunction<Options> = (context: CheckContext<Options>) => Promise<readonly Violation[]>;

/**
 * A check that also needs the resolved workspace layout.
 */
export type LayoutCheckFunction<Options> = (context: LayoutCheckContext<Options>) => Promise<readonly Violation[]>;
