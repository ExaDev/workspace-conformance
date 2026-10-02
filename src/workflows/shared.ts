import type { SourceLocation, Violation } from '../check';
import type { Job, Step, Workflow } from './model';

/**
 * A violation about a place in a workflow file.
 */
export function workflowViolation(workflow: Workflow, code: string, message: string, location: SourceLocation): Violation {
  return { code, message, file: workflow.file, location };
}

/**
 * The commands of a `run` script as logical lines: a line ended by a backslash is joined to the next one, comment lines and blank lines are dropped.
 */
export function commandLines(run: string): readonly string[] {
  const lines: string[] = [];
  let continued = '';
  for (const line of run.split('\n')) {
    const joined = `${continued}${line.trim()}`;
    if (joined.endsWith('\\')) {
      continued = `${joined.slice(0, -1).trimEnd()} `;
    } else {
      continued = '';
      if (joined !== '' && !joined.startsWith('#')) {
        lines.push(joined);
      }
    }
  }
  if (continued !== '') {
    lines.push(continued.trim());
  }

  return lines;
}

/**
 * Variable assignments that prefix a command (`HUSKY=0 pnpm exec ...`).
 */
const LEADING_ASSIGNMENTS = /^(?:[A-Za-z_]\w*=\S*\s+)+/u;

/**
 * The simple commands of a logical line, without the variable assignments that prefix them: it is split at `&&`, `||`, `;`, `|` and `&` that are outside quotes and outside `${{ }}` expressions, and that are not part of a redirection (`2>&1`, `&>file`), so text inside a quoted string (an `echo` of a command) is not mistaken for a command.
 */
export function commandSegments(line: string): readonly string[] {
  const segments: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const rest = line.slice(index);
    const character = rest.charAt(0);
    if (quote !== undefined) {
      current += character;
      quote = character === quote ? undefined : quote;
    } else if (rest.startsWith('${{')) {
      const end = rest.indexOf('}}');
      const expression = end === -1 ? rest : rest.slice(0, end + 2);
      current += expression;
      index += expression.length - 1;
    } else if (character === '"' || character === "'") {
      current += character;
      quote = character;
    } else if (character === '&' && (current.endsWith('>') || current.endsWith('<') || rest.startsWith('&>'))) {
      current += character;
    } else if (character === '&' || character === '|' || character === ';') {
      segments.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  segments.push(current);

  return segments.map((segment) => segment.trim().replace(LEADING_ASSIGNMENTS, '')).filter((segment) => segment !== '');
}

/**
 * The simple commands of every line of a `run` script.
 */
export function scriptCommands(run: string | undefined): readonly string[] {
  return commandLines(run ?? '').flatMap(commandSegments);
}

/**
 * Whether a step uses the action `owner/repository`, at any path or ref.
 */
export function stepUses(step: Step, action: string): boolean {
  const target = step.uses?.split('@')[0]?.toLowerCase();

  return target === action.toLowerCase() || target?.startsWith(`${action.toLowerCase()}/`) === true;
}

/**
 * The jobs among `ids` that exist in the workflow, in the workflow's order.
 */
export function jobsNamed(workflow: Workflow, ids: readonly string[]): readonly Job[] {
  return workflow.jobs.filter((job) => ids.includes(job.id));
}

/**
 * Whether an `if` expression calls `always()`.
 */
export function callsAlways(condition: string | undefined): boolean {
  return condition !== undefined && /\balways\(\)/u.test(condition);
}

/**
 * The default ids of junction jobs, shared by the checks that look for one.
 */
export const DEFAULT_JUNCTION_JOBS: readonly string[] = ['required-checks'];
