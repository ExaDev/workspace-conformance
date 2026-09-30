import { describe, expect, it } from 'vitest';

import { ConformanceError } from './errors';
import { expandTemplate } from './template';

describe('expandTemplate', () => {
  it('replaces every placeholder, repeats included', () => {
    expect(expandTemplate('{dir}/{name}/{name}.ts', { dir: 'a', name: 'B' })).toBe('a/B/B.ts');
  });

  it('leaves text without placeholders alone', () => {
    expect(expandTemplate('plain/path.ts', {})).toBe('plain/path.ts');
  });

  it('fails on a placeholder without a value and lists the ones that exist', () => {
    expect(() => expandTemplate('{adapter}/x', { dir: 'a', name: 'B' })).toThrow(ConformanceError);
    expect(() => expandTemplate('{adapter}/x', { dir: 'a', name: 'B' })).toThrow('use {dir}, {name}');
  });
});
