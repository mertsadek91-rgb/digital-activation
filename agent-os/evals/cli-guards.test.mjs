// CLI input guards (TASK-0098): a command that would add nothing, or that was
// called with a flag it does not read, is refused and writes nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sandbox, task } from './sandbox.mjs';

const R = ['--by', 'frontend-engineer', '--reason', 'eval'];
const LOG = 'agent-os/state/events.jsonl';

test('a transition to the status the item already has is refused and writes nothing', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', ...R, '--json', task());
    assert.equal(s.pm('transition', 'TASK-0001', 'IN_PROGRESS', ...R).code, 0);
    const before = s.read(LOG);
    const r = s.pm('transition', 'TASK-0001', 'IN_PROGRESS', ...R);
    assert.equal(r.code, 2, r.all);
    assert.match(r.all, /already IN_PROGRESS/);
    // Restating the current stage or progress is still a no-op.
    const same = s.pm('transition', 'TASK-0001', 'IN_PROGRESS', '--stage', 'ANALYSIS', '--progress', '10', ...R);
    assert.equal(same.code, 2, same.all);
    assert.match(same.all, /with that stage and progress/);
    assert.equal(s.read(LOG), before);
  } finally {
    s.cleanup();
  }
});

test('a same-status transition that moves the stage or progress is accepted', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', ...R, '--json', task({ status: 'IN_PROGRESS' }));
    const stage = s.pm('transition', 'TASK-0001', 'IN_PROGRESS', '--stage', 'IMPLEMENTATION', ...R);
    assert.equal(stage.code, 0, stage.all);
    const progress = s.pm('transition', 'TASK-0001', 'IN_PROGRESS', '--progress', '60', ...R);
    assert.equal(progress.code, 0, progress.all);
    const e = JSON.parse(s.pm('show', 'TASK-0001').out).entity;
    assert.equal(e.stage, 'IMPLEMENTATION');
    assert.equal(e.progress, 60);
    const bad = s.pm('transition', 'TASK-0001', 'IN_PROGRESS', '--progress', 'sixty', ...R);
    assert.equal(bad.code, 1, bad.all);
    assert.match(bad.all, /--progress must be a number/);
  } finally {
    s.cleanup();
  }
});

test('a no-op transition appended around the CLI is caught by pm check', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', ...R, '--json', task());
    assert.equal(s.pm('check').code, 0);
    const ev = s.js(`import { newEvent } from '${s.lib('state.mjs')}';
console.log(JSON.stringify(newEvent({ type: 'status_changed', entity: 'TASK-0001', actor: 'frontend-engineer', channel: 'cli', data: { from: 'READY', to: 'READY' }, reason: 'eval' })));`);
    s.write(LOG, s.read(LOG) + ev + '\n');
    const c = s.pm('check');
    assert.equal(c.code, 1);
    assert.match(c.all, /TASK-0001 is already READY/);
  } finally {
    s.cleanup();
  }
});

test('an unknown flag on a write is refused before anything is written', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', ...R, '--json', task());
    const before = s.read(LOG);
    const t = s.pm('transition', 'TASK-0001', 'IN_PROGRESS', ...R, '--dry-run');
    assert.equal(t.code, 1, t.all);
    assert.match(t.all, /unknown flag\(s\) for transition: --dry-run — nothing was written/);
    const c = s.pm('create', 'TASK', ...R, '--dry-run', '--json', task());
    assert.equal(c.code, 1, c.all);
    assert.match(c.all, /--dry-run/);
    assert.match(s.pm('note', 'TASK-0001', ...R, '--txt', 'typo').all, /unknown flag\(s\) for note: --txt/);
    assert.equal(s.read(LOG), before);
    assert.equal(JSON.parse(s.pm('show', 'TASK-0001').out).entity.status, 'READY');
  } finally {
    s.cleanup();
  }
});

test('reads refuse unknown flags too; documented flags still work', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', ...R, '--json', task());
    assert.match(s.pm('list', 'TASK', '--state', 'READY').all, /unknown flag\(s\) for list: --state/);
    assert.match(s.pm('list', 'TASK', '--status', 'READY').out, /TASK-0001\tREADY/);
    assert.match(s.pm('route', '--path', 'apps/api/src/x.ts').all, /did you mean --paths\?/);
    assert.match(s.pm('migrate-v1', '--dry-run').all, /records would be imported/);
  } finally {
    s.cleanup();
  }
});
