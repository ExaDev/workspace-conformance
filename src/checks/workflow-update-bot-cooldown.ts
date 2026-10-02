import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parse, type ParseError, printParseErrorCode } from 'jsonc-parser';

import type { CheckFunction, Violation } from '../check';
import { isRecord } from '../config-files';
import { ConformanceError } from '../errors';
import type { WorkflowUpdateBotCooldownOptions } from '../options';
import { parseYaml } from '../workflows/model';

const DEPENDABOT_FILES: readonly string[] = ['.github/dependabot.yml', '.github/dependabot.yaml'];
const RENOVATE_FILES: readonly string[] = ['renovate.json', '.renovaterc.json', '.renovaterc', '.github/renovate.json'];

/**
 * The cooldown settings that delay a release by a number of days.
 */
const COOLDOWN_DAYS: readonly string[] = ['default-days', 'semver-major-days', 'semver-minor-days', 'semver-patch-days'];

const RENOVATE_SETTING = 'minimumReleaseAge';

function firstExisting(cwd: string, explicit: string | undefined, defaults: readonly string[]): string | undefined {
  if (explicit !== undefined) {
    if (!existsSync(resolve(cwd, explicit))) {
      throw new ConformanceError(`${explicit} does not exist`);
    }

    return explicit;
  }

  return defaults.find((file) => existsSync(resolve(cwd, file)));
}

function hasCooldown(update: unknown): boolean {
  if (!isRecord(update) || !isRecord(update['cooldown'])) {
    return false;
  }
  const cooldown = update['cooldown'];

  return COOLDOWN_DAYS.some((setting) => typeof cooldown[setting] === 'number' && cooldown[setting] > 0);
}

async function dependabotViolations(cwd: string, file: string): Promise<readonly Violation[]> {
  const parsed = parseYaml(file, await readFile(resolve(cwd, file), 'utf8'));
  const updates = isRecord(parsed.value) && Array.isArray(parsed.value['updates']) ? parsed.value['updates'] : [];

  return updates.flatMap((update: unknown, index: number) =>
    hasCooldown(update)
      ? []
      : [
          {
            code: 'workflow-update-bot-cooldown/dependabot-no-cooldown',
            message: `the update entry for ${isRecord(update) && typeof update['package-ecosystem'] === 'string' ? update['package-ecosystem'] : `entry ${String(index)}`} has no cooldown with a number of days above zero, so Dependabot proposes a release the day it is published`,
            file,
            location: parsed.locate(['updates', index]),
          },
        ],
  );
}

/**
 * Whether a `minimumReleaseAge` value waits for a positive time: a duration string such as `3 days`, whose number is above zero. `0 days` and `null` (which clears the setting) wait for nothing.
 */
function delaysRelease(age: unknown): boolean {
  const amount = typeof age === 'string' ? /^\s*(\d+(?:\.\d+)?)\s*[a-z]/iu.exec(age)?.[1] : undefined;

  return amount !== undefined && Number(amount) > 0;
}

function setsMinimumReleaseAge(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const rules = Array.isArray(value['packageRules']) ? value['packageRules'] : [];
  const presets = Array.isArray(value['extends']) ? value['extends'] : [];

  return (
    delaysRelease(value[RENOVATE_SETTING]) ||
    rules.some((rule: unknown) => isRecord(rule) && delaysRelease(rule[RENOVATE_SETTING])) ||
    presets.some((preset: unknown) => typeof preset === 'string' && preset.includes(RENOVATE_SETTING))
  );
}

async function renovateViolations(cwd: string, file: string): Promise<readonly Violation[]> {
  const errors: ParseError[] = [];
  const value: unknown = parse(await readFile(resolve(cwd, file), 'utf8'), errors, { allowTrailingComma: true });
  const [error] = errors;
  if (error !== undefined) {
    throw new ConformanceError(`${file}: not valid JSON: ${printParseErrorCode(error.error)} at offset ${String(error.offset)}`);
  }

  return setsMinimumReleaseAge(value)
    ? []
    : [{ code: 'workflow-update-bot-cooldown/renovate-no-minimum-release-age', message: `${file} sets no ${RENOVATE_SETTING} above zero, so Renovate proposes a release the day it is published`, file }];
}

/**
 * The update bots wait before proposing a release, so a compromised release is withdrawn before it is installed. Dependabot: every `updates` entry needs a `cooldown` with `default-days` or one of the `semver-*-days` above zero. Renovate: `minimumReleaseAge` must be set to a duration above zero at the top level or in a `packageRules` entry.
 *
 * Limits: the bots' own rules differ, since Dependabot's cooldown does not apply to security updates, and a Renovate preset is not resolved (an `extends` entry counts only when its name contains `minimumReleaseAge`), so a setting that comes from a preset under another name is reported. Renovate configs in JSON5 syntax beyond comments and trailing commas, and a `renovate` key in `package.json`, are not read. A repository with neither bot has nothing to report.
 */
export const workflowUpdateBotCooldown: CheckFunction<WorkflowUpdateBotCooldownOptions> = async ({ cwd, options }) => {
  const dependabot = firstExisting(cwd, options.dependabot, DEPENDABOT_FILES);
  const renovate = firstExisting(cwd, options.renovate, RENOVATE_FILES);

  return [...(dependabot === undefined ? [] : await dependabotViolations(cwd, dependabot)), ...(renovate === undefined ? [] : await renovateViolations(cwd, renovate))];
};
