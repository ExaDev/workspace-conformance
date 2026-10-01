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

  it('marks exactly the settings checks as reading the repository through the GitHub API', () => {
    expect(checkNames.filter((name) => registry[name].requiresGitHub)).toEqual(['settings-merge-methods', 'settings-required-checks', 'settings-review-thread-resolution']);
  });

  it('refuses to run a settings check without a GitHub client', async () => {
    const settings = registry['settings-merge-methods'];
    if (!('run' in settings)) {
      throw new Error('settings-merge-methods has no run');
    }

    await expect(settings.run({ cwd: '.', checks: { 'settings-merge-methods': {} }, layout: undefined, configFiles: undefined, github: undefined })).rejects.toThrow(/needs a GitHub client/u);
  });

  it('treats a check as enabled when its setting is an options object, and not when it is false or absent', () => {
    expect(registry['single-storybook'].isEnabled({ 'single-storybook': {} })).toBe(true);
    expect(registry['single-storybook'].isEnabled({ 'single-storybook': false })).toBe(false);
    expect(registry['single-storybook'].isEnabled({})).toBe(false);
  });

  it('refuses to run a check that is not enabled', async () => {
    const storybook = registry['single-storybook'];
    if (!('run' in storybook)) {
      throw new Error('single-storybook has no run');
    }

    await expect(storybook.run({ cwd: '.', checks: {}, layout: undefined, configFiles: undefined, github: undefined })).rejects.toThrow(ConformanceError);
  });

  it('gives the import checks a place in the shared cruise and no run of their own', () => {
    for (const name of checkNames.filter((checkName) => registry[checkName].requiresLayout)) {
      const entry = registry[name];
      expect('importGraph' in entry).toBe(true);
      expect('run' in entry).toBe(false);
    }
  });
});

describe('isCheckName', () => {
  it('recognises the names of checks only', () => {
    expect(isCheckName('import-cycles')).toBe(true);
    expect(isCheckName('import-cycle')).toBe(false);
    expect(isCheckName('toString')).toBe(false);
  });
});
