import type { ConfigFileOptions, LayoutConfig } from '@exadev/config';

import type { GitHubClient } from './github';

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
   * The directory the checks run in, absolute or relative to the working directory of the process; every path option is relative to it.
   */
  readonly cwd: string;
  readonly options: Options;
  /**
   * How config files that a check evaluates itself (the commitlint and release configs of `commit-types`) are loaded. Only `alias` and `fsCache` apply to evaluating a file; `trust` and the per-shape `unified` and `standalone` layer options are for `extends`. No transpile cache is written when omitted.
   */
  readonly configFiles?: ConfigFileOptions;
  /**
   * Receives what the check reports beside its violations: a line about what it did, such as how many files it linted, so a clean result can be told apart from one that looked at little. Nothing is reported when omitted.
   */
  readonly note?: (text: string) => void;
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

/**
 * What a check that reads repository settings through the GitHub API receives.
 */
export interface GitHubCheckContext<Options> extends CheckContext<Options> {
  readonly github: GitHubClient;
}

/**
 * A check that reads repository settings through the GitHub API. Its violations name the repository (`owner/name`) as the file.
 */
export type GitHubCheckFunction<Options> = (context: GitHubCheckContext<Options>) => Promise<readonly Violation[]>;
