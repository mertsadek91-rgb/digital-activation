// Governance rules over canonical state.
//
//   writeGuards()    — refuse a commit whose resulting state breaks a hard rule
//   checkProblems()  — everything `pm check` reports (V1 rules + V2 rules)
//   attention()      — what needs the human owner, and why
//   health()         — the V1 health rule, scoped to the new application
//
// The V1 rules (authority ceiling, L4 second manager, L5 consensus, completion,
// dependencies, file collisions) are ported unchanged from the V1 generator
// (archived at project-management/tools/archive/sync-v1.mjs.txt); an eval
// asserts they still fire.

import { verify as verifyOwnerProof } from './owner-key.mjs';
import { entityErrors, entitiesOf, materialize, OPP_AGENT_TRANSITIONS } from './state.mjs';
import { matchesAny } from './glob.mjs';
import { decisionRights, governor, OWNER, OWNER_CHANNELS, people, permissions, routing } from './policy.mjs';

export const TERMINAL = new Set(['COMPLETED', 'CANCELLED']);
export const REVIEW = new Set(['MANAGER_REVIEW', 'CROSS_MANAGER_REVIEW']);
export const QA_STATES = new Set(['QA', 'SECURITY_REVIEW', 'REGRESSION_TESTING']);
export const OPEN_ISSUE = (s) => !['FIXED', 'VERIFIED', 'CLOSED', 'WONT_FIX', 'DUPLICATE'].includes(s);
export const LEGACY_SYSTEMS = new Set(['LEGACY_WORDPRESS', 'MIGRATION']);
const STAGES = ['ANALYSIS', 'RESEARCH', 'IMPACT_REVIEW', 'APPROVAL', 'IMPLEMENTATION', 'TECHNICAL_REVIEW', 'UX_UI_REVIEW', 'MANAGER_REVIEW', 'QA', 'SECURITY_REVIEW', 'REGRESSION', 'RELEASE_REVIEW', 'COMPLETED'];
const PASSING = new Set(['PASS', 'RECOMMENDATION', 'CONCERN', 'ACCEPTED_RISK']);
const BLOCKING = new Set(['VETO', 'BLOCKING_OBJECTION']);
const EXPLORATORY = new Set(['RESEARCH', 'VALIDATE_WITH_USERS', 'WATCH', 'EXPERIMENT', 'PROTOTYPE', 'DO_NOT_BUILD']);
// TASK-0092 IN_PROGRESS → IN_PROGRESS twice on 2026-10-02 (branch claude/next-batch).
const PRE_RULE_NOOP_TRANSITIONS = new Set(['E20261002070015-10d006', 'E20261002070028-aaad98']);
export const PACK_SECTIONS = ['Problem', 'Evidence Against', 'Alternatives', 'Why Now', 'Why Not Now', 'Cost of Doing Nothing', 'Technical Feasibility', 'Risks', 'Success Criteria', 'Validation Plan', 'Recommendation'];

export const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const isOwner = (who) => who === OWNER || who === 'user';

// ------------------------------------------------------------------ helpers

export function decisionClassOf(entity) {
  if (entity.decision_class) return entity.decision_class;
  if (entity.id.startsWith('OPP-')) return 'opportunity_approval';
  const files = list(entity.affected_files);
  let best = null;
  for (const d of routing().domains)
    if (files.some((f) => matchesAny(f, d.paths)) && (!best || d.min_level > best.min_level)) best = d;
  return best?.decision_class ?? 'architecture';
}

export function levelFloor(entity) {
  let best = null;
  for (const f of list(entity.affected_files)) {
    const d = routing().domains.find((x) => matchesAny(f, x.paths));
    if (d && (!best || d.min_level > best.level)) best = { level: d.min_level, domain: d.id, file: f };
  }
  return best;
}

export const reviewsOf = (state, id) => state.reviews.filter((r) => r.target === id);

function openBlocking(state, id) {
  // A blocking review stays open until the same reviewer records a later
  // non-blocking result, or the owner accepts the risk.
  const byReviewer = new Map();
  for (const r of reviewsOf(state, id)) byReviewer.set(r.reviewer, r);
  const accepted = state.accepted_risks.some((a) => a.entity === id);
  return accepted ? [] : [...byReviewer.values()].filter((r) => BLOCKING.has(r.result));
}

function tokens(s) {
  const STOP = new Set('a an the of for to in on and or with without by from into is are be our we it its this that as at'.split(' '));
  return new Set(
    String(s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9؀-ۿ ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, '')),
  );
}
export function similarity(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
}

/** Existing items an opportunity might duplicate, most similar first. */
export function duplicateCandidates(state, text, selfId = null) {
  const th = governor().duplicate_similarity_threshold;
  const pool = [...state.entities.values()].filter((e) => e.id !== selfId && /^(OPP|SIG|TASK|CR|EPIC)-/.test(e.id));
  return pool
    .map((e) => ({ id: e.id, title: e.title, status: e.status, score: similarity(text, `${e.title}`) }))
    .filter((c) => c.score >= th)
    .sort((a, b) => b.score - a.score);
}

const linked = (state, a, b) => state.links.some((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a));

// ------------------------------------------------------------ write guards

/** A CR that records an opportunity's approval (source_opportunity) is owner-class state. */
function approvalArtifact(ev) {
  if (!String(ev.entity).startsWith('CR-')) return false;
  const f = ev.data?.fields ?? {};
  return (ev.type === 'entity_created' || ev.type === 'entity_updated') && f.source_opportunity != null;
}

export function writeGuards(before, after, events, ctx = {}) {
  const errs = [];
  const P = people();
  const dr = decisionRights();
  const touched = new Set(events.map((e) => e.entity));

  for (const ev of events) {
    // Owner-only actions: only the owner, only through an owner channel.
    const ownerOnly = dr.owner_only_events.includes(ev.type);
    if (ownerOnly && !(isOwner(ev.actor) && OWNER_CHANNELS.has(ev.channel)))
      errs.push(`${ev.type} is an owner decision; it can only come from the owner through the dashboard or the interactive owner CLI (got actor "${ev.actor}" via ${ev.channel})`);
    if (isOwner(ev.actor) && !OWNER_CHANNELS.has(ev.channel) && ev.channel !== 'migration')
      errs.push(`actor "owner" is reserved for owner channels; an agent may not write as the owner (channel ${ev.channel})`);
    // Owner channel ⇒ owner proof, verified against the key only the owner's paths create (REV-0004 H1).
    if (ev.channel === 'migration' && !(ev.type === 'v1_imported' && ev.actor === 'system'))
      errs.push('the migration channel carries only the V1 import (v1_imported by system)');
    // An owner-class event needs a proof on EVERY channel, not only the owner
    // channels (REV-0005 H1: system/pm-01 on cli, owner on migration). The V1
    // import is the one exception, and replay confines it to the log's prefix.
    const artifact = approvalArtifact(ev);
    const ownerClass = ev.type !== 'v1_imported' && (ownerOnly || isOwner(ev.actor) || artifact);
    if (artifact && !(isOwner(ev.actor) && OWNER_CHANNELS.has(ev.channel)))
      errs.push(`${ev.entity}: a change request created from an opportunity (source_opportunity) is the owner's approval; only the owner's decision creates it (got actor "${ev.actor}" via ${ev.channel})`);
    if (ownerClass) {
      const v = verifyOwnerProof(ev);
      // Replay in CI has no owner key: presence is checked there, validity wherever the key exists.
      if (v !== 'valid' && !(ctx.replay && v === 'unverifiable')) errs.push(`owner event ${ev.type} ${ev.entity} has ${v === 'unverifiable' ? 'a proof but no owner key on this machine to verify it' : v === 'missing' ? 'no owner proof' : 'an invalid owner proof'} — owner decisions are recorded only through the owner's dashboard or \`pm owner\``);
    }
    if (!isOwner(ev.actor) && ev.channel !== 'migration' && !P[ev.actor] && ev.actor !== 'system')
      errs.push(`actor "${ev.actor}" is not a role in PERMISSIONS.json`);
    if (ev.actor === 'system' && ev.channel !== 'migration') errs.push('actor "system" is reserved for the V1 migration');

    const b = before.entities.get(ev.entity);
    const a = after.entities.get(ev.entity);

    if (ev.type === 'entity_created' && b) errs.push(`${ev.entity} already exists`);

    // A transition must change something (TASK-0098). The log is append-only,
    // so the no-ops written before this rule existed stay and are exempt.
    if (ev.type === 'status_changed' && b && ev.data.to === b.status && !PRE_RULE_NOOP_TRANSITIONS.has(ev.id)) {
      const changes = ['stage', 'progress'].filter((k) => ev.data[k] !== undefined && ev.data[k] !== b[k]);
      if (!changes.length)
        errs.push(`${ev.entity} is already ${b.status}${['stage', 'progress'].some((k) => ev.data[k] !== undefined) ? ' with that stage and progress' : ''} — a transition to the same status must change --stage or --progress; use \`pm note\` to record something without a state change`);
    }

    if (ev.type === 'status_changed' && a?.id.startsWith('OPP-')) {
      const allowed = OPP_AGENT_TRANSITIONS[ev.data.from] ?? [];
      if (!allowed.includes(ev.data.to))
        errs.push(`${ev.entity}: ${ev.data.from} → ${ev.data.to} is not an agent transition. Leaving READY_FOR_OWNER_DECISION (approve, defer, reject, watch, merge) is the owner's decision.`);
      // On replay the pack body has legitimately moved on since; the structured gate still applies.
      if (ev.data.to === 'READY_FOR_OWNER_DECISION') errs.push(...readyGuards(after, a, ctx.replay ? {} : ctx));
    }
    if (ev.type === 'entity_created' && a?.id.startsWith('OPP-') && !['DETECTED', 'TRIAGED', 'DISCOVERY'].includes(a.status))
      errs.push(`${a.id}: a new opportunity starts at DETECTED, TRIAGED or DISCOVERY, not ${a.status}`);
    if (ev.type === 'entity_updated' && a?.id.startsWith('OPP-') && 'status' in (ev.data.fields ?? {}))
      errs.push(`${a.id}: change status with a transition, not an update`);
    if (ev.type === 'entity_updated' && a?.id.startsWith('OPP-') && ['decision', 'decided_at', 'decision_reason'].some((k) => k in (ev.data.fields ?? {})))
      errs.push(`${a.id}: decision fields are written only by an owner decision`);

    if (ev.type === 'status_changed' && a?.id.startsWith('TASK-')) errs.push(...taskTransitionGuards(after, a));

    if (ev.type === 'review_recorded') {
      const target = after.entities.get(ev.entity);
      if (!target) errs.push(`review of unknown ${ev.entity}`);
      else {
        // Independent means a fresh context: a subagent, never the main session.
        if (ev.data.independent && !/^subagent:/.test(ev.data.executor ?? ''))
          errs.push(`${ev.entity}: an --independent review must name its fresh-context executor (--executor subagent:<name>); "${ev.data.executor ?? 'none'}" is not independent`);
        if (ev.data.independent && ev.data.reviewer === target.primary_agent)
          errs.push(`${ev.entity}: the primary agent (${target.primary_agent}) cannot be its own independent reviewer`);
        if (BLOCKING.has(ev.data.result)) {
          const cls = decisionClassOf(target);
          const vetoes = dr.classes[cls]?.veto ?? [];
          if (!vetoes.includes(ev.data.reviewer) && !(isOwner(ev.data.reviewer) && vetoes.includes('user')))
            errs.push(`${ev.data.reviewer} has no ${ev.data.result} right on ${cls} decisions (allowed: ${vetoes.join(', ')}). Record an OBJECTION instead.`);
        }
      }
    }

    if (ev.type === 'review_invalidated') {
      const r = before.reviews.find((x) => x.review_id === ev.data.review_id);
      if (r && r.target === ev.entity) errs.push(...invalidationRefusals(before, r, ev));
      // Unknown, already-invalidated or mismatched ids are refused by materialize().
    }

    if (ev.type === 'opportunity_decided' && ['APPROVE', 'APPROVE_AND_PRIORITIZE'].includes(ev.data.decision)) {
      const cr = ev.data.related_change_request && after.entities.get(ev.data.related_change_request);
      if (!cr || cr.source_opportunity !== ev.entity)
        errs.push(`${ev.entity}: approval must create or link a change request whose source_opportunity is ${ev.entity}`);
    }
    if (ev.type === 'ranking_set')
      for (const id of list(ev.data.order)) if (!after.entities.get(id)?.id.startsWith('OPP-')) errs.push(`ranking: ${id} is not an opportunity`);
  }

  for (const id of touched) {
    const a = after.entities.get(id);
    if (!a) continue;
    errs.push(...entityErrors(a));
    if (id.startsWith('TASK-')) {
      if (a.primary_agent && !P[a.primary_agent]) errs.push(`${id}: primary_agent "${a.primary_agent}" is not a role`);
      const owner = P[a.primary_agent];
      if (owner && a.authority_level > owner.max_authority)
        errs.push(`${id}: authority ${a.authority_level} exceeds ${a.primary_agent}'s ceiling of ${owner.max_authority}`);
      if (a.related_opportunity) {
        const opp = after.entities.get(a.related_opportunity);
        const cr = a.related_change_request && after.entities.get(a.related_change_request);
        if (!opp || opp.status !== 'APPROVED' || !cr || cr.source_opportunity !== opp.id)
          errs.push(`${id}: work for ${a.related_opportunity} needs the owner's approval and a change request created from it; an opportunity is not implementation authority`);
      }
    }
  }
  return errs;
}

/**
 * Who may strike a review (TASK-0092). Judged against the state at the time of
 * the event, so replay applies the same authority the CLI did.
 *   - never an owner record: an agent cannot unsay the owner;
 *   - VETO / BLOCKING_OBJECTION only by the reviewer who recorded it — anyone
 *     else lifts a block through a later review or the owner's accept-risk;
 *   - any other non-PASS result (OBJECTION, CONCERN, RECOMMENDATION…) only by
 *     the reviewer or exec-director: dissent must be answered, and the manager
 *     who answers for the task cannot erase it or reset the round count;
 *   - a PASS: the original reviewer, exec-director, the target's responsible
 *     manager, the reviewer's own manager (reports_to), or a manager in the
 *     decision class's owner/escalation chain (decision-rights.json);
 *   - never the target's primary agent striking someone else's review of its work.
 */
export function reviewInvalidators(state, r) {
  const managers = permissions().managers;
  const P = people();
  const target = state.entities.get(r.target) ?? { id: r.target };
  const cls = classRights(target);
  const chain = [cls?.owner, ...(cls?.escalation ?? [])];
  const out = new Set([r.reviewer, 'exec-director']);
  if (r.result !== 'PASS') return out;
  for (const m of [target.responsible_manager, P[r.reviewer]?.reports_to, ...chain]) if (m && managers[m]) out.add(m);
  return out;
}
const classRights = (target) => decisionRights().classes[decisionClassOf(target)] ?? null;

function invalidationRefusals(state, r, ev) {
  const errs = [];
  const target = state.entities.get(r.target);
  if (!ev.reason || !String(ev.reason).trim()) errs.push(`${r.review_id}: an invalidation needs a --reason`);
  if (isOwner(r.reviewer) || isOwner(r.actor)) errs.push(`${r.review_id} is the owner's record; an agent cannot invalidate it`);
  else if (BLOCKING.has(r.result) && ev.actor !== r.reviewer)
    errs.push(`${r.review_id} is a ${r.result} by ${r.reviewer}; only ${r.reviewer} can withdraw it (or the owner accepts the risk)`);
  else if (target?.primary_agent === ev.actor && ev.actor !== r.reviewer)
    errs.push(`${r.review_id}: ${ev.actor} is the primary agent of ${r.target} and cannot invalidate another reviewer's review of its own work`);
  else if (!reviewInvalidators(state, r).has(ev.actor))
    errs.push(`${ev.actor} may not invalidate ${r.review_id} (allowed: ${[...reviewInvalidators(state, r)].join(', ')})`);
  return errs;
}

function taskTransitionGuards(state, t) {
  const errs = [];
  const g = governor();
  if (t.status === 'COMPLETED') {
    if (t.progress !== 100) errs.push(`${t.id}: COMPLETED requires progress 100`);
    for (const d of list(t.dependencies)) {
      const dep = state.entities.get(d);
      if (dep && !TERMINAL.has(dep.status)) errs.push(`${t.id}: dependency ${d} is still ${dep.status}`);
    }
    if (t.authority_level >= g.independent_review_required_from_level) {
      const ok = reviewsOf(state, t.id).some((r) => r.independent && r.reviewer !== t.primary_agent && PASSING.has(r.result));
      if (!ok) errs.push(`${t.id}: level ${t.authority_level} work needs a passing independent review (pm review ${t.id} --independent …) before COMPLETED`);
    }
    const blocking = openBlocking(state, t.id);
    if (blocking.length) errs.push(`${t.id}: open ${blocking.map((r) => `${r.result} by ${r.reviewer}`).join(', ')}`);
  }
  if (['READY_FOR_RELEASE'].includes(t.status)) {
    const blocking = openBlocking(state, t.id);
    if (blocking.length) errs.push(`${t.id}: cannot be released with an open ${blocking[0].result}`);
  }
  if (t.authority_level === 5 && STAGES.indexOf(t.stage) > STAGES.indexOf('APPROVAL') && !t.related_consensus && t.status !== 'CANCELLED')
    errs.push(`${t.id}: level 5 work past APPROVAL needs a related_consensus record`);
  return errs;
}

/** What an opportunity must have before it is put in front of the owner. */
export function readyGuards(state, o, ctx = {}) {
  const errs = [];
  const rv = reviewsOf(state, o.id);
  const has = (types, roles) => rv.some((r) => types.includes(r.review_type) && (!roles || roles.includes(r.reviewer)) && r.independent);
  if (!has(['ENGINEERING_SHAPING'], ['embedded-product-engineer']))
    errs.push(`${o.id}: no engineering shaping review from embedded-product-engineer — engineering participates before approval`);
  if (o.user_facing && !has(['UX'], ['product-ui-designer', 'ux-architect', 'ux-researcher']))
    errs.push(`${o.id}: user-facing opportunity has no UX shaping review`);
  if (o.visual_impact && !has(['ART_DIRECTION'], ['art-director']))
    errs.push(`${o.id}: changes visual expression but has no art-director review`);
  const ev = state.evidence.get(o.id) ?? [];
  const sup = ev.filter((e) => e.stance === 'SUPPORTS');
  if (!sup.length) errs.push(`${o.id}: no supporting evidence recorded`);
  if (!o.evidence_strength) errs.push(`${o.id}: evidence_strength not set`);
  const factual = sup.filter((e) => ['FACT', 'OBSERVATION'].includes(e.quality));
  if (o.evidence_strength === 'STRONG' && factual.length < 2)
    errs.push(`${o.id}: STRONG evidence needs at least two supporting FACT/OBSERVATION items (has ${factual.length})`);
  if (o.evidence_strength === 'MIXED' && factual.length < 1)
    errs.push(`${o.id}: MIXED evidence needs at least one supporting FACT/OBSERVATION; assumptions and hypotheses alone are WEAK at best`);
  if (['STRONG', 'MIXED'].includes(o.evidence_strength) && sup.length && sup.every((e) => e.evidence_type === 'COMPETITOR'))
    errs.push(`${o.id}: competitor behaviour alone is evidence of the market, not of our users; strength cannot exceed WEAK`);
  if (['WEAK', 'INSUFFICIENT'].includes(o.evidence_strength) && !EXPLORATORY.has(o.recommendation))
    errs.push(`${o.id}: ${o.evidence_strength} evidence cannot carry a ${o.recommendation} recommendation; recommend RESEARCH, VALIDATE_WITH_USERS, EXPERIMENT, PROTOTYPE, WATCH or DO_NOT_BUILD`);
  for (const k of ['recommendation', 'technical_effort', 'user_value', 'risk'])
    if (!o[k]) errs.push(`${o.id}: ${k} not set`);
  const body = ctx.bodies?.[o.id];
  if (body !== undefined) errs.push(...packGaps(o.id, body));
  return errs;
}

export function packGaps(id, body) {
  const errs = [];
  for (const sec of PACK_SECTIONS) {
    const m = new RegExp(`^#{2,3}\\s+${sec.replace(/ /g, '\\s+')}\\s*$([\\s\\S]*?)(?=^#{2,3}\\s|$(?![\\s\\S]))`, 'mi').exec(body);
    const content = m?.[1]?.replace(/<!--[\s\S]*?-->/g, '').trim() ?? '';
    if (!m) errs.push(`${id}: development pack is missing "## ${sec}"`);
    else if (!content || /^(tbd|todo|n\/a|—|-)$/i.test(content)) errs.push(`${id}: "## ${sec}" is empty`);
  }
  return errs;
}

// ------------------------------------------------------------ check problems

export function checkProblems(state, ctx = {}) {
  const problems = [];
  const P = people();
  const managers = permissions().managers;
  const g = governor();
  const p = (where, msg) => problems.push(`${where}: ${msg}`);
  for (const e of state.errors) problems.push(`state: ${e}`);
  for (const ent of state.entities.values()) for (const e of entityErrors(ent)) problems.push(e);

  const tasks = entitiesOf(state, 'TASK');
  const byId = state.entities;
  for (const t of tasks) {
    const w = t.id;
    if (!P[t.primary_agent]) p(w, `primary_agent "${t.primary_agent}" is not a role in PERMISSIONS.json`);
    if (!managers[t.responsible_manager]) p(w, `responsible_manager "${t.responsible_manager}" is not a manager`);
    for (const r of [...list(t.supporting_agents), ...list(t.required_reviewers)]) if (!P[r]) p(w, `"${r}" is not a role in PERMISSIONS.json`);
    for (const d of [...list(t.dependencies), ...list(t.blocks)]) if (!byId.has(d)) p(w, `references unknown item ${d}`);
    const owner = P[t.primary_agent];
    if (owner && t.authority_level > owner.max_authority) p(w, `authority ${t.authority_level} exceeds ${t.primary_agent}'s ceiling of ${owner.max_authority}`);
    const pastApproval = STAGES.indexOf(t.stage) > STAGES.indexOf('APPROVAL');
    if (t.authority_level === 5 && pastApproval && !t.related_consensus && t.status !== 'CANCELLED') p(w, 'level 5 task is past APPROVAL without related_consensus');
    if (t.authority_level >= 4) {
      const mgr = list(t.required_reviewers).filter((r) => managers[r]);
      if (new Set([t.responsible_manager, ...mgr]).size < 2) p(w, 'level 4+ task needs a second manager in required_reviewers');
    }
    if (t.status === 'COMPLETED' && t.progress !== 100) p(w, 'COMPLETED but progress is not 100');
    if (t.progress === 100 && t.status !== 'COMPLETED') p(w, 'progress 100 but not COMPLETED');
    if (!TERMINAL.has(t.status) && !['BACKLOG', 'PLANNED'].includes(t.status))
      for (const d of list(t.dependencies)) {
        const dep = byId.get(d);
        if (dep && !TERMINAL.has(dep.status) && !['WAITING_DEPENDENCY', 'BLOCKED'].includes(t.status)) p(w, `is ${t.status} while dependency ${d} is still ${dep.status}`);
      }
    // The V1 ownership rule, now enforced: a change inside a path is at least that path's level.
    const floor = levelFloor(t);
    if (floor && !TERMINAL.has(t.status) && t.authority_level < floor.level)
      p(w, `authority ${t.authority_level} is below the level-${floor.level} floor of ${floor.domain} (${floor.file}) — raise it or narrow affected_files`);
    // V2: completion evidence, reviews, governor.
    if (t.status === 'COMPLETED' && t.authority_level >= g.independent_review_required_from_level && !reviewsOf(state, t.id).some((r) => r.independent && r.reviewer !== t.primary_agent && PASSING.has(r.result)))
      p(w, `COMPLETED at level ${t.authority_level} without a passing independent review`);
    if (!TERMINAL.has(t.status)) {
      const rounds = reviewsOf(state, t.id).filter((r) => !PASSING.has(r.result) || r.result === 'CONCERN').length;
      if (rounds > g.max_review_rounds) p(w, `${rounds} unresolved review rounds (limit ${g.max_review_rounds}) — escalate, do not loop`);
      if ((state.attempts.get(t.id) ?? 0) > g.max_failed_attempts) p(w, `${state.attempts.get(t.id)} failed attempts (limit ${g.max_failed_attempts}) — return to analysis`);
    }
  }

  const claims = fileClaims(tasks);
  for (const [file, ids] of claims) if (ids.length > 1) p('collision', `${file} is claimed by ${ids.join(', ')}`);

  for (const i of entitiesOf(state, 'BUG')) if (!i.affected_system) p(i.id, 'affected_system is required');

  // Opportunities.
  for (const o of entitiesOf(state, 'OPP')) {
    if (o.status === 'READY_FOR_OWNER_DECISION') for (const e of readyGuards(state, o, ctx)) problems.push(e);
    if (o.status === 'APPROVED') {
      const cr = byId.get(o.related_change_request);
      if (!cr || cr.source_opportunity !== o.id) p(o.id, 'APPROVED without a change request created from it');
    }
    if (!['REJECTED', 'MERGED', 'DELIVERED'].includes(o.status))
      for (const c of duplicateCandidates(state, o.title, o.id))
        if (!linked(state, o.id, c.id)) p(o.id, `possible duplicate of ${c.id} ("${c.title}", similarity ${c.score.toFixed(2)}) — record DUPLICATE, OVERLAPPING, RELATED or DISTINCT with pm link`);
    const loops = state.decisions.filter((d) => d.opportunity === o.id && d.decision === 'RESEARCH_MORE').length;
    if (loops > g.max_research_loops_without_new_evidence) p(o.id, `${loops} research loops — decide, watch or drop`);
  }
  for (const t of tasks) if (t.related_opportunity && byId.get(t.related_opportunity)?.status !== 'APPROVED') p(t.id, `linked to ${t.related_opportunity}, which is not APPROVED`);

  // Ranking only ever contains opportunities and was set by the owner.
  if (state.ranking.by && !isOwner(state.ranking.by)) p('ranking', `set by ${state.ranking.by}, not the owner`);
  // Validation on READ, not only on write (REV-0005): replay the whole log and
  // run every write guard on every event. An event that reached the file by any
  // route — a shell redirect, a script, a no-op guard passed to commit() — is
  // judged exactly as if it had come through the CLI. CI runs this.
  problems.push(...replayProblems(state.events, ctx));
  return problems;
}

export function replayProblems(events, ctx = {}) {
  const out = [];
  let pastImport = false;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === 'v1_imported') {
      if (ev.channel !== 'migration' || ev.actor !== 'system') out.push(`event ${ev.id} (${ev.type} ${ev.entity}) would be refused: v1_imported is only valid from the migration`);
      // The import ran once, on an empty log (REV-0005 H1): an unguarded
      // v1_imported appended later could create an APPROVED opportunity or an
      // approval CR with no proof.
      else if (pastImport) out.push(`event ${ev.id} (${ev.type} ${ev.entity}) would be refused: v1_imported after the V1 import finished; the import is the log's prefix only`);
      continue;
    }
    pastImport = true;
    if (ev.channel === 'migration') {
      out.push(`event ${ev.id} (${ev.type} ${ev.entity}) would be refused: only v1_imported events may use the migration channel`);
      continue;
    }
    const before = materializeCached(events, i);
    const after = materializeCached(events, i + 1);
    for (const e of writeGuards(before, after, [ev], { ...ctx, replay: true })) out.push(`event ${ev.id} (${ev.type} ${ev.entity}) would be refused: ${e}`);
  }
  return out;
}

let replayCache = { events: null, states: [] };
function materializeCached(events, n) {
  if (replayCache.events !== events) replayCache = { events, states: [] };
  replayCache.states[n] ??= materialize(events.slice(0, n));
  return replayCache.states[n];
}

export function fileClaims(tasks) {
  const claims = new Map();
  for (const t of tasks) {
    if (TERMINAL.has(t.status) || ['BACKLOG', 'PLANNED'].includes(t.status)) continue;
    for (const f of list(t.affected_files)) {
      if (!claims.has(f)) claims.set(f, []);
      claims.get(f).push(t.id);
    }
  }
  return claims;
}

// ------------------------------------------------------------------ attention

export function attention(state, now = new Date()) {
  const out = [];
  const g = governor();
  const add = (kind, ref, why) => out.push({ kind, ref, why });
  for (const t of entitiesOf(state, 'TASK')) {
    // WAITING_INFORMATION means waiting on the owner unless `waiting_on` names someone else.
    if (t.status === 'WAITING_INFORMATION' && (!t.waiting_on || isOwner(t.waiting_on))) add('OWNER_DECISION_REQUIRED', t.id, t.title);
    if (t.authority_level === 5 && !TERMINAL.has(t.status) && !t.related_consensus && t.status !== 'BACKLOG') add('ARCHITECTURE_DECISION_REQUIRED', t.id, 'level 5 work without a decision record');
    const last = state.history.get(t.id)?.at(-1)?.ts;
    const lim = g.stuck_after_days[t.status];
    if (lim && last && (now - new Date(last)) / 864e5 > lim) add('STUCK', t.id, `${t.status} with no event for over ${lim} days`);
    for (const r of openBlocking(state, t.id)) add(r.review_type === 'SECURITY' ? 'SECURITY_BLOCK' : 'ESCALATION_REQUIRED', t.id, `${r.result} by ${r.reviewer}: ${r.findings ?? ''}`);
  }
  for (const c of entitiesOf(state, 'CONSENSUS')) if (c.status === 'AWAITING_USER_INPUT') add('OWNER_DECISION_REQUIRED', c.id, c.subject);
  for (const i of entitiesOf(state, 'BUG')) if (OPEN_ISSUE(i.status) && i.category === 'security' && i.severity === 'CRITICAL' && !LEGACY_SYSTEMS.has(i.affected_system)) add('SECURITY_BLOCK', i.id, i.title);
  for (const o of entitiesOf(state, 'OPP')) if (o.status === 'READY_FOR_OWNER_DECISION') add('OPPORTUNITY_READY_FOR_DECISION', o.id, o.title);
  for (const s of state.suggestions) {
    const decidedLater = state.ranking.at && state.ranking.at > s.ts;
    if (!decidedLater) add('PRIORITY_REVIEW_SUGGESTED', s.entity, s.reason);
  }
  for (const cr of entitiesOf(state, 'CR')) if (cr.status === 'IN_REVIEW') add('OWNER_DECISION_REQUIRED', cr.id, cr.title);
  return out;
}

// ------------------------------------------------------------------ health

export function health(state, problems) {
  const reasons = [];
  const tasks = entitiesOf(state, 'TASK');
  const open = entitiesOf(state, 'BUG').filter((i) => OPEN_ISSUE(i.status));
  const app = open.filter((i) => !LEGACY_SYSTEMS.has(i.affected_system));
  const critBlocked = tasks.filter((t) => t.status === 'BLOCKED' && t.priority === 'CRITICAL');
  const releaseBlockers = open.filter((i) => i.release_blocker === true);
  if (critBlocked.length || releaseBlockers.length) {
    for (const t of critBlocked) reasons.push(`${t.id} is CRITICAL and BLOCKED`);
    for (const i of releaseBlockers) reasons.push(`${i.id} blocks release`);
    return { health: 'BLOCKED', reasons };
  }
  const crit = app.filter((i) => i.severity === 'CRITICAL');
  if (crit.length) {
    for (const i of crit) reasons.push(`${i.id} is an open CRITICAL ${i.category ? i.category + ' issue' : 'issue'}`);
    return { health: 'AT_RISK', reasons };
  }
  for (const i of app.filter((x) => x.severity === 'HIGH')) reasons.push(`${i.id} is an open HIGH ${i.category ? i.category + ' issue' : 'issue'}`);
  for (const t of tasks.filter((x) => x.status === 'BLOCKED')) reasons.push(`${t.id} is BLOCKED`);
  if (problems.length) reasons.push(`${problems.length} governance validation problem(s)`);
  return reasons.length ? { health: 'ATTENTION_REQUIRED', reasons } : { health: 'HEALTHY', reasons: [] };
}
