/**
 * The variables git sets for a hook and for a command run from one, which say which repository, index and working tree a git command works on. A test run from a hook (the pre-push hook runs the tests) would otherwise have every `git init` and `git add` in a fixture act on the repository being pushed from instead of the fixture.
 */
const REPOSITORY_VARIABLES: readonly string[] = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_PREFIX',
  'GIT_WORK_TREE',
];

for (const name of REPOSITORY_VARIABLES) {
  // Reflect.deleteProperty, not `= undefined`, which would set the variable to the string "undefined" in a child process.
  Reflect.deleteProperty(process.env, name);
}
