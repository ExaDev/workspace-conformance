import type { LayoutConfig } from '@exadev/config';

/**
 * The layout the import fixtures under `test/fixtures/imports` are written for: three ranked groups, verticals sliced by their first directory below the group, and the foundation isolated from the product.
 */
export const importsLayout: LayoutConfig = {
  groups: [
    { name: 'core', rank: 0 },
    { name: 'features', rank: 1, slice: { segment: 0 } },
    { name: 'product', rank: 2, slice: { segment: 0 } },
  ],
  rankSkip: { maxDistance: 1, exemptRanks: [] },
  isolatedGroups: [['core', 'product']],
};
