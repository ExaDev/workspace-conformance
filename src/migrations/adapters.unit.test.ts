import { describe, expect, it } from 'vitest';

import { ConformanceError } from '../errors';
import { deployTools, generators } from './adapters';

describe('the drizzle-kit adapter', () => {
  const { applyCommand, outputDirectory } = generators['drizzle-kit'];

  it.each([
    'drizzle-kit migrate',
    'pnpm exec drizzle-kit migrate',
    'npx drizzle-kit migrate --config=drizzle.config.ts',
    'pnpm build && drizzle-kit migrate',
    'cd db; drizzle-kit migrate',
    'echo ok | drizzle-kit migrate',
    '(drizzle-kit migrate)',
  ])('recognises %s as applying migrations', (script) => {
    expect(applyCommand.test(script)).toBe(true);
  });

  it.each(['drizzle-kit generate', 'drizzle-kit push', 'drizzle-kit migrate:legacy', 'echo drizzle-kit-migrate', 'mydrizzle-kit migrate', 'wrangler d1 migrations apply DB'])(
    'does not recognise %s',
    (script) => {
      expect(applyCommand.test(script)).toBe(false);
    },
  );

  it('reads out, and falls back to the generator default when the config sets none', () => {
    expect(outputDirectory({ out: './db' }, 'drizzle.config.ts')).toBe('./db');
    expect(outputDirectory({}, 'drizzle.config.ts')).toBe('drizzle');
  });

  it('refuses a config it cannot read', () => {
    expect(() => outputDirectory({ out: 1 }, 'drizzle.config.ts')).toThrow(ConformanceError);
    expect(() => outputDirectory([], 'drizzle.config.ts')).toThrow('the config must be an object');
  });
});

describe('the wrangler adapter', () => {
  const { migrationsDirectory } = deployTools.wrangler;

  it('reads the directory of the only database and the tool default when it sets none', () => {
    expect(migrationsDirectory({ d1_databases: [{ binding: 'DB', migrations_dir: 'db' }] }, 'wrangler.json', {})).toEqual({ directory: 'db' });
    expect(migrationsDirectory({ d1_databases: [{ binding: 'DB' }] }, 'wrangler.json', {})).toEqual({ directory: 'migrations' });
  });

  it('reads the database whose binding is named among several', () => {
    const config = { d1_databases: [{ binding: 'A', migrations_dir: 'a' }, { binding: 'B', migrations_dir: 'b' }] };

    expect(migrationsDirectory(config, 'wrangler.json', { database: 'B' })).toEqual({ directory: 'b' });
    expect(() => migrationsDirectory(config, 'wrangler.json', {})).toThrow('declares several D1 databases');
  });

  it('refuses a config that is not an object', () => {
    expect(() => migrationsDirectory('x', 'wrangler.json', {})).toThrow('the config must be an object');
  });
});
