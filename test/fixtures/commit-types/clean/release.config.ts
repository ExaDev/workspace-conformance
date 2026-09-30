export default {
  branches: ['main'],
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits', releaseRules: [{ breaking: true, release: 'major' }, { type: 'feat', release: 'minor' }, { type: 'fix', release: 'patch' }, { type: 'chore', release: false }] }],
    ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits', presetConfig: { types: [{ type: 'feat', section: 'Features' }, { type: 'fix', section: 'Fixes' }, { type: 'chore', hidden: true }] } }],
  ],
};
