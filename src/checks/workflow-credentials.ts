import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { CheckFunction, Violation } from '../check';
import { isRecord } from '../config-files';
import type { WorkflowCredentialsOptions } from '../options';
import { loadWorkflows } from '../workflows/load';
import { accessOf, effectiveEnv, effectivePermissions, type Job, type Workflow } from '../workflows/model';
import { scriptCommands, stepUses, workflowViolation } from '../workflows/shared';

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
 * The variables a token for the registry is passed in.
 */
const TOKEN_VARIABLES: readonly string[] = ['NODE_AUTH_TOKEN', 'NPM_TOKEN'];

const PROVENANCE_FLAG = /--provenance(?!=false)(?:=true)?(?:\s|$)/u;

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
function passesToken(workflow: Workflow, job: Job): boolean {
  return [undefined, ...job.steps].some((step) => TOKEN_VARIABLES.some((variable) => (effectiveEnv(workflow, job, step)[variable] ?? '') !== ''));
}

function tokenlessPublishViolations(workflow: Workflow, job: Job, provenanceInManifest: boolean): readonly Violation[] {
  if (accessOf(effectivePermissions(workflow, job), 'id-token') !== 'write' || passesToken(workflow, job)) {
    return [];
  }

  return job.steps.flatMap((step) => {
    const publishes = scriptCommands(step.run).filter((line) => PUBLISH_COMMAND.test(line));
    if (publishes.length === 0) {
      return [];
    }
    const env = effectiveEnv(workflow, job, step);
    const blanked = TOKEN_VARIABLES.every((variable) => env[variable] === '');
    const provenance = provenanceInManifest || publishes.some((line) => PROVENANCE_FLAG.test(line)) || env['NPM_CONFIG_PROVENANCE'] === 'true';

    return blanked || provenance
      ? []
      : [
          workflowViolation(
            workflow,
            'workflow-credentials/tokenless-publish-unprotected',
            `job '${job.id}' publishes with an OIDC identity and no token, but does not set ${TOKEN_VARIABLES.join(' and ')} to the empty string or request provenance, so a token inherited from the environment is used when the OIDC exchange fails`,
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
 * `workflow-credentials/tokenless-publish-unprotected`: a job with `id-token: write` that publishes (`npm`, `pnpm` or `yarn npm publish`, with options such as `-r` or `--filter <package>` before `publish`, `semantic-release`, `changeset publish`, `lerna publish`, bare or run through `pnpm`, `pnpm exec`, `yarn` or `npx`) and passes no token must blank `NODE_AUTH_TOKEN` and `NPM_TOKEN` (set them to `''` at step, job or workflow level) or request provenance (`--provenance`, `NPM_CONFIG_PROVENANCE: true`, or `publishConfig.provenance: true` in the `package.json` of the working directory). The npm CLI replaces any configured token with the one from the OIDC exchange, but when the exchange fails it falls back to whatever token the environment holds, silently.
 *
 * Limits: `registry-url` is not reported, because it does not stop the exchange (see the README); a job that calls a reusable workflow is not read; a publish inside a script file or composite action is not seen; provenance set in a `package.json` other than the one in the working directory is not read; a job is tokenless only when no token variable is non-empty anywhere in the job, so a publish that uses a secret is left alone.
 */
export const workflowCredentials: CheckFunction<WorkflowCredentialsOptions> = async ({ cwd, options }) => {
  const provenanceInManifest = await requestsProvenance(cwd);

  return (await loadWorkflows(cwd, options)).flatMap((workflow) => workflow.jobs.flatMap((job) => [...attestationViolations(workflow, job), ...tokenlessPublishViolations(workflow, job, provenanceInManifest)]));
};
