import type { GroupSpec, LayoutConfig, RankSkipOptions } from '@exadev/config';

const groups: readonly GroupSpec[] = [
  { name: 'core', rank: 0 },
  { name: 'features', rank: 1, slice: { segment: 0 } },
  { name: 'product', rank: 2, slice: { segment: 0 } },
];
const rankSkip: RankSkipOptions = { maxDistance: 1, exemptRanks: [] };
const isolatedGroups: readonly (readonly [string, string])[] = [['core', 'product']];

/**
 * The layout the import fixtures under `test/fixtures/imports` are written for: three ranked groups, verticals sliced by their first directory below the group, and the foundation isolated from the product.
 */
export const importsLayout: LayoutConfig = { groups, rankSkip, isolatedGroups };

/**
 * {@link importsLayout} without `rankSkip`.
 */
export const layoutWithoutRankSkip: LayoutConfig = { groups, isolatedGroups };

/**
 * {@link importsLayout} without `isolatedGroups`.
 */
export const layoutWithoutIsolation: LayoutConfig = { groups, rankSkip };

/**
 * The same groups with ranks and no slices.
 */
export const layoutWithoutSlices: LayoutConfig = { groups: [{ name: 'core', rank: 0 }, { name: 'features', rank: 1 }, { name: 'product', rank: 2 }] };

/**
 * The same groups with neither ranks nor slices.
 */
export const layoutWithoutRanks: LayoutConfig = { groups: [{ name: 'core' }, { name: 'features' }, { name: 'product' }] };
