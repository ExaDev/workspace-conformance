/**
 * A problem with how the tool was used or configured rather than a finding about the workspace: an unknown or disabled check, a missing or invalid section, a layout that cannot be resolved, a repository that is not a git checkout. The command line reports it and exits 2.
 */
export class ConformanceError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConformanceError';
  }
}
