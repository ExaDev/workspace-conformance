export default { plugins: [['@semantic-release/commit-analyzer', { releaseRules: [{ type: 'feat', release: 'minor' }, { type: 'deps', release: 'patch' }] }]] };
