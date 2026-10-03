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
 * A way the workspace fails a check that is about a file.
 */
export interface FileViolation {
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
  readonly repository?: never;
}

/**
 * A way the repository fails a check that reads its settings, which is about the repository and no file in it.
 */
export interface RepositoryViolation {
  /**
   * Stable identifier of the rule that was broken, `<check name>/<reason>`. Callers may match on it; the message may change.
   */
  readonly code: string;
  readonly message: string;
  /**
   * The repository the violation is about, `owner/name`.
   */
  readonly repository: string;
  readonly file?: never;
  readonly location?: never;
}

/**
 * One way the workspace fails a check: about a file ({@link FileViolation}, with `file`) or about the repository's settings ({@link RepositoryViolation}, with `repository`). A violation has exactly one of the two, so `violation.file === undefined` tells them apart.
 */
export type Violation = FileViolation | RepositoryViolation;

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
export type CheckFunction<Options> = (context: CheckContext<Options>) => Promise<readonly FileViolation[]>;

/**
 * A check that also needs the resolved workspace layout.
 */
export type LayoutCheckFunction<Options> = (context: LayoutCheckContext<Options>) => Promise<readonly FileViolation[]>;

/**
 * What a check that reads repository settings through the GitHub API receives.
 */
export interface GitHubCheckContext<Options> extends CheckContext<Options> {
  readonly github: GitHubClient;
}

/**
 * A check that reads repository settings through the GitHub API. Its violations are about the repository, which they name as `owner/name`.
 */
export type GitHubCheckFunction<Options> = (context: GitHubCheckContext<Options>) => Promise<readonly RepositoryViolation[]>;

/**
 * What a check that reads files, and the repository's settings too when it can, receives.
 */
export interface SettingsAwareCheckContext<Options> extends CheckContext<Options> {
  /**
   * The client to read the repository's settings through; absent when the run is offline, and the check then judges from the files alone.
   */
  readonly github?: GitHubClient;
}

/**
 * A check that reads files and refines its judgement with the repository's settings when the run is given a GitHub client. It runs offline too, unlike a {@link GitHubCheckFunction}.
 */
export type SettingsAwareCheckFunction<Options> = (context: SettingsAwareCheckContext<Options>) => Promise<readonly FileViolation[]>;
