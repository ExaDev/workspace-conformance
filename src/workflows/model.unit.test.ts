import { describe, expect, it } from 'vitest';

import { ConformanceError } from '../errors';
import { accessOf, effectiveEnv, effectivePermissions, parseUses, parseWorkflow, transitiveNeeds } from './model';

const FILE = '.github/workflows/ci.yml';

describe('parseWorkflow', () => {
  it('reads events written as a name, a list or a mapping, and where each is written', () => {
    expect([...parseWorkflow(FILE, 'on: push\njobs: {}\n').triggers.keys()]).toEqual(['push']);

    const listed = parseWorkflow(FILE, 'on: [push, pull_request]\njobs: {}\n');

    expect([...listed.triggers.keys()]).toEqual(['push', 'pull_request']);
    expect(listed.triggerLocations.get('pull_request')).toEqual({ line: 1, column: 12 });

    const mapped = parseWorkflow(FILE, 'on:\n  push:\n    branches: [main]\n  merge_group:\njobs: {}\n');

    expect([...mapped.triggers.keys()]).toEqual(['push', 'merge_group']);
    expect(mapped.triggers.get('push')).toEqual({ branches: ['main'] });
    expect(mapped.triggerLocations.get('merge_group')).toEqual({ line: 4, column: 3 });
  });

  it('reads the permissions in each form, and none as the repository default', () => {
    const permissions = (text: string): unknown => parseWorkflow(FILE, `on: push\n${text}jobs: {}\n`).permissions;

    expect(permissions('')).toEqual({ kind: 'default' });
    expect(permissions('permissions: read-all\n')).toEqual({ kind: 'all', access: 'read' });
    expect(permissions('permissions: write-all\n')).toEqual({ kind: 'all', access: 'write' });
    expect(permissions('permissions: {}\n')).toEqual({ kind: 'scopes', scopes: new Map() });
    expect(permissions('permissions:\n  contents: read\n  id-token: write\n')).toEqual({
      kind: 'scopes',
      scopes: new Map([
        ['contents', 'read'],
        ['id-token', 'write'],
      ]),
    });
    expect(parseWorkflow(FILE, 'on: push\njobs: {}\n').permissionsLocation).toBeUndefined();
    expect(parseWorkflow(FILE, 'on: push\npermissions: {}\njobs: {}\n').permissionsLocation).toEqual({ line: 2, column: 1 });
  });

  it('reads a job environment written as a name or as a mapping with a name', () => {
    const environments = parseWorkflow(FILE, 'on: push\njobs:\n  a:\n    environment: release\n  b:\n    environment:\n      name: production\n      url: https://example.com\n  c:\n    runs-on: x\n').jobs.map((job) => job.environment);

    expect(environments).toEqual(['release', 'production', undefined]);
  });

  it('reads jobs, steps and what they carry as text, with positions', () => {
    const workflow = parseWorkflow(
      FILE,
      `name: CI
on: push
env:
  LEVEL: 1
jobs:
  build:
    name: Build
    needs: setup
    if: github.ref == 'refs/heads/main'
    runs-on: [self-hosted, "\${{ matrix.os }}"]
    timeout-minutes: 10
    outputs:
      path: \${{ steps.pack.outputs.path }}
    steps:
      - id: pack
        name: Pack
        uses: actions/setup-node@v4
        with:
          node-version: 22
        env:
          CI: true
        if: always()
      - run: echo done
  call:
    needs: [setup, build]
    uses: ./.github/workflows/other.yml
    with:
      flag: true
`,
    );
    const [build, call] = workflow.jobs;

    expect(workflow.name).toBe('CI');
    expect(workflow.env).toEqual({ LEVEL: '1' });
    expect(build).toMatchObject({
      id: 'build',
      name: 'Build',
      needs: ['setup'],
      condition: "github.ref == 'refs/heads/main'",
      timeoutMinutes: '10',
      outputs: { path: '${{ steps.pack.outputs.path }}' },
      runsOn: { labels: ['self-hosted'], expressions: ['${{ matrix.os }}'], group: undefined },
      location: { line: 6, column: 3 },
    });
    expect(build?.steps[0]).toMatchObject({ index: 0, id: 'pack', name: 'Pack', uses: 'actions/setup-node@v4', run: undefined, with: { 'node-version': '22' }, env: { CI: 'true' }, condition: 'always()', location: { line: 15, column: 9 } });
    expect(build?.steps[1]).toMatchObject({ index: 1, run: 'echo done', condition: undefined });
    expect(call).toMatchObject({ id: 'call', needs: ['setup', 'build'], uses: './.github/workflows/other.yml', with: { flag: 'true' }, steps: [] });
  });

  it('reads a runner group and the outputs a reusable workflow declares', () => {
    const workflow = parseWorkflow(
      FILE,
      `on:
  workflow_call:
    outputs:
      runner:
        value: \${{ jobs.pick.outputs.runner }}
jobs:
  pick:
    runs-on:
      group: fleet
      labels: gpu
`,
    );

    expect(workflow.callOutputs).toEqual({ runner: '${{ jobs.pick.outputs.runner }}' });
    expect(workflow.jobs[0]?.runsOn).toEqual({ labels: ['gpu'], expressions: [], group: 'fleet' });
  });

  it('fails, naming the file and the field, on what is not shaped like a workflow', () => {
    expect(() => parseWorkflow(FILE, 'on: push\njobs: [unclosed\n')).toThrow(new RegExp(`^${FILE}: not valid YAML`, 'u'));
    expect(() => parseWorkflow(FILE, 'on: push\njobs: 5\n')).toThrow(`${FILE}: jobs must be a mapping`);
    expect(() => parseWorkflow(FILE, 'on: push\njobs:\n  a:\n    steps: x\n')).toThrow(`${FILE}: jobs.a.steps must be a list`);
    expect(() => parseWorkflow(FILE, 'on: push\npermissions:\n  contents: sideways\njobs: {}\n')).toThrow(`${FILE}: permissions.contents must be read, write or none`);
    expect(() => parseWorkflow(FILE, 'on: push\njobs:\n  a:\n    name: [x]\n')).toThrow(`${FILE}: jobs.a.name must be a string, number or boolean`);
    expect(() => parseWorkflow(FILE, 'on: push\njobs:\n  a:\n    needs: [[x]]\n')).toThrow(ConformanceError);
    expect(() => parseWorkflow(FILE, 'on: [null]\njobs: {}\n')).toThrow(`${FILE}: on must be a string or a list of strings`);
    expect(() => parseWorkflow(FILE, 'on: [[x]]\njobs: {}\n')).toThrow(`${FILE}: on must be a string, number or boolean`);
  });
});

describe('permissions', () => {
  const workflow = parseWorkflow(
    FILE,
    `on: push
permissions:
  contents: read
jobs:
  own:
    permissions:
      id-token: write
  inherited: {}
`,
  );

  it('are a job’s own when it declares any, and the workflow’s otherwise', () => {
    const [own, inherited] = workflow.jobs;

    expect(own === undefined ? undefined : effectivePermissions(workflow, own)).toEqual({ kind: 'scopes', scopes: new Map([['id-token', 'write']]) });
    expect(inherited === undefined ? undefined : effectivePermissions(workflow, inherited)).toBe(workflow.permissions);
  });

  it('grant none to a scope that is not specified once any is, everything for write-all, and leave the default undecided', () => {
    expect(accessOf({ kind: 'scopes', scopes: new Map([['contents', 'read']]) }, 'id-token')).toBe('none');
    expect(accessOf({ kind: 'scopes', scopes: new Map([['contents', 'read']]) }, 'contents')).toBe('read');
    expect(accessOf({ kind: 'all', access: 'write' }, 'id-token')).toBe('write');
    expect(accessOf({ kind: 'default' }, 'contents')).toBeUndefined();
  });
});

describe('effectiveEnv', () => {
  it('lets the job override the workflow and the step override the job', () => {
    const workflow = parseWorkflow(FILE, "on: push\nenv: { A: workflow, B: workflow, C: workflow }\njobs:\n  j:\n    env: { B: job, C: job }\n    steps:\n      - run: x\n        env: { C: step }\n");
    const [job] = workflow.jobs;
    const step = job?.steps[0];

    expect(job === undefined ? undefined : effectiveEnv(workflow, job, undefined)).toEqual({ A: 'workflow', B: 'job', C: 'job' });
    expect(job === undefined ? undefined : effectiveEnv(workflow, job, step)).toEqual({ A: 'workflow', B: 'job', C: 'step' });
  });
});

describe('transitiveNeeds', () => {
  it('collects what a job waits for through other jobs, once each, and survives a cycle', () => {
    const workflow = parseWorkflow(FILE, 'on: push\njobs:\n  a: { needs: [b, c] }\n  b: { needs: c }\n  c: { needs: a }\n  d: { needs: missing }\n');

    expect([...transitiveNeeds(workflow, 'a')].sort()).toEqual(['b', 'c']);
    expect([...transitiveNeeds(workflow, 'd')]).toEqual(['missing']);
    expect([...transitiveNeeds(workflow, 'unknown')]).toEqual([]);
  });
});

describe('parseUses', () => {
  it('splits local paths, Docker images and repository references', () => {
    expect(parseUses('./.github/actions/x')).toEqual({ kind: 'local', path: './.github/actions/x' });
    expect(parseUses('docker://alpine:3.20')).toEqual({ kind: 'docker', image: 'alpine:3.20', digest: undefined });
    expect(parseUses('docker://alpine@sha256:abc')).toEqual({ kind: 'docker', image: 'alpine', digest: 'sha256:abc' });
    expect(parseUses('actions/checkout@v4')).toEqual({ kind: 'remote', owner: 'actions', repository: 'checkout', path: '', ref: 'v4' });
    expect(parseUses('example-org/shared/.github/workflows/build.yml@main')).toEqual({ kind: 'remote', owner: 'example-org', repository: 'shared', path: '.github/workflows/build.yml', ref: 'main' });
    expect(parseUses('example-org/tool')).toEqual({ kind: 'remote', owner: 'example-org', repository: 'tool', path: '', ref: undefined });
  });
});
