// Decision rights and independent evaluation.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sandbox, task } from './sandbox.mjs';

const R = ['--reason', 'eval'];
const auth = task({ title: 'Harden refresh', primary_agent: 'auth-rbac-specialist', authority_level: 4, required_reviewers: ['pm-04', 'pm-06'], affected_files: ['apps/api/src/auth/auth.service.ts'], status: 'IN_PROGRESS', stage: 'IMPLEMENTATION', progress: 60 });
const complete = (s) => s.pm('transition', 'TASK-0001', 'COMPLETED', '--stage', 'COMPLETED', '--progress', '100', '--by', 'auth-rbac-specialist', ...R);

test('L3+ work cannot be completed without a passing independent review', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'auth-rbac-specialist', ...R, '--json', auth);
    const r = complete(s);
    assert.equal(r.code, 2);
    assert.match(r.all, /needs a passing independent review/);
    // A non-independent review does not count.
    s.pm('review', 'TASK-0001', '--by', 'qa-lead', '--type', 'QA', '--result', 'PASS', '--findings', 'looked fine');
    assert.equal(complete(s).code, 2);
    s.pm('review', 'TASK-0001', '--by', 'qa-lead', '--independent', '--executor', 'subagent:independent-reviewer', '--type', 'QA', '--result', 'PASS', '--findings', 'tests pass');
    assert.equal(complete(s).code, 0, complete(s).all);
  } finally {
    s.cleanup();
  }
});

test('independence needs a fresh-context executor: --executor main is refused (REV-0003 finding)', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'auth-rbac-specialist', ...R, '--json', auth);
    for (const ex of [[], ['--executor', 'main']]) {
      const r = s.pm('review', 'TASK-0001', '--by', 'qa-lead', '--independent', ...ex, '--type', 'QA', '--result', 'PASS', '--findings', 'ok');
      assert.equal(r.code, 2, r.all);
      assert.match(r.all, /fresh-context executor/);
    }
    assert.equal(complete(s).code, 2);
  } finally {
    s.cleanup();
  }
});

test('the implementer cannot be its own independent reviewer', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'auth-rbac-specialist', ...R, '--json', auth);
    const r = s.pm('review', 'TASK-0001', '--by', 'auth-rbac-specialist', '--independent', '--executor', 'subagent:independent-reviewer', '--type', 'TECHNICAL', '--result', 'PASS', '--findings', 'mine');
    assert.equal(r.code, 2);
    assert.match(r.all, /cannot be its own independent reviewer/);
  } finally {
    s.cleanup();
  }
});

test('veto is domain-bound: design cannot veto auth; security can, and it blocks completion until resolved', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'auth-rbac-specialist', ...R, '--json', auth);
    const art = s.pm('review', 'TASK-0001', '--by', 'art-director', '--independent', '--executor', 'subagent:independent-reviewer', '--type', 'VISUAL', '--result', 'VETO', '--findings', 'dislike');
    assert.equal(art.code, 2);
    assert.match(art.all, /no VETO right on auth decisions/);
    assert.equal(s.pm('review', 'TASK-0001', '--by', 'security-engineer', '--independent', '--executor', 'subagent:independent-reviewer', '--type', 'SECURITY', '--result', 'BLOCKING_OBJECTION', '--findings', 'replay not revoked').code, 0);
    s.pm('review', 'TASK-0001', '--by', 'qa-lead', '--independent', '--executor', 'subagent:independent-reviewer', '--type', 'QA', '--result', 'PASS', '--findings', 'ok');
    const r = complete(s);
    assert.equal(r.code, 2);
    assert.match(r.all, /open BLOCKING_OBJECTION by security-engineer/);
    assert.match(s.pm('attention').out, /SECURITY_BLOCK/);
    s.pm('review', 'TASK-0001', '--by', 'security-engineer', '--independent', '--executor', 'subagent:independent-reviewer', '--type', 'SECURITY', '--result', 'PASS', '--findings', 'fixed');
    assert.equal(complete(s).code, 0, complete(s).all);
  } finally {
    s.cleanup();
  }
});

test('the governor flags review loops instead of letting them run', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'auth-rbac-specialist', ...R, '--json', auth);
    for (let i = 0; i < 4; i++) s.pm('review', 'TASK-0001', '--by', 'qa-lead', '--independent', '--executor', 'subagent:independent-reviewer', '--type', 'QA', '--result', 'FAIL', '--findings', `round ${i}`);
    assert.match(s.pm('check').all, /unresolved review rounds \(limit 3\) — escalate/);
    for (let i = 0; i < 3; i++) s.pm('attempt-failed', 'TASK-0001', '--by', 'auth-rbac-specialist', ...R);
    assert.match(s.pm('check').all, /failed attempts \(limit 2\)/);
  } finally {
    s.cleanup();
  }
});

test('level 5 work cannot pass APPROVAL without a consensus record', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'auth-rbac-specialist', ...R, '--json', task({ primary_agent: 'auth-rbac-specialist', authority_level: 5, required_reviewers: ['pm-04', 'pm-06'], stage: 'APPROVAL' }));
    const r = s.pm('transition', 'TASK-0001', 'IN_PROGRESS', '--stage', 'IMPLEMENTATION', '--by', 'auth-rbac-specialist', ...R);
    assert.equal(r.code, 2);
    assert.match(r.all, /needs a related_consensus/);
  } finally {
    s.cleanup();
  }
});
