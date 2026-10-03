import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { CheckFunction, FileViolation } from '../check';
import type { WorkflowVersionSingleSourceOptions } from '../options';
import { loadWorkflows } from '../workflows/load';
import { hasExpression } from '../workflows/model';
import { stepUses, workflowViolation } from '../workflows/shared';

const TOOL_VERSIONS = '.tool-versions';
const NVMRC = '.nvmrc';

/**
 * A setup action: the input that holds a literal version, the input that reads it from a file, and the names `.tool-versions` knows the tool by.
 */
interface SetupAction {
  readonly action: string;
  readonly versionInput: string;
  readonly fileInput: string | undefined;
  readonly tools: readonly string[];
}

const SETUP_ACTIONS: readonly SetupAction[] = [
  { action: 'actions/setup-node', versionInput: 'node-version', fileInput: 'node-version-file', tools: ['nodejs', 'node'] },
  { action: 'actions/setup-python', versionInput: 'python-version', fileInput: 'python-version-file', tools: ['python'] },
  { action: 'actions/setup-go', versionInput: 'go-version', fileInput: 'go-version-file', tools: ['golang', 'go'] },
  { action: 'actions/setup-java', versionInput: 'java-version', fileInput: 'java-version-file', tools: ['java'] },
  { action: 'actions/setup-dotnet', versionInput: 'dotnet-version', fileInput: 'global-json-file', tools: ['dotnet', 'dotnet-core'] },
  { action: 'ruby/setup-ruby', versionInput: 'ruby-version', fileInput: undefined, tools: ['ruby'] },
  { action: 'oven-sh/setup-bun', versionInput: 'bun-version', fileInput: 'bun-version-file', tools: ['bun'] },
  { action: 'denoland/setup-deno', versionInput: 'deno-version', fileInput: 'deno-version-file', tools: ['deno'] },
  { action: 'pnpm/action-setup', versionInput: 'version', fileInput: undefined, tools: ['pnpm'] },
  { action: 'hashicorp/setup-terraform', versionInput: 'terraform_version', fileInput: undefined, tools: ['terraform'] },
];

/**
 * The tool names a `.tool-versions` file lists. Each line is a tool name followed by versions; a comment starts with `#`.
 */
function listedTools(content: string): ReadonlySet<string> {
  return new Set(
    content
      .split('\n')
      .map((line) => line.replace(/#.*$/u, '').trim().split(/\s+/u))
      .filter((fields) => fields.length >= 2)
      .map((fields) => String(fields[0])),
  );
}

/**
 * A setup step keeps a runtime version in the workflow when a version file already says it: `.nvmrc` for Node, `.tool-versions` for any tool it lists. The step reads the file instead (`node-version-file`, or `mise` or `asdf` actions), so there is one place to change.
 *
 * A version is a literal when it contains no expression, so `${{ matrix.node }}` is not reported: a matrix tests versions on purpose. A range or alias such as `lts/*` is a literal. Only the setup actions listed in the README are recognised, only the files in the working directory are looked for, and composite actions are not read.
 */
export const workflowVersionSingleSource: CheckFunction<WorkflowVersionSingleSourceOptions> = async ({ cwd, options }) => {
  const toolVersions = existsSync(resolve(cwd, TOOL_VERSIONS)) ? listedTools(await readFile(resolve(cwd, TOOL_VERSIONS), 'utf8')) : new Set<string>();
  const hasNvmrc = existsSync(resolve(cwd, NVMRC));
  const violations: FileViolation[] = [];
  for (const workflow of await loadWorkflows(cwd, options)) {
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        for (const setup of SETUP_ACTIONS.filter((candidate) => stepUses(step, candidate.action))) {
          const version = step.with[setup.versionInput];
          const source = setup.action === 'actions/setup-node' && hasNvmrc ? NVMRC : setup.tools.find((tool) => toolVersions.has(tool)) === undefined ? undefined : TOOL_VERSIONS;
          if (version !== undefined && !hasExpression(version) && source !== undefined) {
            violations.push(
              workflowViolation(
                workflow,
                'workflow-version-single-source/literal-version',
                `${setup.action} sets ${setup.versionInput}: ${version}, but ${source} already holds the version; read it from there${setup.fileInput === undefined ? '' : ` with ${setup.fileInput}`}`,
                step.location,
              ),
            );
          }
        }
      }
    }
  }

  return violations;
};
