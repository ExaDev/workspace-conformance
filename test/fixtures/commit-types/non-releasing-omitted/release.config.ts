export default {
  plugins: [['@semantic-release/commit-analyzer', { releaseRules: [{ breaking: true, release: 'major' }, { type: 'feat', release: 'minor' }, { type: 'fix', release: 'patch' }] }]],
};
