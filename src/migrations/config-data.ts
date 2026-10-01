import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

import type { ConfigFileOptions } from '@exadev/config';
import { type Node, type ParseError, parse, parseTree, printParseErrorCode } from 'jsonc-parser';
import { parse as parseToml } from 'smol-toml';

import { evaluateConfigFile } from '../config-files';
import { ConformanceError } from '../errors';

/**
 * The first of `candidates` (relative to `cwd`) that exists, or `undefined` when none does.
 */
export function firstExisting(cwd: string, candidates: readonly string[]): string | undefined {
  return candidates.find((candidate) => existsSync(resolve(cwd, candidate)));
}

function assertValid(errors: readonly ParseError[], file: string): void {
  const [first] = errors;
  if (first !== undefined) {
    throw new ConformanceError(`${file}: not valid JSON (${printParseErrorCode(first.error)} at offset ${String(first.offset)})`);
  }
}

/**
 * The data in the text of a JSON file with comments and trailing commas allowed (`.jsonc`, and the `.json` files of tools that read them that way). Throws `ConformanceError` naming `file` when it is not valid.
 */
export function parseJsonc(text: string, file: string): unknown {
  const errors: ParseError[] = [];
  const data: unknown = parse(text, errors, { allowTrailingComma: true });
  assertValid(errors, file);

  return data;
}

/**
 * The syntax tree of the same text, with the offsets of its nodes. Throws `ConformanceError` naming `file` when it is not valid or holds no value.
 */
export function parseJsoncTree(text: string, file: string): Node {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true });
  assertValid(errors, file);
  if (tree === undefined) {
    throw new ConformanceError(`${file}: holds no JSON value`);
  }

  return tree;
}

/**
 * The data of the config file at `file` (relative to `cwd`), which must exist: JSON and JSONC are parsed, TOML is parsed, and anything else is evaluated as a module and its default export taken, as {@link evaluateConfigFile} does, so a TypeScript config runs as its own tool would run it.
 */
export async function readConfigData(cwd: string, file: string, configFiles: ConfigFileOptions | undefined): Promise<unknown> {
  const extension = extname(file).toLowerCase();
  if (extension === '.json' || extension === '.jsonc') {
    return parseJsonc(await readFile(resolve(cwd, file), 'utf8'), file);
  }
  if (extension === '.toml') {
    try {
      return parseToml(await readFile(resolve(cwd, file), 'utf8'));
    } catch (error) {
      throw new ConformanceError(`${file}: not valid TOML (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  return evaluateConfigFile(cwd, file, configFiles);
}
