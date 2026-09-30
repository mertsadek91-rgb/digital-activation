// Canonical state: schema/enum governance, transactional refusal, V1
// compatibility (the ported rules still fire), append-only history, legacy
// status mapping, deterministic reconstruction.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sandbox, task } from './sandbox.mjs';

test('free-form status names are refused and nothing is written', () => {
  const s = sandbox();
  try {
    const r = s.pm('create', 'TASK', '--by', 'frontend-engineer', '--reason', 'eval', '--json', task({ status: 'IN PROGRESS' }));
    assert.equal(r.code, 2, r.all);
    assert.match(r.all, /is not one of/);
    assert.equal(s.pm('list', 'TASK').out.trim(), '');
  } finally {
    s.cleanup();
  }
});

test('an agent cannot write as the owner', () => {
  const s = sandbox();
  try {
    const r = s.pm('create', 'TASK', '--by', 'owner', '--reason', 'eval', '--json', task());
    assert.notEqual(r.code, 0);
    assert.match(r.all, /cannot act as the owner/);
  } finally {
    s.cleanup();
  }
});

test('V1 rules still fire: authority ceiling at write time, L4 second manager at check time', () => {
  const s = sandbox();
  try {
    const high = s.pm('create', 'TASK', '--by', 'frontend-engineer', '--reason', 'eval', '--json', task({ authority_level: 5 }));
    assert.equal(high.code, 2);
    assert.match(high.all, /exceeds frontend-engineer's ceiling of 3/);
    assert.equal(s.pm('create', 'TASK', '--by', 'backend-architect', '--reason', 'eval', '--json', task({ primary_agent: 'backend-architect', authority_level: 4, required_reviewers: ['pm-04'] })).code, 0);
    const c = s.pm('check');
    assert.equal(c.code, 1);
    assert.match(c.all, /level 4\+ task needs a second manager/);
  } finally {
    s.cleanup();
  }
});

test('ownership floor: a task below the level of the paths it touches is reported', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'backend-architect', '--reason', 'eval', '--json', task({ primary_agent: 'backend-architect', authority_level: 3, affected_files: ['apps/api/src/checkout/expiry-sweep.service.ts'] }));
    assert.match(s.pm('check').all, /below the level-4 floor of checkout/);
  } finally {
    s.cleanup();
  }
});

test('V1 import maps legacy status names and preserves every field', () => {
  const s = sandbox();
  try {
    s.write('project-management/tasks/active/TASK-0007.md', `---\nid: TASK-0007\ntitle: "Legacy: task"\ntype: bug\nstatus: WORKING\nstage: IMPLEMENTATION\npriority: HIGH\nprogress: 40\nauthority_level: 2\nrisk: LOW\nprimary_agent: frontend-engineer\nresponsible_manager: pm-04\nsupporting_agents:\n  [\n    qa-lead,\n  ]\nrelated_consensus:\n---\n\n# body kept\n`);
    const r = s.pm('migrate-v1');
    assert.equal(r.code, 0, r.all);
    const e = JSON.parse(s.pm('show', 'TASK-0007').out).entity;
    assert.equal(e.status, 'IN_PROGRESS');
    assert.equal(e.title, 'Legacy: task');
    assert.deepEqual(e.supporting_agents, ['qa-lead']);
    assert.equal(e.related_consensus, null);
    assert.match(s.read('project-management/tasks/active/TASK-0007.md'), /# body kept/);
    assert.match(s.pm('migrate-v1').all, /already imported/);
  } finally {
    s.cleanup();
  }
});

test('history is append-only: rewriting a committed event fails the check', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'frontend-engineer', '--reason', 'eval', '--json', task());
    s.git('add', '-A');
    s.git('commit', '-qm', 'state');
    assert.equal(s.pm('check').code, 0, s.pm('check').all);
    const log = s.read('agent-os/state/events.jsonl');
    s.write('agent-os/state/events.jsonl', log.replace('Eval task', 'Rewritten'));
    const c = s.pm('check');
    assert.equal(c.code, 1);
    assert.match(c.all, /append-only/);
  } finally {
    s.cleanup();
  }
});

test('reconstruction: a fresh fold of the log reproduces the same state', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'frontend-engineer', '--reason', 'eval', '--json', task());
    s.pm('transition', 'TASK-0001', 'IN_PROGRESS', '--stage', 'IMPLEMENTATION', '--progress', '40', '--by', 'frontend-engineer', '--reason', 'eval');
    const a = s.js(`import {materialize, readEvents} from '${s.lib('state.mjs')}'; console.log(JSON.stringify([...materialize(readEvents()).entities]))`);
    const b = s.js(`import {materialize, readEvents} from '${s.lib('state.mjs')}'; console.log(JSON.stringify([...materialize(readEvents()).entities]))`);
    assert.equal(a, b);
    assert.equal(JSON.parse(a)[0][1].status, 'IN_PROGRESS');
  } finally {
    s.cleanup();
  }
});
