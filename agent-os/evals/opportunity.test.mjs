// Product Evolution evals: the approval boundary, the readiness gate,
// evidence quality, duplicate prevention, owner-only ranking.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PACK, sandbox, task } from './sandbox.mjs';

const OPP = (o = {}) =>
  JSON.stringify({ title: 'Declare official profiles in structured data', opportunity_type: 'SEO_OPPORTUNITY', status: 'DISCOVERY', proposed_by: 'technical-seo-specialist', responsible_manager: 'pm-07', user_facing: false, visual_impact: false, ...o });
const R = ['--reason', 'eval'];

function shaped(s, extra = {}) {
  assert.equal(s.pm('create', 'OPP', '--by', 'product-opportunity-lead', ...R, '--json', OPP(extra)).code, 0);
  s.write('project-management/opportunities/OPP-0001.md', `---\nid: OPP-0001\n---\n${PACK}`);
  s.pm('sync');
  for (const [to] of [['PRODUCT_SHAPING'], ['TECHNICAL_SHAPING'], ['EVIDENCE_REVIEW'], ['CROSS_FUNCTIONAL_REVIEW']])
    assert.equal(s.pm('transition', 'OPP-0001', to, '--by', 'product-opportunity-lead', ...R).code, 0);
}
const evidence = (s, stance, quality, type = 'TECHNICAL') =>
  s.pm('evidence', 'OPP-0001', '--by', 'technical-seo-specialist', '--type', type, '--stance', stance, '--quality', quality, '--claim', 'a verified claim', '--source', 'repo file:line');
const engineering = (s) =>
  s.pm('review', 'OPP-0001', '--by', 'embedded-product-engineer', '--independent', '--executor', 'subagent:independent-reviewer', '--type', 'ENGINEERING_SHAPING', '--result', 'PASS', '--findings', 'feasible, two files');
const score = (s, o = {}) => {
  const f = { user_value: 'MEDIUM', technical_effort: 'LOW', risk: 'LOW', recommendation: 'BUILD', evidence_strength: 'MIXED', ...o };
  return s.pm('set', 'OPP-0001', ...Object.entries(f).flatMap(([k, v]) => ['--field', `${k}=${v}`]), '--by', 'product-opportunity-lead', ...R);
};
const ready = (s) => s.pm('transition', 'OPP-0001', 'READY_FOR_OWNER_DECISION', '--by', 'product-opportunity-lead', ...R);
// Plays the owner: the key is created exactly as the owner-mode dashboard does.
const ownerDecide = (s, decision) =>
  s.js(`import {ensureOwnerKey} from '${s.lib('owner-key.mjs')}'; import {ownerEvents} from '${s.lib('owner.mjs')}'; import {commit} from '${s.lib('state.mjs')}'; import {writeGuards} from '${s.lib('rules.mjs')}';
    ensureOwnerKey(); commit(ownerEvents('decide','OPP-0001','${decision}',{reason:'owner eval'},'dashboard'), (b,a,e)=>writeGuards(b,a,e,{})); console.log('ok')`);

test('REV-0004 H1: forging an owner decision through the libraries is refused (no key, tampered proof, unguarded commit)', () => {
  const s = sandbox();
  try {
    shaped(s);
    const attempt = (code) => s.js(`import {ownerEvents} from '${s.lib('owner.mjs')}'; import {commit, newEvent} from '${s.lib('state.mjs')}'; import {writeGuards} from '${s.lib('rules.mjs')}';
      try { ${code}; console.log('accepted'); } catch (e) { console.log('refused'); }`);
    // No owner key on this machine: the events are unsigned.
    assert.equal(attempt(`commit(ownerEvents('decide','OPP-0001','APPROVE',{reason:'x'},'dashboard'), (b,a,e)=>writeGuards(b,a,e,{}))`), 'refused');
    // commit() without guards.
    assert.equal(attempt(`commit(ownerEvents('decide','OPP-0001','APPROVE',{reason:'x'},'dashboard'))`), 'refused');
    // A made-up proof, with or without a key present.
    const forged = `const ev = ownerEvents('decide','OPP-0001','REJECT',{reason:'x'},'dashboard'); ev[0].data.owner_proof = 'ab'.repeat(32); commit(ev, (b,a,e)=>writeGuards(b,a,e,{}))`;
    assert.equal(attempt(forged), 'refused');
    s.js(`import {ensureOwnerKey} from '${s.lib('owner-key.mjs')}'; ensureOwnerKey()`);
    assert.equal(attempt(forged), 'refused');
    assert.equal(JSON.parse(s.pm('show', 'OPP-0001').out).entity.status, 'CROSS_FUNCTIONAL_REVIEW');
  } finally {
    s.cleanup();
  }
});

test('REV-0005: an event that reaches the log by any route (raw append, no-op guard, non-owner channel) fails pm check on replay', () => {
  for (const forge of ['raw', 'noop', 'system-cli', 'owner-migration']) {
    const s = sandbox();
    try {
      shaped(s);
      assert.equal(s.pm('check').code, 0, s.pm('check').all);
      if (forge === 'raw') {
        const ev = { id: 'E20991231000000-abcdef', ts: '2099-12-31T00:00:00Z', type: 'opportunity_decided', actor: 'owner', channel: 'dashboard', entity: 'OPP-0001', data: { decision: 'APPROVE', reason: 'x' } };
        s.write('agent-os/state/events.jsonl', s.read('agent-os/state/events.jsonl') + JSON.stringify(ev) + '\n');
      } else {
        const actor = forge === 'system-cli' ? 'system' : forge === 'owner-migration' ? 'owner' : 'owner';
        const channel = forge === 'system-cli' ? 'cli' : forge === 'owner-migration' ? 'migration' : 'dashboard';
        s.js(`import {commit, newEvent} from '${s.lib('state.mjs')}';
          commit([newEvent({type:'opportunity_decided',entity:'OPP-0001',actor:'${actor}',channel:'${channel}',data:{decision:'APPROVE',reason:'x'}})], () => []);`);
      }
      const c = s.pm('check');
      assert.equal(c.code, 1, `${forge}: ${c.all}`);
      assert.match(c.all, /would be refused/, forge);
    } finally {
      s.cleanup();
    }
  }
});

test('REV-0005 H1: an approval plus its CR, with no proof, fails pm check on every channel and actor; so does a late v1_imported', () => {
  const CR = (actor, channel) =>
    `newEvent({type:'entity_created',entity:'CR-0001',actor:'${actor}',channel:'${channel}',data:{fields:{title:'x',status:'APPROVED',authority_level:3,risk:'LOW',responsible_manager:'pm-01',departments:['Product'],consensus_required:false,tasks:[],source_opportunity:'OPP-0001'}}})`;
  const DECIDE = (actor, channel) => `newEvent({type:'opportunity_decided',entity:'OPP-0001',actor:'${actor}',channel:'${channel}',data:{decision:'APPROVE',reason:'x',related_change_request:'CR-0001'}})`;
  const routes = {
    'system-cli': [CR('system', 'cli'), DECIDE('system', 'cli')],
    'pm-01-cli': [CR('pm-01', 'cli'), DECIDE('pm-01', 'cli')],
    'owner-migration': [CR('owner', 'migration'), DECIDE('owner', 'migration')],
    'owner-cli': [CR('owner', 'cli'), DECIDE('owner', 'cli')],
    'owner-dashboard-unsigned': [CR('owner', 'dashboard'), DECIDE('owner', 'dashboard')],
    // An agent CR that claims to come from the opportunity, without any decision event.
    'pm-01-cr-only': [CR('pm-01', 'cli')],
  };
  for (const [name, evs] of Object.entries(routes)) {
    const s = sandbox();
    try {
      shaped(s);
      s.js(`import {commit, newEvent} from '${s.lib('state.mjs')}'; commit([${evs.join(',')}], () => []);`);
      const c = s.pm('check');
      assert.equal(c.code, 1, `${name}: ${c.all}`);
      assert.match(c.all, /would be refused/, name);
    } finally {
      s.cleanup();
    }
  }
  // A v1_imported appended after the import: an APPROVED opportunity out of nowhere.
  const s = sandbox();
  try {
    shaped(s);
    const ev = { id: 'E20991231000000-abcdef', ts: '2099-12-31T00:00:00Z', type: 'v1_imported', actor: 'system', channel: 'migration', entity: 'OPP-0002', data: { fields: JSON.parse(OPP({ status: 'APPROVED', title: 'Forged approval out of nowhere' })), v1_file: 'x.md' } };
    s.write('agent-os/state/events.jsonl', s.read('agent-os/state/events.jsonl') + JSON.stringify(ev) + '\n');
    const c = s.pm('check');
    assert.equal(c.code, 1, c.all);
    assert.match(c.all, /v1_imported after the V1 import finished/);
  } finally {
    s.cleanup();
  }
});

test('REV-0004 M2: assumptions alone cannot be labelled MIXED', () => {
  const s = sandbox();
  try {
    shaped(s);
    engineering(s);
    evidence(s, 'SUPPORTS', 'ASSUMPTION');
    score(s, { evidence_strength: 'MIXED', recommendation: 'BUILD' });
    assert.match(ready(s).all, /MIXED evidence needs at least one supporting FACT\/OBSERVATION/);
  } finally {
    s.cleanup();
  }
});

test('an opportunity cannot be created already approved or ready', () => {
  const s = sandbox();
  try {
    for (const status of ['APPROVED', 'READY_FOR_OWNER_DECISION']) {
      const r = s.pm('create', 'OPP', '--by', 'product-opportunity-lead', ...R, '--json', OPP({ status }));
      assert.equal(r.code, 2, status);
    }
  } finally {
    s.cleanup();
  }
});

test('approval boundary: agents cannot approve, and cannot write an owner decision event', () => {
  const s = sandbox();
  try {
    shaped(s);
    assert.equal(s.pm('transition', 'OPP-0001', 'APPROVED', '--by', 'pm-07', ...R).code, 2);
    const forged = s.js(`import {ownerEvents} from '${s.lib('owner.mjs')}'; import {commit} from '${s.lib('state.mjs')}'; import {writeGuards} from '${s.lib('rules.mjs')}';
      const ev = ownerEvents('decide','OPP-0001','APPROVE',{reason:'x'},'cli');
      try { commit(ev,(b,a,e)=>writeGuards(b,a,e,{})); console.log('accepted'); } catch (e) { console.log('refused'); }`);
    assert.equal(forged, 'refused');
    const pm07 = s.js(`import {newEvent, commit} from '${s.lib('state.mjs')}'; import {writeGuards} from '${s.lib('rules.mjs')}';
      try { commit([newEvent({type:'opportunity_decided',entity:'OPP-0001',actor:'pm-07',channel:'dashboard',data:{decision:'APPROVE'}})],(b,a,e)=>writeGuards(b,a,e,{})); console.log('accepted'); } catch { console.log('refused'); }`);
    assert.equal(pm07, 'refused');
  } finally {
    s.cleanup();
  }
});

test('readiness gate: engineering shaping is required before the owner sees it', () => {
  const s = sandbox();
  try {
    shaped(s);
    evidence(s, 'SUPPORTS', 'FACT');
    evidence(s, 'SUPPORTS', 'OBSERVATION');
    score(s);
    const r = ready(s);
    assert.equal(r.code, 2);
    assert.match(r.all, /no engineering shaping review/);
    engineering(s);
    assert.equal(ready(s).code, 0, ready(s).all);
  } finally {
    s.cleanup();
  }
});

test('weak evidence cannot be presented as BUILD; competitor-only evidence cannot be MIXED', () => {
  const s = sandbox();
  try {
    shaped(s);
    engineering(s);
    evidence(s, 'SUPPORTS', 'OBSERVATION', 'COMPETITOR');
    score(s, { evidence_strength: 'WEAK', recommendation: 'BUILD' });
    assert.match(ready(s).all, /WEAK evidence cannot carry a BUILD/);
    score(s, { evidence_strength: 'MIXED', recommendation: 'BUILD' });
    assert.match(ready(s).all, /competitor behaviour alone/);
    score(s, { evidence_strength: 'WEAK', recommendation: 'RESEARCH' });
    assert.equal(ready(s).code, 0, ready(s).all);
  } finally {
    s.cleanup();
  }
});

test('user-facing needs UX shaping; visual changes need the art director', () => {
  const s = sandbox();
  try {
    shaped(s, { user_facing: true, visual_impact: true });
    engineering(s);
    evidence(s, 'SUPPORTS', 'FACT');
    evidence(s, 'SUPPORTS', 'FACT');
    score(s);
    const r = ready(s);
    assert.match(r.all, /no UX shaping review/);
    assert.match(r.all, /no art-director review/);
    s.pm('review', 'OPP-0001', '--by', 'product-ui-designer', '--independent', '--executor', 'subagent:independent-reviewer', '--type', 'UX', '--result', 'PASS', '--findings', 'ok');
    s.pm('review', 'OPP-0001', '--by', 'art-director', '--independent', '--executor', 'subagent:independent-reviewer', '--type', 'ART_DIRECTION', '--result', 'RECOMMENDATION', '--findings', 'ok');
    assert.equal(ready(s).code, 0, ready(s).all);
  } finally {
    s.cleanup();
  }
});

test('an incomplete development pack is refused', () => {
  const s = sandbox();
  try {
    shaped(s);
    s.write('project-management/opportunities/OPP-0001.md', s.read('project-management/opportunities/OPP-0001.md').replace('Benefit may be small.', 'TBD'));
    engineering(s);
    evidence(s, 'SUPPORTS', 'FACT');
    score(s);
    assert.match(ready(s).all, /"## Evidence Against" is empty/);
  } finally {
    s.cleanup();
  }
});

test('approval converts into the change workflow, and work needs that CR', () => {
  const s = sandbox();
  try {
    shaped(s);
    engineering(s);
    evidence(s, 'SUPPORTS', 'FACT');
    score(s);
    assert.equal(ready(s).code, 0);
    // Work on an unapproved opportunity is refused.
    const early = s.pm('create', 'TASK', '--by', 'frontend-engineer', ...R, '--json', task({ related_opportunity: 'OPP-0001' }));
    assert.equal(early.code, 2);
    assert.match(early.all, /not implementation authority/);
    assert.equal(ownerDecide(s, 'APPROVE'), 'ok');
    const o = JSON.parse(s.pm('show', 'OPP-0001').out);
    assert.equal(o.entity.status, 'APPROVED');
    const cr = JSON.parse(s.pm('show', o.entity.related_change_request).out).entity;
    assert.equal(cr.source_opportunity, 'OPP-0001');
    assert.equal(s.pm('create', 'TASK', '--by', 'frontend-engineer', ...R, '--json', task({ related_opportunity: 'OPP-0001', related_change_request: cr.id })).code, 0);
    assert.equal(o.decisions[0].actor, 'owner');
  } finally {
    s.cleanup();
  }
});

test('rejected opportunities stay as knowledge, with the decision and reason', () => {
  const s = sandbox();
  try {
    shaped(s);
    engineering(s);
    evidence(s, 'SUPPORTS', 'FACT');
    score(s);
    ready(s);
    assert.equal(ownerDecide(s, 'REJECT'), 'ok');
    const o = JSON.parse(s.pm('show', 'OPP-0001').out);
    assert.equal(o.entity.status, 'REJECTED');
    assert.equal(o.decisions[0].reason, 'owner eval');
    assert.ok(o.history.length >= 6);
  } finally {
    s.cleanup();
  }
});

test('duplicates: creation is refused until each similar item has a relation; DUPLICATE is refused', () => {
  const s = sandbox();
  try {
    s.pm('create', 'TASK', '--by', 'frontend-engineer', ...R, '--json', task({ title: 'Load Tajawal in the admin panel' }));
    const r = s.pm('create', 'OPP', '--by', 'product-opportunity-lead', ...R, '--json', OPP({ title: 'Load the Tajawal typeface in the admin panel' }));
    assert.equal(r.code, 3);
    assert.match(r.all, /TASK-0001/);
    assert.equal(s.pm('create', 'OPP', '--by', 'product-opportunity-lead', ...R, '--relation', 'TASK-0001:DUPLICATE', '--json', OPP({ title: 'Load the Tajawal typeface in the admin panel' })).code, 3);
    assert.equal(s.pm('list', 'OPP').out.trim(), '');
    assert.equal(s.pm('create', 'OPP', '--by', 'product-opportunity-lead', ...R, '--relation', 'TASK-0001:OVERLAPPING', '--json', OPP({ title: 'Load the Tajawal typeface in the admin panel' })).code, 0);
  } finally {
    s.cleanup();
  }
});

test('ranking is the owner\'s: an agent may suggest a review but cannot reorder', () => {
  const s = sandbox();
  try {
    shaped(s);
    const agentRank = s.js(`import {newEvent, commit} from '${s.lib('state.mjs')}'; import {writeGuards} from '${s.lib('rules.mjs')}';
      try { commit([newEvent({type:'ranking_set',entity:'ROADMAP',actor:'pm-07',channel:'cli',data:{order:['OPP-0001']}})],(b,a,e)=>writeGuards(b,a,e,{})); console.log('accepted'); } catch { console.log('refused'); }`);
    assert.equal(agentRank, 'refused');
    assert.equal(s.pm('suggest-priority-review', 'OPP-0001', '--by', 'pm-07', '--reason', 'new evidence').code, 0);
    const st = JSON.parse(s.js(`import {materialize, readEvents} from '${s.lib('state.mjs')}'; const m = materialize(readEvents()); console.log(JSON.stringify({order: m.ranking.order, suggestions: m.suggestions.length}))`));
    assert.deepEqual(st.order, []);
    assert.equal(st.suggestions, 1);
  } finally {
    s.cleanup();
  }
});
