import type { ExportedDeclarations, InterfaceDeclaration, ModuleDeclaration, SourceFile, TypeAliasDeclaration } from 'ts-morph';
import { Node } from 'ts-morph';

import type { SourceLocation } from '../check';

/**
 * An exported interface or type alias.
 */
export type ExportedType = InterfaceDeclaration | TypeAliasDeclaration;

function isExportedType(declaration: ExportedDeclarations): declaration is ExportedType {
  return Node.isInterfaceDeclaration(declaration) || Node.isTypeAliasDeclaration(declaration);
}

function collectFromNamespace(namespace: ModuleDeclaration, prefix: string, found: Map<string, ExportedType>): void {
  for (const declaration of [...namespace.getInterfaces(), ...namespace.getTypeAliases()]) {
    if (declaration.isExported()) {
      found.set(`${prefix}${declaration.getName()}`, declaration);
    }
  }
  for (const nested of namespace.getModules()) {
    if (nested.isExported()) {
      collectFromNamespace(nested, `${prefix}${nested.getName()}.`, found);
    }
  }
}

function collectFromFile(file: SourceFile, prefix: string, found: Map<string, ExportedType>, entered: ReadonlySet<SourceFile>): void {
  for (const [name, declarations] of file.getExportedDeclarations()) {
    const declaration = declarations.find(isExportedType);
    if (declaration !== undefined) {
      found.set(`${prefix}${name}`, declaration);
    }
    for (const member of declarations) {
      if (Node.isModuleDeclaration(member)) {
        collectFromNamespace(member, `${prefix}${name}.`, found);
      } else if (Node.isSourceFile(member) && !entered.has(member)) {
        collectFromFile(member, `${prefix}${name}.`, found, new Set([...entered, member]));
      }
    }
  }
}

/**
 * The interfaces and type aliases `file` exports, by name, wherever they are declared: a re-export counts. Those inside an exported namespace, or in a module re-exported as a namespace (`export * as ns from './x'`), are included under their qualified name (`Namespace.Type`). Values, classes and enums are not types in this sense and are left out.
 */
export function exportedTypes(file: SourceFile): ReadonlyMap<string, ExportedType> {
  const found = new Map<string, ExportedType>();
  collectFromFile(file, '', found, new Set([file]));

  return found;
}

/**
 * Where the declaration's name is written, as a file relative to `cwd`'s path and a line and column.
 */
export function declarationLocation(declaration: ExportedType): SourceLocation {
  const file = declaration.getSourceFile();
  const { line, column } = file.getLineAndColumnAtPos(declaration.getNameNode().getStart());

  return { line, column };
}
