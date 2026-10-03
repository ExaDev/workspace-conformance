/**
 * An expression written inside the `${{ }}` that marks it as one.
 */
const EXPRESSION_WRAPPER = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/u;

/**
 * The operands of `operator` at the top level of an expression: not inside parentheses or quotes.
 */
export function operands(expression: string, operator: '||' | '&&'): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let start = 0;
  for (let index = 0; index < expression.length; index += 1) {
    const character = expression.charAt(index);
    if (quote !== undefined) {
      quote = character === quote ? undefined : quote;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
    } else if (depth === 0 && expression.startsWith(operator, index)) {
      parts.push(expression.slice(start, index));
      index += operator.length - 1;
      start = index + 1;
    }
  }
  parts.push(expression.slice(start));

  return parts.map((part) => part.trim());
}

/**
 * Whether the first parenthesis of an expression is closed by its last character, so the parentheses enclose all of it, unlike `(a) && (b)`.
 */
function enclosedByOneGroup(expression: string): boolean {
  let depth = 0;
  for (let index = 0; index < expression.length; index += 1) {
    depth += expression.charAt(index) === '(' ? 1 : expression.charAt(index) === ')' ? -1 : 0;
    if (depth === 0) {
      return index === expression.length - 1;
    }
  }

  return false;
}

/**
 * The expression without the `${{ }}` that wraps it, or the parentheses that enclose all of it.
 */
export function unwrapped(expression: string): string {
  const trimmed = expression.trim();
  const inner = EXPRESSION_WRAPPER.exec(trimmed)?.[1] ?? trimmed;

  return enclosedByOneGroup(inner) ? unwrapped(inner.slice(1, -1)) : inner;
}

/**
 * A string literal of an expression, whose body writes a quote as `''`.
 */
const STRING_LITERAL = /^'((?:[^']|'')*)'$/u;

/**
 * A call of `format`, whose name, like every function name in an expression, is case-insensitive.
 */
const FORMAT_CALL = /^format\s*\(([\s\S]*)\)$/iu;

/**
 * A reference to an input of the workflow.
 */
const INPUT_REFERENCE = /^inputs\.([\w-]+)$/u;

/**
 * A placeholder of a `format` pattern, or the doubled brace that writes a literal one.
 */
const FORMAT_PLACEHOLDER = /\{\{|\}\}|\{(\d+)\}/gu;

/**
 * The arguments of a call, split at the commas outside quotes and parentheses.
 */
function callArguments(text: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (character === "'") {
      quoted = !quoted;
    } else if (!quoted && character === '(') {
      depth += 1;
    } else if (!quoted && character === ')') {
      depth -= 1;
    } else if (!quoted && depth === 0 && character === ',') {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));

  return parts.map((part) => part.trim());
}

/**
 * `format(pattern, ...values)` as GitHub evaluates it: `{N}` is the value at index N and `{{` and `}}` are literal braces. `undefined` when a placeholder names a value that is not given, which GitHub rejects.
 */
function formatted(pattern: string, values: readonly string[]): string | undefined {
  let text = '';
  let end = 0;
  for (const match of pattern.matchAll(FORMAT_PLACEHOLDER)) {
    const index = match[1];
    const value = index === undefined ? match[0].charAt(0) : values[Number(index)];
    if (value === undefined) {
      return undefined;
    }
    text += `${pattern.slice(end, match.index)}${value}`;
    end = match.index + match[0].length;
  }

  return `${text}${pattern.slice(end)}`;
}

/**
 * The value an operand of an expression has on every run, or `undefined` when that depends on the run: a string literal, an input whose value `inputs` gives, or `format()` of such values. An input `inputs` holds as `undefined`, or does not hold, is not known.
 */
export function constantString(operand: string, inputs: Readonly<Record<string, string | undefined>>): string | undefined {
  const text = unwrapped(operand);
  const literal = STRING_LITERAL.exec(text)?.[1];
  if (literal !== undefined) {
    return literal.replaceAll("''", "'");
  }
  const input = INPUT_REFERENCE.exec(text)?.[1];
  if (input !== undefined) {
    return Object.hasOwn(inputs, input) ? inputs[input] : undefined;
  }
  const call = FORMAT_CALL.exec(text)?.[1];
  if (call === undefined) {
    return undefined;
  }
  const [pattern, ...rest] = callArguments(call).map((argument) => constantString(argument, inputs));
  const values = rest.filter((value): value is string => value !== undefined);

  return pattern === undefined || values.length !== rest.length ? undefined : formatted(pattern, values);
}
