// Each way the config can fail to apply ESLint: a rule off, a rule weaker than required, a rule missing, a directory ignored and a file no block matches.
export default [
  { ignores: ['ignored'] },
  { files: ['**/*.js'], rules: { 'no-console': 'warn', eqeqeq: 'off' } },
];
