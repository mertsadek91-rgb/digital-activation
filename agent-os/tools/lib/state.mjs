// Canonical operational state: agent-os/state/events.jsonl.
//
// One JSON event per line, append-only. Current state is the deterministic
// fold of the file in order (DEC-0012). Nothing else is authoritative:
// front matter, indexes and the dashboard are projections of `materialize()`.
//
// Writes go through `commit()`: build the would-be state in memory, run every
// write guard against it, and only then append. A rejected change writes
// nothing — the closest thing to a transaction a text file can give.

import crypto from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';

import { EVENTS, STATE_DIR, kindOf } from './paths.mjs';
import { schema, validate } from './schema.mjs';

export function readEvents(file = EVENTS) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line, i) => [line, i + 1])
    .filter(([line]) => line.trim())
    .map(([line, n]) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`events.jsonl line ${n} is not valid JSON`);
      }
    });
}

export function newEvent({ type, entity, actor, channel = 'cli', data = {}, reason = null, evidence = null, ts }) {
  const at = ts ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const compact = at.replace(/\D/g, '').slice(0, 14);
  const ev = { id: `E${compact}-${crypto.randomBytes(3).toString('hex')}`, ts: at, type, actor, channel, entity, data };
  if (reason) ev.reason = reason;
  if (evidence?.length) ev.evidence = evidence;
  return ev;
}

// Opportunity lifecycle. An agent moves an opportunity forward through
// shaping; only the owner's decision moves it out of READY_FOR_OWNER_DECISION.
export const OPP_AGENT_TRANSITIONS = {
  DETECTED: ['TRIAGED', 'DISCOVERY'],
  TRIAGED: ['DISCOVERY'],
  DISCOVERY: ['PRODUCT_SHAPING'],
  PRODUCT_SHAPING: ['DESIGN_SHAPING', 'TECHNICAL_SHAPING', 'DISCOVERY'],
  DESIGN_SHAPING: ['TECHNICAL_SHAPING', 'PRODUCT_SHAPING', 'DISCOVERY'],
  TECHNICAL_SHAPING: ['EVIDENCE_REVIEW', 'DESIGN_SHAPING', 'DISCOVERY'],
  EVIDENCE_REVIEW: ['CROSS_FUNCTIONAL_REVIEW', 'TECHNICAL_SHAPING', 'DISCOVERY'],
  CROSS_FUNCTIONAL_REVIEW: ['READY_FOR_OWNER_DECISION', 'EVIDENCE_REVIEW', 'DISCOVERY'],
  READY_FOR_OWNER_DECISION: ['DISCOVERY'],
  APPROVED: ['DELIVERED'],
};
export const OWNER_DECISION_STATUS = {
  APPROVE: 'APPROVED',
  APPROVE_AND_PRIORITIZE: 'APPROVED',
  RESEARCH_MORE: 'DISCOVERY',
  DEFER: 'DEFERRED',
  REJECT: 'REJECTED',
  WATCH: 'WATCH',
  MERGE: 'MERGED',
};

const clone = (o) => JSON.parse(JSON.stringify(o));

export function materialize(events) {
  const s = {
    entities: new Map(),
    history: new Map(),
    reviews: [],
    // Reviews struck by a review_invalidated event (TASK-0092). They stay
    // visible here and in the history, but nothing that counts reviews sees them.
    invalidated_reviews: [],
    evidence: new Map(),
    links: [],
    ranking: { order: [], at: null, by: null },
    ranking_history: [],
    portfolio: { preferences: null, at: null },
    suggestions: [],
    attempts: new Map(),
    accepted_risks: [],
    decisions: [],
    events,
    errors: [],
  };
  const hist = (id, ev, summary) => {
    if (!s.history.has(id)) s.history.set(id, []);
    s.history.get(id).push({ ts: ev.ts, type: ev.type, actor: ev.actor, channel: ev.channel, reason: ev.reason ?? null, summary, event: ev.id });
  };
  for (const ev of events) {
    const d = ev.data ?? {};
    const cur = s.entities.get(ev.entity);
    switch (ev.type) {
      case 'v1_imported':
      case 'entity_created':
        if (cur) s.errors.push(`${ev.id}: ${ev.entity} created twice`);
        s.entities.set(ev.entity, { ...clone(d.fields ?? {}), id: ev.entity });
        hist(ev.entity, ev, ev.type === 'v1_imported' ? 'imported from V1' : 'created');
        break;
      case 'entity_updated':
        if (!cur) s.errors.push(`${ev.id}: update of unknown ${ev.entity}`);
        else Object.assign(cur, clone(d.fields ?? {}));
        hist(ev.entity, ev, `updated ${Object.keys(d.fields ?? {}).join(', ')}`);
        break;
      case 'status_changed':
        if (!cur) s.errors.push(`${ev.id}: status change of unknown ${ev.entity}`);
        else {
          cur.status = d.to;
          if (d.stage !== undefined) cur.stage = d.stage;
          if (d.progress !== undefined) cur.progress = d.progress;
          if (d.updated_at) cur.updated_at = d.updated_at;
        }
        hist(ev.entity, ev, `${d.from} → ${d.to}`);
        break;
      case 'review_recorded':
        s.reviews.push({ ...clone(d), target: ev.entity, ts: ev.ts, actor: ev.actor, event: ev.id });
        hist(ev.entity, ev, `${d.review_type} review by ${d.reviewer}: ${d.result}`);
        break;
      case 'review_invalidated': {
        // Append-only: the original review_recorded line is never edited. The
        // review moves out of `reviews`, so completion, blocking, governor
        // rounds, readiness and every projection ignore it from here on.
        const i = s.reviews.findIndex((r) => r.review_id === d.review_id);
        if (i < 0) {
          const gone = s.invalidated_reviews.some((r) => r.review_id === d.review_id);
          s.errors.push(`${ev.id}: ${d.review_id} ${gone ? 'is already invalidated' : 'is not a recorded review'}`);
        } else if (s.reviews[i].target !== ev.entity) s.errors.push(`${ev.id}: ${d.review_id} is a review of ${s.reviews[i].target}, not ${ev.entity}`);
        else {
          const [r] = s.reviews.splice(i, 1);
          r.invalidated = { by: ev.actor, ts: ev.ts, reason: ev.reason ?? null, event: ev.id };
          s.invalidated_reviews.push(r);
        }
        hist(ev.entity, ev, `review ${d.review_id} invalidated by ${ev.actor}`);
        break;
      }
      case 'evidence_added':
        if (!s.evidence.has(ev.entity)) s.evidence.set(ev.entity, []);
        s.evidence.get(ev.entity).push({ ...clone(d), ts: ev.ts, actor: ev.actor });
        hist(ev.entity, ev, `evidence ${d.evidence_id} (${d.stance}, ${d.quality})`);
        break;
      case 'link_added':
        s.links.push({ from: ev.entity, to: d.target, relation: d.relation, ts: ev.ts, actor: ev.actor });
        hist(ev.entity, ev, `${d.relation} → ${d.target}`);
        break;
      case 'opportunity_decided': {
        if (!cur) {
          s.errors.push(`${ev.id}: decision on unknown ${ev.entity}`);
          break;
        }
        const from = cur.status;
        cur.status = OWNER_DECISION_STATUS[d.decision] ?? cur.status;
        cur.decision = d.decision;
        cur.decision_reason = d.reason ?? ev.reason ?? null;
        cur.decided_at = ev.ts.slice(0, 10);
        for (const k of ['suggested_priority', 'target_milestone', 'revisit_when', 'related_change_request', 'merged_into'])
          if (d[k] !== undefined) cur[k] = d[k];
        s.decisions.push({ opportunity: ev.entity, decision: d.decision, from, to: cur.status, reason: cur.decision_reason, ts: ev.ts, actor: ev.actor, questions: d.questions ?? null, invalidated_if: d.invalidated_if ?? null });
        hist(ev.entity, ev, `owner decision ${d.decision} (${from} → ${cur.status})`);
        break;
      }
      case 'ranking_set':
        s.ranking = { order: [...(d.order ?? [])], at: ev.ts, by: ev.actor };
        s.ranking_history.push(s.ranking);
        break;
      case 'portfolio_preferences_set':
        s.portfolio = { preferences: clone(d.preferences ?? {}), at: ev.ts };
        break;
      case 'priority_review_suggested':
        s.suggestions.push({ entity: ev.entity, reason: ev.reason, ts: ev.ts, actor: ev.actor, data: clone(d) });
        hist(ev.entity, ev, 'priority review suggested');
        break;
      case 'attempt_failed':
        s.attempts.set(ev.entity, (s.attempts.get(ev.entity) ?? 0) + 1);
        hist(ev.entity, ev, 'implementation attempt failed');
        break;
      case 'risk_accepted':
        s.accepted_risks.push({ entity: ev.entity, ...clone(d), ts: ev.ts, actor: ev.actor });
        hist(ev.entity, ev, 'risk accepted');
        break;
      case 'note':
        hist(ev.entity, ev, d.text ?? 'note');
        break;
      default:
        s.errors.push(`${ev.id}: unknown event type ${ev.type}`);
    }
  }
  return s;
}

export function entitiesOf(state, prefix) {
  return [...state.entities.values()].filter((e) => e.id.startsWith(prefix + '-')).sort((a, b) => a.id.localeCompare(b.id));
}

export function nextId(state, prefix) {
  let max = 0;
  for (const id of state.entities.keys())
    if (id.startsWith(prefix + '-')) max = Math.max(max, Number(id.split('-')[1]));
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

/** Every review ever recorded, invalidated or not — for id allocation. */
export const allReviews = (state) => [...state.reviews, ...state.invalidated_reviews];

export function nextSubId(items, key, prefix) {
  let max = 0;
  for (const i of items) if (i[key]?.startsWith(prefix + '-')) max = Math.max(max, Number(i[key].split('-')[1]));
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

export function eventErrors(ev) {
  const errs = validate(ev, schema('event')).map((e) => `event ${ev.type} ${ev.entity}: ${e}`);
  if (ev.type === 'review_recorded') errs.push(...validate(ev.data, schema('review')).map((e) => `review: ${e}`));
  if (ev.type === 'review_invalidated' && !/^REV-\d{4}$/.test(ev.data?.review_id ?? '')) errs.push(`review_invalidated ${ev.entity}: data.review_id must be a REV-NNNN id`);
  if (ev.type === 'evidence_added') errs.push(...validate(ev.data, schema('evidence')).map((e) => `evidence: ${e}`));
  return errs;
}

export function entityErrors(entity) {
  const k = kindOf(entity.id);
  if (!k) return [`${entity.id}: unknown id prefix`];
  return validate(entity, schema(k.schema)).map((e) => `${entity.id}: ${e}`);
}

function withLock(fn) {
  mkdirSync(STATE_DIR, { recursive: true });
  const lock = EVENTS + '.lock';
  let fd = null;
  for (let i = 0; i < 50 && fd === null; i++) {
    try {
      fd = openSync(lock, 'wx');
    } catch {
      const until = Date.now() + 100;
      while (Date.now() < until) {
        /* spin: a CLI write holds the lock for milliseconds */
      }
    }
  }
  if (fd === null) throw new Error(`events.jsonl is locked (${lock}); remove it if no pm command is running`);
  try {
    return fn();
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

/**
 * Append events atomically after `guard(before, after, events)` approves the
 * resulting state. Returns the new state. Throws with every reason on refusal.
 */
export function commit(newEvents, guard, { migration = false } = {}) {
  // No unguarded writes (REV-0004 H1). The single exception is the one-time V1
  // import, which may only write v1_imported events on the migration channel.
  if (typeof guard !== 'function') {
    if (!migration || !newEvents.every((e) => e.type === 'v1_imported' && e.channel === 'migration'))
      throw new Error('refused:\n  - commit() requires write guards; only the V1 import may commit unguarded, and only v1_imported migration events');
  }
  if (migration && readEvents().some((e) => e.type === 'v1_imported'))
    throw new Error('refused:\n  - V1 has already been imported; the log is append-only');
  return withLock(() => {
    const current = readEvents();
    const errs = newEvents.flatMap(eventErrors);
    const before = materialize(current);
    const after = materialize([...current, ...newEvents]);
    errs.push(...after.errors.slice(before.errors.length));
    if (!errs.length && guard) errs.push(...guard(before, after, newEvents));
    if (errs.length) {
      const e = new Error(`refused:\n  - ${errs.join('\n  - ')}`);
      e.refusals = errs;
      throw e;
    }
    appendFileSync(EVENTS, newEvents.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return after;
  });
}
