import { describe, expect, it } from 'vitest';

import { fixturePath } from '../test/support/temp';
import { runCommand } from './cli-command';
import { checkNames } from './registry';
import { EXIT_CODES } from './run-checks';

interface Captured {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function run(...args: readonly string[]): Promise<Captured> {
  let stdout = '';
  let stderr = '';
  const code = await runCommand(args, {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });

  return { code, stdout, stderr };
}

describe('check', () => {
  it('exits 0 and names the checks that ran when nothing is found', async () => {
    const result = await run('check', '--cwd', fixturePath('imports', 'clean'));

    expect(result).toEqual({
      code: EXIT_CODES.clean,
      stdout: 'no violations from import-uphill, import-rank-skip, import-cross-slice, import-isolated-groups, import-cycles\n',
      stderr: '',
    });
  });

  it('exits 1 and prints each violation as file, code and message', async () => {
    const result = await run('check', '--cwd', fixturePath('imports', 'violating'), '--check', 'import-uphill');

    expect(result.code).toBe(EXIT_CODES.violations);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'core/kernel/src/index.ts: import-uphill/higher-rank: @fx/core-kernel (rank 0) imports features/billing/src/index.ts in @fx/features-billing (rank 1), a higher rank\n',
    );
  });

  it('prints the line and column when a violation has a location', async () => {
    const result = await run('check', '--cwd', fixturePath('violating-locations'));

    expect(result.code).toBe(EXIT_CODES.violations);
    expect(result.stderr).toMatch(/^Dockerfile:2:22: dockerfile-package-manager\/version-mismatch: /u);
  });

  it('runs several requested checks', async () => {
    const result = await run('check', '--cwd', fixturePath('imports', 'violating'), '--check', 'import-cycles', '--check', 'import-uphill');

    expect(result.stderr.split('\n').filter((line) => line !== '')).toHaveLength(2);
  });

  it('exits 2 for an unknown check, naming the ones that exist', async () => {
    const result = await run('check', '--cwd', fixturePath('imports', 'clean'), '--check', 'nope');

    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr).toContain("unknown check 'nope'");
    expect(result.stderr).toContain(checkNames.join(', '));
  });

  it('exits 2 for a check that is not enabled', async () => {
    const result = await run('check', '--cwd', fixturePath('imports', 'clean'), '--check', 'single-storybook');

    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr).toContain('single-storybook is not enabled');
  });

  it('exits 2 when the directory has no conformance section', async () => {
    const result = await run('check', '--cwd', fixturePath('storybook', 'clean'));

    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr).toContain("no 'conformance' section");
  });

  it('exits 2 for an unknown option', async () => {
    const result = await run('check', '--nope');

    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr).toContain('--nope');
  });
});

describe('check --list', () => {
  it('still rejects a check that does not exist', async () => {
    const result = await run('check', '--list', '--check', 'nope');

    expect(result.code).toBe(EXIT_CODES.failed);
    expect(result.stderr).toContain("unknown check 'nope'");
  });

  it('prints every check with its description and needs no configuration', async () => {
    const result = await run('check', '--list', '--cwd', fixturePath('storybook', 'clean'));

    expect(result.code).toBe(EXIT_CODES.clean);
    expect(result.stdout.split('\n').filter((line) => line !== '').map((line) => line.split('\t')[0])).toEqual(checkNames);
  });
});

describe('the command', () => {
  it('prints usage for --help, -h and help and for check --help and check -h, and exits 0', async () => {
    for (const args of [['--help'], ['-h'], ['help'], ['check', '--help'], ['check', '-h']]) {
      const result = await run(...args);

      expect(result.code).toBe(EXIT_CODES.clean);
      expect(result.stdout).toContain('Usage: workspace-conformance check');
    }
  });

  it('exits 2 without a command or with an unknown one, printing usage', async () => {
    const missing = await run();
    const unknown = await run('nope');

    expect(missing.code).toBe(EXIT_CODES.failed);
    expect(missing.stderr).toContain('missing command');
    expect(unknown.code).toBe(EXIT_CODES.failed);
    expect(unknown.stderr).toContain("unknown command 'nope'");
    expect(unknown.stderr).toContain('Usage: workspace-conformance check');
  });
});
