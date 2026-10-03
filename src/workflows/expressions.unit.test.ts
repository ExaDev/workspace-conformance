import { describe, expect, it } from 'vitest';

import { constantString } from './expressions';

describe('constantString', () => {
  const inputs = { label: 'ubuntu-latest', unknown: undefined };

  it('reads a string literal, with a doubled quote as one quote', () => {
    expect(constantString("'it''s'", {})).toBe("it's");
    expect(constantString("( '[\"a\"]' )", {})).toBe('["a"]');
  });

  it('reads an input only when it has a value', () => {
    expect(constantString('inputs.label', inputs)).toBe('ubuntu-latest');
    expect(constantString('inputs.unknown', inputs)).toBeUndefined();
    expect(constantString('inputs.absent', inputs)).toBeUndefined();
  });

  it('evaluates format() as GitHub does, with doubled braces as literal ones', () => {
    expect(constantString(`format('["{0}"]', inputs.label)`, inputs)).toBe('["ubuntu-latest"]');
    expect(constantString(`FORMAT('{{{0}}}-{1}', 'a', format('{0}', 'b'))`, inputs)).toBe('{a}-b');
    expect(constantString(`format('{0}, {1}', 'a, b', 'c')`, inputs)).toBe('a, b, c');
  });

  it('knows nothing of a value that depends on the run', () => {
    expect(constantString('steps.resolve.outputs.runner', inputs)).toBeUndefined();
    expect(constantString(`format('{0}', inputs.unknown)`, inputs)).toBeUndefined();
    expect(constantString(`format('{1}', 'a')`, inputs)).toBeUndefined();
    expect(constantString(`toJSON('a')`, inputs)).toBeUndefined();
  });
});
