import { describe, expect, it } from 'vitest';

import { ConformanceError } from '../errors';
import { fixturePath } from '../../test/support/temp';
import { derivedTypes } from './derived-types';

const cwd = fixturePath('type-graph', 'derived');
const pair = { schemas: ['schemas/*.ts'], types: ['types/*.ts'] };
const options = { pairs: [pair], exclude: ['Note'] };

function namesOf(violations: readonly { readonly message: string }[]): readonly string[] {
  return violations.map((violation) => violation.message.slice(0, violation.message.indexOf(' ')));
}

describe('derived-types', () => {
  it('reports each exported type that is not derived from a schema of its pair, where it is declared', async () => {
    const violations = await derivedTypes({ cwd, options });

    expect(violations.map((violation) => [violation.code, namesOf([violation])[0], violation.file, violation.location])).toEqual([
      ['derived-types/not-derived', 'Customer', 'types/models.ts', { line: 8, column: 18 }],
      ['derived-types/not-derived', 'Invoice', 'types/models.ts', { line: 12, column: 13 }],
      ['derived-types/not-derived', 'ChainedLoose', 'types/models.ts', { line: 21, column: 13 }],
      ['derived-types/not-derived', 'Wrapped', 'types/models.ts', { line: 25, column: 13 }],
      ['derived-types/not-derived', 'FromLocal', 'types/models.ts', { line: 29, column: 13 }],
      ['derived-types/not-derived', 'OrderOrInvoice', 'types/models.ts', { line: 43, column: 13 }],
    ]);
  });

  it('says which schemas a hand-written type should be derived from', async () => {
    const [violation] = await derivedTypes({ cwd, options });

    expect(violation?.message).toBe('Customer is not derived from a schema in schemas/*.ts: nothing in its definition applies an inference generic to one');
  });

  it('accepts a type inferred from a schema, and one built from such a type by a generic, an intersection, a nullable union, an array or an interface that extends it', async () => {
    const names = namesOf(await derivedTypes({ cwd, options }));

    for (const derived of ['Order', 'PartialOrder', 'MaybeOrder', 'AnnotatedOrder', 'Orders', 'ExtendedOrder']) {
      expect(names).not.toContain(derived);
    }
  });

  it('follows an alias chain through two files to the inference at its end', async () => {
    const names = namesOf(await derivedTypes({ cwd, options }));

    expect(names).not.toContain('Chained');
    expect(names).toContain('ChainedLoose');
  });

  it('does not count a schema passed to a generic that is not an inference, or an inference of a schema outside the pair', async () => {
    const names = namesOf(await derivedTypes({ cwd, options }));

    expect(names).toEqual(expect.arrayContaining(['Wrapped', 'FromLocal']));
  });

  it('skips the names listed in exclude', async () => {
    expect(namesOf(await derivedTypes({ cwd, options }))).not.toContain('Note');
    expect(namesOf(await derivedTypes({ cwd, options: { pairs: [pair] } }))).toContain('Note');
  });

  it("counts Drizzle's InferSelectModel and $inferSelect by default, and only the generics named in inferences when they are given", async () => {
    const users = { pairs: [{ schemas: ['schemas/users.ts'], types: ['types/users.ts'] }] };

    expect(await derivedTypes({ cwd, options: users })).toEqual([]);
    expect(namesOf(await derivedTypes({ cwd, options: { ...users, inferences: ['infer'] } }))).toEqual(['User', 'UserRow']);
  });

  it('judges each type against the schemas of its own pair', async () => {
    const violations = await derivedTypes({ cwd, options: { pairs: [{ schemas: ['schemas/users.ts'], types: ['types/models.ts'] }], exclude: ['Note'] } });

    expect(namesOf(violations)).toContain('Order');
  });

  it('fails when a glob of a pair matches no file, naming the option', async () => {
    const noSchemas = derivedTypes({ cwd, options: { pairs: [pair, { schemas: ['nowhere/*.ts'], types: ['types/*.ts'] }] } });

    await expect(noSchemas).rejects.toThrow(ConformanceError);
    await expect(noSchemas).rejects.toThrow(/^checks\.derived-types\.pairs\.1\.schemas: no file matches$/u);
    await expect(derivedTypes({ cwd, options: { pairs: [{ schemas: ['schemas/*.ts'], types: ['nowhere/*.ts'] }] } })).rejects.toThrow(/^checks\.derived-types\.pairs\.0\.types: no file matches$/u);
  });
});
