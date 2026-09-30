#!/usr/bin/env bash
# Installs the packed tarball into a scratch project that holds a small workspace with known violations, and runs the checks through it as ESM, as CommonJS and as the command line.
# Usage: install-check.sh <directory holding the .tgz> <cosmiconfig major> <scratch directory>
set -euo pipefail
# A caller that is itself a git hook exports the repository it runs for, which would make the `git init` below act on that repository.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_PREFIX GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_NAMESPACE

pack_dir=$1
cosmiconfig_major=$2
scratch=$3
here=$(cd "$(dirname "$0")" && pwd)
# The TypeScript the repository itself uses, so the consumer check does not drift with TypeScript releases.
typescript_version=$(node -p "require(process.argv[1]).devDependencies.typescript" "$here/../../package.json")

mkdir -p "$scratch"
cd "$scratch"
npm init -y > /dev/null
npm install "$pack_dir"/*.tgz "cosmiconfig@$cosmiconfig_major" "typescript@$typescript_version" @exadev/config

cp "$here/check.mjs" "$here/check.cjs" .

# The workspace: a rank 0 library that imports a rank 1 app (uphill), a hand-written command interface, and instruction files that are git symlinks.
mkdir -p libs/core/src apps/web/src contract
printf 'packages:\n  - libs/*\n  - apps/*\n' > pnpm-workspace.yaml
echo '{ "name": "@scratch/core" }' > libs/core/package.json
echo '{ "name": "@scratch/web" }' > apps/web/package.json
echo "import { web } from '../../../apps/web/src/index';
export const core = web;" > libs/core/src/index.ts
echo 'export const web = 1;' > apps/web/src/index.ts
echo 'export interface CancelOrder { readonly orderId: string }' > contract/commands.ts
echo '{ "compilerOptions": { "module": "ESNext", "moduleResolution": "bundler", "strict": true } }' > tsconfig.json
echo '# scratch' > README.md
ln -s README.md AGENTS.md
ln -s README.md CLAUDE.md
git init --quiet
git add --force README.md AGENTS.md CLAUDE.md

# The file is evaluated, not type-checked: it imports the installed package as an authoring file does.
cat > exadev.config.ts <<'CONFIG'
import { layoutSection, withSections } from '@exadev/config';
import { conformanceSection } from 'workspace-conformance';

export default withSections(
  layoutSection,
  conformanceSection,
)({
  layout: { groups: [{ name: 'libs', rank: 0 }, { name: 'apps', rank: 1 }] },
  conformance: {
    checks: {
      'import-uphill': {},
      'command-types': { commands: ['contract/commands.ts'] },
      'instruction-symlinks': {},
      'single-storybook': {},
    },
  },
});
CONFIG

node check.mjs
node check.cjs
