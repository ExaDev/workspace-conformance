import { afterEach, describe, expect, it } from 'vitest';

import { fixturePath, makeTempDir, removeTempDirs, writeFiles } from '../../test/support/temp';
import { ConformanceError } from '../errors';
import type { MigrationsDirectoryOptions } from '../options';
import { migrationsDirectory } from './migrations-directory';

afterEach(removeTempDirs);

const options: MigrationsDirectoryOptions = { generator: 'drizzle-kit', deployTool: 'wrangler' };

function drizzle(out: string | undefined): string {
  return `export default { dialect: 'sqlite', ${out === undefined ? '' : `out: '${out}'`} };\n`;
}

function wranglerJson(databases: readonly Readonly<Record<string, string>>[]): string {
  return JSON.stringify({ name: 'worker', d1_databases: databases });
}

async function workspace(files: Readonly<Record<string, string>>): Promise<string> {
  const cwd = await makeTempDir();
  await writeFiles(cwd, files);

  return cwd;
}

describe('migrations-directory on the fixtures', () => {
  it('reports nothing when the generator writes where the deploy tool applies from', async () => {
    expect(await migrationsDirectory({ cwd: fixturePath('migrations-directory', 'clean'), options })).toEqual([]);
  });

  it('reports the directories that differ and the script that applies migrations with the generator', async () => {
    expect(await migrationsDirectory({ cwd: fixturePath('migrations-directory', 'violating'), options })).toEqual([
      {
        code: 'migrations-directory/mismatch',
        message: 'drizzle.config.ts writes migrations to drizzle, but wrangler.toml applies them from migrations',
        file: 'drizzle.config.ts',
      },
      {
        code: 'migrations-directory/generator-apply-command',
        message: "the script 'db:apply' runs 'drizzle-kit migrate' (pnpm exec drizzle-kit migrate) where migrations are applied by wrangler",
        file: 'package.json',
        location: { line: 6, column: 17 },
      },
    ]);
  });
});

describe('migrations-directory comparing the directories', () => {
  it('compares the defaults of both tools when neither config sets a directory', async () => {
    const cwd = await workspace({ 'drizzle.config.ts': drizzle(undefined), 'wrangler.json': wranglerJson([{ binding: 'DB' }]) });

    expect((await migrationsDirectory({ cwd, options })).map((violation) => violation.message)).toEqual([
      'drizzle.config.ts writes migrations to drizzle, but wrangler.json applies them from migrations',
    ]);
  });

  it('accepts the same directory written differently', async () => {
    const cwd = await workspace({ 'drizzle.config.ts': drizzle('./db/migrations/'), 'wrangler.json': wranglerJson([{ binding: 'DB', migrations_dir: 'db/../db/migrations' }]) });

    expect(await migrationsDirectory({ cwd, options })).toEqual([]);
  });

  it('resolves each path against the directory of the file that sets it', async () => {
    const cwd = await workspace({
      'apps/api/drizzle.config.ts': drizzle('../shared/migrations'),
      'apps/api/wrangler.toml': '[[d1_databases]]\nbinding = "DB"\nmigrations_dir = "../shared/migrations"\n',
      'apps/worker/src/wrangler.toml': '[[d1_databases]]\nbinding = "DB"\nmigrations_dir = "../shared/migrations"\n',
    });

    expect(await migrationsDirectory({ cwd, options: { ...options, generatorConfig: 'apps/api/drizzle.config.ts', deployConfig: 'apps/api/wrangler.toml' } })).toEqual([]);

    const [mismatch] = await migrationsDirectory({ cwd, options: { ...options, generatorConfig: 'apps/api/drizzle.config.ts', deployConfig: 'apps/worker/src/wrangler.toml' } });
    expect(mismatch?.message).toBe('apps/api/drizzle.config.ts writes migrations to apps/shared/migrations, but apps/worker/src/wrangler.toml applies them from apps/worker/shared/migrations');
  });

  it.each([
    ['wrangler.json', wranglerJson([{ binding: 'DB', migrations_dir: 'drizzle' }])],
    ['wrangler.jsonc', '{\n  // comment\n  "d1_databases": [{ "binding": "DB", "migrations_dir": "drizzle", },],\n}\n'],
    ['wrangler.toml', '[[d1_databases]]\nbinding = "DB"\nmigrations_dir = "drizzle"\n'],
  ])('reads the deploy config from %s', async (name, content) => {
    const cwd = await workspace({ 'drizzle.config.ts': drizzle('drizzle'), [name]: content });

    expect(await migrationsDirectory({ cwd, options })).toEqual([]);
  });

  it('reads a JSON drizzle config', async () => {
    const cwd = await workspace({ 'drizzle.config.json': '{ "out": "drizzle" }', 'wrangler.json': wranglerJson([{ binding: 'DB', migrations_dir: 'drizzle' }]) });

    expect(await migrationsDirectory({ cwd, options })).toEqual([]);
  });

  it('prefers the deploy config file the tool itself prefers', async () => {
    const cwd = await workspace({
      'drizzle.config.ts': drizzle('drizzle'),
      'wrangler.json': wranglerJson([{ binding: 'DB', migrations_dir: 'drizzle' }]),
      'wrangler.toml': '[[d1_databases]]\nbinding = "DB"\nmigrations_dir = "elsewhere"\n',
    });

    expect(await migrationsDirectory({ cwd, options })).toEqual([]);
  });
});

describe('migrations-directory with several databases and environments', () => {
  const several = wranglerJson([
    { binding: 'PRIMARY', migrations_dir: 'drizzle' },
    { binding: 'ANALYTICS', migrations_dir: 'analytics' },
  ]);

  it('fails instead of guessing which database the generator writes for', async () => {
    const cwd = await workspace({ 'drizzle.config.ts': drizzle('drizzle'), 'wrangler.json': several });

    await expect(migrationsDirectory({ cwd, options })).rejects.toThrow(ConformanceError);
    await expect(migrationsDirectory({ cwd, options })).rejects.toThrow('checks.migrations-directory.database');
  });

  it('compares with the database that is named', async () => {
    const cwd = await workspace({ 'drizzle.config.ts': drizzle('drizzle'), 'wrangler.json': several });

    expect(await migrationsDirectory({ cwd, options: { ...options, database: 'PRIMARY' } })).toEqual([]);
    expect((await migrationsDirectory({ cwd, options: { ...options, database: 'ANALYTICS' } })).map((violation) => violation.code)).toEqual(['migrations-directory/mismatch']);
  });

  it('reports a database that the deploy config does not declare, and a config that declares none', async () => {
    const cwd = await workspace({ 'drizzle.config.ts': drizzle('drizzle'), 'wrangler.json': several });
    const none = await workspace({ 'drizzle.config.ts': drizzle('drizzle'), 'wrangler.json': '{ "name": "worker" }' });

    expect(await migrationsDirectory({ cwd, options: { ...options, database: 'MISSING' } })).toEqual([
      { code: 'migrations-directory/no-database', message: "wrangler.json declares no D1 database with the binding 'MISSING'", file: 'wrangler.json' },
    ]);
    expect(await migrationsDirectory({ cwd: none, options })).toEqual([{ code: 'migrations-directory/no-database', message: 'wrangler.json declares no D1 database', file: 'wrangler.json' }]);
  });

  it('reads the tables of a named environment, which does not inherit the top-level databases', async () => {
    const config = JSON.stringify({
      d1_databases: [{ binding: 'DB', migrations_dir: 'drizzle' }],
      env: { staging: { d1_databases: [{ binding: 'DB', migrations_dir: 'staging-migrations' }] }, empty: {} },
    });
    const cwd = await workspace({ 'drizzle.config.ts': drizzle('drizzle'), 'wrangler.json': config });

    expect(await migrationsDirectory({ cwd, options })).toEqual([]);
    expect((await migrationsDirectory({ cwd, options: { ...options, environment: 'staging' } })).map((violation) => violation.message)).toEqual([
      'drizzle.config.ts writes migrations to drizzle, but wrangler.json applies them from staging-migrations',
    ]);
    expect(await migrationsDirectory({ cwd, options: { ...options, environment: 'empty' } })).toEqual([
      { code: 'migrations-directory/no-database', message: "wrangler.json (environment 'empty') declares no D1 database", file: 'wrangler.json' },
    ]);
    await expect(migrationsDirectory({ cwd, options: { ...options, environment: 'production' } })).rejects.toThrow("has no environment 'production'");
  });
});

describe('migrations-directory with config files that are missing or unreadable', () => {
  it('reports each config file that does not exist, by the default names or by the option', async () => {
    const cwd = await workspace({ 'package.json': '{}' });

    expect(await migrationsDirectory({ cwd, options })).toEqual([
      { code: 'migrations-directory/missing-config', message: 'none of drizzle.config.ts, drizzle.config.js, drizzle.config.json exists', file: 'drizzle.config.ts' },
      { code: 'migrations-directory/missing-config', message: 'none of wrangler.json, wrangler.jsonc, wrangler.toml exists', file: 'wrangler.json' },
    ]);
    expect(await migrationsDirectory({ cwd, options: { ...options, generatorConfig: 'db/drizzle.config.ts', deployConfig: 'db/wrangler.toml' } })).toEqual([
      { code: 'migrations-directory/missing-config', message: 'db/drizzle.config.ts does not exist', file: 'db/drizzle.config.ts' },
      { code: 'migrations-directory/missing-config', message: 'db/wrangler.toml does not exist', file: 'db/wrangler.toml' },
    ]);
  });

  it('still checks the scripts when a config file is missing', async () => {
    const cwd = await workspace({ 'wrangler.toml': '', 'package.json': '{ "scripts": { "migrate": "drizzle-kit migrate" } }' });

    expect((await migrationsDirectory({ cwd, options })).map((violation) => violation.code)).toEqual(['migrations-directory/missing-config', 'migrations-directory/generator-apply-command']);
  });

  it('fails on a config it cannot parse, naming the file', async () => {
    const json = await workspace({ 'drizzle.config.ts': drizzle('drizzle'), 'wrangler.json': '{ "d1_databases": ' });
    const toml = await workspace({ 'drizzle.config.ts': drizzle('drizzle'), 'wrangler.toml': 'binding = ' });

    await expect(migrationsDirectory({ cwd: json, options })).rejects.toThrow('wrangler.json: not valid JSON');
    await expect(migrationsDirectory({ cwd: toml, options })).rejects.toThrow('wrangler.toml: not valid TOML');
  });

  it('fails on a config whose shape it cannot read', async () => {
    const out = await workspace({ 'drizzle.config.ts': 'export default { out: 3 };\n', 'wrangler.json': wranglerJson([{ binding: 'DB' }]) });
    const databases = await workspace({ 'drizzle.config.ts': drizzle('drizzle'), 'wrangler.json': '{ "d1_databases": "DB" }' });
    const directory = await workspace({ 'drizzle.config.ts': drizzle('drizzle'), 'wrangler.json': '{ "d1_databases": [{ "binding": "DB", "migrations_dir": 3 }] }' });
    const notAnObject = await workspace({ 'drizzle.config.ts': 'export default 3;\n', 'wrangler.json': wranglerJson([{ binding: 'DB' }]) });

    await expect(migrationsDirectory({ cwd: out, options })).rejects.toThrow("drizzle.config.ts: 'out' must be a string");
    await expect(migrationsDirectory({ cwd: databases, options })).rejects.toThrow("'d1_databases' must be an array of objects");
    await expect(migrationsDirectory({ cwd: directory, options })).rejects.toThrow("'migrations_dir' must be a string");
    await expect(migrationsDirectory({ cwd: notAnObject, options })).rejects.toThrow('the config must be an object');
  });
});

describe('migrations-directory looking for scripts that apply migrations with the generator', () => {
  const agreeing = { 'drizzle.config.ts': drizzle('drizzle'), 'wrangler.json': wranglerJson([{ binding: 'DB', migrations_dir: 'drizzle' }]) };

  it('reports each package.json script that runs the generator apply command, with its position, and no other script', async () => {
    const cwd = await workspace({
      ...agreeing,
      'package.json': ['{', '  "scripts": {', '    "generate": "drizzle-kit generate",', '    "push": "drizzle-kit push",', '    "apply": "npm run build && drizzle-kit migrate --config x"', '  }', '}', ''].join('\n'),
      'apps/api/package.json': '{ "scripts": { "deploy": "wrangler d1 migrations apply DB", "migrate": "npx drizzle-kit migrate" } }',
      'node_modules/dep/package.json': '{ "scripts": { "migrate": "drizzle-kit migrate" } }',
    });

    expect((await migrationsDirectory({ cwd, options })).map((violation) => [violation.code, violation.file, violation.location])).toEqual([
      ['migrations-directory/generator-apply-command', 'apps/api/package.json', { line: 1, column: 72 }],
      ['migrations-directory/generator-apply-command', 'package.json', { line: 5, column: 14 }],
    ]);
  });

  it('searches only the package.json files the option names', async () => {
    const cwd = await workspace({
      ...agreeing,
      'package.json': '{ "scripts": { "migrate": "drizzle-kit migrate" } }',
      'tools/package.json': '{ "scripts": { "migrate": "drizzle-kit migrate" } }',
    });

    expect((await migrationsDirectory({ cwd, options: { ...options, packageJsons: ['package.json'] } })).map((violation) => violation.file)).toEqual(['package.json']);
  });

  it('fails on a package.json that is not valid JSON', async () => {
    const cwd = await workspace({ ...agreeing, 'package.json': '{ "scripts": ' });

    await expect(migrationsDirectory({ cwd, options })).rejects.toThrow('package.json: not valid JSON');
  });
});
