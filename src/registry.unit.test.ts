import { describe, expect, it } from 'vitest';

import { ConformanceError } from './errors';
import { checkNames, isCheckName, registry } from './registry';

describe('registry', () => {
  it('registers every check under its own name', () => {
    for (const [key, entry] of Object.entries(registry)) {
      expect(entry.name).toBe(key);
      expect(entry.description).not.toBe('');
    }
  });

  it('lists the check names in registry order', () => {
    expect(checkNames).toEqual(Object.keys(registry));
  });

  it('marks exactly the import checks as reading the layout', () => {
    expect(checkNames.filter((name) => registry[name].requiresLayout)).toEqual([
      'import-uphill',
      'import-rank-skip',
      'import-cross-slice',
      'import-isolated-groups',
      'import-cycles',
    ]);
  });

  it('treats a check as enabled when its setting is an options object, and not when it is false or absent', () => {
    expect(registry['single-storybook'].isEnabled({ 'single-storybook': {} })).toBe(true);
    expect(registry['single-storybook'].isEnabled({ 'single-storybook': false })).toBe(false);
    expect(registry['single-storybook'].isEnabled({})).toBe(false);
  });

  it('refuses to run a check that is not enabled', async () => {
    await expect(registry['single-storybook'].run({ cwd: '.', checks: {}, layout: undefined, configFiles: undefined })).rejects.toThrow(ConformanceError);
    await expect(registry['import-uphill'].run({ cwd: '.', checks: {}, layout: undefined, configFiles: undefined })).rejects.toThrow("'import-uphill' is not enabled");
  });

  it('refuses to run a layout check without the layout', async () => {
    await expect(registry['import-uphill'].run({ cwd: '.', checks: { 'import-uphill': {} }, layout: undefined, configFiles: undefined })).rejects.toThrow('reads the workspace layout');
  });
});

describe('isCheckName', () => {
  it('recognises the names of checks only', () => {
    expect(isCheckName('import-cycles')).toBe(true);
    expect(isCheckName('import-cycle')).toBe(false);
    expect(isCheckName('toString')).toBe(false);
  });
});
