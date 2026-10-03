import { resolve } from 'node:path';

import { type ExpressionWithTypeArguments, type InterfaceDeclaration, Node, SyntaxKind, type TypeAliasDeclaration, type TypeNode, type TypeReferenceNode } from 'ts-morph';

import type { CheckFunction, Violation } from '../check';
import { ConformanceError } from '../errors';
import { findFiles } from '../files';
import type { DerivedTypesOptions, DerivedTypesPair } from '../options';
import { relativePosix } from '../paths';
import { createProject } from '../ts-project';
import { DEFAULT_INFERENCES } from './command-types';
import { declarationLocation, exportedTypes, type ExportedType } from './exported-types';
import { declarationsOf, lastIdentifier, referenceNames } from './type-references';

/**
 * The last names that count as inference when the options name none: those of `command-types`, Drizzle's `InferSelectModel` and `InferInsertModel` generics, and the `$inferSelect` and `$inferInsert` members of a Drizzle table, read as `typeof table.$inferSelect`.
 */
export const DEFAULT_DERIVED_TYPE_INFERENCES: readonly string[] = [...DEFAULT_INFERENCES, 'InferSelectModel', 'InferInsertModel', '$inferSelect', '$inferInsert'];

/**
 * What a walk of one type's definition needs: which names count as inference, which files hold the schemas, and the declarations already followed, so a loop of aliases is not followed twice.
 */
interface Derivation {
  readonly inferences: ReadonlySet<string>;
  /**
   * The schema files, relative to the directory the checks run in.
   */
  readonly schemaFiles: ReadonlySet<string>;
  readonly cwd: string;
  readonly followed: ReadonlySet<ExportedType>;
}

/**
 * Whether the node names something declared in one of the schema files.
 */
function declaredInSchema(name: Node, derivation: Derivation): boolean {
  const identifier = Node.isIdentifier(name) ? name : Node.isQualifiedName(name) ? name.getRight() : undefined;

  return identifier !== undefined && declarationsOf(identifier).some((declaration) => derivation.schemaFiles.has(relativePosix(derivation.cwd, declaration.getSourceFile().getFilePath())));
}

/**
 * The interface or type alias without type parameters a reference names, when it has not been followed yet. Such a declaration is a name for what it is written as, so it is judged by that.
 */
function followable(reference: TypeReferenceNode | ExpressionWithTypeArguments, derivation: Derivation): ExportedType | undefined {
  const name = Node.isTypeReference(reference) ? reference.getTypeName() : reference.getExpression();
  if (!Node.isIdentifier(name) && !Node.isQualifiedName(name) && !Node.isPropertyAccessExpression(name)) {
    return undefined;
  }
  const declaration = declarationsOf(lastIdentifier(name)).find((found): found is ExportedType => Node.isTypeAliasDeclaration(found) || Node.isInterfaceDeclaration(found));

  return declaration?.getTypeParameters().length === 0 && !derivation.followed.has(declaration) ? declaration : undefined;
}

function isNullish(node: TypeNode): boolean {
  return node.getKind() === SyntaxKind.UndefinedKeyword || (Node.isLiteralTypeNode(node) && node.getLiteral().getKind() === SyntaxKind.NullKeyword);
}

/**
 * Whether a reference is derived: an inference applied to `typeof schema`, an alias or interface that is itself derived, or another generic given a derived type, as `Partial<Order>` is.
 */
function derivedReference(reference: TypeReferenceNode | ExpressionWithTypeArguments, derivation: Derivation): boolean {
  const name = Node.isTypeReference(reference) ? reference.getTypeName() : reference.getExpression();
  if ((Node.isIdentifier(name) || Node.isQualifiedName(name) || Node.isPropertyAccessExpression(name)) && referenceNames(name).some((candidate) => derivation.inferences.has(candidate))) {
    const [argument] = reference.getTypeArguments();

    return argument !== undefined && Node.isTypeQuery(argument) && declaredInSchema(argument.getExprName(), derivation);
  }
  const declaration = followable(reference, derivation);
  if (declaration !== undefined) {
    return derivedDeclaration(declaration, { ...derivation, followed: new Set([...derivation.followed, declaration]) });
  }

  return reference.getTypeArguments().some((argument) => derivedType(argument, derivation));
}

/**
 * Whether a type, as written, is derived from a schema. A type literal is written by hand whatever its members are.
 */
function derivedType(node: TypeNode, derivation: Derivation): boolean {
  if (Node.isTypeReference(node) || Node.isExpressionWithTypeArguments(node)) {
    return derivedReference(node, derivation);
  }
  if (Node.isTypeQuery(node)) {
    const name = node.getExprName();

    return Node.isQualifiedName(name) && referenceNames(name).some((candidate) => derivation.inferences.has(candidate)) && declaredInSchema(name.getLeft(), derivation);
  }
  if (Node.isParenthesizedTypeNode(node) || Node.isTypeOperatorTypeNode(node)) {
    return derivedType(node.getTypeNode(), derivation);
  }
  if (Node.isArrayTypeNode(node)) {
    return derivedType(node.getElementTypeNode(), derivation);
  }
  if (Node.isIndexedAccessTypeNode(node)) {
    return derivedType(node.getObjectTypeNode(), derivation);
  }
  if (Node.isIntersectionTypeNode(node)) {
    return node.getTypeNodes().some((member) => derivedType(member, derivation));
  }
  if (Node.isUnionTypeNode(node)) {
    const members = node.getTypeNodes().filter((member) => !isNullish(member));

    return members.length > 0 && members.every((member) => derivedType(member, derivation));
  }

  return false;
}

/**
 * Whether an interface or type alias is derived: an alias by the type it is written as, an interface by whether it extends a derived type.
 */
function derivedDeclaration(declaration: InterfaceDeclaration | TypeAliasDeclaration, derivation: Derivation): boolean {
  if (Node.isInterfaceDeclaration(declaration)) {
    return declaration.getExtends().some((heritage) => derivedReference(heritage, derivation));
  }

  return derivedType(declaration.getTypeNodeOrThrow(), derivation);
}

async function pairViolations(cwd: string, options: DerivedTypesOptions, pair: DerivedTypesPair, index: number): Promise<readonly Violation[]> {
  const { project, files } = await createProject(cwd, options.tsConfig, pair.types, { check: 'derived-types', files: `pairs.${String(index)}.types` });
  const schemaFiles = await findFiles(cwd, pair.schemas);
  if (schemaFiles.length === 0) {
    throw new ConformanceError(`checks.derived-types.pairs.${String(index)}.schemas: no file matches`);
  }
  const excluded = new Set(options.exclude);
  const derivation: Derivation = { inferences: new Set(options.inferences ?? DEFAULT_DERIVED_TYPE_INFERENCES), schemaFiles: new Set(schemaFiles), cwd, followed: new Set() };
  const seen = new Set<ExportedType>();
  const violations: Violation[] = [];

  for (const file of files) {
    for (const [name, declaration] of exportedTypes(project.getSourceFileOrThrow(resolve(cwd, file)))) {
      if (excluded.has(name) || seen.has(declaration)) {
        continue;
      }
      seen.add(declaration);
      if (!derivedDeclaration(declaration, { ...derivation, followed: new Set([declaration]) })) {
        violations.push({
          code: 'derived-types/not-derived',
          message: `${name} is not derived from a schema in ${pair.schemas.join(', ')}: nothing in its definition applies an inference generic to one`,
          file: relativePosix(cwd, declaration.getSourceFile().getFilePath()),
          location: declarationLocation(declaration),
        });
      }
    }
  }

  return violations;
}

/**
 * For each pair, every exported interface and type alias of its type files is derived from a schema declared in its schema files: somewhere in its definition an inference (a generic in `inferences`, such as `z.infer` or `InferSelectModel`) is applied to `typeof schema`, or an inference member is read from it (`typeof table.$inferSelect`).
 *
 * The definition is followed through aliases and interfaces without type parameters, in any file, and through the arguments of other generics, intersections, unions whose members are all derived (`null` and `undefined` aside), arrays, type operators and indexed access. A type literal, and a schema passed to a generic that is not an inference, are written by hand.
 */
export const derivedTypes: CheckFunction<DerivedTypesOptions> = async ({ cwd, options }) => {
  const violations: Violation[] = [];
  for (const [index, pair] of options.pairs.entries()) {
    violations.push(...(await pairViolations(cwd, options, pair, index)));
  }

  return violations.sort((a, b) => a.file.localeCompare(b.file) || (a.location?.line ?? 0) - (b.location?.line ?? 0) || a.message.localeCompare(b.message));
};
