import { isMap, isNode, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import type { Document } from 'yaml';

import type { SourceLocation } from '../check';
import { isRecord } from '../config-files';
import { ConformanceError } from '../errors';

/**
 * How much of a scope the `GITHUB_TOKEN` is granted.
 */
export type PermissionAccess = 'read' | 'write' | 'none';

/**
 * The `permissions` of a workflow or job as written. A scope missing from a `scopes` mapping is `none`, because GitHub sets every scope that is not specified to `none` as soon as any is specified. When nothing is declared the token gets the repository's default permissions, a setting the workflow file cannot show.
 */
export type Permissions =
  | { readonly kind: 'default' }
  | { readonly kind: 'all'; readonly access: 'read' | 'write' }
  | { readonly kind: 'scopes'; readonly scopes: ReadonlyMap<string, PermissionAccess> };

/**
 * The access `permissions` grants to `scope`, or `undefined` when the permissions are not declared and the repository default applies.
 */
export function accessOf(permissions: Permissions, scope: string): PermissionAccess | undefined {
  if (permissions.kind === 'default') {
    return undefined;
  }

  return permissions.kind === 'all' ? permissions.access : (permissions.scopes.get(scope) ?? 'none');
}

/**
 * What a job's `runs-on` names: literal labels, labels that are expressions, and a runner group.
 */
export interface RunsOn {
  readonly labels: readonly string[];
  readonly expressions: readonly string[];
  readonly group: string | undefined;
}

/**
 * One step of a job. Every value is the text written in the file; expressions are not evaluated.
 */
export interface Step {
  readonly index: number;
  readonly id: string | undefined;
  readonly name: string | undefined;
  readonly uses: string | undefined;
  readonly run: string | undefined;
  readonly with: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<string, string>>;
  readonly condition: string | undefined;
  readonly location: SourceLocation;
}

/**
 * One job. A job that calls a reusable workflow has `uses` and no steps.
 */
export interface Job {
  readonly id: string;
  readonly name: string | undefined;
  /**
   * The jobs named by `needs`, directly.
   */
  readonly needs: readonly string[];
  readonly condition: string | undefined;
  readonly permissions: Permissions;
  /**
   * The name of the deployment environment the job runs in, written as `environment: <name>` or `environment: { name: <name> }`; `undefined` when it names none.
   */
  readonly environment: string | undefined;
  readonly env: Readonly<Record<string, string>>;
  readonly runsOn: RunsOn;
  readonly timeoutMinutes: string | undefined;
  readonly uses: string | undefined;
  readonly with: Readonly<Record<string, string>>;
  readonly outputs: Readonly<Record<string, string>>;
  readonly steps: readonly Step[];
  readonly location: SourceLocation;
}

/**
 * A parsed workflow file.
 */
export interface Workflow {
  /**
   * The path relative to the directory the checks run in, with `/` separators.
   */
  readonly file: string;
  readonly name: string | undefined;
  /**
   * The events in `on`, each with its configuration (`undefined` for an event written without any).
   */
  readonly triggers: ReadonlyMap<string, unknown>;
  /**
   * Where each event of `triggers` is written.
   */
  readonly triggerLocations: ReadonlyMap<string, SourceLocation>;
  readonly permissions: Permissions;
  /**
   * Where the workflow's `permissions` is written; `undefined` when it declares none.
   */
  readonly permissionsLocation: SourceLocation | undefined;
  readonly env: Readonly<Record<string, string>>;
  readonly jobs: readonly Job[];
  /**
   * The `value` of each output a reusable workflow declares under `on.workflow_call.outputs`.
   */
  readonly callOutputs: Readonly<Record<string, string>>;
}

/**
 * The text of a scalar value; `undefined` for anything that is not a string, number or boolean.
 */
function scalarText(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : undefined;
}

/**
 * Where a node of the document is: the key for a mapping entry, the item for a sequence entry, else the node itself. Positions are counted from 1.
 */
function locationAt(document: Document.Parsed, lineCounter: LineCounter, path: readonly (string | number)[]): SourceLocation {
  const parent = path.length === 0 ? document.contents : document.getIn(path.slice(0, -1), true);
  const last = path.at(-1);
  let range: readonly [number, number, number] | null | undefined;
  if (isMap(parent) && typeof last === 'string') {
    const pair = parent.items.find((item) => isScalar(item.key) && item.key.value === last);
    range = isScalar(pair?.key) ? pair.key.range : undefined;
  } else {
    const target: unknown = isSeq(parent) && typeof last === 'number' ? parent.items[last] : parent;
    range = isNode(target) ? target.range : undefined;
  }
  const position = lineCounter.linePos(range?.[0] ?? 0);

  return { line: position.line, column: position.col };
}

/**
 * A parsed YAML file: its value, and where a path into it is written.
 */
export interface ParsedYaml {
  readonly value: unknown;
  /**
   * Where the key (or sequence item) at `path` is, counted from 1.
   */
  readonly locate: (path: readonly (string | number)[]) => SourceLocation;
}

/**
 * Parse YAML text. It throws `ConformanceError` naming `file` when the text is not valid YAML.
 */
export function parseYaml(file: string, source: string): ParsedYaml {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { lineCounter, prettyErrors: false });
  const [error] = document.errors;
  if (error !== undefined) {
    throw new ConformanceError(`${file}: not valid YAML: ${error.message}`, { cause: error });
  }

  return { value: document.toJS(), locate: (path) => locationAt(document, lineCounter, path) };
}

/**
 * A reader for one file, so the helpers can name the field they read when the file is not a workflow.
 */
class Reader {
  public constructor(
    private readonly file: string,
    private readonly parsed: ParsedYaml,
  ) {}

  public fail(what: string): never {
    throw new ConformanceError(`${this.file}: ${what}`);
  }

  public location(path: readonly (string | number)[]): SourceLocation {
    return this.parsed.locate(path);
  }

  public record(value: unknown, what: string): Readonly<Record<string, unknown>> {
    if (value === undefined || value === null) {
      return {};
    }
    if (!isRecord(value)) {
      return this.fail(`${what} must be a mapping`);
    }

    return value;
  }

  public text(value: unknown, what: string): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    const text = scalarText(value);

    return text ?? this.fail(`${what} must be a string, number or boolean`);
  }

  public texts(value: unknown, what: string): Readonly<Record<string, string>> {
    return Object.fromEntries(Object.entries(this.record(value, what)).map(([key, entry]) => [key, this.text(entry, `${what}.${key}`) ?? '']));
  }

  public list(value: unknown, what: string): readonly string[] {
    if (value === undefined || value === null) {
      return [];
    }
    const items = Array.isArray(value) ? value : [value];

    return items.map((item: unknown) => this.text(item, what) ?? this.fail(`${what} must be a string or a list of strings`));
  }
}

const PERMISSION_ACCESS: ReadonlySet<string> = new Set<PermissionAccess>(['read', 'write', 'none']);

function isPermissionAccess(value: string): value is PermissionAccess {
  return PERMISSION_ACCESS.has(value);
}

function permissionsOf(reader: Reader, value: unknown, what: string): Permissions {
  if (value === undefined || value === null) {
    return { kind: 'default' };
  }
  if (value === 'read-all') {
    return { kind: 'all', access: 'read' };
  }
  if (value === 'write-all') {
    return { kind: 'all', access: 'write' };
  }
  const scopes = new Map<string, PermissionAccess>();
  for (const [scope, access] of Object.entries(reader.record(value, what))) {
    const text = reader.text(access, `${what}.${scope}`);
    if (text === undefined || !isPermissionAccess(text)) {
      return reader.fail(`${what}.${scope} must be read, write or none`);
    }
    scopes.set(scope, text);
  }

  return { kind: 'scopes', scopes };
}

function runsOnOf(reader: Reader, value: unknown, what: string): RunsOn {
  const mapping = isRecord(value) ? value : undefined;
  const entries = reader.list(mapping === undefined ? value : mapping['labels'], what);
  const group = mapping === undefined ? undefined : reader.text(mapping['group'], `${what}.group`);

  return { labels: entries.filter((entry) => !entry.includes('${{')), expressions: entries.filter((entry) => entry.includes('${{')), group };
}

function environmentOf(reader: Reader, value: unknown, what: string): string | undefined {
  return isRecord(value) ? reader.text(value['name'], `${what}.name`) : reader.text(value, what);
}

function stepOf(reader: Reader, value: unknown, jobPath: readonly (string | number)[], index: number): Step {
  const path = [...jobPath, 'steps', index];
  const what = path.join('.');
  const step = reader.record(value, what);

  return {
    index,
    id: reader.text(step['id'], `${what}.id`),
    name: reader.text(step['name'], `${what}.name`),
    uses: reader.text(step['uses'], `${what}.uses`),
    run: reader.text(step['run'], `${what}.run`),
    with: reader.texts(step['with'], `${what}.with`),
    env: reader.texts(step['env'], `${what}.env`),
    condition: reader.text(step['if'], `${what}.if`),
    location: reader.location(path),
  };
}

function jobOf(reader: Reader, id: string, value: unknown): Job {
  const path = ['jobs', id];
  const what = path.join('.');
  const job = reader.record(value, what);
  const steps = job['steps'];
  if (steps !== undefined && !Array.isArray(steps)) {
    return reader.fail(`${what}.steps must be a list`);
  }

  return {
    id,
    name: reader.text(job['name'], `${what}.name`),
    needs: reader.list(job['needs'], `${what}.needs`),
    condition: reader.text(job['if'], `${what}.if`),
    permissions: permissionsOf(reader, job['permissions'], `${what}.permissions`),
    environment: environmentOf(reader, job['environment'], `${what}.environment`),
    env: reader.texts(job['env'], `${what}.env`),
    runsOn: runsOnOf(reader, job['runs-on'], `${what}.runs-on`),
    timeoutMinutes: reader.text(job['timeout-minutes'], `${what}.timeout-minutes`),
    uses: reader.text(job['uses'], `${what}.uses`),
    with: reader.texts(job['with'], `${what}.with`),
    outputs: reader.texts(job['outputs'], `${what}.outputs`),
    steps: (steps ?? []).map((step: unknown, index: number) => stepOf(reader, step, path, index)),
    location: reader.location(path),
  };
}

function triggerLocationsOf(reader: Reader, triggers: ReadonlyMap<string, unknown>, value: unknown): ReadonlyMap<string, SourceLocation> {
  const events = [...triggers.keys()];

  return new Map(events.map((event, index) => [event, reader.location(Array.isArray(value) ? ['on', index] : isRecord(value) ? ['on', event] : ['on'])]));
}

function triggersOf(reader: Reader, value: unknown): ReadonlyMap<string, unknown> {
  if (typeof value === 'string') {
    return new Map([[value, undefined]]);
  }
  if (Array.isArray(value)) {
    return new Map(reader.list(value, 'on').map((event): [string, undefined] => [event, undefined]));
  }

  return new Map(Object.entries(reader.record(value, 'on')));
}

/**
 * Parse the text of a workflow file into the model the checks read. It throws `ConformanceError` when the file is not YAML or is not shaped like a workflow, since a check cannot judge what it cannot read.
 */
export function parseWorkflow(file: string, source: string): Workflow {
  const parsed = parseYaml(file, source);
  const reader = new Reader(file, parsed);
  const root = reader.record(parsed.value, 'the workflow');
  const triggers = triggersOf(reader, root['on']);
  const call = triggers.get('workflow_call');
  const outputs = reader.record(reader.record(call, 'on.workflow_call')['outputs'], 'on.workflow_call.outputs');

  return {
    file,
    name: reader.text(root['name'], 'name'),
    triggers,
    triggerLocations: triggerLocationsOf(reader, triggers, root['on']),
    permissions: permissionsOf(reader, root['permissions'], 'permissions'),
    permissionsLocation: root['permissions'] === undefined ? undefined : reader.location(['permissions']),
    env: reader.texts(root['env'], 'env'),
    jobs: Object.entries(reader.record(root['jobs'], 'jobs')).map(([id, job]) => jobOf(reader, id, job)),
    callOutputs: Object.fromEntries(Object.entries(outputs).map(([name, output]) => [name, reader.text(reader.record(output, `on.workflow_call.outputs.${name}`)['value'], `on.workflow_call.outputs.${name}.value`) ?? ''])),
  };
}

/**
 * The permissions that apply to a job: its own when it declares any, else the workflow's. A job's declaration replaces the workflow's whole, it is not merged with it.
 */
export function effectivePermissions(workflow: Workflow, job: Job): Permissions {
  return job.permissions.kind === 'default' ? workflow.permissions : job.permissions;
}

/**
 * The environment a step runs with: the workflow's, the job's and the step's, the later winning.
 */
export function effectiveEnv(workflow: Workflow, job: Job, step: Step | undefined): Readonly<Record<string, string>> {
  return { ...workflow.env, ...job.env, ...step?.env };
}

/**
 * Every job `jobId` waits for, directly or through other jobs, not including itself. A `needs` that names no job of the workflow is followed no further.
 */
export function transitiveNeeds(workflow: Workflow, jobId: string): ReadonlySet<string> {
  const byId = new Map(workflow.jobs.map((job) => [job.id, job]));
  const reached = new Set<string>();
  const pending = [...(byId.get(jobId)?.needs ?? [])];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (!reached.has(next)) {
      reached.add(next);
      pending.push(...(byId.get(next)?.needs ?? []));
    }
  }
  reached.delete(jobId);

  return reached;
}

/**
 * A `uses` value: a local action or workflow, a Docker image, or a repository reference.
 */
export type UsesReference =
  | { readonly kind: 'local'; readonly path: string }
  | { readonly kind: 'docker'; readonly image: string; readonly digest: string | undefined }
  | { readonly kind: 'remote'; readonly owner: string; readonly repository: string; readonly path: string; readonly ref: string | undefined };

/**
 * Split a `uses` value into its parts.
 */
export function parseUses(uses: string): UsesReference {
  if (uses.startsWith('./')) {
    return { kind: 'local', path: uses };
  }
  if (uses.startsWith('docker://')) {
    const reference = uses.slice('docker://'.length);
    const at = reference.indexOf('@');

    return at === -1 ? { kind: 'docker', image: reference, digest: undefined } : { kind: 'docker', image: reference.slice(0, at), digest: reference.slice(at + 1) };
  }
  const at = uses.lastIndexOf('@');
  const target = at === -1 ? uses : uses.slice(0, at);
  const [owner = '', repository = '', ...path] = target.split('/');

  return { kind: 'remote', owner, repository, path: path.join('/'), ref: at === -1 ? undefined : uses.slice(at + 1) };
}

/**
 * Whether `value` contains an expression, which is only known when the workflow runs.
 */
export function hasExpression(value: string): boolean {
  return value.includes('${{');
}
