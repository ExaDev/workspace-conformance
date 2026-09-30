import type { CheckFunction, Violation } from '../check';
import { evaluateConfigFile, isRecord } from '../config-files';
import { ConformanceError } from '../errors';
import type { CommitTypesOptions } from '../options';

const DEFAULT_COMMITLINT_CONFIG = 'commitlint.config.ts';
const DEFAULT_RELEASE_CONFIG = 'release.config.ts';
const COMMIT_ANALYZER = '@semantic-release/commit-analyzer';
const RELEASE_NOTES_GENERATOR = '@semantic-release/release-notes-generator';

function stringsOf(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;
}

/**
 * The types listed in commitlint's `type-enum` rule, or `undefined` when the config does not set the rule and so takes the types of its preset.
 */
function commitTypesOf(config: Readonly<Record<string, unknown>>, file: string): readonly string[] | undefined {
  const rules = config['rules'];
  if (!isRecord(rules) || !('type-enum' in rules)) {
    return undefined;
  }
  const rule = rules['type-enum'];
  const types = Array.isArray(rule) ? stringsOf(rule[2]) : undefined;
  if (types === undefined) {
    throw new ConformanceError(`${file}: the 'type-enum' rule must be written as [level, 'always', [types]] for its types to be read`);
  }

  return types;
}

/**
 * The options of the semantic-release plugin named `plugin`, or `undefined` when it is not configured or has no options.
 */
function pluginOptions(release: Readonly<Record<string, unknown>>, plugin: string): Readonly<Record<string, unknown>> | undefined {
  const plugins = release['plugins'];
  if (!Array.isArray(plugins)) {
    return undefined;
  }
  for (const entry of plugins) {
    if (Array.isArray(entry) && entry[0] === plugin && isRecord(entry[1])) {
      return entry[1];
    }
  }

  return undefined;
}

function typesOfEntries(entries: unknown, file: string, what: string): readonly string[] | undefined {
  if (entries === undefined) {
    return undefined;
  }
  if (!Array.isArray(entries)) {
    throw new ConformanceError(`${file}: ${what} must be an array for its types to be read`);
  }

  return entries.flatMap((entry) => (isRecord(entry) && typeof entry['type'] === 'string' ? [entry['type']] : []));
}

async function readObject(cwd: string, file: string): Promise<Readonly<Record<string, unknown>> | undefined> {
  const config = await evaluateConfigFile(cwd, file);
  if (config === undefined) {
    return undefined;
  }
  if (!isRecord(config)) {
    throw new ConformanceError(`${file}: the default export must be an object`);
  }

  return config;
}

/**
 * The commit types the conventional presets know, which is the `type-enum` of `@commitlint/config-conventional` and the type list the conventional changelog presets label. Their release behaviour is the preset's own, so a preset type needs no release rule or changelog section to be accounted for; a type outside this list does.
 */
export const PRESET_COMMIT_TYPES: readonly string[] = ['build', 'chore', 'ci', 'docs', 'feat', 'fix', 'perf', 'refactor', 'revert', 'style', 'test'];

function isCustom(type: string): boolean {
  return !PRESET_COMMIT_TYPES.includes(type);
}

/**
 * The commit types commitlint accepts are accounted for in the release config. A type no preset knows must have a release rule and, when the config lists changelog sections, a section, or it can be committed and never released or shown; a release rule or changelog section for a type commitlint rejects can never apply. A preset type may be left out of either list: leaving out a type that does not release is how a release rule list is normally written.
 *
 * It compares only what is written. The check has nothing to say when the commit types are the preset's and every listed type is one of them. A commitlint config that does not set `type-enum` while the release config lists a type no preset knows is a violation, since the commit types cannot then be read. Both configs are evaluated, so a list may be derived from one shared constant.
 */
export const commitTypes: CheckFunction<CommitTypesOptions> = async ({ cwd, options }) => {
  const commitlintFile = options.commitlint ?? DEFAULT_COMMITLINT_CONFIG;
  const releaseFile = options.release ?? DEFAULT_RELEASE_CONFIG;
  const commitlint = await readObject(cwd, commitlintFile);
  const release = await readObject(cwd, releaseFile);
  const violations: Violation[] = [];
  if (commitlint === undefined) {
    violations.push({ code: 'commit-types/missing-config', message: `${commitlintFile} does not exist`, file: commitlintFile });
  }
  if (release === undefined) {
    violations.push({ code: 'commit-types/missing-config', message: `${releaseFile} does not exist`, file: releaseFile });
  }
  if (commitlint === undefined || release === undefined) {
    return violations;
  }

  const releaseRules = typesOfEntries(pluginOptions(release, COMMIT_ANALYZER)?.['releaseRules'], releaseFile, 'releaseRules');
  const presetConfig = pluginOptions(release, RELEASE_NOTES_GENERATOR)?.['presetConfig'];
  const changelog = typesOfEntries(isRecord(presetConfig) ? presetConfig['types'] : undefined, releaseFile, 'presetConfig.types');
  const accepted = commitTypesOf(commitlint, commitlintFile);
  if (accepted === undefined) {
    const unknown = [releaseRules, changelog].flatMap((list) => list ?? []).filter(isCustom);
    if (unknown.length > 0) {
      violations.push({
        code: 'commit-types/no-type-enum',
        message: `${releaseFile} lists ${unknown.map((type) => `'${type}'`).join(', ')}, which no preset knows, but ${commitlintFile} sets no 'type-enum' rule, so the commit types cannot be read`,
        file: commitlintFile,
      });
    }

    return violations;
  }

  const lists = [
    { listed: releaseRules, noun: 'release rule', absent: 'no-release-rule', extra: 'release-rule-not-a-commit-type' },
    { listed: changelog, noun: 'changelog section', absent: 'no-changelog-section', extra: 'changelog-section-not-a-commit-type' },
  ];
  for (const { listed, noun, absent, extra } of lists) {
    for (const type of accepted.filter(isCustom)) {
      if (listed?.includes(type) !== true) {
        violations.push({
          code: `commit-types/${absent}`,
          message: `'${type}' is a commit type in ${commitlintFile} that no preset knows, and ${releaseFile} has no ${noun} for it`,
          file: releaseFile,
        });
      }
    }
    if (listed !== undefined) {
      for (const type of listed.filter((candidate) => !accepted.includes(candidate))) {
        violations.push({ code: `commit-types/${extra}`, message: `'${type}' has a ${noun} in ${releaseFile} but is not a commit type in ${commitlintFile}`, file: commitlintFile });
      }
    }
  }

  return violations;
};
