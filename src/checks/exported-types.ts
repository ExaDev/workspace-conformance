import type { ExportedDeclarations, InterfaceDeclaration, SourceFile, TypeAliasDeclaration } from 'ts-morph';
import { Node } from 'ts-morph';

import type { SourceLocation } from '../check';

/**
 * An exported interface or type alias.
 */
export type ExportedType = InterfaceDeclaration | TypeAliasDeclaration;

function isExportedType(declaration: ExportedDeclarations): declaration is ExportedType {
  return Node.isInterfaceDeclaration(declaration) || Node.isTypeAliasDeclaration(declaration);
}

/**
 * The interfaces and type aliases `file` exports by name, wherever they are declared: a re-export counts. Values, classes and enums are not types in this sense and are left out.
 */
export function exportedTypes(file: SourceFile): ReadonlyMap<string, ExportedType> {
  const found = new Map<string, ExportedType>();
  for (const [name, declarations] of file.getExportedDeclarations()) {
    const declaration = declarations.find(isExportedType);
    if (declaration !== undefined) {
      found.set(name, declaration);
    }
  }

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
