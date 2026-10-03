import { describe, expect, it } from 'vitest';

import { runChecks } from '../src/run-checks';

describe('this repository', () => {
  it('conforms to the checks that apply to a single package', async () => {
    const { violations } = await runChecks({
      cwd: process.cwd(),
      // The fixtures hold Storybooks and Dockerfiles on purpose.
      config: {
        checks: {
          'commit-types': {},
          'instruction-symlinks': {},
          'single-storybook': { exclude: ['test/fixtures/**'] },
          'dockerfile-package-manager': { exclude: ['test/fixtures/**'] },
          'engines-floor': {},
          'workflow-job-ordering': {},
          // The fallback is Blacksmith, which runs outside both the self-hosted fleet and GitHub's own billing.
          'workflow-runner-resolution': { hostedLabels: ['^blacksmith-', '^(?:ubuntu|windows|macos)-'] },
          'workflow-credentials': {},
          'workflow-skippable-jobs': {},
          'workflow-version-single-source': {},
        },
      },
    });

    expect(violations).toEqual([]);
  });
});
