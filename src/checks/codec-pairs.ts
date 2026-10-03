import { resolve } from 'node:path';

import { type ExportedDeclarations, type ModuleDeclaration, Node, type SourceFile } from 'ts-morph';

import type { CheckFunction, SourceLocation, FileViolation } from '../check';
import { ConformanceError } from '../errors';
import type { CodecPairsOptions } from '../options';
import { relativePosix } from '../paths';
import { NAME_TEMPLATE_REQUIREMENT, type NameTemplate, parseNameTemplate } from '../template';
import { createProject } from '../ts-project';

function collect(container: SourceFile | ModuleDeclaration, prefix: string, found: Map<string, ExportedDeclarations>, entered: ReadonlySet<SourceFile>): void {
  for (const [name, declarations] of container.getExportedDeclarations()) {
    const value = declarations.find((declaration) => !Node.isInterfaceDeclaration(declaration) && !Node.isTypeAliasDeclaration(declaration) && !Node.isModuleDeclaration(declaration) && !Node.isSourceFile(declaration));
    if (value !== undefined) {
      found.set(`${prefix}${name}`, value);
    }
    for (const member of declarations) {
      if (Node.isModuleDeclaration(member)) {
        collect(member, `${prefix}${name}.`, found, entered);
      } else if (Node.isSourceFile(member) && !entered.has(member)) {
        collect(member, `${prefix}${name}.`, found, new Set([...entered, member]));
      }
    }
  }
}

/**
 * The values `file` exports, by name, wherever they are declared: a re-export counts. Those inside an exported namespace, or in a module re-exported as a namespace (`export * as ns from './x'`), are included under their qualified name (`Namespace.value`). Interfaces and type aliases are types, not codecs, and a namespace is where codecs live rather than one itself, so all three are left out.
 */
function exportedValues(file: SourceFile): ReadonlyMap<string, ExportedDeclarations> {
  const found = new Map<string, ExportedDeclarations>();
  collect(file, '', found, new Set([file]));

  return found;
}

/**
 * Where the declaration's name is written, or where the declaration starts when it has no name node.
 */
function valueLocation(declaration: ExportedDeclarations): SourceLocation {
  const nameNode = Node.hasName(declaration) ? declaration.getNameNode() : undefined;
  const { line, column } = declaration.getSourceFile().getLineAndColumnAtPos((nameNode ?? declaration).getStart());

  return { line, column };
}

/**
 * The template of an option, which the configuration has already validated; a template that does not parse is a configuration error naming the option.
 */
function templateOf(options: CodecPairsOptions, option: 'encoder' | 'decoder'): NameTemplate {
  const template = parseNameTemplate(options[option]);
  if (template === undefined) {
    throw new ConformanceError(`checks.codec-pairs.${option}: ${NAME_TEMPLATE_REQUIREMENT}`);
  }

  return template;
}

/**
 * The shared name a qualified export name gives under `template`, or `undefined` when its last segment does not fit the template. The namespace part is kept apart so a counterpart is looked for in the same namespace.
 */
function sharedName(qualified: string, template: NameTemplate): { readonly namespace: string; readonly name: string } | undefined {
  const namespace = qualified.slice(0, qualified.lastIndexOf('.') + 1);
  const local = qualified.slice(namespace.length);
  if (local.length <= template.before.length + template.after.length || !local.startsWith(template.before) || !local.endsWith(template.after)) {
    return undefined;
  }

  return { namespace, name: local.slice(template.before.length, local.length - template.after.length) };
}

/**
 * Every encoder a codec file exports has the decoder its name implies, exported by the same file, and every decoder the encoder. A name is an encoder or a decoder when it fits that template; other exports are not codecs and are not judged. A half re-exported from another file counts, and is reported where it is declared.
 *
 * It checks that the counterpart is exported, not that the two round-trip: that is a property test of the repository's own.
 */
export const codecPairs: CheckFunction<CodecPairsOptions> = async ({ cwd, options }) => {
  const { project, files } = await createProject(cwd, options.tsConfig, options.codecs, { check: 'codec-pairs', files: 'codecs' });
  const excluded = new Set(options.exclude);
  const encoder = templateOf(options, 'encoder');
  const decoder = templateOf(options, 'decoder');
  const halves = [
    { template: encoder, counterpart: decoder, missing: 'decoder' },
    { template: decoder, counterpart: encoder, missing: 'encoder' },
  ];
  const violations: FileViolation[] = [];

  for (const file of files) {
    const values = exportedValues(project.getSourceFileOrThrow(resolve(cwd, file)));
    for (const [qualified, declaration] of values) {
      if (excluded.has(qualified)) {
        continue;
      }
      for (const { template, counterpart, missing } of halves) {
        const shared = sharedName(qualified, template);
        if (shared === undefined) {
          continue;
        }
        const expected = `${shared.namespace}${counterpart.before}${shared.name}${counterpart.after}`;
        if (!values.has(expected)) {
          violations.push({
            code: `codec-pairs/missing-${missing}`,
            message: `${qualified} has no ${missing}: ${file} does not export ${expected}`,
            file: relativePosix(cwd, declaration.getSourceFile().getFilePath()),
            location: valueLocation(declaration),
          });
        }
      }
    }
  }

  return violations.sort((a, b) => a.file.localeCompare(b.file) || (a.location?.line ?? 0) - (b.location?.line ?? 0) || a.message.localeCompare(b.message));
};
