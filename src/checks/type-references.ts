import { type EntityName, type Identifier, Node, type PropertyAccessExpression } from 'ts-morph';

/**
 * How a type is referred to: a name in a type position (`z.infer`, `Base`) or an expression in a heritage clause (`interface X extends z.infer<...>`).
 */
export type ReferenceName = EntityName | PropertyAccessExpression;

/**
 * The identifier a reference ends in: `infer` in `z.infer`, the name itself when it is not qualified.
 */
export function lastIdentifier(reference: ReferenceName): Identifier {
  if (Node.isQualifiedName(reference)) {
    return reference.getRight();
  }
  if (Node.isPropertyAccessExpression(reference)) {
    return reference.getNameNode();
  }

  return reference;
}

/**
 * The declarations the identifier refers to, through any imports and re-exports.
 */
export function declarationsOf(identifier: Identifier): readonly Node[] {
  const symbol = identifier.getSymbol();

  return (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations() ?? [];
}

/**
 * The names a reference goes by: the last name as written, and the name it was declared with when that differs, as for `Infer` in `import type { infer as Infer } from 'zod'`, which is also `infer`. A library may itself re-export a generic under another name, so both count.
 */
export function referenceNames(reference: ReferenceName): readonly string[] {
  const identifier = lastIdentifier(reference);
  const symbol = identifier.getSymbol();
  const declared = (symbol?.getAliasedSymbol() ?? symbol)?.getName();

  return declared === undefined ? [identifier.getText()] : [...new Set([identifier.getText(), declared])];
}
