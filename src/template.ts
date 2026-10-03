import { ConformanceError } from './errors';

const PLACEHOLDER = /\{([a-z]+)\}/gu;

/**
 * `template` with each `{name}` replaced by the value of that name. Throws `ConformanceError` for a placeholder with no value, so a typo in an option cannot produce a path that silently matches nothing.
 */
export function expandTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(PLACEHOLDER, (placeholder: string, name: string) => {
    const value = values[name];
    if (value === undefined) {
      throw new ConformanceError(`the placeholder ${placeholder} in '${template}' is not available here; use ${Object.keys(values).map((key) => `{${key}}`).join(', ')}`);
    }

    return value;
  });
}

/**
 * A name template split at its one `{name}`: the text before it and the text after it.
 */
export interface NameTemplate {
  readonly before: string;
  readonly after: string;
}

const NAME_PLACEHOLDER = '{name}';

/**
 * What a name template must be, as a configuration error says it. It does not quote the template, as no configuration error quotes a value.
 */
export const NAME_TEMPLATE_REQUIREMENT = 'needs {name} exactly once, other text beside it and no other placeholder';
const ANY_PLACEHOLDER = /\{[a-z]+\}/u;

/**
 * `template` split at `{name}`, or `undefined` unless it holds `{name}` exactly once, other text beside it and no other placeholder. Without other text every name would match, and with `{name}` twice a name could be split more than one way.
 */
export function parseNameTemplate(template: string): NameTemplate | undefined {
  const [before, after, ...rest] = template.split(NAME_PLACEHOLDER);
  if (before === undefined || after === undefined || rest.length > 0 || before + after === '' || ANY_PLACEHOLDER.test(before + after)) {
    return undefined;
  }

  return { before, after };
}
