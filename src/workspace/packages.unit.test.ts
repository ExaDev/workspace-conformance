import type { LayoutConfig } from '@exadev/config';
import { describe, expect, it } from 'vitest';

import { ConformanceError } from '../errors';
import { classifyPackages, type DiscoveredPackage } from './packages';

const VENDORED_RANK = 5;
const GROUP_RANK = 3;
const DEFAULT_RANK = 9;

const named = (dir: string, name?: string): DiscoveredPackage => ({ dir, name });

describe('classifyPackages', () => {
  it('gives a package the group whose root is the longest prefix of its directory', () => {
    const layout: LayoutConfig = { groups: [{ name: 'libs', rank: 0 }, { name: 'vendored', path: 'libs/vendored', rank: VENDORED_RANK }] };

    const packages = classifyPackages([named('libs/a'), named('libs/vendored/b')], layout);

    expect(packages.map((member) => [member.dir, member.group, member.rank])).toEqual([
      ['libs/a', 'libs', 0],
      ['libs/vendored/b', 'vendored', VENDORED_RANK],
    ]);
  });

  it('prefers a nameRanks match over the group rank, and the group rank over defaultRank', () => {
    const layout: LayoutConfig = {
      groups: [{ name: 'a', rank: GROUP_RANK }, { name: 'b' }],
      nameRanks: [{ pattern: '-contract$', rank: 0 }],
      defaultRank: DEFAULT_RANK,
    };

    const ranks = classifyPackages([named('a/one', '@x/one-contract'), named('a/two', '@x/two'), named('b/three', '@x/three'), named('b/four')], layout).map(
      (member) => member.rank,
    );

    expect(ranks).toEqual([0, GROUP_RANK, DEFAULT_RANK, DEFAULT_RANK]);
  });

  it('leaves the rank undefined when nothing supplies one', () => {
    const [member] = classifyPackages([named('a/one', 'one')], { groups: [{ name: 'a' }] });

    expect(member?.rank).toBeUndefined();
  });

  it('takes a segment slice from the path segment below the group root', () => {
    const layout: LayoutConfig = { groups: [{ name: 'features', slice: { segment: 1 } }] };

    const slices = classifyPackages([named('features/web/store'), named('features/web/cart')], layout).map((member) => member.slice);

    expect(slices).toEqual(['store', 'cart']);
  });

  it('gives a namePrefix slice the longest known slice that prefixes the unscoped name', () => {
    const layout: LayoutConfig = {
      groups: [{ name: 'verticals', slice: { segment: 0 } }, { name: 'targets', slice: { namePrefix: true } }],
    };

    const targets = classifyPackages(
      [named('verticals/store', '@x/store'), named('verticals/store-admin', '@x/store-admin'), named('targets/a', '@x/store-admin-cli'), named('targets/b', '@x/store-cli'), named('targets/c', '@x/other'), named('targets/d')],
      layout,
    ).filter((member) => member.group === 'targets');

    expect(targets.map((member) => member.slice)).toEqual(['store-admin', 'store', undefined, undefined]);
  });

  it('does not match a slice that only shares leading characters', () => {
    const layout: LayoutConfig = { groups: [{ name: 'verticals', slice: { segment: 0 } }, { name: 'targets', slice: { namePrefix: true } }] };

    const [, target] = classifyPackages([named('verticals/store', 'store'), named('targets/x', 'storefront')], layout);

    expect(target?.slice).toBeUndefined();
  });

  it('rejects a package directory that no group owns', () => {
    expect(() => classifyPackages([named('stray/one')], { groups: [{ name: 'a' }] })).toThrow(ConformanceError);
    expect(() => classifyPackages([named('stray/one')], { groups: [{ name: 'a' }] })).toThrow("'stray/one' is not under any layout group's path");
  });

  it('rejects nested package directories', () => {
    expect(() => classifyPackages([named('a/one'), named('a/one/inner')], { groups: [{ name: 'a' }] })).toThrow("'a/one/inner' is inside the package directory 'a/one'");
  });

  it('gives the root package the group whose path is the root', () => {
    const [root] = classifyPackages([named('.', 'single')], { groups: [{ name: 'root', path: '.', rank: 0 }] });

    expect(root).toEqual({ dir: '.', name: 'single', group: 'root', rank: 0, slice: undefined });
  });

  it('rejects the root package beside other packages, since every package directory is inside it', () => {
    expect(() => classifyPackages([named('.'), named('a/one')], { groups: [{ name: 'root', path: '.' }, { name: 'a' }] })).toThrow("'a/one' is inside the package directory '.'");
  });

  it('does not treat a directory that only shares a name prefix as nested', () => {
    const packages = classifyPackages([named('a/one'), named('a/one-more')], { groups: [{ name: 'a' }] });

    expect(packages).toHaveLength(2);
  });
});
