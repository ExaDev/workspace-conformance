import { describe, expect, it } from 'vitest';

import { ConformanceError } from '../errors';
import { normaliseSeverity } from './eslint';

describe('normaliseSeverity', () => {
  it('reads a severity in each form ESLint accepts, bare or as the first element of an entry', () => {
    expect(normaliseSeverity(0)).toBe('off');
    expect(normaliseSeverity('off')).toBe('off');
    expect(normaliseSeverity([0, 'x'])).toBe('off');
    expect(normaliseSeverity(1)).toBe('warn');
    expect(normaliseSeverity('warn')).toBe('warn');
    expect(normaliseSeverity([1])).toBe('warn');
    expect(normaliseSeverity(2)).toBe('error');
    expect(normaliseSeverity('error')).toBe('error');
    expect(normaliseSeverity(['error', { max: 3 }])).toBe('error');
  });

  it('throws for what is not a severity', () => {
    expect(() => normaliseSeverity('3')).toThrow(ConformanceError);
    expect(() => normaliseSeverity(['fatal'])).toThrow(/not a severity/u);
    expect(() => normaliseSeverity([])).toThrow(ConformanceError);
    expect(() => normaliseSeverity(undefined)).toThrow(ConformanceError);
  });
});
