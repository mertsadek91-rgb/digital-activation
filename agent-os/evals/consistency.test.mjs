// Dashboard state equals canonical state; hand edits are caught; the owner
// endpoints are closed unless the owner started the server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { join } from 'node:path';

import { REPO } from '../tools/lib/paths.mjs';
import { sandbox, task } from './sandbox.mjs';

const R = ['--reason', 'eval'];

test('V1 compatibility stays removed (M12, TASK-0083): no sync.mjs, no file_ownership; ownership comes from routing.json', () => {
  assert.equal(existsSync(join(REPO, 'project-management', 'tools', 'sync.mjs')), false);
  const config = JSON.parse(readFileSync(join(REPO, 'project-management', 'PROJECT_CONFIG.json'), 'utf8'));
  assert.equal('file_ownership' in config, false);
  // The dashboard's ownership map is projected from the routing domains, one row per domain.
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'frontend-engineer', ...R, '--json', task());
    const js = s.read('project-management/dashboard/data.js');
    const data = JSON.parse(js.slice(js.indexOf('{'), js.lastIndexOf('}') + 1));
    const domains = JSON.parse(s.read('agent-os/policies/routing.json')).domains;
    assert.deepEqual(data.ownership.map((o) => o.domain), domains.map((d) => d.id));
  } finally {
    s.cleanup();
  }
});

test('after any write, projections are current and pm check is clean', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'frontend-engineer', ...R, '--json', task());
    s.pm('transition', 'TASK-0001', 'IN_PROGRESS', '--stage', 'IMPLEMENTATION', '--progress', '40', '--by', 'frontend-engineer', ...R);
    const c = s.pm('check');
    assert.equal(c.code, 0, c.all);
    const idx = JSON.parse(s.read('project-management/TASK_INDEX.json')).tasks[0];
    assert.equal(idx.status, 'IN_PROGRESS');
    assert.equal(idx.file, 'tasks/active/TASK-0001.md');
    assert.match(s.read('project-management/tasks/active/TASK-0001.md'), /status: IN_PROGRESS/);
    const data = s.read('project-management/dashboard/data.js');
    assert.match(data, /"status":"IN_PROGRESS"/);
  } finally {
    s.cleanup();
  }
});

test('a hand-edited status in front matter is detected, not believed', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'frontend-engineer', ...R, '--json', task());
    const f = 'project-management/tasks/ready/TASK-0001.md';
    s.write(f, s.read(f).replace('status: READY', 'status: COMPLETED'));
    const c = s.pm('check');
    assert.equal(c.code, 1);
    assert.match(c.all, /front matter differs from canonical state \(status\)/);
    // The canonical status is untouched, and sync restores the projection.
    assert.equal(JSON.parse(s.pm('show', 'TASK-0001').out).entity.status, 'READY');
    s.pm('sync');
    assert.equal(s.pm('check').code, 0);
  } finally {
    s.cleanup();
  }
});

test('the served dashboard state equals canonical state, and owner endpoints are closed to a non-owner server', async () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'frontend-engineer', ...R, '--json', task());
    s.pm('transition', 'TASK-0001', 'BLOCKED', '--by', 'frontend-engineer', ...R);
    const port = 47000 + Math.floor(Math.random() * 1000);
    const env = { ...process.env, PM_ROOT: s.dir };
    const srv = spawn(process.execPath, [join(s.dir, 'agent-os', 'tools', 'server.mjs'), String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((res, rej) => {
      srv.stdout.on('data', (d) => /dashboard:/.test(d) && res());
      srv.on('exit', (c) => rej(new Error(`server exited ${c}`)));
      setTimeout(() => rej(new Error('server did not start')), 8000);
    });
    try {
      const st = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
      assert.equal(st.live, true);
      assert.equal(st.owner_mode, false);
      assert.equal(st.tasks[0].status, 'BLOCKED');
      assert.equal(st.state.blocked_tasks, 1);
      const r = await fetch(`http://127.0.0.1:${port}/api/owner/ranking`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"order":[]}' });
      assert.equal(r.status, 403);
      assert.equal((await fetch(`http://127.0.0.1:${port}/../agent-os/state/events.jsonl`)).status, 404);
    } finally {
      srv.kill();
    }
  } finally {
    s.cleanup();
  }
});
