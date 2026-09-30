import { describe, expect, it } from 'vitest';

import { ConformanceError } from '../errors';
import type { WorkspacePackage } from './packages';
import { crossSliceRules, cycleRule, isolatedGroupRules, packagesPattern, rankSkipRules, ranked, uphillRules } from './rules';

function member(dir: string, group: string, rank: number | undefined, slice?: string): WorkspacePackage {
  return { dir, name: undefined, group, rank, slice };
}

const core = member('core/kernel', 'core', 0);
const feature = member('features/auth', 'features', 1, 'auth');
const otherFeature = member('features/billing', 'features', 1, 'billing');
const product = member('product/auth', 'product', 2, 'auth');
const packages: readonly WorkspacePackage[] = [core, feature, otherFeature, product];

function matches(pattern: string | undefined, path: string): boolean {
  return pattern !== undefined && new RegExp(pattern, 'u').test(path);
}

describe('packagesPattern', () => {
  it('matches files inside a listed package and no others', () => {
    const pattern = packagesPattern([core, feature]);

    expect(matches(pattern, 'core/kernel/src/index.ts')).toBe(true);
    expect(matches(pattern, 'features/auth/index.ts')).toBe(true);
    expect(matches(pattern, 'features/billing/src/index.ts')).toBe(false);
  });

  it('does not let a directory name match another that merely starts with it', () => {
    expect(matches(packagesPattern([member('packages/a', 'g', 0)]), 'packages/ab/src/index.ts')).toBe(false);
  });

  it('escapes characters that mean something in a regular expression', () => {
    const pattern = packagesPattern([member('packages/a.b+c', 'g', 0)]);

    expect(matches(pattern, 'packages/a.b+c/src/x.ts')).toBe(true);
    expect(matches(pattern, 'packages/aXb+c/src/x.ts')).toBe(false);
  });
});

describe('ranked', () => {
  it('names every package that has no rank', () => {
    expect(() => ranked([core, member('x/one', 'x', undefined), member('x/two', 'x', undefined)])).toThrow(ConformanceError);
    expect(() => ranked([core, member('x/one', 'x', undefined), member('x/two', 'x', undefined)])).toThrow('x/one, x/two');
  });
});

describe('uphillRules', () => {
  it('makes a rule for each rank that has a higher rank above it, from that rank to all higher ranks', () => {
    const rules = uphillRules(packages);

    expect(rules.map((rule) => rule.name)).toEqual(['uphill-rank-0', 'uphill-rank-1']);
    const [fromCore, fromFeatures] = rules;
    expect(matches(fromCore?.from.path, 'core/kernel/src/a.ts')).toBe(true);
    expect(matches(fromCore?.from.path, 'features/auth/src/a.ts')).toBe(false);
    expect(matches(fromCore?.to.path, 'features/billing/src/a.ts')).toBe(true);
    expect(matches(fromCore?.to.path, 'product/auth/src/a.ts')).toBe(true);
    expect(matches(fromCore?.to.path, 'core/kernel/src/a.ts')).toBe(false);
    expect(matches(fromFeatures?.to.path, 'product/auth/src/a.ts')).toBe(true);
    expect(matches(fromFeatures?.to.path, 'features/billing/src/a.ts')).toBe(false);
  });

  it('makes no rule for the top rank, which has nothing above it', () => {
    expect(uphillRules([product])).toEqual([]);
  });
});

describe('rankSkipRules', () => {
  it('forbids ranks further below than maxDistance', () => {
    const rules = rankSkipRules(packages, { maxDistance: 1, exemptRanks: [] });

    expect(rules.map((rule) => rule.name)).toEqual(['rank-skip-2']);
    expect(matches(rules[0]?.to.path, 'core/kernel/src/a.ts')).toBe(true);
    expect(matches(rules[0]?.to.path, 'features/auth/src/a.ts')).toBe(false);
  });

  it('allows a distance of maxDistance exactly, and forbids same-rank imports only at maxDistance below zero', () => {
    expect(rankSkipRules(packages, { maxDistance: 2, exemptRanks: [] })).toEqual([]);
  });

  it('leaves exempt ranks importable from any distance', () => {
    const rules = rankSkipRules(packages, { maxDistance: 0, exemptRanks: [0] });

    expect(rules.map((rule) => rule.name)).toEqual(['rank-skip-2']);
    expect(matches(rules[0]?.to.path, 'features/auth/src/a.ts')).toBe(true);
    expect(matches(rules[0]?.to.path, 'core/kernel/src/a.ts')).toBe(false);
    expect(rankSkipRules(packages, { maxDistance: 1, exemptRanks: [0] })).toEqual([]);
  });
});

describe('crossSliceRules', () => {
  it('makes one rule per slice, forbidding every package with a different slice', () => {
    const rules = crossSliceRules(packages);

    expect(rules.map((rule) => rule.name)).toEqual(['cross-slice-auth', 'cross-slice-billing']);
    const [auth] = rules;
    expect(matches(auth?.from.path, 'features/auth/src/a.ts')).toBe(true);
    expect(matches(auth?.from.path, 'product/auth/src/a.ts')).toBe(true);
    expect(matches(auth?.to.path, 'features/billing/src/a.ts')).toBe(true);
    expect(matches(auth?.to.path, 'product/auth/src/a.ts')).toBe(false);
    expect(matches(auth?.to.path, 'core/kernel/src/a.ts')).toBe(false);
  });

  it('makes no rule when only one slice exists', () => {
    expect(crossSliceRules([feature, product])).toEqual([]);
  });
});

describe('isolatedGroupRules', () => {
  it('makes a rule for each direction of a pair', () => {
    const rules = isolatedGroupRules(packages, [['core', 'product']]);

    expect(rules.map((rule) => rule.name)).toEqual(['isolated-core-product', 'isolated-product-core']);
    expect(matches(rules[0]?.from.path, 'core/kernel/src/a.ts')).toBe(true);
    expect(matches(rules[0]?.to.path, 'product/auth/src/a.ts')).toBe(true);
    expect(matches(rules[1]?.from.path, 'product/auth/src/a.ts')).toBe(true);
  });

  it('skips a direction when a group has no packages', () => {
    expect(isolatedGroupRules([core], [['core', 'product']])).toEqual([]);
  });
});

describe('cycleRule', () => {
  it('forbids circular imports', () => {
    expect(cycleRule().to).toEqual({ circular: true });
  });
});
