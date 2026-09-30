export default {
  groups: [
    { name: 'core', rank: 0 },
    { name: 'features', rank: 1, slice: { segment: 0 } },
    { name: 'product', rank: 2, slice: { segment: 0 } },
  ],
  rankSkip: { maxDistance: 1, exemptRanks: [] },
  isolatedGroups: [['core', 'product']],
};
