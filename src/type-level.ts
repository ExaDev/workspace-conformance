import { type CompilerOptions, ModuleKind, ModuleResolutionKind, Node, type ObjectLiteralExpression, Project, ScriptTarget, type SourceFile, ts } from 'ts-morph';

/**
 * A compiler error found in an in-memory file.
 */
export interface TypeErrorReport {
  readonly file: string;
  readonly line: number;
  /**
   * The TypeScript diagnostic code, such as 2741 for a property missing from an object literal.
   */
  readonly code: number;
  readonly message: string;
}

/**
 * The outcome of removing one case from a handler map.
 */
export interface CaseRemoval {
  readonly case: string;
  /**
   * What the compiler reports once the case is gone; never empty in a proof that held.
   */
  readonly errors: readonly TypeErrorReport[];
}

/**
 * What {@link proveExhaustive} established: the map type-checks as written, and every case it was asked about breaks the type check when removed.
 */
export interface ExhaustivenessProof {
  readonly removals: readonly CaseRemoval[];
}

/**
 * Raised when a handler map is not exhaustive as claimed, or when the map cannot be found.
 */
export class ExhaustivenessError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ExhaustivenessError';
  }
}

/**
 * Compiler options for the in-memory programs: strict, ESM, the target's default library (for ES2022 that is `lib.es2022.full.d.ts`, which includes the DOM), and no ambient types. Only what a self-contained snippet needs.
 *
 * `skipDefaultLibCheck` leaves TypeScript's own library files unchecked, so diagnostics cover the snippet and not the library's declarations, which otherwise dominate the cost of every program. Errors in the snippet's own files, declaration files included, are still reported.
 */
const SNIPPET_COMPILER_OPTIONS: CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ScriptTarget.ES2022,
  module: ModuleKind.ESNext,
  moduleResolution: ModuleResolutionKind.Bundler,
  types: [],
  skipDefaultLibCheck: true,
};

function inMemoryProject(files: Readonly<Record<string, string>>, options: CompilerOptions): Project {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { ...SNIPPET_COMPILER_OPTIONS, ...options } });
  for (const [name, source] of Object.entries(files)) {
    project.createSourceFile(name, source);
  }

  return project;
}

/**
 * One project per distinct set of compiler options, kept for the life of the module so that the default library is parsed and bound once instead of once per program. {@link typeErrors} adds its files to the project and removes them before it returns, so a call never sees another call's files.
 */
const projectsByOptions = new Map<string, Project>();

function sharedProject(options: CompilerOptions): Project {
  const compilerOptions = { ...SNIPPET_COMPILER_OPTIONS, ...options };
  const key = JSON.stringify(compilerOptions);
  const existing = projectsByOptions.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions });
  projectsByOptions.set(key, project);

  return project;
}

/**
 * Compile the files in memory and return every error the type checker reports. Names are paths in the in-memory file system, so one file can import another with a relative path.
 */
export function typeErrors(files: Readonly<Record<string, string>>, options: CompilerOptions = {}): readonly TypeErrorReport[] {
  const project = sharedProject(options);
  const added: SourceFile[] = [];
  try {
    for (const [name, source] of Object.entries(files)) {
      added.push(project.createSourceFile(name, source));
    }

    return project.getPreEmitDiagnostics().map((diagnostic) => ({
      file: diagnostic.getSourceFile()?.getBaseName() ?? '',
      line: diagnostic.getLineNumber() ?? 0,
      code: diagnostic.getCode(),
      message: ts.flattenDiagnosticMessageText(diagnostic.compilerObject.messageText, '\n'),
    }));
  } finally {
    for (const sourceFile of added) {
      project.removeSourceFile(sourceFile);
    }
  }
}

function handlerMap(source: SourceFile, map: string): ObjectLiteralExpression {
  const declaration = source.getVariableDeclaration(map);
  let initializer = declaration?.getInitializer();
  while (initializer !== undefined && (Node.isSatisfiesExpression(initializer) || Node.isAsExpression(initializer) || Node.isParenthesizedExpression(initializer))) {
    initializer = initializer.getExpression();
  }
  if (initializer === undefined || !Node.isObjectLiteralExpression(initializer)) {
    throw new ExhaustivenessError(`${source.getBaseName()} has no variable '${map}' initialised with an object literal`);
  }

  return initializer;
}

/**
 * The names of the cases of the handler map `map`, an object literal assigned to a variable of that name in `source`.
 */
export function handlerCases(source: string, map: string): readonly string[] {
  const file = inMemoryProject({ 'cases.ts': source }, {}).getSourceFileOrThrow('cases.ts');

  return handlerMap(file, map)
    .getProperties()
    .flatMap((property) => (Node.isPropertyNamed(property) ? [property.getName()] : []));
}

/**
 * `source` with the case `key` deleted from the handler map `map`.
 */
export function removeCase(source: string, map: string, key: string): string {
  const file = inMemoryProject({ 'cases.ts': source }, {}).getSourceFileOrThrow('cases.ts');
  const property = handlerMap(file, map).getProperty(key);
  if (property === undefined) {
    throw new ExhaustivenessError(`the handler map '${map}' has no case '${key}'`);
  }
  property.remove();

  return file.getFullText();
}

/**
 * Prove that the handler map `map` in `files[file]` is checked for exhaustiveness by the compiler: the files type-check as written, and deleting any one case (each in `cases`, else every case of the map) makes them fail. Throws {@link ExhaustivenessError} otherwise.
 *
 * Write the handler map's type so the compiler demands every case, for example a mapped type over the union of command types, and call this from an ordinary test:
 *
 * ```ts
 * proveExhaustive({ files: { 'handlers.ts': source }, file: 'handlers.ts', map: 'handlers' });
 * ```
 */
export function proveExhaustive(input: {
  readonly files: Readonly<Record<string, string>>;
  readonly file: string;
  readonly map: string;
  readonly cases?: readonly string[];
  readonly compilerOptions?: CompilerOptions;
}): ExhaustivenessProof {
  const { files, file, map, compilerOptions = {} } = input;
  const source = files[file];
  if (source === undefined) {
    throw new ExhaustivenessError(`no file '${file}' among ${Object.keys(files).join(', ')}`);
  }
  const baseline = typeErrors(files, compilerOptions);
  if (baseline.length > 0) {
    throw new ExhaustivenessError(`the files do not type-check as written: ${baseline.map((error) => `${error.file}:${String(error.line)} TS${String(error.code)} ${error.message}`).join('; ')}`);
  }

  const removals = (input.cases ?? handlerCases(source, map)).map((name): CaseRemoval => {
    const errors = typeErrors({ ...files, [file]: removeCase(source, map, name) }, compilerOptions);
    if (errors.length === 0) {
      throw new ExhaustivenessError(`removing the case '${name}' from '${map}' still type-checks, so the map is not checked for exhaustiveness`);
    }

    return { case: name, errors };
  });

  return { removals };
}
