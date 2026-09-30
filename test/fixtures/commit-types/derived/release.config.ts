import { types } from './types';

export default { plugins: [['@semantic-release/commit-analyzer', { releaseRules: types.map((entry) => ({ type: entry.type, release: entry.release })) }]] };
