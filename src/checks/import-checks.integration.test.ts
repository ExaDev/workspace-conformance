import { afterEach, describe, expect, it } from 'vitest';

import type { LayoutCheckFunction, Violation } from '../check';
import { ConformanceError } from '../errors';
import type { ImportGraphOptions } from '../options';
import { importsLayout, layoutWithoutIsolation, layoutWithoutRankSkip, layoutWithoutRanks, layoutWithoutSlices } from '../../test/support/layouts';
import { copyFixture, fixturePath, makeTempDir, removeTempDirs, writeFiles } from '../../test/support/temp';
import { importCrossSlice } from './import-cross-slice';
import { importCycles } from './import-cycles';
import { importIsolatedGroups } from './import-isolated-groups';
import { importRankSkip } from './import-rank-skip';
import { importUphill } from './import-uphill';

const violating = fixturePath('imports', 'violating');
const clean = fixturePath('imports', 'clean');

const checks: readonly { readonly name: string; readonly check: LayoutCheckFunction<ImportGraphOptions>; readonly code: string; readonly files: readonly string[] }[] = [
  { name: 'import-uphill', check: importUphill, code: 'import-uphill/higher-rank', files: ['core/kernel/src/index.ts'] },
  { name: 'import-rank-skip', check: importRankSkip, code: 'import-rank-skip/skipped-rank', files: ['product/billing/src/index.ts'] },
  { name: 'import-cross-slice', check: importCrossSlice, code: 'import-cross-slice/other-slice', files: ['features/billing/src/index.ts', 'product/billing/src/index.ts'] },
  { name: 'import-isolated-groups', check: importIsolatedGroups, code: 'import-isolated-groups/isolated-group', files: ['product/billing/src/index.ts'] },
  { name: 'import-cycles', check: importCycles, code: 'import-cycles/cycle', files: ['features/auth/src/index.ts'] },
];

function summary(violations: readonly Violation[]): readonly (readonly [string, string])[] {
  return violations.map((violation) => [violation.code, violation.file]);
}

afterEach(removeTempDirs);

describe.each(checks)('$name', ({ check, code, files }) => {
  it('reports each violation of the workspace that has them, with its code and file', async () => {
    const violations = await check({ cwd: violating, layout: importsLayout, options: {} });

    expect(summary(violations)).toEqual(files.map((file) => [code, file]));
  });

  it('reports nothing for a workspace that keeps to the layout', async () => {
    expect(await check({ cwd: clean, layout: importsLayout, options: {} })).toEqual([]);
  });

  it('finds the same violations when nothing is installed anywhere above the workspace', async () => {
    const copy = await copyFixture('imports', 'violating');

    expect(summary(await check({ cwd: copy, layout: importsLayout, options: {} }))).toEqual(files.map((file) => [code, file]));
  });
});

describe('violation messages', () => {
  it('name both packages and the ranks, slices or groups involved', async () => {
    const [uphill] = await importUphill({ cwd: violating, layout: importsLayout, options: {} });
    const [skip] = await importRankSkip({ cwd: violating, layout: importsLayout, options: {} });
    const [slice] = await importCrossSlice({ cwd: violating, layout: importsLayout, options: {} });
    const [isolated] = await importIsolatedGroups({ cwd: violating, layout: importsLayout, options: {} });
    const [cycle] = await importCycles({ cwd: violating, layout: importsLayout, options: {} });

    expect(uphill?.message).toBe('@fx/core-kernel (rank 0) imports features/billing/src/index.ts in @fx/features-billing (rank 1), a higher rank');
    expect(skip?.message).toBe('@fx/product-billing (rank 2) imports core/kernel/src/index.ts in @fx/core-kernel (rank 0), further below than the layout allows');
    expect(slice?.message).toBe("@fx/features-billing (slice 'billing') imports features/auth/src/index.ts in @fx/features-auth (slice 'auth')");
    expect(isolated?.message).toBe("@fx/product-billing (group 'product') imports core/kernel/src/index.ts in @fx/core-kernel (group 'core'), which the layout isolates from it");
    expect(cycle?.message).toBe('import cycle: features/auth/src/index.ts -> features/auth/src/ping.ts -> features/auth/src/index.ts');
  });
});

describe('a layout that does not configure what a check needs', () => {
  it('fails import-rank-skip without rankSkip', async () => {
    await expect(importRankSkip({ cwd: clean, layout: layoutWithoutRankSkip, options: {} })).rejects.toThrow("has no 'rankSkip'");
  });

  it('fails import-cross-slice without any slice', async () => {
    await expect(importCrossSlice({ cwd: clean, layout: layoutWithoutSlices, options: {} })).rejects.toThrow('no package in the layout has a slice');
  });

  it('fails import-isolated-groups without isolatedGroups', async () => {
    await expect(importIsolatedGroups({ cwd: clean, layout: layoutWithoutIsolation, options: {} })).rejects.toThrow("has no 'isolatedGroups'");
  });

  it('fails the rank checks when a package has no rank', async () => {
    await expect(importUphill({ cwd: clean, layout: layoutWithoutRanks, options: {} })).rejects.toThrow(ConformanceError);
    await expect(importUphill({ cwd: clean, layout: layoutWithoutRanks, options: {} })).rejects.toThrow('no rank resolves for');
  });
});

describe('options', () => {
  it('leaves out the paths matched by exclude', async () => {
    const violations = await importUphill({ cwd: violating, layout: importsLayout, options: { exclude: ['^core/kernel/'] } });

    expect(violations).toEqual([]);
  });

  it('resolves an alias through the tsconfig named by tsConfig, and not without it', async () => {
    const workspace = await makeTempDir();
    await writeFiles(workspace, {
      'pnpm-workspace.yaml': 'packages:\n  - core/*\n  - features/*\n',
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'bundler', baseUrl: '.', paths: { '@alias/billing': ['features/billing/src/index.ts'] } } }),
      'core/kernel/package.json': '{ "name": "@fx/kernel" }',
      'core/kernel/src/index.ts': "import { billing } from '@alias/billing';\nexport const kernel = billing;\n",
      'features/billing/package.json': '{ "name": "@fx/billing" }',
      'features/billing/src/index.ts': 'export const billing = 1;\n',
    });
    const layout = { groups: [{ name: 'core', rank: 0 }, { name: 'features', rank: 1 }] };

    const without = await importUphill({ cwd: workspace, layout, options: {} });
    const withPaths = await importUphill({ cwd: workspace, layout, options: { tsConfig: 'tsconfig.json' } });

    expect(without).toEqual([]);
    expect(summary(withPaths)).toEqual([['import-uphill/higher-rank', 'core/kernel/src/index.ts']]);
  });
});

describe('a tsconfig with paths and no baseUrl', () => {
  it('resolves aliases relative to the tsconfig whatever directory the process runs in', async () => {
    const workspace = await makeTempDir();
    await writeFiles(workspace, {
      'pnpm-workspace.yaml': 'packages:\n  - core/*\n  - apps/*\n',
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'bundler', paths: { '~web/*': ['./apps/web/src/*'] } } }),
      'core/kernel/package.json': '{ "name": "@fx/kernel" }',
      'core/kernel/src/index.ts': "import { web } from '~web/index';\nexport const kernel = web;\n",
      'apps/web/package.json': '{ "name": "@fx/web" }',
      'apps/web/src/index.ts': 'export const web = 1;\n',
    });
    const layout = { groups: [{ name: 'core', rank: 0 }, { name: 'apps', rank: 1 }] };

    expect(process.cwd()).not.toBe(workspace);
    expect(summary(await importUphill({ cwd: workspace, layout, options: { tsConfig: 'tsconfig.json' } }))).toEqual([['import-uphill/higher-rank', 'core/kernel/src/index.ts']]);
  });
});

describe('imports of a package by name', () => {
  const layout = { groups: [{ name: 'core', rank: 0 }, { name: 'features', rank: 1 }] };
  const base = {
    'pnpm-workspace.yaml': 'packages:\n  - core/*\n  - features/*\n',
    'core/kernel/package.json': '{ "name": "@fx/kernel" }',
    'features/billing/package.json': '{ "name": "@fx/billing", "exports": { ".": "./dist/index.js" } }',
    'features/billing/src/index.ts': "import { kernel } from '@fx/kernel';\nexport const billing = kernel;\n",
    'core/kernel/src/index.ts': 'export const kernel = 1;\n',
  };

  it('are attributed to the package when the name resolves nowhere, as in a workspace that is not installed or built', async () => {
    const workspace = await makeTempDir();
    await writeFiles(workspace, { ...base, 'core/kernel/src/index.ts': "import { billing } from '@fx/billing';\nexport const kernel = billing;\n" });

    const violations = await importUphill({ cwd: workspace, layout, options: {} });

    expect(summary(violations)).toEqual([['import-uphill/higher-rank', 'core/kernel/src/index.ts']]);
    expect(violations[0]?.message).toBe('@fx/kernel (rank 0) imports @fx/billing (rank 1), a higher rank');
  });

  it('are attributed to the package when they name a subpath of it', async () => {
    const workspace = await makeTempDir();
    await writeFiles(workspace, { ...base, 'core/kernel/src/index.ts': "import { extra } from '@fx/billing/extra';\nexport const kernel = extra;\n" });

    expect(summary(await importUphill({ cwd: workspace, layout, options: {} }))).toEqual([['import-uphill/higher-rank', 'core/kernel/src/index.ts']]);
  });

  it('do not take a package whose name only starts with the same characters for it', async () => {
    const workspace = await makeTempDir();
    await writeFiles(workspace, { ...base, 'core/kernel/src/index.ts': "import { billing } from '@fx/billing-extras';\nexport const kernel = billing;\n" });

    expect(await importUphill({ cwd: workspace, layout, options: {} })).toEqual([]);
  });

  it('reach a package through its build output, which is a target and never a dependant', async () => {
    const workspace = await makeTempDir();
    await writeFiles(workspace, {
      ...base,
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'bundler', baseUrl: '.', paths: { '@fx/billing': ['features/billing/dist/index.js'] } } }),
      'core/kernel/src/index.ts': "import { billing } from '@fx/billing';\nexport const kernel = billing;\n",
      'features/billing/dist/index.js': "import { kernel } from '../../../core/kernel/src/index';\nexport const billing = kernel;\n",
    });

    const options = { tsConfig: 'tsconfig.json' };

    expect(summary(await importUphill({ cwd: workspace, layout, options }))).toEqual([['import-uphill/higher-rank', 'core/kernel/src/index.ts']]);
    expect(summary(await importUphill({ cwd: workspace, layout, options: { ...options, doNotFollow: [] } }))).toEqual([
      ['import-uphill/higher-rank', 'core/kernel/src/index.ts'],
    ]);
  });
});

describe('a layout root other than the working directory', () => {
  it('reports files relative to the working directory', async () => {
    const violations = await importUphill({ cwd: fixturePath('imports'), layout: { ...importsLayout, root: 'violating' }, options: {} });

    expect(summary(violations)).toEqual([['import-uphill/higher-rank', 'violating/core/kernel/src/index.ts']]);
  });
});
