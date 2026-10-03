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
        'codec-pairs': { codecs: ['codecs.ts'], encoder: 'encode{name}', decoder: 'decode{name}', exclude: ['encodeLegacy'], tsConfig: 'tsconfig.json' },
        'command-types': { commands: ['c.ts'], exclude: ['Command'], inferences: ['infer'], tsConfig: 'tsconfig.json' },
        'derived-types': { pairs: [{ schemas: ['s.ts'], types: ['t.ts'] }], exclude: ['Union'], inferences: ['infer'], tsConfig: 'tsconfig.json' },
        'import-uphill': {},
        'import-rank-skip': { exclude: ['^x/'], doNotFollow: ['^y/'], tsConfig: 'tsconfig.json' },
        'import-cross-slice': false,
        'instruction-symlinks': { files: ['AGENTS.md'], directories: ['.'], target: 'README.md' },
        'single-storybook': { location: '.', exclude: ['test/fixtures/**'] },
        'commit-types': { commitlint: 'c.ts', release: 'r.ts' },
        'dockerfile-package-manager': { dockerfiles: ['Dockerfile'], exclude: ['test/fixtures/**'], packageJson: 'package.json' },
        'workflow-job-ordering': { workflows: ['.github/workflows/ci.yml'], exclude: ['x'], releaseJobs: ['release'], deployJobs: ['deploy'], docsDeployJobs: ['docs'], junctionJobs: ['gate'], junctionExempt: ['nightly'], defaultBranch: 'main' },
        'workflow-skippable-jobs': { junctionJobs: ['gate'], pathFilterActions: ['dorny/paths-filter'] },
        'workflow-runner-resolution': { hostedLabels: ['^ubuntu-'] },
        'workflow-version-single-source': {},
        'workflow-credentials': {},
        'workflow-repository-dispatch': { defaultBranches: ['main'], assumeRequiredChecks: true },
        'workflow-update-bot-cooldown': { dependabot: '.github/dependabot.yml', renovate: 'renovate.json' },
        'workflow-merge-group': false,
        'workflow-action-pinning': { thirdParty: 'sha', sameOrganisation: 'ref', organisations: ['example-org'], allow: ['actions/*'] },
        'settings-merge-methods': { repository: 'example-org/example-repo', branch: 'main', allowed: 'rebase' },
        'settings-required-checks': { repository: 'example-org/example-repo', junctionJobs: ['gate'], workflows: ['.github/workflows/*.yml'] },
        'settings-review-thread-resolution': {},
        eslint: { samples: ['src/index.ts', { path: 'package.json', rules: { 'no-console': 'warn' } }], rules: { 'no-console': 'error' }, configFile: 'eslint.config.ts', lint: true, lintPatterns: ['src'] },
        'migrations-directory': {
          generator: 'drizzle-kit',
          deployTool: 'wrangler',
          generatorConfig: 'db/drizzle.config.ts',
          deployConfig: 'db/wrangler.toml',
          database: 'DB',
          environment: 'staging',
          packageJsons: ['package.json'],
        },
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

  it('rejects a derived-types check without pairs, or with a pair that lacks either list of globs', async () => {
    expect(await issuesOf({ checks: { 'derived-types': { pairs: [] } } })).toBeDefined();
    expect(await issuesOf({ checks: { 'derived-types': { pairs: [{ schemas: ['s.ts'] }] } } })).toBeDefined();
    expect(await issuesOf({ checks: { 'derived-types': { pairs: [{ schemas: [], types: ['t.ts'] }] } } })).toBeDefined();
    expect(await issuesOf({ checks: { 'derived-types': { pairs: [{ schemas: ['s.ts'], types: ['t.ts'], extra: 1 }] } } })).toBeDefined();
  });

  it('rejects a codec-pairs name template without exactly one {name} and other text, or with another placeholder, without quoting it, and an encoder template equal to the decoder template', async () => {
    const codecs = ['codecs.ts'];
    const issue = 'checks.codec-pairs.encoder: needs {name} exactly once, other text beside it and no other placeholder';

    expect(await issuesOf({ checks: { 'codec-pairs': { codecs, decoder: 'decode{name}' } } })).toBeDefined();
    expect(await issuesOf({ checks: { 'codec-pairs': { codecs, encoder: 'encode', decoder: 'decode{name}' } } })).toEqual([issue]);
    expect(await issuesOf({ checks: { 'codec-pairs': { codecs, encoder: '{name}', decoder: 'decode{name}' } } })).toEqual([issue]);
    expect(await issuesOf({ checks: { 'codec-pairs': { codecs, encoder: 'encode{name}{name}', decoder: 'decode{name}' } } })).toEqual([issue]);
    expect(await issuesOf({ checks: { 'codec-pairs': { codecs, encoder: 'encode{name}As{format}', decoder: 'decode{name}' } } })).toEqual([issue]);
    expect(await issuesOf({ checks: { 'codec-pairs': { codecs, encoder: 'codec{name}', decoder: 'codec{name}' } } })).toEqual([
      'checks.codec-pairs.decoder: the decoder template is the encoder template, so every name would be its own pair',
    ]);
  });

  it('rejects a migrations-directory check without both tools, or with one that has no adapter', async () => {
    expect(await issuesOf({ checks: { 'migrations-directory': {} } })).toBeDefined();
    expect(await issuesOf({ checks: { 'migrations-directory': { generator: 'drizzle-kit' } } })).toBeDefined();
    expect(await issuesOf({ checks: { 'migrations-directory': { generator: 'prisma', deployTool: 'wrangler' } } })).toBeDefined();
    expect(await issuesOf({ checks: { 'migrations-directory': { generator: 'drizzle-kit', deployTool: 'flyway' } } })).toBeDefined();
  });

  it('rejects an eslint check without samples, with a required severity other than warn or error, or with an unknown sample key', async () => {
    expect(await issuesOf({ checks: { eslint: {} } })).toBeDefined();
    expect(await issuesOf({ checks: { eslint: { samples: [] } } })).toBeDefined();
    expect(await issuesOf({ checks: { eslint: { samples: ['a.js'], rules: { 'no-console': 'off' } } } })).toBeDefined();
    expect(await issuesOf({ checks: { eslint: { samples: [{ path: 'a.js', except: ['x'] }] } } })).toBeDefined();
    expect(await issuesOf({ checks: { eslint: { samples: ['a.js'], lint: 'yes' } } })).toBeDefined();
  });

  it('rejects empty paths, empty lists of globs and options of the wrong type', async () => {
    expect(await issuesOf({ checks: { 'aggregate-mappers': { contracts: [], mapper: 'x' } } })).toBeDefined();
    expect(await issuesOf({ checks: { 'single-storybook': { location: '' } } })).toBeDefined();
    expect(await issuesOf({ checks: { 'import-uphill': { exclude: 'x' } } })).toBeDefined();
  });

  it('rejects a pinning level that is neither sha nor ref, a repository that is not owner/name and a boolean that is not one', async () => {
    expect(await issuesOf({ checks: { 'workflow-action-pinning': { thirdParty: 'tag' } } })).toBeDefined();
    expect(await issuesOf({ checks: { 'settings-merge-methods': { repository: 'example' } } })).toBeDefined();
    expect(await issuesOf({ checks: { 'settings-merge-methods': { allowed: 'fast-forward' } } })).toBeDefined();
    expect(await issuesOf({ checks: { 'workflow-repository-dispatch': { assumeRequiredChecks: 'yes' } } })).toBeDefined();
  });

  it('rejects an option written as undefined, as the type does under exactOptionalPropertyTypes', async () => {
    expect(await issuesOf({ checks: { 'single-storybook': { location: undefined } } })).toBeDefined();
  });

  it('rejects a regular expression that does not compile, at its position and without quoting it', async () => {
    const issues = await issuesOf({ checks: { 'import-uphill': { exclude: ['^ok/', '(SECRETREGEX13'], doNotFollow: ['[SECRETREGEX14'] } } });

    expect(issues).toEqual(['checks.import-uphill.exclude.1: not a valid regular expression', 'checks.import-uphill.doNotFollow.0: not a valid regular expression']);
  });

  it('says what is wrong with the options of a check whose setting is neither false nor valid options', async () => {
    expect(await issuesOf({ checks: { 'import-uphill': { tsConfig: 12345, bogus: 'x' } } })).toEqual([
      'checks.import-uphill: expected false or an options object: tsConfig: Invalid input: expected string, received number; Unrecognized key: "bogus"',
    ]);
    expect(await issuesOf({ checks: { 'single-storybook': 'x' } })).toEqual(['checks.single-storybook: expected false or an options object: Invalid input: expected object, received string']);
  });
});
