import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { LayoutConfig } from '@exadev/config';

/**
 * The shape of a generated workspace.
 */
export interface SyntheticWorkspaceShape {
  /**
   * Packages in the `core` group, which import only each other.
   */
  readonly corePackages: number;
  /**
   * Slices. Each has one package in `features`, which imports `core` and its own files, and one in `product`, which imports the `features` package of the same slice.
   */
  readonly slices: number;
  /**
   * Source files in every package.
   */
  readonly filesPerPackage: number;
  /**
   * Imports each file has of earlier files in its own package, so the files form a directed acyclic graph.
   */
  readonly importsPerFile: number;
}

/**
 * The layout a generated workspace keeps to: ranked groups with the verticals sliced by their first directory, rank skipping not allowed and the foundation isolated from the product, so every import check has rules to evaluate.
 */
export const syntheticLayout: LayoutConfig = {
  groups: [
    { name: 'core', rank: 0 },
    { name: 'features', rank: 1, slice: { segment: 0 } },
    { name: 'product', rank: 2, slice: { segment: 0 } },
  ],
  rankSkip: { maxDistance: 1, exemptRanks: [] },
  isolatedGroups: [['core', 'product']],
};

async function writePackage(root: string, dir: string, files: Readonly<Record<string, string>>): Promise<void> {
  await mkdir(join(root, dir, 'src'), { recursive: true });
  await writeFile(join(root, dir, 'package.json'), JSON.stringify({ name: `@synthetic/${dir.replaceAll('/', '-')}`, version: '0.0.0', private: true }));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(root, dir, 'src', name), content);
  }
}

function packageFiles(shape: SyntheticWorkspaceShape, foreignImport: string | undefined): Readonly<Record<string, string>> {
  const files: Record<string, string> = {};
  for (let index = 0; index < shape.filesPerPackage; index += 1) {
    const siblings = Array.from({ length: Math.min(index, shape.importsPerFile) }, (_, offset) => `import { value${String(index - offset - 1)} } from './file${String(index - offset - 1)}';`);
    const foreign = index === 0 && foreignImport !== undefined ? [`import { value0 as foreign } from '${foreignImport}';`] : [];
    const uses = [...siblings.map((_, offset) => `value${String(index - offset - 1)}`), ...foreign.map(() => 'foreign')];
    files[`file${String(index)}.ts`] = [...siblings, ...foreign, `export const value${String(index)} = [${uses.join(', ')}];`, ''].join('\n');
  }

  return files;
}

/**
 * Write a workspace that keeps to {@link syntheticLayout} under `root`, large enough for a run of the import checks to take measurable time.
 */
export async function writeSyntheticWorkspace(root: string, shape: SyntheticWorkspaceShape): Promise<void> {
  await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - core/*\n  - features/*\n  - product/*\n');
  for (let index = 0; index < shape.corePackages; index += 1) {
    const previous = index === 0 ? undefined : `../../core${String(index - 1)}/src/file0`;
    await writePackage(root, `core/core${String(index)}`, packageFiles(shape, previous));
  }
  for (let index = 0; index < shape.slices; index += 1) {
    const core = `../../../core/core${String(index % shape.corePackages)}/src/file0`;
    await writePackage(root, `features/slice${String(index)}`, packageFiles(shape, core));
    await writePackage(root, `product/slice${String(index)}`, packageFiles(shape, `../../../features/slice${String(index)}/src/file0`));
  }
}
