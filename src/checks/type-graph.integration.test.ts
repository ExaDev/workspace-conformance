import { afterEach, describe, expect, it } from 'vitest';

import { ConformanceError } from '../errors';
import { fixturePath, makeTempDir, removeTempDirs, writeFiles } from '../../test/support/temp';
import { aggregateMappers } from './aggregate-mappers';
import { commandTypes } from './command-types';

const violating = fixturePath('type-graph', 'violating');
const clean = fixturePath('type-graph', 'clean');
const aggregateOptions = {
  contracts: ['product/*/contract/src/aggregates.ts'],
  adapters: '{dir}/../../adapters/*',
  mapper: '{adapter}/src/{name}.mapper.ts',
};
const commandOptions = { commands: ['product/*/contract/src/commands.ts'], exclude: ['Command'] };

afterEach(removeTempDirs);

describe('aggregate-mappers', () => {
  it('reports each aggregate that lacks a mapper in an adapter, where the aggregate is declared', async () => {
    const violations = await aggregateMappers({ cwd: violating, options: aggregateOptions });

    expect(violations).toEqual([
      {
        code: 'aggregate-mappers/missing-mapper',
        message: 'Customer has no mapper at product/shop/adapters/http/src/Customer.mapper.ts',
        file: 'product/shop/contract/src/aggregates.ts',
        location: { line: 1, column: 18 },
      },
      {
        code: 'aggregate-mappers/missing-mapper',
        message: 'Invoice has no mapper at product/shop/adapters/pg/src/Invoice.mapper.ts',
        file: 'product/shop/contract/src/aggregates.ts',
        location: { line: 5, column: 13 },
      },
    ]);
  });

  it('does not count a type that is not exported, or an export that is not a type', async () => {
    const messages = (await aggregateMappers({ cwd: violating, options: aggregateOptions })).map((violation) => violation.message);

    expect(messages.join('\n')).not.toMatch(/Internal|notAType/u);
  });

  it('reports nothing when every adapter maps every aggregate', async () => {
    expect(await aggregateMappers({ cwd: clean, options: aggregateOptions })).toEqual([]);
  });

  it('skips the names listed in exclude', async () => {
    const violations = await aggregateMappers({ cwd: violating, options: { ...aggregateOptions, exclude: ['Customer', 'Invoice'] } });

    expect(violations).toEqual([]);
  });

  it('checks one mapper path per aggregate when there are no adapters', async () => {
    const violations = await aggregateMappers({
      cwd: violating,
      options: { contracts: aggregateOptions.contracts, mapper: '{dir}/../../adapters/pg/src/{name}.mapper.ts' },
    });

    expect(violations.map((violation) => violation.message)).toEqual(['Invoice has no mapper at product/shop/adapters/pg/src/Invoice.mapper.ts']);
  });

  it('reports a contract whose adapter glob matches no directory', async () => {
    const violations = await aggregateMappers({ cwd: clean, options: { ...aggregateOptions, adapters: '{dir}/../../nowhere/*' } });

    expect(violations.map((violation) => violation.code)).toContain('aggregate-mappers/no-adapters');
  });

  it('fails on a placeholder that has no value', async () => {
    await expect(aggregateMappers({ cwd: clean, options: { ...aggregateOptions, mapper: '{adapter}/{missing}.ts' } })).rejects.toThrow('{missing}');
    await expect(aggregateMappers({ cwd: clean, options: { contracts: aggregateOptions.contracts, mapper: '{adapter}/src/{name}.mapper.ts' } })).rejects.toThrow('{adapter}');
  });

  it('fails when no contract file matches, so a mistyped glob is not a pass', async () => {
    await expect(aggregateMappers({ cwd: clean, options: { ...aggregateOptions, contracts: ['nowhere/*.ts'] } })).rejects.toThrow(ConformanceError);
  });

  it('fails when the tsconfig does not exist', async () => {
    const empty = await makeTempDir();
    await writeFiles(empty, { 'a.ts': 'export interface A { readonly id: string }' });

    await expect(aggregateMappers({ cwd: empty, options: { contracts: ['a.ts'], mapper: 'x/{name}.ts' } })).rejects.toThrow('does not exist');
  });
});

describe('command-types', () => {
  it('reports hand-written interfaces, hand-written aliases and inferences of something that is not a schema', async () => {
    const violations = await commandTypes({ cwd: violating, options: commandOptions });

    expect(violations.map((violation) => [violation.code, violation.file, violation.location])).toEqual([
      ['command-types/hand-written-interface', 'product/shop/contract/src/commands.ts', { line: 8, column: 18 }],
      ['command-types/hand-written-alias', 'product/shop/contract/src/commands.ts', { line: 12, column: 13 }],
      ['command-types/not-a-schema', 'product/shop/contract/src/commands.ts', { line: 16, column: 13 }],
    ]);
  });

  it('accepts commands inferred from a schema, including one imported from another file and one from another library', async () => {
    expect(await commandTypes({ cwd: clean, options: commandOptions })).toEqual([]);
  });

  it('follows local aliases and renamed imports to the inference, and judges the type an alias stands for', async () => {
    const violations = await commandTypes({ cwd: fixturePath('type-graph', 'aliases'), options: { commands: ['commands.ts'] } });

    expect(violations.map((violation) => [violation.code, violation.message.split(' ')[0]])).toEqual([
      ['command-types/hand-written-alias', 'ViaHandWritten'],
      ['command-types/hand-written-alias', 'ViaGeneric'],
    ]);
  });

  it('takes the generics that count as inference from the options', async () => {
    const violations = await commandTypes({ cwd: clean, options: { ...commandOptions, inferences: ['infer'] } });

    expect(violations.map((violation) => violation.message)).toEqual([expect.stringContaining('ShipOrder is a type alias')]);
  });

  it('judges a type once even when several listed files export it', async () => {
    const workspace = await makeTempDir();
    await writeFiles(workspace, {
      'tsconfig.json': '{ "compilerOptions": { "strict": true } }',
      'a.ts': 'export interface Bad { readonly id: string }\n',
      'b.ts': "export type { Bad } from './a';\n",
    });

    const violations = await commandTypes({ cwd: workspace, options: { commands: ['*.ts'] } });

    expect(violations.map((violation) => [violation.code, violation.file])).toEqual([['command-types/hand-written-interface', 'a.ts']]);
  });

  it('without an exclusion, reports a union of the commands as a hand-written alias', async () => {
    const violations = await commandTypes({ cwd: violating, options: { commands: commandOptions.commands } });

    expect(violations.map((violation) => violation.message.split(' ')[0])).toContain('Command');
  });
});
