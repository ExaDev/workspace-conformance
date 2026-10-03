import { describe, expect, it } from 'vitest';

import { ConformanceError } from './errors';
import { expandTemplate, parseNameTemplate } from './template';

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

describe('parseNameTemplate', () => {
  it('splits a template into the text before and after {name}', () => {
    expect(parseNameTemplate('encode{name}')).toEqual({ before: 'encode', after: '' });
    expect(parseNameTemplate('{name}Decoder')).toEqual({ before: '', after: 'Decoder' });
    expect(parseNameTemplate('to{name}Json')).toEqual({ before: 'to', after: 'Json' });
  });

  it('rejects a template without {name}, with it more than once, with nothing else, or with another placeholder', () => {
    expect(parseNameTemplate('encode')).toBeUndefined();
    expect(parseNameTemplate('{name}And{name}')).toBeUndefined();
    expect(parseNameTemplate('{name}')).toBeUndefined();
    expect(parseNameTemplate('encode{name}As{format}')).toBeUndefined();
  });
});
