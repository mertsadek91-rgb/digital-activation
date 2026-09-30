// Isolated eval environment: a throwaway copy of the Agent OS (tools,
// policies, schemas, role catalog) with empty canonical state and its own git
// repository. Nothing an eval does can reach the real project state, and no
// eval sees another's residue.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { REPO } from '../tools/lib/paths.mjs';

export function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-os-eval-'));
  for (const p of ['agent-os/tools', 'agent-os/policies', 'agent-os/schemas', '.claude/hooks'])
    cpSync(join(REPO, p), join(dir, p), { recursive: true });
  mkdirSync(join(dir, 'agent-os', 'state'), { recursive: true });
  mkdirSync(join(dir, 'project-management'), { recursive: true });
  for (const f of ['PERMISSIONS.json', 'PROJECT_CONFIG.json'])
    cpSync(join(REPO, 'project-management', f), join(dir, 'project-management', f));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'eval@example.invalid');
  git(dir, 'config', 'user.name', 'eval');
  // The owner key lives in the sandbox, never in the real home directory; it
  // does not exist until a test deliberately plays the owner (ensureOwnerKey).
  const env = { ...process.env, PM_ROOT: dir, PM_CHANNEL: 'eval', AGENT_OS_OWNER_KEY_FILE: join(dir, 'owner-home', 'owner.key') };
  delete env.CLAUDECODE;
  delete env.GITHUB_BASE_REF;

  const pm = (...args) => {
    const r = spawnSync(process.execPath, [join(dir, 'agent-os', 'tools', 'pm.mjs'), ...args], { cwd: dir, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
  };
  // Run an ESM snippet inside the sandbox (for owner/dashboard-channel events,
  // which the CLI deliberately cannot produce).
  const js = (code) => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr || r.stdout);
    return r.stdout.trim();
  };
  const lib = (name) => `file:///${join(dir, 'agent-os', 'tools', 'lib', name).replace(/\\/g, '/')}`;
  const read = (p) => readFileSync(join(dir, p), 'utf8');
  const write = (p, s) => {
    mkdirSync(join(dir, p, '..'), { recursive: true });
    writeFileSync(join(dir, p), s);
  };
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return { dir, pm, js, lib, read, write, git: (...a) => git(dir, ...a), cleanup };
}

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// A minimal valid task, overridable.
export const task = (o = {}) =>
  JSON.stringify({
    title: 'Eval task',
    type: 'bug',
    status: 'READY',
    stage: 'ANALYSIS',
    priority: 'MEDIUM',
    progress: 10,
    authority_level: 2,
    risk: 'LOW',
    primary_agent: 'frontend-engineer',
    responsible_manager: 'pm-04',
    required_reviewers: ['pm-04'],
    affected_files: [],
    ...o,
  });

export const PACK = `
# pack

## Problem
A real problem statement.

## Evidence Against
Benefit may be small.

## Alternatives
Do nothing; improve existing; build.

## Why Now
Cheap now.

## Why Not Now
Other work is more urgent.

## Cost of Doing Nothing
Small but ongoing.

## Technical Feasibility
Two files, LOW.

## Risks
Wrong handle.

## Success Criteria
Validator shows the property.

## Validation Plan
Rich results test.

## Recommendation
BUILD.
`;
