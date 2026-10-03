import { resolve } from 'node:path';

import { type EntityName, Node, type TypeAliasDeclaration } from 'ts-morph';

import type { CheckFunction, FileViolation } from '../check';
import type { CommandTypesOptions } from '../options';
import { relativePosix } from '../paths';
import { createProject } from '../ts-project';
import { declarationLocation, exportedTypes, type ExportedType } from './exported-types';
import { declarationsOf, lastIdentifier, referenceNames } from './type-references';

/**
 * The last names of the generics that turn a schema into its type, used when the options name none: `z.infer`, `z.input`, `z.output`, `z.TypeOf` and Valibot's `InferInput` and `InferOutput`.
 */
export const DEFAULT_INFERENCES: readonly string[] = ['infer', 'input', 'output', 'TypeOf', 'InferInput', 'InferOutput'];

/**
 * The member Standard Schema requires of every schema object, which is what makes a value a schema whatever library made it.
 */
const STANDARD_SCHEMA_MEMBER = '~standard';

/**
 * The local alias without type parameters that a type reference names, or `undefined` when it names anything else. Such an alias is a name for the type it is written as, so it is judged by that.
 */
function aliasNamed(typeName: EntityName): TypeAliasDeclaration | undefined {
  const declaration = declarationsOf(lastIdentifier(typeName)).find(Node.isTypeAliasDeclaration);

  return declaration?.getTypeParameters().length === 0 ? declaration : undefined;
}

/**
 * Why a command type is not derived from a schema, or `undefined` when it is. `followed` holds the aliases already followed from the exported type, so a chain of aliases is followed to its end and a loop of them is not followed twice.
 */
function problem(
  declaration: ExportedType,
  name: string,
  inferences: readonly string[],
  followed: ReadonlySet<TypeAliasDeclaration> = new Set(),
): { readonly reason: string; readonly message: string } | undefined {
  if (Node.isInterfaceDeclaration(declaration)) {
    return { reason: 'hand-written-interface', message: `${name} is a hand-written interface; derive the command from its schema` };
  }
  const written = declaration.getTypeNode();
  if (Node.isTypeReference(written)) {
    const inference = referenceNames(written.getTypeName()).find((candidate) => inferences.includes(candidate));
    if (inference !== undefined) {
      const [argument] = written.getTypeArguments();
      if (argument !== undefined && Node.isTypeQuery(argument) && argument.getExprName().getType().getProperty(STANDARD_SCHEMA_MEMBER) !== undefined) {
        return undefined;
      }

      return { reason: 'not-a-schema', message: `${name} applies '${inference}' to something that is not a schema: its type has no '${STANDARD_SCHEMA_MEMBER}' member` };
    }
    const alias = aliasNamed(written.getTypeName());
    if (alias !== undefined && !followed.has(alias)) {
      return problem(alias, name, inferences, new Set([...followed, alias]));
    }
  }

  return { reason: 'hand-written-alias', message: `${name} is a type alias that does not apply ${inferences.map((inference) => `'${inference}'`).join(', ')} to a schema; derive the command from its schema` };
}

/**
 * Every exported interface and type alias of a command file is derived from a schema: an alias of `infer<typeof schema>` (or another generic in `inferences`) where the type of `schema` is a Standard Schema. Interfaces and other aliases are hand-written, and so are aliases of something that is not a schema.
 *
 * The schema is recognised by type, so it may be imported from another file or renamed; it does not need to come from Zod. A union of the commands is not a command: list its name in `exclude`.
 */
export const commandTypes: CheckFunction<CommandTypesOptions> = async ({ cwd, options }) => {
  const { project, files } = await createProject(cwd, options.tsConfig, options.commands, { check: 'command-types', files: 'commands' });
  const excluded = new Set(options.exclude);
  const inferences = options.inferences ?? DEFAULT_INFERENCES;
  const seen = new Set<ExportedType>();
  const violations: FileViolation[] = [];

  for (const file of files) {
    for (const [name, declaration] of exportedTypes(project.getSourceFileOrThrow(resolve(cwd, file)))) {
      if (excluded.has(name) || seen.has(declaration)) {
        continue;
      }
      seen.add(declaration);
      const found = problem(declaration, name, inferences);
      if (found !== undefined) {
        violations.push({
          code: `command-types/${found.reason}`,
          message: found.message,
          file: relativePosix(cwd, declaration.getSourceFile().getFilePath()),
          location: declarationLocation(declaration),
        });
      }
    }
  }

  return violations.sort((a, b) => a.file.localeCompare(b.file) || (a.location?.line ?? 0) - (b.location?.line ?? 0));
};
