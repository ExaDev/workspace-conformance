# workspace-conformance

Conformance checks for a pnpm workspace that ESLint cannot express: type-graph checks on ts-morph, import-graph checks on dependency-cruiser generated from the shared `layout` section of `@exadev/config`, and file-tree and cross-config checks that compare two files or read git state.
