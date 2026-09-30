import { describe, expect, it } from 'vitest';

import { conformanceSchema, conformanceSection } from './config';

async function issuesOf(value: unknown): Promise<readonly string[] | undefined> {
  const result = await conformanceSchema['~standard'].validate(value);

  return result.issues?.map((issue) => `${(issue.path ?? []).map(String).join('.')}: ${issue.message}`);
}

describe('conformanceSection', () => {
  it('is the conformance section', () => {
    expect(conformanceSection.name).toBe('conformance');
    expect(conformanceSection.schema).toBe(conformanceSchema);
  });
});

describe('conformanceSchema', () => {
  it('accepts checks with options, with empty options and switched off', async () => {
    const config = {
      checks: {
        'aggregate-mappers': { contracts: ['a.ts'], mapper: '{dir}/{name}.ts', adapters: '{dir}/*', exclude: ['X'], tsConfig: 'tsconfig.json' },
        'command-types': { commands: ['c.ts'], exclude: ['Command'], inferences: ['infer'], tsConfig: 'tsconfig.json' },
        'import-uphill': {},
        'import-rank-skip': { exclude: ['^x/'], doNotFollow: ['^y/'], tsConfig: 'tsconfig.json' },
        'import-cross-slice': false,
        'instruction-symlinks': { files: ['AGENTS.md'], directories: ['.'], target: 'README.md' },
        'single-storybook': { location: '.', exclude: ['test/fixtures/**'] },
        'commit-types': { commitlint: 'c.ts', release: 'r.ts' },
        'dockerfile-package-manager': { dockerfiles: ['Dockerfile'], exclude: ['test/fixtures/**'], packageJson: 'package.json' },
      },
    };

    expect(await issuesOf(config)).toBeUndefined();
    expect(await conformanceSchema['~standard'].validate(config)).toEqual({ value: config });
  });

  it('accepts no checks at all, which the runner reports as nothing enabled', async () => {
    expect(await issuesOf({ checks: {} })).toBeUndefined();
  });

  it('rejects a section without checks', async () => {
    expect(await issuesOf({})).toEqual(['checks: Invalid input: expected object, received undefined']);
  });

  it('rejects an unknown key at every level', async () => {
    expect(await issuesOf({ checks: {}, extra: 1 })).toEqual([': Unrecognized key: "extra"']);
    expect(await issuesOf({ checks: { 'import-uphill': { extra: 1 } } })).toBeDefined();
    expect(await issuesOf({ checks: { 'no-such-check': {} } })).toEqual(['checks: Unrecognized key: "no-such-check"']);
  });

  it('rejects a check whose required options are missing, and true as a setting', async () => {
    expect(await issuesOf({ checks: { 'aggregate-mappers': { mapper: 'x' } } })).toBeDefined();
    expect(await issuesOf({ checks: { 'command-types': true } })).toBeDefined();
    expect(await issuesOf({ checks: { 'import-uphill': true } })).toBeDefined();
  });

  it('rejects empty paths, empty lists of globs and options of the wrong type', async () => {
    expect(await issuesOf({ checks: { 'aggregate-mappers': { contracts: [], mapper: 'x' } } })).toBeDefined();
    expect(await issuesOf({ checks: { 'single-storybook': { location: '' } } })).toBeDefined();
    expect(await issuesOf({ checks: { 'import-uphill': { exclude: 'x' } } })).toBeDefined();
  });

  it('rejects an option written as undefined, as the type does under exactOptionalPropertyTypes', async () => {
    expect(await issuesOf({ checks: { 'single-storybook': { location: undefined } } })).toBeDefined();
  });

  it('rejects a regular expression that does not compile, at its position and without quoting it', async () => {
    const issues = await issuesOf({ checks: { 'import-uphill': { exclude: ['^ok/', '(SECRETREGEX13'], doNotFollow: ['[SECRETREGEX14'] } } });

    expect(issues).toEqual(['checks.import-uphill.exclude.1: not a valid regular expression', 'checks.import-uphill.doNotFollow.0: not a valid regular expression']);
  });
});
