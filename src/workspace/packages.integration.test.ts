import { afterEach, describe, expect, it } from 'vitest';

import { importsLayout } from '../../test/support/layouts';
import { fixturePath, makeTempDir, removeTempDirs, writeFiles } from '../../test/support/temp';
import { ConformanceError } from '../errors';
import { discoverPackages, readWorkspacePackages, workspacePatterns, workspaceRoot } from './packages';

const clean = fixturePath('imports', 'clean');

afterEach(removeTempDirs);

describe('discoverPackages', () => {
  it('finds every directory a pattern selects that holds a package.json, with its declared name', async () => {
    const found = await discoverPackages(clean, ['core/*', 'features/*', 'product/*']);

    expect(found.map((member) => [member.dir, member.name])).toEqual([
      ['core/kernel', '@fx/core-kernel'],
      ['core/util', '@fx/core-util'],
      ['features/auth', '@fx/features-auth'],
      ['features/billing', '@fx/features-billing'],
      ['product/auth', '@fx/product-auth'],
      ['product/billing', '@fx/product-billing'],
    ]);
  });

  it('drops directories a ! pattern excludes', async () => {
    const found = await discoverPackages(clean, ['core/*', '!core/util']);

    expect(found.map((member) => member.dir)).toEqual(['core/kernel']);
  });

  it('finds the root package as the directory . when a pattern selects it, and leaves out installed dependencies', async () => {
    const root = await makeTempDir();
    await writeFiles(root, {
      'package.json': '{ "name": "root" }',
      'a/package.json': '{ "name": "a" }',
      'a/node_modules/dep/package.json': '{ "name": "dep" }',
    });

    const found = await discoverPackages(root, ['.', 'a', '**']);

    expect(found).toEqual([
      { dir: '.', name: 'root' },
      { dir: 'a', name: 'a' },
    ]);
  });

  it('leaves out the root package when no pattern selects it', async () => {
    const root = await makeTempDir();
    await writeFiles(root, { 'package.json': '{ "name": "root" }', 'a/package.json': '{ "name": "a" }' });

    expect((await discoverPackages(root, ['a'])).map((member) => member.dir)).toEqual(['a']);
  });

  it('fails naming the manifest that is not valid JSON', async () => {
    const root = await makeTempDir();
    await writeFiles(root, { 'a/package.json': '{ "name": ' });

    await expect(discoverPackages(root, ['a'])).rejects.toThrow('a/package.json cannot be read as JSON');
  });

  it('reads a package without a name as one that has none', async () => {
    const root = await makeTempDir();
    await writeFiles(root, { 'a/package.json': '{ "private": true }' });

    expect(await discoverPackages(root, ['a'])).toEqual([{ dir: 'a', name: undefined }]);
  });
});

describe('workspacePatterns', () => {
  it('uses the layout packages when it lists them', async () => {
    expect(await workspacePatterns(clean, { ...importsLayout, packages: ['x/*'] })).toEqual(['x/*']);
  });

  it('reads the packages list of pnpm-workspace.yaml otherwise', async () => {
    expect(await workspacePatterns(clean, importsLayout)).toEqual(['core/*', 'features/*', 'product/*']);
  });

  it('fails when there is neither', async () => {
    const root = await makeTempDir();

    await expect(workspacePatterns(root, importsLayout)).rejects.toThrow(ConformanceError);
  });

  it('fails when the workspace file has no packages list', async () => {
    const root = await makeTempDir();
    await writeFiles(root, { 'pnpm-workspace.yaml': 'saveExact: true\n' });

    await expect(workspacePatterns(root, importsLayout)).rejects.toThrow("has no 'packages' list");
  });

  it('fails when a package pattern is not a string', async () => {
    const root = await makeTempDir();
    await writeFiles(root, { 'pnpm-workspace.yaml': 'packages:\n  - 1\n' });

    await expect(workspacePatterns(root, importsLayout)).rejects.toThrow("every entry of 'packages' must be a string");
  });
});

describe('workspaceRoot', () => {
  it('is the working directory unless the layout names a root', () => {
    expect(workspaceRoot('/work', importsLayout)).toBe('/work');
    expect(workspaceRoot('/work', { ...importsLayout, root: 'inner' })).toBe('/work/inner');
  });
});

describe('readWorkspacePackages', () => {
  it('reads a single-package repository whose root package the patterns select', async () => {
    const root = await makeTempDir();
    await writeFiles(root, { 'package.json': '{ "name": "single" }' });

    const packages = await readWorkspacePackages(root, { groups: [{ name: 'root', path: '.', rank: 0 }], packages: ['.'] });

    expect(packages).toEqual([{ dir: '.', name: 'single', group: 'root', rank: 0, slice: undefined }]);
  });

  it('fails when the patterns select no package, instead of checking nothing', async () => {
    const root = await makeTempDir();
    await writeFiles(root, { 'package.json': '{ "name": "single" }', 'pnpm-workspace.yaml': 'packages: []\n' });

    await expect(readWorkspacePackages(root, { groups: [{ name: 'root', path: '.' }] })).rejects.toThrow(ConformanceError);
    await expect(readWorkspacePackages(root, { groups: [{ name: 'root', path: '.' }], packages: ['packages/*'] })).rejects.toThrow(
      "no workspace package found: no directory the patterns packages/* select holds a package.json; for a single-package repository, set the layout's packages to ['.']",
    );
  });

  it('classifies the packages the workspace file selects', async () => {
    const packages = await readWorkspacePackages(clean, importsLayout);

    expect(packages.map((member) => [member.dir, member.group, member.rank, member.slice])).toEqual([
      ['core/kernel', 'core', 0, undefined],
      ['core/util', 'core', 0, undefined],
      ['features/auth', 'features', 1, 'auth'],
      ['features/billing', 'features', 1, 'billing'],
      ['product/auth', 'product', 2, 'auth'],
      ['product/billing', 'product', 2, 'billing'],
    ]);
  });
});
