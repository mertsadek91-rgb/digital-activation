// Review invalidation (TASK-0092): a reviewer or a manager can strike a review
// that should not count — append-only, authority-checked, replay-validated.
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { sandbox, task } from './sandbox.mjs';

const R = ['--reason', 'eval'];
const IND = ['--independent', '--executor', 'subagent:independent-reviewer'];
const auth = task({ title: 'Harden refresh', primary_agent: 'auth-rbac-specialist', authority_level: 4, required_reviewers: ['pm-04', 'pm-06'], affected_files: ['apps/api/src/auth/auth.service.ts'], status: 'IN_PROGRESS', stage: 'IMPLEMENTATION', progress: 60 });
const complete = (s) => s.pm('transition', 'TASK-0001', 'COMPLETED', '--stage', 'COMPLETED', '--progress', '100', '--by', 'auth-rbac-specialist', ...R);
const pass = (s, by = 'qa-lead') => s.pm('review', 'TASK-0001', '--by', by, ...IND, '--type', 'QA', '--result', 'PASS', '--findings', 'ok').out.trim().split(/\s+/).at(-1);
const invalidate = (s, rev, by, reason = 'recorded by another tool; the review never happened') => s.pm('review-invalidate', rev, '--by', by, '--reason', reason);
const show = (s) => JSON.parse(s.pm('show', 'TASK-0001').out);

test('an invalidated PASS no longer satisfies completion, and pm show lists it as invalidated', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'auth-rbac-specialist', ...R, '--json', auth);
    const rev = pass(s);
    assert.equal(rev, 'REV-0001');
    const before = s.read('agent-os/state/events.jsonl');
    const r = invalidate(s, rev, 'qa-lead');
    assert.equal(r.code, 0, r.all);
    // Append-only: the original line is untouched, one line is added.
    const after = s.read('agent-os/state/events.jsonl');
    assert.ok(after.startsWith(before));
    assert.match(after.slice(before.length), /"type":"review_invalidated"/);
    const c = complete(s);
    assert.equal(c.code, 2);
    assert.match(c.all, /needs a passing independent review/);
    const sh = show(s);
    assert.deepEqual(sh.reviews, []);
    assert.equal(sh.invalidated_reviews.length, 1);
    assert.equal(sh.invalidated_reviews[0].review_id, 'REV-0001');
    assert.equal(sh.invalidated_reviews[0].invalidated.by, 'qa-lead');
    assert.match(sh.history.at(-1).summary, /REV-0001 invalidated by qa-lead/);
    const idx = JSON.parse(s.read('project-management/REVIEW_INDEX.json'));
    assert.equal(idx.reviews.length, 0);
    assert.equal(idx.invalidated_reviews.length, 1);
    // A new review gets a fresh id (no reuse) and counts again.
    assert.equal(pass(s), 'REV-0002');
    assert.equal(complete(s).code, 0);
  } finally {
    s.cleanup();
  }
});

test('authority: reviewer, exec-director and the domain managers may invalidate; others are refused', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'auth-rbac-specialist', ...R, '--json', auth);
    for (const by of ['frontend-engineer', 'pm-03', 'auth-rbac-specialist']) {
      const rev = pass(s);
      const r = invalidate(s, rev, by);
      assert.equal(r.code, 2, `${by}: ${r.all}`);
      assert.match(r.all, /may not invalidate|primary agent/);
    }
    assert.equal(show(s).invalidated_reviews.length, 0);
    assert.equal(invalidate(s, pass(s), 'qa-lead', '  ').code, 2, 'a blank reason is refused');
    for (const by of ['qa-lead', 'exec-director', 'pm-04', 'pm-06']) assert.equal(invalidate(s, pass(s), by).code, 0, by);
    assert.notEqual(s.pm('review-invalidate', pass(s), '--by', 'owner', ...R).code, 0, 'an agent cannot act as the owner');
  } finally {
    s.cleanup();
  }
});

test('a VETO or BLOCKING_OBJECTION is withdrawn only by its own reviewer; an owner record by nobody',() => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'auth-rbac-specialist', ...R, '--json', auth);
    const veto = s.pm('review', 'TASK-0001', '--by', 'security-engineer', ...IND, '--type', 'SECURITY', '--result', 'BLOCKING_OBJECTION', '--findings', 'replay not revoked').out.trim().split(/\s+/).at(-1);
    pass(s);
    for (const by of ['exec-director', 'pm-04', 'pm-06']) {
      const r = invalidate(s, veto, by);
      assert.equal(r.code, 2, by);
      assert.match(r.all, /only security-engineer can withdraw it/);
    }
    assert.equal(complete(s).code, 2);
    // An owner record is out of every agent's reach, exec-director included.
    const own = { id: 'E20260930110000-abcdef', ts: '2026-09-30T11:00:00Z', type: 'review_recorded', actor: 'owner', channel: 'dashboard', entity: 'TASK-0001', data: { review_id: 'REV-0009', reviewer: 'owner', review_type: 'QA', result: 'PASS', independent: false, findings: 'owner looked' } };
    appendFileSync(join(s.dir, 'agent-os', 'state', 'events.jsonl'), JSON.stringify(own) + '\n');
    for (const by of ['exec-director', 'pm-04']) {
      const r = invalidate(s, 'REV-0009', by);
      assert.equal(r.code, 2, by);
      assert.match(r.all, /owner's record/);
    }
  } finally {
    s.cleanup();
  }
});

test('an invalidation cannot be undone into a pass, and striking a fake PASS restores an earlier block', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'auth-rbac-specialist', ...R, '--json', auth);
    s.pm('review', 'TASK-0001', '--by', 'security-engineer', ...IND, '--type', 'SECURITY', '--result', 'BLOCKING_OBJECTION', '--findings', 'replay not revoked');
    const fake = s.pm('review', 'TASK-0001', '--by', 'security-engineer', ...IND, '--type', 'SECURITY', '--result', 'PASS', '--findings', 'fixed').out.trim().split(/\s+/).at(-1);
    pass(s);
    assert.equal(invalidate(s, fake, 'pm-06').code, 0);
    const c = complete(s);
    assert.equal(c.code, 2);
    assert.match(c.all, /open BLOCKING_OBJECTION by security-engineer/);
    // Final: a second invalidation of the same review is refused, by anyone.
    for (const by of ['security-engineer', 'exec-director']) {
      const r = invalidate(s, fake, by);
      assert.equal(r.code, 2);
      assert.match(r.all, /already invalidated/);
    }
    // A forged second event on the same id is a state error that pm check reports.
    const ev = { id: 'E20260930120000-abcdef', ts: '2026-09-30T12:00:00Z', type: 'review_invalidated', actor: 'exec-director', channel: 'cli', entity: 'TASK-0001', data: { review_id: fake }, reason: 'again' };
    appendFileSync(join(s.dir, 'agent-os', 'state', 'events.jsonl'), JSON.stringify(ev) + '\n');
    assert.match(s.pm('check').all, /is already invalidated/);
  } finally {
    s.cleanup();
  }
});

test('replay: an authorised invalidation replays cleanly; a forged unauthorised one is caught', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'auth-rbac-specialist', ...R, '--json', auth);
    const rev = pass(s);
    assert.equal(complete(s).code, 0);
    assert.equal(invalidate(s, rev, 'pm-04').code, 0);
    let c = s.pm('check');
    assert.doesNotMatch(c.all, /would be refused/, c.all);
    // The completion stood when it happened; the final state now lacks a valid review.
    assert.match(c.all, /COMPLETED at level 4 without a passing independent review/);
    // Forge a review and an invalidation by a role with no authority, bypassing the CLI.
    const second = pass(s);
    const ev = { id: 'E20260930120001-abcdef', ts: '2026-09-30T12:00:01Z', type: 'review_invalidated', actor: 'frontend-engineer', channel: 'cli', entity: 'TASK-0001', data: { review_id: second }, reason: 'forged' };
    appendFileSync(join(s.dir, 'agent-os', 'state', 'events.jsonl'), JSON.stringify(ev) + '\n');
    c = s.pm('check');
    assert.equal(c.code, 1);
    assert.match(c.all, /review_invalidated TASK-0001\) would be refused: frontend-engineer may not invalidate/);
  } finally {
    s.cleanup();
  }
});

test('dissent short of a block (CONCERN, OBJECTION) is struck only by its reviewer or exec-director', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'auth-rbac-specialist', ...R, '--json', auth);
    const concern = s.pm('review', 'TASK-0001', '--by', 'security-engineer', ...IND, '--type', 'SECURITY', '--result', 'CONCERN', '--findings', 'rotation window too long').out.trim().split(/\s+/).at(-1);
    // pm-04 answers for the task (responsible manager) and may strike a PASS, not another reviewer's dissent.
    for (const by of ['pm-04', 'pm-06']) {
      const r = invalidate(s, concern, by);
      assert.equal(r.code, 2, `${by}: ${r.all}`);
      assert.match(r.all, /may not invalidate/);
    }
    assert.equal(invalidate(s, concern, 'exec-director').code, 0);
    assert.equal(show(s).invalidated_reviews[0].invalidated.by, 'exec-director');
  } finally {
    s.cleanup();
  }
});
