export default {
  plugins: [
    ['@semantic-release/commit-analyzer', { releaseRules: [{ type: 'feat', release: 'minor' }, { type: 'fix', release: 'patch' }, { type: 'perf', release: 'patch' }] }],
    ['@semantic-release/release-notes-generator', { presetConfig: { types: [{ type: 'feat', section: 'Features' }, { type: 'fix', section: 'Fixes' }, { type: 'docs', section: 'Documentation' }] } }],
  ],
};
