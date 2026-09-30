// Projections of canonical state. Everything written here is GENERATED:
// record front matter, the *_INDEX.json / *_STATE.json files (V1-compatible
// field names), role profiles, dashboard/data.js and the daily snapshot.
//
// `project({ check: true })` writes nothing and reports what is stale, which
// front matter was hand-edited, which record files have no entity, and whether
// any line of the event log was rewritten relative to git.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { parse, sameValue, serialize } from './frontmatter.mjs';
import { EVENTS, KINDS, PM, REPO, kindOf } from './paths.mjs';
import { attention, checkProblems, fileClaims, health, LEGACY_SYSTEMS, list, OPEN_ISSUE, QA_STATES, REVIEW, TERMINAL } from './rules.mjs';
import { schema } from './schema.mjs';
import { entitiesOf, materialize, readEvents } from './state.mjs';
import { config as cfg, decisionRights, governor, people, permissions, routing } from './policy.mjs';

export const STATUS_FOLDER = {
  BACKLOG: 'backlog', PLANNED: 'planned', READY: 'ready', IN_PROGRESS: 'active', WAITING_DEPENDENCY: 'active',
  WAITING_INFORMATION: 'active', REVISION_REQUIRED: 'active', BLOCKED: 'blocked', MANAGER_REVIEW: 'review',
  CROSS_MANAGER_REVIEW: 'cross-review', QA: 'qa', SECURITY_REVIEW: 'qa', REGRESSION_TESTING: 'qa',
  READY_FOR_RELEASE: 'qa', COMPLETED: 'completed', CANCELLED: 'completed',
};
const GEN = '# GENERATED from agent-os/state/events.jsonl — change it with `pnpm pm`, not by hand. The body below is yours.';

export const fileFor = (e) => {
  const k = kindOf(e.id);
  return e.id.startsWith('TASK-') ? `tasks/${STATUS_FOLDER[e.status] ?? 'backlog'}/${e.id}.md` : `${k.folder}/${e.id}.md`;
};

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.md') && /^[A-Z]+-\d{4}\.md$/.test(e.name) ? [p] : [];
  });
}
const rel = (p) => relative(PM, p).split('\\').join('/');

/** Every record file on disk, keyed by id. */
export function recordFiles() {
  const out = new Map();
  for (const k of Object.values(KINDS)) for (const f of walk(join(PM, k.folder))) out.set(f.split(/[\\/]/).pop().slice(0, -3), rel(f));
  return out;
}

export function bodiesOf(files = recordFiles()) {
  const b = {};
  for (const [id, f] of files) b[id] = parse(readFileSync(join(PM, f), 'utf8')).body;
  return b;
}

const keyOrder = (e) => Object.keys(schema(kindOf(e.id).schema).properties);
export const frontMatterOf = (e) => {
  const order = keyOrder(e);
  const fm = {};
  for (const k of [...order, ...Object.keys(e).filter((k) => !order.includes(k))]) if (k in e) fm[k] = e[k];
  return fm;
};

function template(e) {
  const k = kindOf(e.id).kind;
  if (k === 'opportunity')
    return `\n# ${e.id} — ${e.title}\n\n<!-- Opportunity Development Pack. Every "##" section below is required before READY_FOR_OWNER_DECISION; see agent-os/PRODUCT_EVOLUTION_OPERATING_MODEL.md. -->\n\n## Executive Summary\n\n## Problem\n\n## Evidence\n\n## Evidence Against\n\n## Assumptions\n\n## Unknowns\n\n## User Impact\n\n## Competitive Context\n\n## Current UX\n\n## Proposed UX\n\n## Product Solution\n\n## Alternatives\n\n## Why This Approach\n\n## Why Now\n\n## Why Not Now\n\n## Cost of Doing Nothing\n\n## Design Direction\n\n## Technical Feasibility\n\n## Security, Privacy, Performance, Data, SEO\n\n## Analytics Impact\n\n## Localization / RTL and Accessibility\n\n## Dependencies\n\n## Risks\n\n## Success Criteria\n\n## Validation Plan\n\n## Implementation Notes\n\n## Rollback / Reversibility\n\n## Recommendation\n`;
  return `\n# ${e.id} — ${e.title ?? e.subject}\n\n## Objective\n\n## Notes\n`;
}

function historyViolations() {
  // Append-only: every event line that git already has must still be there,
  // unchanged and in order. Compared against HEAD (local) or the PR base (CI).
  const relEvents = relative(REPO, EVENTS).split('\\').join('/');
  const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'HEAD';
  let committed;
  try {
    committed = execFileSync('git', ['show', `${base}:${relEvents}`], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return []; // not committed yet, or base not fetched
  }
  const now = existsSync(EVENTS) ? readFileSync(EVENTS, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const was = committed.split(/\r?\n/).filter(Boolean);
  const nowSet = new Set(now);
  const missing = was.filter((l) => !nowSet.has(l));
  return missing.length ? [`history: ${missing.length} committed event(s) were removed or rewritten — the log is append-only`] : [];
}

function v1Log(name) {
  const p = join(PM, 'logs', name);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const [at, actor, event, ref, ...rest] = l.split(' | ');
      return { at, actor, event, ref, message: rest.join(' | '), source: `v1:${name}` };
    });
}

export function project({ check = false, now = null } = {}) {
  const events = readEvents();
  // Projections are a pure function of the log: "now" is the last event's time,
  // so a committed projection stays valid in CI next week. Live callers (the
  // dashboard server, `pm attention`) pass the wall clock for stuck detection.
  now ??= new Date(events.at(-1)?.ts ?? 0);
  const state = materialize(events);
  const files = recordFiles();
  const bodies = bodiesOf(files);
  const problems = checkProblems(state, { bodies });
  const P = people();
  const { managers, roles } = permissions();
  const config = cfg();
  const nowIso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

  // ---------------------------------------------------------- record files
  const drift = [];
  const moves = [];
  const recordWrites = new Map();
  for (const e of state.entities.values()) {
    const want = fileFor(e);
    const have = files.get(e.id);
    const fm = frontMatterOf(e);
    const body = have ? bodies[e.id] : template(e);
    if (have) {
      const disk = parse(readFileSync(join(PM, have), 'utf8')).meta;
      const keys = new Set([...Object.keys(fm), ...Object.keys(disk)]);
      const diff = [...keys].filter((k) => !sameValue(fm[k], disk[k]));
      if (diff.length) drift.push(`${have}: front matter differs from canonical state (${diff.join(', ')}) — edit with \`pnpm pm set\`, not by hand`);
      if (have !== want) moves.push([have, want]);
      if (diff.length || have !== want) recordWrites.set(want, { fm, body });
    } else recordWrites.set(want, { fm, body });
  }
  const orphans = [...files].filter(([id]) => !state.entities.has(id)).map(([, f]) => `${f}: record file with no entity in canonical state`);

  // ---------------------------------------------------------- indexes
  const tasks = entitiesOf(state, 'TASK');
  const issues = entitiesOf(state, 'BUG');
  const changes = entitiesOf(state, 'CR');
  const decisions = entitiesOf(state, 'DEC');
  const consensus = entitiesOf(state, 'CONSENSUS');
  const epics = entitiesOf(state, 'EPIC');
  const milestones = entitiesOf(state, 'MILESTONE');
  const opps = entitiesOf(state, 'OPP');
  const signals = entitiesOf(state, 'SIG');
  const insights = entitiesOf(state, 'INS');
  const releases = entitiesOf(state, 'REL');
  const withFile = (xs) => xs.map((x) => ({ ...x, file: fileFor(x) }));

  const TASK_KEYS = ['id', 'title', 'type', 'status', 'stage', 'priority', 'progress', 'authority_level', 'risk', 'primary_agent', 'responsible_manager', 'supporting_agents', 'required_reviewers', 'related_change_request', 'related_issue', 'related_consensus', 'related_epic', 'related_milestone', 'related_opportunity', 'dependencies', 'blocks', 'affected_modules', 'affected_pages', 'affected_files', 'created_at', 'updated_at'];
  const LISTS = ['supporting_agents', 'required_reviewers', 'dependencies', 'blocks', 'affected_modules', 'affected_pages', 'affected_files'];
  const taskRows = tasks.map((t) => {
    const r = Object.fromEntries(TASK_KEYS.map((k) => [k, t[k] ?? null]));
    for (const k of LISTS) r[k] = list(r[k]);
    r.reaudit = t.reaudit ?? null;
    r.file = fileFor(t);
    return r;
  });

  const openTasks = tasks.filter((t) => !TERMINAL.has(t.status));
  const openIssues = issues.filter((i) => OPEN_ISSUE(i.status));
  const appIssues = openIssues.filter((i) => !LEGACY_SYSTEMS.has(i.affected_system));
  const legacyIssues = openIssues.filter((i) => LEGACY_SYSTEMS.has(i.affected_system));
  const security = appIssues.filter((i) => i.category === 'security');
  const SEV = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  const counted = tasks.filter((t) => t.status !== 'CANCELLED');
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  const milestoneRows = withFile(milestones).map((m) => {
    const ts = counted.filter((t) => t.related_milestone === m.id);
    return { ...m, task_count: ts.length, progress: avg(ts.map((t) => t.progress)) };
  });
  const epicRows = withFile(epics).map((e) => {
    const ts = counted.filter((t) => t.related_epic === e.id);
    return { ...e, task_count: ts.length, progress: avg(ts.map((t) => t.progress)) };
  });

  // Timeline: canonical events, plus the frozen V1 logs (IMMUTABLE_HISTORY).
  const activity = [
    ...events.map((ev) => ({ at: ev.ts, actor: ev.actor, event: ev.type.toUpperCase(), ref: ev.entity, message: summarize(ev, state), source: ev.channel })),
    ...v1Log('activity.log'),
    ...v1Log('task-events.log'),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const lastActivity = (id) => activity.find((a) => a.actor === id)?.at ?? null;

  const reviewsFor = (id) => state.reviews.filter((r) => r.target === id);
  const agentState = Object.keys(roles).map((id) => {
    const mine = openTasks.filter((t) => t.primary_agent === id);
    const reviewing = openTasks.filter((t) => list(t.required_reviewers).includes(id) && (REVIEW.has(t.status) || QA_STATES.has(t.status)));
    const supporting = openTasks.filter((t) => list(t.supporting_agents).includes(id));
    let st = 'AVAILABLE';
    if (mine.some((t) => t.status === 'BLOCKED')) st = 'BLOCKED';
    else if (mine.some((t) => t.status === 'IN_PROGRESS' || t.status === 'REVISION_REQUIRED')) st = 'WORKING';
    else if (reviewing.length) st = 'REVIEWING';
    else if (mine.some((t) => t.status.startsWith('WAITING'))) st = 'WAITING';
    else if (supporting.some((t) => QA_STATES.has(t.status))) st = 'QA_SUPPORT';
    const current = mine.find((t) => t.status === 'IN_PROGRESS') ?? mine[0] ?? null;
    return {
      id, role: P[id].title, department: P[id].department, manager: P[id].reports_to, staffed: P[id].staffed !== false,
      executor: routing().executors[id] ?? routing().executors.default, squads: P[id].squads ?? [],
      state: st, current_task: current?.id ?? null, assignments: mine.map((t) => t.id), supporting: supporting.map((t) => t.id),
      reviews: reviewing.map((t) => t.id), reviews_recorded: state.reviews.filter((r) => r.reviewer === id).length,
      opportunities: opps.filter((o) => o.proposed_by === id || list(o.contributors).includes(id)).map((o) => o.id),
      workload: mine.length + supporting.length * 0.5 + reviewing.length * 0.5,
      blockers: mine.filter((t) => t.status === 'BLOCKED').map((t) => t.id), last_activity: lastActivity(id),
    };
  });
  const managerState = Object.keys(managers).map((id) => {
    const owned = openTasks.filter((t) => t.responsible_manager === id);
    return {
      id, manager: managers[id].title, department: managers[id].department,
      team: Object.entries(roles).filter(([, r]) => r.reports_to === id || list(r.squads).includes(managers[id].squad_id)).map(([rid]) => rid),
      active_tasks: owned.filter((t) => !['BACKLOG', 'PLANNED'].includes(t.status)).map((t) => t.id),
      owned_tasks: owned.map((t) => t.id),
      reviews: openTasks.filter((t) => (t.responsible_manager === id && REVIEW.has(t.status)) || (list(t.required_reviewers).includes(id) && t.status === 'CROSS_MANAGER_REVIEW')).map((t) => t.id),
      blocked_work: owned.filter((t) => t.status === 'BLOCKED').map((t) => t.id),
      pending_decisions: decisions.filter((d) => d.status === 'PROPOSED' && list(d.participants).includes(id)).map((d) => d.id),
      consensus: consensus.filter((c) => !['APPROVED', 'REJECTED'].includes(c.status) && list(c.participants).includes(id)).map((c) => c.id),
      opportunities: opps.filter((o) => o.responsible_manager === id && !['REJECTED', 'MERGED', 'DELIVERED'].includes(o.status)).map((o) => o.id),
      risks: openIssues.filter((i) => i.manager === id && ['CRITICAL', 'HIGH'].includes(i.severity)).map((i) => i.id),
      last_activity: lastActivity(id),
    };
  });

  const allProblems = [...problems, ...drift, ...orphans, ...historyViolations()];
  const h = health(state, allProblems);
  const att = attention(state, now);
  const currentMilestone = milestoneRows.find((m) => m.id === config.current_milestone) ?? null;
  const projectState = {
    project_name: config.project_name, project_type: config.project_type, current_phase: config.current_phase,
    current_milestone: config.current_milestone, current_milestone_progress: currentMilestone?.progress ?? null,
    progress: avg(counted.map((t) => t.progress)), health: h.health, health_reasons: h.reasons,
    total_tasks: tasks.length,
    active_tasks: tasks.filter((t) => ['IN_PROGRESS', 'WAITING_DEPENDENCY', 'WAITING_INFORMATION', 'REVISION_REQUIRED'].includes(t.status)).length,
    blocked_tasks: tasks.filter((t) => t.status === 'BLOCKED').length,
    review_tasks: tasks.filter((t) => REVIEW.has(t.status)).length,
    qa_tasks: tasks.filter((t) => QA_STATES.has(t.status)).length,
    completed_tasks: tasks.filter((t) => t.status === 'COMPLETED').length,
    open_bugs: appIssues.filter((i) => i.category !== 'security').length,
    legacy_and_migration_issues: legacyIssues.length,
    legacy_and_migration_by_severity: Object.fromEntries(SEV.map((s) => [s, legacyIssues.filter((i) => i.severity === s).length])),
    security_findings: security.length,
    security_by_severity: Object.fromEntries(SEV.map((s) => [s, security.filter((i) => i.severity === s).length])),
    active_change_requests: changes.filter((c) => !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(c.status)).length,
    pending_decisions: decisions.filter((d) => d.status === 'PROPOSED').length,
    pending_consensus: consensus.filter((c) => !['APPROVED', 'REJECTED'].includes(c.status)).length,
    opportunities_open: opps.filter((o) => !['APPROVED', 'REJECTED', 'DEFERRED', 'WATCH', 'MERGED', 'DELIVERED'].includes(o.status)).length,
    opportunities_ready_for_decision: opps.filter((o) => o.status === 'READY_FOR_OWNER_DECISION').length,
    watchlist: signals.filter((s) => s.status === 'WATCH').length + opps.filter((o) => o.status === 'WATCH').length,
    reviews_recorded: state.reviews.length,
    independent_reviews: state.reviews.filter((r) => r.independent).length,
    owner_attention: att.length,
    active_agents: agentState.filter((a) => a.state !== 'AVAILABLE').length,
    file_collisions: [...fileClaims(tasks)].filter(([, ids]) => ids.length > 1).length,
    validation_problems: allProblems.length,
    canonical_events: events.length,
    last_activity: activity[0]?.at ?? null,
  };

  // ---------------------------------------------------------- outputs
  const outputs = new Map();
  const json = (o) => JSON.stringify(o, null, 2) + '\n';
  const G = 'agent-os/tools/pm.mjs (projection of agent-os/state/events.jsonl)';
  outputs.set('TASK_INDEX.json', json({ generated_by: G, tasks: taskRows }));
  outputs.set('ISSUE_INDEX.json', json({ generated_by: G, issues: withFile(issues) }));
  outputs.set('CHANGE_INDEX.json', json({ generated_by: G, change_requests: withFile(changes) }));
  outputs.set('DECISION_INDEX.json', json({ generated_by: G, decisions: withFile(decisions), consensus: withFile(consensus) }));
  outputs.set('OPPORTUNITY_INDEX.json', json({ generated_by: G, opportunities: withFile(opps), signals: withFile(signals), insights: withFile(insights), evidence: Object.fromEntries(state.evidence), links: state.links, ranking: state.ranking, owner_decisions: state.decisions, portfolio: state.portfolio }));
  outputs.set('REVIEW_INDEX.json', json({ generated_by: G, reviews: state.reviews }));
  outputs.set('PROJECT_STATE.json', json(projectState));
  outputs.set('AGENT_STATE.json', json({ generated_by: G, agents: agentState }));
  outputs.set('MANAGER_STATE.json', json({ generated_by: G, managers: managerState }));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  for (const s of agentState) outputs.set(`agents/${s.id}.md`, profile(s.id, roles[s.id], s, false, P, taskById, roles));
  for (const s of managerState) outputs.set(`managers/${s.id}.md`, profile(s.id, managers[s.id], s, true, P, taskById, roles));

  const data = {
    generated_at: nowIso, config, state: projectState, tasks: taskRows, issues: withFile(issues), changes: withFile(changes),
    decisions: withFile(decisions), consensus: withFile(consensus), epics: epicRows, milestones: milestoneRows,
    opportunities: withFile(opps), signals: withFile(signals), insights: withFile(insights), releases: withFile(releases),
    evidence: Object.fromEntries(state.evidence), reviews: state.reviews, links: state.links, ranking: state.ranking,
    owner_decisions: state.decisions, suggestions: state.suggestions, portfolio: state.portfolio, accepted_risks: state.accepted_risks,
    attention: att, agents: agentState, managers: managerState, permissions: permissions(),
    routing: routing(), decision_rights: decisionRights(), governor: governor(), enums: JSON.parse(readFileSync(join(REPO, 'agent-os', 'policies', 'enums.json'), 'utf8')),
    collisions: [...fileClaims(tasks)].filter(([, ids]) => ids.length > 1).map(([file, ids]) => ({ file, tasks: ids })),
    problems: allProblems, activity: activity.slice(0, 300),
    history: Object.fromEntries(state.history),
    bodies,
    files: [...fileClaims(tasks)].map(([file, ids]) => ({ file, tasks: ids })),
    ownership: routing().domains.map((d) => ({ path: d.paths.join(', '), primary: d.primary, manager: d.manager, reviewers: d.reviewers, authority: d.min_level, domain: d.id })),
  };
  outputs.set('dashboard/data.js', `// GENERATED by agent-os/tools/pm.mjs from agent-os/state/events.jsonl. Do not edit.\nwindow.PM_DATA = ${JSON.stringify(data)};\n`);

  const stable = (s) => s.replace(/"generated_at":"[^"]*"/, '');
  const stale = [];
  for (const [path, content] of outputs) {
    const full = join(PM, path);
    const before = existsSync(full) ? readFileSync(full, 'utf8') : null;
    const same = path === 'dashboard/data.js' ? before !== null && stable(before) === stable(content) : before === content;
    if (!same) stale.push(path);
  }

  if (!check) {
    for (const [from, to] of moves) {
      mkdirSync(dirname(join(PM, to)), { recursive: true });
      if (existsSync(join(PM, from))) renameSync(join(PM, from), join(PM, to));
    }
    for (const [path, { fm, body }] of recordWrites) {
      mkdirSync(dirname(join(PM, path)), { recursive: true });
      writeFileSync(join(PM, path), serialize(fm, []).replace('---\n', `---\n${GEN}\n`) + (body.startsWith('\n') ? body : '\n' + body));
    }
    for (const path of stale) {
      mkdirSync(dirname(join(PM, path)), { recursive: true });
      writeFileSync(join(PM, path), outputs.get(path));
    }
    mkdirSync(join(PM, 'history'), { recursive: true });
    writeFileSync(join(PM, 'history', `${nowIso.slice(0, 10)}.json`), json(projectState));
  }
  return { state, projectState, problems: allProblems, drift, orphans, stale: check ? stale : [], written: check ? [] : stale, records: [...recordWrites.keys()], attention: att, data };
}

function summarize(ev, state) {
  const d = ev.data ?? {};
  switch (ev.type) {
    case 'status_changed': return `${d.from} → ${d.to}${ev.reason ? ' — ' + ev.reason : ''}`;
    case 'review_recorded': return `${d.review_type} review by ${d.reviewer}${d.independent ? ' (independent)' : ''}: ${d.result}${d.findings ? ' — ' + d.findings : ''}`;
    case 'opportunity_decided': return `owner: ${d.decision}${d.reason ? ' — ' + d.reason : ''}`;
    case 'evidence_added': return `${d.stance} · ${d.quality} · ${d.claim}`;
    case 'link_added': return `${d.relation} ${d.target}`;
    case 'entity_created': case 'v1_imported': return `${ev.type === 'v1_imported' ? 'imported from V1' : 'created'}: ${state.entities.get(ev.entity)?.title ?? state.entities.get(ev.entity)?.subject ?? ''}`;
    case 'entity_updated': return `updated ${Object.keys(d.fields ?? {}).join(', ')}${ev.reason ? ' — ' + ev.reason : ''}`;
    default: return ev.reason ?? d.text ?? '';
  }
}

function profile(id, p, st, isManager, P, taskById, roles) {
  const bullets = (xs) => (list(xs).length ? list(xs).map((x) => `- ${x}`).join('\n') : '- —');
  const taskLine = (tid) => {
    const t = taskById.get(tid);
    return t ? `- ${tid} — ${t.title} (${t.status}, ${t.progress}%)` : `- ${tid}`;
  };
  const reportsTo = p.reports_to ? `${P[p.reports_to]?.title ?? p.reports_to} (\`${p.reports_to}\`)` : '—';
  const L = [
    '<!-- GENERATED by agent-os/tools/pm.mjs from PERMISSIONS.json and canonical state. Edit those, not this. -->', '',
    `# ${p.title}`, '', '| | |', '|---|---|', `| Role id | \`${id}\` |`, `| Department | ${p.department} |`,
    `| Seniority | ${p.seniority} |`, `| Reports to | ${reportsTo} |`, `| Max authority | Level ${p.max_authority} |`,
    `| Executes as | ${routing().executors[id] ?? routing().executors.default} |`,
    `| Staffed on this project | ${p.staffed === false ? 'No — ' + (p.not_staffed_reason ?? 'not required yet') : 'Yes'} |`,
    `| Current state | ${st.state} |`, '',
  ];
  if (p.quality_contract) L.push('## Quality contract', '', bullets(p.quality_contract), '');
  for (const [h, k] of [['Responsibilities', 'responsibilities'], ['Owned domains', 'owned_domains'], ['Allowed', 'allowed'], ['Requires approval', 'requires_approval'], ['Forbidden', 'forbidden'], ['Review obligations', 'review_obligations'], ['Escalation', 'escalation']])
    L.push(`## ${h}`, '', bullets(p[k]), '');
  if (isManager) {
    L.push('## Team', '', bullets(st.team.map((r) => `${roles[r].title} (\`${r}\`)`)), '');
    L.push('## Open reviews', '', st.reviews.length ? st.reviews.map(taskLine).join('\n') : '- none', '');
    L.push('## Current risks', '', st.risks.length ? st.risks.map((r) => `- ${r}`).join('\n') : '- none recorded', '');
    L.push('## Owned tasks', '', st.owned_tasks.length ? st.owned_tasks.map(taskLine).join('\n') : '- none', '');
  } else {
    L.push('## Current tasks', '', st.assignments.length ? st.assignments.map(taskLine).join('\n') : '- none', '');
    if (st.supporting.length) L.push('## Supporting', '', st.supporting.map(taskLine).join('\n'), '');
    if (st.reviews.length) L.push('## Pending reviews', '', st.reviews.map(taskLine).join('\n'), '');
  }
  return L.join('\n');
}
