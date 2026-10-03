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
