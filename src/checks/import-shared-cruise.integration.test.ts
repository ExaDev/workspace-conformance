import type { LayoutConfig } from '@exadev/config';
import type * as dependencyCruiser from 'dependency-cruiser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { importsLayout } from '../../test/support/layouts';
import { fixturePath, removeTempDirs } from '../../test/support/temp';
import type { ConformanceConfig } from '../config';
import { ConformanceError } from '../errors';
import type { ImportGraphOptions } from '../options';
import { runChecks } from '../run-checks';
import { importCrossSlice } from './import-cross-slice';
import { importCycles } from './import-cycles';
import { type ImportCheckSpec, runImportChecks } from './import-graph';
import { importIsolatedGroups } from './import-isolated-groups';
import { importRankSkip } from './import-rank-skip';
import { importUphill } from './import-uphill';

const cruising = vi.hoisted(() => {
  const calls: unknown[][] = [];
  const overrides: unknown[] = [];

  return { calls, overrides };
});

vi.mock('dependency-cruiser', async (importOriginal) => {
  const original = await importOriginal<typeof dependencyCruiser>();

  return {
    ...original,
    cruise: async (...args: Parameters<typeof original.cruise>) => {
      cruising.calls.push(args);
      const override = cruising.overrides.shift();

      return Promise.resolve(override ?? original.cruise(...args));
    },
  };
});

const violating = fixturePath('imports', 'violating');
const allChecks: ConformanceConfig = {
  checks: { 'import-uphill': {}, 'import-rank-skip': {}, 'import-cross-slice': {}, 'import-isolated-groups': {}, 'import-cycles': {} },
};

beforeEach(() => {
  cruising.calls.length = 0;
  cruising.overrides.length = 0;
});

afterEach(removeTempDirs);

describe('import checks that share a cruise', () => {
  it('cruise once for all the checks that use the default options', async () => {
    await runChecks({ cwd: violating, config: allChecks, layout: importsLayout });

    expect(cruising.calls).toHaveLength(1);
  });

  it('find what each check finds when it runs alone', async () => {
    const context = { cwd: violating, layout: importsLayout, options: {} };
    const alone = [await importUphill(context), await importRankSkip(context), await importCrossSlice(context), await importIsolatedGroups(context), await importCycles(context)];
    expect(cruising.calls).toHaveLength(alone.length);

    const together = await runChecks({ cwd: violating, config: allChecks, layout: importsLayout });

    expect(together.results.map((result) => result.violations)).toEqual(alone);
    expect(together.violations.length).toBeGreaterThan(0);
  });

  it('share a cruise when options are written out as the defaults they replace', async () => {
    const config: ConformanceConfig = {
      checks: { 'import-uphill': {}, 'import-rank-skip': { exclude: ['(^|/)node_modules/'], doNotFollow: ['(^|/)dist/'] } },
    };

    await runChecks({ cwd: violating, config, layout: importsLayout });

    expect(cruising.calls).toHaveLength(1);
  });

  it.each<readonly [string, ImportGraphOptions]>([
    ['exclude', { exclude: ['^product/billing/'] }],
    ['doNotFollow', { doNotFollow: ['^product/billing/'] }],
    ['tsConfig', { tsConfig: 'tsconfig.json' }],
  ])('cruise separately for checks whose %s differs, and give each its own graph', async (_option, options) => {
    const config: ConformanceConfig = { checks: { 'import-uphill': {}, 'import-rank-skip': options } };

    const result = await runChecks({ cwd: violating, config, layout: importsLayout });

    expect(cruising.calls).toHaveLength(2);
    expect(result.results[0]?.violations).toEqual(await importUphill({ cwd: violating, layout: importsLayout, options: {} }));
    expect(result.results[1]?.violations).toEqual(await importRankSkip({ cwd: violating, layout: importsLayout, options }));
  });

  it('leave a file out of the checks whose options exclude it and keep it for the others', async () => {
    const config: ConformanceConfig = { checks: { 'import-rank-skip': { exclude: ['^product/billing/'] }, 'import-cross-slice': {} } };

    const result = await runChecks({ cwd: violating, config, layout: importsLayout });

    expect(result.results.map((entry) => [entry.check, entry.violations.map((violation) => violation.file)])).toEqual([
      ['import-rank-skip', []],
      ['import-cross-slice', ['features/billing/src/index.ts', 'product/billing/src/index.ts']],
    ]);
  });

  it('do not cruise when no check of the group has a rule to enforce', async () => {
    const flat = { groups: [{ name: 'core', rank: 0 }, { name: 'features', rank: 0 }, { name: 'product', rank: 0 }] };

    const result = await runChecks({ cwd: violating, config: { checks: { 'import-uphill': {} } }, layout: flat });

    expect(cruising.calls).toHaveLength(0);
    expect(result.results).toEqual([{ check: 'import-uphill', violations: [], notes: [] }]);
  });

  it('fail when the layout lacks what any one of them needs, before cruising', async () => {
    const config: ConformanceConfig = { checks: { 'import-uphill': {}, 'import-rank-skip': {} } };

    await expect(runChecks({ cwd: violating, config, layout: { groups: importsLayout.groups } })).rejects.toThrow("the layout has no 'rankSkip'");
    expect(cruising.calls).toHaveLength(0);
  });
});

describe('runImportChecks guarding the split of findings', () => {
  const named = (name: string, rule: string): ImportCheckSpec => ({
    name,
    rules: () => [{ name: rule, severity: 'error', comment: 'x', from: {}, to: { circular: true } }],
    report: () => [],
  });

  it('refuses two checks that generate a rule of the same name, whose findings could not be told apart', async () => {
    const entries = [
      { spec: named('first', 'same'), options: {} },
      { spec: named('second', 'same'), options: {} },
    ];

    const run = runImportChecks({ cwd: violating, layout: importsLayout, entries });

    await expect(run).rejects.toThrow(ConformanceError);
    await expect(run).rejects.toThrow("the checks first and second both generate a rule named 'same'");
  });

  it('allows one check to repeat a rule name, since all its findings are its own', async () => {
    const twice: ImportCheckSpec = { ...named('first', 'same'), rules: (...args) => [...named('first', 'same').rules(...args), ...named('first', 'same').rules(...args)] };

    expect([...(await runImportChecks({ cwd: violating, layout: importsLayout, entries: [{ spec: twice, options: {} }] })).keys()]).toEqual(['first']);
  });

  it('reports a layout that lists an isolated pair twice or in both orders as it does a single listing', async () => {
    const once = await importIsolatedGroups({ cwd: violating, layout: importsLayout, options: {} });
    const duplicated: LayoutConfig = { ...importsLayout, isolatedGroups: [['core', 'product'], ['product', 'core'], ['core', 'product']] };

    const result = await importIsolatedGroups({ cwd: violating, layout: duplicated, options: {} });

    expect(result.length).toBeGreaterThan(0);
    expect(result).toEqual(once);
  });

  it('allows the same rule name in checks that do not share a cruise', async () => {
    const entries = [
      { spec: named('first', 'same'), options: {} },
      { spec: named('second', 'same'), options: { exclude: ['^product/'] } },
    ];

    expect([...(await runImportChecks({ cwd: violating, layout: importsLayout, entries })).keys()]).toEqual(['first', 'second']);
  });

  it('refuses a finding of a rule that no check generated', async () => {
    cruising.overrides.push({ output: { summary: { violations: [{ rule: { name: 'ghost', severity: 'error' }, from: 'a', to: 'b' }] } } });

    await expect(runImportChecks({ cwd: violating, layout: importsLayout, entries: [{ spec: named('first', 'real'), options: {} }] })).rejects.toThrow(
      "dependency-cruiser reported the rule 'ghost', which no check generated",
    );
  });
});
