import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { CheckFunction, Violation } from '../check';
import { isRecord } from '../config-files';
import type { WorkflowCredentialsOptions } from '../options';
import { loadWorkflows } from '../workflows/load';
import { accessOf, effectiveEnv, effectivePermissions, type Job, type Step, type Workflow } from '../workflows/model';
import { REGISTRY_TOKEN_VARIABLES, scriptCommands, stepUses, workflowViolation } from '../workflows/shared';

/**
 * The actions that sign an attestation, which needs an OIDC identity and the right to store the attestation.
 */
const ATTESTATION_ACTIONS: readonly string[] = ['actions/attest', 'actions/attest-build-provenance', 'actions/attest-sbom'];

/**
 * The scopes an attestation step needs written.
 */
const ATTESTATION_SCOPES: readonly string[] = ['id-token', 'attestations'];

/**
 * The options a package manager takes before its subcommand: flags such as `-r`, and the options that select a workspace package or directory, with their value after a space or an equals sign.
 */
const PACKAGE_MANAGER_OPTIONS = String.raw`(?:\s+(?:(?:--filter|-F|--workspace|-w|--dir|-C)(?:\s+|=)\S+|--?[\w-]+))*`;

/**
 * Commands that publish a package to a registry.
 */
const PUBLISH_COMMAND = new RegExp(
  String.raw`^(?:(?:npm|pnpm|yarn)${PACKAGE_MANAGER_OPTIONS}(?:\s+npm)?\s+publish|(?:(?:pnpm|yarn)(?:\s+exec)?\s+|npx\s+)?(?:semantic-release|changeset\s+publish|lerna\s+publish))(?:\s|$)`,
  'u',
);

/**
 * A token variable that something in a publish step reads, and what reads it.
 */
interface TokenRead {
  readonly variable: string;
  readonly reader: string;
}

/**
 * npm reads no token variable by name: a variable reaches it only through `${NAME}` (or `${NAME?}`) in the value of an `.npmrc` setting. These are the settings that carry credentials.
 */
const NPMRC_AUTH_SETTING = /^\s*[^#;=\s]*(?:_authToken|_auth|_password)\s*=(.*)$/u;
const NPMRC_VARIABLE = /\$\{([^${}?]+)\??\}/gu;

/**
 * `semantic-release` as the command a publish line runs, whose npm plugin reads `NPM_TOKEN` itself.
 */
const SEMANTIC_RELEASE = /(?:^|\s)semantic-release(?:\s|$)/u;

const PROVENANCE_FLAG = /--provenance(?:=true)?(?:\s|$)/u;

/**
 * Whether the `package.json` in the working directory asks for provenance with `publishConfig.provenance: true`, which applies to every publish of that package.
 */
async function requestsProvenance(cwd: string): Promise<boolean> {
  const file = resolve(cwd, 'package.json');
  if (!existsSync(file)) {
    return false;
  }
  const manifest: unknown = JSON.parse(await readFile(file, 'utf8'));
  const config = isRecord(manifest) ? manifest['publishConfig'] : undefined;

  return isRecord(config) && config['provenance'] === true;
}

/**
 * The variables the auth settings of the `.npmrc` in the working directory read, which npm and pnpm load for a publish run there.
 */
async function npmrcTokenVariables(cwd: string): Promise<readonly string[]> {
  const file = resolve(cwd, '.npmrc');
  if (!existsSync(file)) {
    return [];
  }
  const values = (await readFile(file, 'utf8')).split('\n').flatMap((line) => NPMRC_AUTH_SETTING.exec(line)?.[1] ?? []);

  return [...new Set(values.flatMap((value) => [...value.matchAll(NPMRC_VARIABLE)].flatMap((match) => match[1] ?? [])))];
}

/**
 * The token variables that what a publish step runs reads, with what reads each: the `.npmrc` that an earlier `actions/setup-node` step with `registry-url` writes reads `NODE_AUTH_TOKEN`, semantic-release's npm plugin reads `NPM_TOKEN`, and the `.npmrc` of the working directory reads the variables of its auth settings.
 */
function tokenReads(job: Job, step: Step, publishes: readonly string[], npmrcVariables: readonly string[]): readonly TokenRead[] {
  const reads: TokenRead[] = [];
  if (job.steps.some((earlier) => earlier.index < step.index && stepUses(earlier, 'actions/setup-node') && (earlier.with['registry-url'] ?? '') !== '')) {
    reads.push({ variable: 'NODE_AUTH_TOKEN', reader: 'the .npmrc actions/setup-node writes for registry-url' });
  }
  if (publishes.some((line) => SEMANTIC_RELEASE.test(line))) {
    reads.push({ variable: 'NPM_TOKEN', reader: "semantic-release's npm plugin" });
  }
  reads.push(...npmrcVariables.map((variable) => ({ variable, reader: 'the .npmrc of the working directory' })));

  return reads.filter((read, index) => reads.findIndex((other) => other.variable === read.variable) === index);
}

function attestationViolations(workflow: Workflow, job: Job): readonly Violation[] {
  const permissions = effectivePermissions(workflow, job);

  return job.steps
    .filter((step) => ATTESTATION_ACTIONS.some((action) => stepUses(step, action)))
    .flatMap((step) => {
      const missing = ATTESTATION_SCOPES.filter((scope) => accessOf(permissions, scope) !== 'write')
        .map((scope) => `${scope}: write`)
        .join(' and ');
      const problem = permissions.kind === 'default' ? `declares no permissions; declare ${missing}` : `does not grant ${missing}`;

      return missing === '' ? [] : [workflowViolation(workflow, 'workflow-credentials/attestation-permissions', `job '${job.id}' creates an attestation but ${problem}`, step.location)];
    });
}

/**
 * Whether the job passes a registry token to a step, which makes its publish not tokenless: a token variable with a value other than the empty string, anywhere in the environment.
 */
function passesToken(workflow: Workflow, job: Job, variables: readonly string[]): boolean {
  return [undefined, ...job.steps].some((step) => variables.some((variable) => (effectiveEnv(workflow, job, step)[variable] ?? '') !== ''));
}

function tokenlessPublishViolations(workflow: Workflow, job: Job, provenanceInManifest: boolean, npmrcVariables: readonly string[]): readonly Violation[] {
  if (accessOf(effectivePermissions(workflow, job), 'id-token') !== 'write' || passesToken(workflow, job, [...REGISTRY_TOKEN_VARIABLES, ...npmrcVariables])) {
    return [];
  }

  return job.steps.flatMap((step) => {
    const publishes = scriptCommands(step.run).filter((line) => PUBLISH_COMMAND.test(line));
    if (publishes.length === 0) {
      return [];
    }
    const env = effectiveEnv(workflow, job, step);
    const unprotected = tokenReads(job, step, publishes, npmrcVariables).filter((read) => env[read.variable] !== '');
    const provenance = provenanceInManifest || publishes.some((line) => PROVENANCE_FLAG.test(line)) || env['NPM_CONFIG_PROVENANCE'] === 'true';

    return unprotected.length === 0 || provenance
      ? []
      : [
          workflowViolation(
            workflow,
            'workflow-credentials/tokenless-publish-unprotected',
            `job '${job.id}' publishes with an OIDC identity and no token, but does not set ${unprotected.map((read) => `${read.variable} (read by ${read.reader})`).join(' and ')} to the empty string, so a token inherited from the environment is used when the OIDC exchange fails; set ${unprotected.length === 1 ? 'it' : 'them'} to the empty string to prevent that, or request provenance so that such a publish at least carries a traceable attestation`,
            step.location,
          ),
        ];
  });
}

/**
 * Credentials are granted to the steps that need them, and a publish with no token cannot quietly use one.
 *
 * `workflow-credentials/attestation-permissions`: a step of `actions/attest`, `actions/attest-build-provenance` or `actions/attest-sbom` needs `id-token: write` and `attestations: write` in the job's effective permissions. Permissions a job declares replace the workflow's; permissions declared nowhere are the repository's default, which the file cannot show and which never includes `id-token`, so they are reported.
 *
 * `workflow-credentials/tokenless-publish-unprotected`: a job with `id-token: write` that publishes (`npm`, `pnpm` or `yarn npm publish`, with options such as `-r` or `--filter <package>` before `publish`, `semantic-release`, `changeset publish`, `lerna publish`, bare or run through `pnpm`, `pnpm exec`, `yarn` or `npx`) and passes no token must blank (set to `''` at step, job or workflow level) every token variable the publish reads, or request provenance (`--provenance`, `NPM_CONFIG_PROVENANCE: true`, or `publishConfig.provenance: true` in the `package.json` of the working directory). The npm CLI replaces any configured token with the one from the OIDC exchange, but when the exchange fails it falls back to whatever token the environment holds, silently. Only blanking the variables prevents that fallback. Provenance does not: npm signs it with the CI's own OIDC identity (through Sigstore), separately from the registry token, so a fallback publish still goes ahead with the inherited token and carries an attestation of where it was built. Requesting provenance is accepted because it makes such a publish traceable, not because it makes it safe.
 *
 * A variable is judged only where something reads it, since npm reads none by name, only through `${NAME}` in an `.npmrc`: `NODE_AUTH_TOKEN` after an `actions/setup-node` step with `registry-url`, whose `.npmrc` refers to it; `NPM_TOKEN` for `semantic-release`, whose npm plugin reads it; and the variables the auth settings (`_authToken`, `_auth`, `_password`) of the `.npmrc` in the working directory refer to.
 *
 * Limits: `registry-url` is not reported, because it does not stop the exchange (see the README); an `.npmrc` the file does not show, such as one in the runner's home directory, a Yarn `.yarnrc.yml` and a token set through an `npm_config_` variable are not read; a job that calls a reusable workflow is not read; a publish inside a script file or composite action is not seen; provenance set in a `package.json` other than the one in the working directory is not read; a job is tokenless only when no token variable is non-empty anywhere in the job, so a publish that uses a secret is left alone.
 */
export const workflowCredentials: CheckFunction<WorkflowCredentialsOptions> = async ({ cwd, options }) => {
  const provenanceInManifest = await requestsProvenance(cwd);
  const npmrcVariables = await npmrcTokenVariables(cwd);

  return (await loadWorkflows(cwd, options)).flatMap((workflow) => workflow.jobs.flatMap((job) => [...attestationViolations(workflow, job), ...tokenlessPublishViolations(workflow, job, provenanceInManifest, npmrcVariables)]));
};
