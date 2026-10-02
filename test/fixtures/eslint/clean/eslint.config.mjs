// Rule entries written in the several forms ESLint accepts, so severity normalisation has to read each of them.
export default [
  { ignores: ['dist'] },
  { files: ['**/*.js'], rules: { 'no-console': 2, eqeqeq: ['error', 'always'], 'no-debugger': 'warn', 'no-var': [1] } },
];
