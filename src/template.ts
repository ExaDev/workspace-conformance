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
