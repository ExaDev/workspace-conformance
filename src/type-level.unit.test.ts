import { describe, expect, it } from 'vitest';

import { ExhaustivenessError, handlerCases, proveExhaustive, removeCase, typeErrors } from './type-level';

const COMMANDS = `
type Command =
  | { readonly type: 'create'; readonly sku: string }
  | { readonly type: 'cancel'; readonly orderId: string }
  | { readonly type: 'refund'; readonly orderId: string };
`;

const CASES = `{
  create: (command) => void command.sku,
  cancel: (command) => void command.orderId,
  refund: (command) => void command.orderId,
}`;

/**
 * The pattern the README documents: a handler map typed as a mapped type over the union of commands, so the compiler demands a handler for every command.
 */
const EXHAUSTIVE_TYPE = `type Handlers = { readonly [Type in Command['type']]: (command: Extract<Command, { readonly type: Type }>) => void };`;

const handlers = `${COMMANDS}
${EXHAUSTIVE_TYPE}

export const handlers: Handlers = ${CASES};
`;

const MISSING_PROPERTY = 2741;
const IMPLICIT_ANY_PARAMETER = 7006;
const CANNOT_FIND_MODULE = 2307;
const CANNOT_FIND_NAME = 2304;
const CASE_COUNT = 3;

describe('proveExhaustive', () => {
  it('proves a handler map that the compiler checks for exhaustiveness: removing any case breaks the type check', () => {
    const proof = proveExhaustive({ files: { 'handlers.ts': handlers }, file: 'handlers.ts', map: 'handlers' });

    expect(proof.removals.map((removal) => removal.case)).toEqual(['create', 'cancel', 'refund']);
    for (const removal of proof.removals) {
      expect(removal.errors.map((error) => error.code)).toContain(MISSING_PROPERTY);
      expect(removal.errors[0]?.message).toContain(removal.case);
    }
  });

  it('limits the proof to the cases it is given', () => {
    const proof = proveExhaustive({ files: { 'handlers.ts': handlers }, file: 'handlers.ts', map: 'handlers', cases: ['cancel'] });

    expect(proof.removals.map((removal) => removal.case)).toEqual(['cancel']);
  });

  it('accepts a map declared with satisfies', () => {
    const source = `${COMMANDS}
${EXHAUSTIVE_TYPE}

export const handlers = ${CASES} satisfies Handlers;
`;

    expect(proveExhaustive({ files: { 'handlers.ts': source }, file: 'handlers.ts', map: 'handlers' }).removals).toHaveLength(CASE_COUNT);
  });

  it('accepts commands that another file declares', () => {
    const commands = "export type Command = { readonly type: 'a' } | { readonly type: 'b' };\n";
    const map = `
import type { Command } from './commands';

type Handlers = { readonly [Type in Command['type']]: () => void };

export const handlers: Handlers = { a: () => undefined, b: () => undefined };
`;

    const proof = proveExhaustive({ files: { 'commands.ts': commands, 'handlers.ts': map }, file: 'handlers.ts', map: 'handlers' });

    expect(proof.removals.map((removal) => removal.case)).toEqual(['a', 'b']);
  });

  it('fails for a map whose type does not demand every case', () => {
    const partial = handlers.replace(EXHAUSTIVE_TYPE, `type Handlers = Partial<${EXHAUSTIVE_TYPE.replace('type Handlers = ', '').replace(/;$/u, '')}>;`);

    expect(() => proveExhaustive({ files: { 'handlers.ts': partial }, file: 'handlers.ts', map: 'handlers' })).toThrow(ExhaustivenessError);
    expect(() => proveExhaustive({ files: { 'handlers.ts': partial }, file: 'handlers.ts', map: 'handlers' })).toThrow("removing the case 'create'");
  });

  it('fails for a map typed as a loose record', () => {
    const loose = `${COMMANDS}
type Handlers = Record<string, () => void>;

export const handlers: Handlers = { create: () => undefined, cancel: () => undefined, refund: () => undefined };
`;

    expect(() => proveExhaustive({ files: { 'handlers.ts': loose }, file: 'handlers.ts', map: 'handlers' })).toThrow('is not checked for exhaustiveness');
  });

  it('fails when the files do not type-check as written', () => {
    const broken = handlers.replace("sku: string", 'sku: number').replace('void command.sku', 'command.sku.toUpperCase()');

    expect(() => proveExhaustive({ files: { 'handlers.ts': broken }, file: 'handlers.ts', map: 'handlers' })).toThrow('do not type-check as written');
  });

  it('fails when the file or the map is missing', () => {
    expect(() => proveExhaustive({ files: { 'handlers.ts': handlers }, file: 'other.ts', map: 'handlers' })).toThrow("no file 'other.ts'");
    expect(() => proveExhaustive({ files: { 'handlers.ts': handlers }, file: 'handlers.ts', map: 'missing' })).toThrow("no variable 'missing'");
  });
});

describe('typeErrors', () => {
  it('returns nothing for a program that type-checks', () => {
    expect(typeErrors({ 'a.ts': 'export const a: number = 1;\n' })).toEqual([]);
  });

  it('returns the code, file and line of each error', () => {
    const errors = typeErrors({ 'a.ts': "export const ok = 1;\nexport const a: number = 'x';\n" });

    expect(errors).toEqual([{ file: 'a.ts', line: 2, code: 2322, message: "Type 'string' is not assignable to type 'number'." }]);
  });

  it('applies compiler options over its defaults', () => {
    const source = 'export const a = (value) => value;\n';

    expect(typeErrors({ 'a.ts': source }).map((error) => error.code)).toEqual([IMPLICIT_ANY_PARAMETER]);
    expect(typeErrors({ 'a.ts': source }, { noImplicitAny: false })).toEqual([]);
  });

  it('type-checks declaration files among the files it is given', () => {
    expect(typeErrors({ 'a.d.ts': 'export declare const a: Missing;\n' }).map((error) => error.code)).toEqual([CANNOT_FIND_NAME]);
  });

  it('does not let one call see the files of an earlier call', () => {
    const importer = "import { value } from './value';\nexport const copy: number = value;\n";

    expect(typeErrors({ 'value.ts': 'export const value = 1;\n', 'a.ts': importer })).toEqual([]);
    expect(typeErrors({ 'a.ts': importer }).map((error) => error.code)).toEqual([CANNOT_FIND_MODULE]);
  });
});

describe('handlerCases and removeCase', () => {
  it('lists the cases of a map in source order', () => {
    expect(handlerCases(handlers, 'handlers')).toEqual(['create', 'cancel', 'refund']);
  });

  it('deletes one case and leaves the others', () => {
    const removed = removeCase(handlers, 'handlers', 'cancel');

    expect(handlerCases(removed, 'handlers')).toEqual(['create', 'refund']);
  });

  it('fails to remove a case the map does not have', () => {
    expect(() => removeCase(handlers, 'handlers', 'missing')).toThrow("has no case 'missing'");
  });
});
