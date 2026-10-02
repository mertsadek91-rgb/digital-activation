#!/usr/bin/env node
// pm — the only sanctioned way to change project state.
//
// Every command builds events, validates the resulting state (schemas, enums,
// lifecycle, authority, decision rights, owner-only actions) and appends them
// to agent-os/state/events.jsonl in one step, then refreshes the projections.
// A refused command writes nothing.
//
// Run `node agent-os/tools/pm.mjs help` (or `pnpm pm help`) for usage.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { ensureOwnerKey } from './lib/owner-key.mjs';

import { parse } from './lib/frontmatter.mjs';
import { KINDS, PM, REPO } from './lib/paths.mjs';
import { bodiesOf, project, recordFiles } from './lib/project.mjs';
import { route } from './lib/router.mjs';
import { attention, duplicateCandidates, list, writeGuards } from './lib/rules.mjs';
import { enums } from './lib/schema.mjs';
import { ownerEvents } from './lib/owner.mjs';
import { allReviews, commit, entitiesOf, materialize, newEvent, nextId, nextSubId, readEvents } from './lib/state.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = [];
const flags = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split(/=(.*)/s);
    let val = true;
    if (v !== undefined) val = v;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) val = argv[++i];
    // A repeated flag (--relation a --relation b, --field x=1 --field y=2) accumulates.
    flags[k] = k in flags && ['relation', 'field'].includes(k) ? [].concat(flags[k], val) : val;
  } else positional.push(a);
}
// The eval channel exists only inside an eval sandbox under the OS temp
// directory (REV-0004 M1); anywhere else every write is an ordinary cli write.
const inSandbox = !!process.env.PM_ROOT && !relative(resolve(tmpdir()), resolve(process.env.PM_ROOT)).startsWith('..');
const CHANNEL = process.env.PM_CHANNEL === 'eval' && inSandbox ? 'eval' : 'cli';
const today = () => new Date().toISOString().slice(0, 10);

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}
function need(name) {
  if (flags[name] === undefined || flags[name] === true) die(`--${name} is required`);
  return flags[name];
}
function actor() {
  const by = need('by');
  if (by === 'owner' || by === 'user') die('An agent cannot act as the owner. Owner decisions are made in the dashboard (`pnpm pm:dashboard`) or with `pm owner …` in an interactive terminal.');
  return by;
}
const coerce = (v) => (v === 'null' ? null : v === 'true' ? true : v === 'false' ? false : /^-?\d+$/.test(v) ? Number(v) : v.startsWith('[') ? JSON.parse(v) : v);
function fieldsFromFlags() {
  const f = flags.json ? JSON.parse(flags.json) : {};
  for (const kv of list(flags.field ? [].concat(flags.field) : []))
    for (const pair of String(kv).split(/;(?=[a-z_]+=)/)) {
      const [k, ...v] = pair.split('=');
      f[k] = coerce(v.join('='));
    }
  return f;
}

function write(events, { quiet = false } = {}) {
  const bodies = bodiesOf();
  let after;
  try {
    after = commit(events, (b, a, evs) => writeGuards(b, a, evs, { bodies }));
  } catch (e) {
    die(e.message, 2);
  }
  sync({ quiet: true });
  if (!quiet) for (const ev of events) console.log(`✓ ${ev.type} ${ev.entity}${ev.data?.to ? ' → ' + ev.data.to : ''}`);
  return after;
}

function prettier(files) {
  const bin = join(REPO, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
  if (!existsSync(bin) || !files.length) return;
  try {
    execFileSync(process.execPath, [bin, '--write', '--log-level', 'warn', ...files], { cwd: REPO, stdio: ['ignore', 'ignore', 'inherit'] });
  } catch {
    /* formatting is cosmetic; `pm check` compares values, not bytes */
  }
}

function sync({ quiet = false } = {}) {
  let r = project({});
  if (r.records.length) {
    // Formatting changes the record bodies the projection just captured, so
    // project once more; otherwise data.js is stale the moment it is written.
    prettier(r.records.map((f) => join(PM, f)));
    r = project({});
  }
  if (!quiet) report(r, 'written');
  return r;
}

function report(r, verb) {
  const s = r.projectState;
  console.log(`pm: ${s.canonical_events} events · ${s.total_tasks} tasks · ${r.state.entities.size} entities · health ${s.health} · owner attention ${s.owner_attention} · ${(verb === 'stale' ? r.stale : r.written).length} projection(s) ${verb}`);
  for (const p of r.problems) console.warn(`  ! ${p}`);
  for (const f of r.stale ?? []) console.warn(`  ~ stale: ${f}`);
}

// ------------------------------------------------------------------ commands

const commands = {
  help() {
    console.log(`pm — canonical project state (agent-os/state/events.jsonl)

Read
  pm show <ID>                          entity, reviews (and invalidated reviews), evidence, history
  pm list <PREFIX> [--status S]         e.g. pm list OPP --status DISCOVERY
  pm attention                          what needs the owner, and why
  pm route --paths a,b [--level N] [--type research|audit|opportunity_shaping] [--user-facing] [--visual]
  pm similar "<text>"                   duplicate candidates before creating anything
  pm metrics                            tool-call and denial counts from the hooks
  pm check                              validate everything; exit 1 on any problem (CI)
  pm sync                               rebuild projections (front matter, indexes, dashboard data)

Every command refuses flags it does not read (there is no --dry-run on writes).

Write (every write needs --by <role id> and --reason "<why>")
  pm create <TASK|BUG|CR|DEC|CONSENSUS|EPIC|MILESTONE|OPP|SIG|INS|REL> --json '{…}'
        OPP/SIG also need --relation <ID>:<DUPLICATE|OVERLAPPING|RELATED|DEPENDENT|DISTINCT> for each similar item
  pm set <ID> --field key=value [--field …]      (not status)
  pm transition <ID> <STATUS> [--stage S] [--progress N]   (same status only if stage or progress changes)
  pm review <ID> --type <REVIEW_TYPE> --result <RESULT> [--independent] [--executor subagent:x] --findings "…" [--evidence "…"]
  pm review-invalidate <REV-ID> --reason "…"
        strike a review that should not count (e.g. it never happened). Append-only: the original
        line stays; the review stops counting for completion, blocking, rounds and projections.
        Allowed: the original reviewer, exec-director, the target's responsible manager, the
        reviewer's manager, or a manager in the decision class's escalation chain. A VETO or
        BLOCKING_OBJECTION only by its own reviewer. Never the owner's records.
  pm evidence <OPP> --type <EVIDENCE_TYPE> --stance SUPPORTS|OPPOSES --quality FACT|… --claim "…" --source "…" [--date YYYY-MM-DD] [--strength LOW|…]
  pm link <ID> <TARGET> --relation <RELATION>
  pm suggest-priority-review <OPP> --reason "…"     (never reorders the owner's ranking)
  pm attempt-failed <TASK>
  pm note <ID> --text "…"

Owner only (interactive terminal; refused for agents and non-TTY shells)
  pm owner decide <OPP> <APPROVE|APPROVE_AND_PRIORITIZE|RESEARCH_MORE|DEFER|REJECT|WATCH|MERGE> --reason "…"
  pm owner rank OPP-0003,OPP-0001,…
  pm owner accept-risk <ID> --reason "…"

Migration
  pm migrate-v1 [--dry-run]             import V1 record files as v1_imported events (once)`);
  },

  show() {
    const s = materialize(readEvents());
    const id = positional[0] ?? die('pm show <ID>');
    const e = s.entities.get(id) ?? die(`${id}: not found`);
    console.log(JSON.stringify({ entity: e, reviews: s.reviews.filter((r) => r.target === id), invalidated_reviews: s.invalidated_reviews.filter((r) => r.target === id), evidence: s.evidence.get(id) ?? [], links: s.links.filter((l) => l.from === id || l.to === id), decisions: s.decisions.filter((d) => d.opportunity === id), history: s.history.get(id) ?? [] }, null, 2));
  },

  list() {
    const s = materialize(readEvents());
    const prefix = positional[0] ?? die('pm list <PREFIX>');
    for (const e of entitiesOf(s, prefix)) if (!flags.status || e.status === flags.status) console.log(`${e.id}\t${e.status}\t${e.title ?? e.subject}`);
  },

  attention() {
    const s = materialize(readEvents());
    const a = attention(s);
    if (!a.length) console.log('nothing needs the owner');
    for (const x of a) console.log(`${x.kind.padEnd(32)} ${x.ref}\t${x.why}`);
  },

  route() {
    const r = route({
      paths: flags.paths ? String(flags.paths).split(',') : [],
      level: flags.level ? Number(flags.level) : null,
      type: flags.type ?? null,
      userFacing: !!flags['user-facing'],
      visual: !!flags.visual,
    });
    if (flags.json) return console.log(JSON.stringify(r, null, 2));
    if (!flags.type && !r.domains.length) console.warn('! no routing domain matched these paths — the team below is a guess; check agent-os/policies/routing.json');
    console.log(`level ${r.level} · ${r.workflow}\ndomains: ${r.domains.join(', ') || '—'} · decision class: ${r.decision_class ?? '—'} · team ${r.team.length}/${r.fan_out_limit}`);
    for (const m of r.team) console.log(`  ${m.required ? '●' : '○'} ${m.role.padEnd(30)} ${m.executor.padEnd(32)} ${m.reason}`);
    for (const m of r.trimmed) console.log(`  ✕ ${m.role} trimmed by the fan-out limit (${m.reason})`);
  },

  similar() {
    const s = materialize(readEvents());
    for (const c of duplicateCandidates(s, positional.join(' '))) console.log(`${c.score.toFixed(2)}\t${c.id}\t${c.status}\t${c.title}`);
  },

  metrics() {
    const dir = join(REPO, '.claude', 'metrics');
    const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
    const calls = read('tool-calls.jsonl');
    const denials = read('guard.jsonl');
    const bySession = new Map();
    for (const c of calls) bySession.set(c.session, (bySession.get(c.session) ?? 0) + 1);
    const byTool = new Map();
    for (const c of calls) byTool.set(c.tool, (byTool.get(c.tool) ?? 0) + 1);
    console.log(`tool calls: ${calls.length} across ${bySession.size} session(s)`);
    for (const [t, n] of [...byTool].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${t.padEnd(36)} ${n}`);
    console.log(`guard decisions: ${denials.length} (${denials.filter((d) => d.decision === 'deny').length} denied, ${denials.filter((d) => d.decision === 'ask').length} asked)`);
    for (const d of denials.slice(-10)) console.log(`  ${d.ts} ${d.decision} ${d.tool}: ${d.rule}`);
    console.log('token and model cost: not exposed to hooks — not tracked (agent-os/policies/governor.json)');
  },

  check() {
    const r = project({ check: true });
    report(r, 'stale');
    if (r.problems.length || r.stale.length || r.records.length) {
      if (r.records.length) console.warn(`  ~ ${r.records.length} record file(s) need regenerating (run pnpm pm sync)`);
      process.exit(1);
    }
  },

  sync() {
    sync();
  },

  create() {
    const prefix = positional[0] ?? die('pm create <PREFIX> --json …');
    if (!KINDS[prefix]) die(`unknown kind ${prefix}`);
    const by = actor();
    const reason = need('reason');
    const s = materialize(readEvents());
    const id = flags.id ?? nextId(s, prefix);
    const fields = { created_at: today(), updated_at: today(), ...fieldsFromFlags() };
    const events = [newEvent({ type: 'entity_created', entity: id, actor: by, channel: CHANNEL, data: { fields }, reason })];
    if (['OPP', 'SIG'].includes(prefix)) {
      // Search before creating: active, deferred, rejected, watchlist, tasks, CRs, epics.
      const given = new Map(list(flags.relation ? [].concat(flags.relation) : []).flatMap((r) => String(r).split(',')).map((r) => r.split(':')));
      const cands = duplicateCandidates(s, `${fields.title}`);
      const unresolved = cands.filter((c) => !given.has(c.id));
      if (unresolved.length)
        die(`${id} may duplicate existing work — say how it relates before creating it:\n${unresolved.map((c) => `  --relation ${c.id}:<DUPLICATE|OVERLAPPING|RELATED|DEPENDENT|DISTINCT>   (${c.score.toFixed(2)}) ${c.status} "${c.title}"`).join('\n')}`, 3);
      for (const [target, relation] of given) {
        if (relation === 'DUPLICATE') die(`${target} already covers this; link a signal to it or ask the owner to MERGE instead of creating a duplicate`, 3);
        events.push(newEvent({ type: 'link_added', entity: id, actor: by, channel: CHANNEL, data: { target, relation }, reason }));
      }
    }
    write(events);
    console.log(id);
  },

  set() {
    const id = positional[0] ?? die('pm set <ID> --field k=v');
    const fields = fieldsFromFlags();
    if ('status' in fields) die('use `pm transition` to change status');
    fields.updated_at = today();
    write([newEvent({ type: 'entity_updated', entity: id, actor: actor(), channel: CHANNEL, data: { fields }, reason: need('reason') })]);
  },

  transition() {
    const [id, to] = positional;
    if (!id || !to) die('pm transition <ID> <STATUS>');
    const s = materialize(readEvents());
    const e = s.entities.get(id) ?? die(`${id}: not found`);
    const data = { from: e.status, to, updated_at: today() };
    if (flags.stage !== undefined) data.stage = flags.stage === true ? die('--stage needs a value') : flags.stage;
    if (flags.progress !== undefined) {
      data.progress = Number(flags.progress);
      if (flags.progress === true || !Number.isFinite(data.progress)) die(`--progress must be a number (got ${flags.progress === true ? 'nothing' : JSON.stringify(flags.progress)})`);
    }
    write([newEvent({ type: 'status_changed', entity: id, actor: actor(), channel: CHANNEL, data, reason: need('reason') })]);
  },

  review() {
    const id = positional[0] ?? die('pm review <ID> …');
    const s = materialize(readEvents());
    const by = actor();
    const data = {
      review_id: nextSubId(allReviews(s), 'review_id', 'REV'),
      reviewer: by,
      executor: flags.executor ?? null,
      review_type: need('type'),
      result: need('result'),
      independent: !!flags.independent,
      findings: need('findings'),
      round: s.reviews.filter((r) => r.target === id && r.reviewer === by).length + 1,
    };
    write([newEvent({ type: 'review_recorded', entity: id, actor: by, channel: CHANNEL, data, reason: flags.reason ?? null, evidence: flags.evidence ? String(flags.evidence).split('|') : null })]);
    console.log(data.review_id);
  },

  'review-invalidate'() {
    const rid = positional[0] ?? die('pm review-invalidate <REV-ID> --by <role> --reason "…"');
    const s = materialize(readEvents());
    const by = actor();
    const reason = need('reason');
    const r = allReviews(s).find((x) => x.review_id === rid) ?? die(`${rid}: not a recorded review`);
    if (r.invalidated) die(`${rid} is already invalidated (by ${r.invalidated.by} at ${r.invalidated.ts}); an invalidation is final`, 2);
    write([newEvent({ type: 'review_invalidated', entity: r.target, actor: by, channel: CHANNEL, data: { review_id: rid, reviewer: r.reviewer, result: r.result }, reason })]);
  },

  evidence() {
    const id = positional[0] ?? die('pm evidence <OPP> …');
    const s = materialize(readEvents());
    const data = {
      evidence_id: nextSubId([...s.evidence.values()].flat(), 'evidence_id', 'EV'),
      evidence_type: need('type'), stance: need('stance'), quality: need('quality'),
      claim: need('claim'), source: need('source'), date: flags.date ?? today(), strength: flags.strength ?? null,
    };
    write([newEvent({ type: 'evidence_added', entity: id, actor: actor(), channel: CHANNEL, data, reason: flags.reason ?? null })]);
    console.log(data.evidence_id);
  },

  link() {
    const [id, target] = positional;
    if (!id || !target) die('pm link <ID> <TARGET> --relation R');
    write([newEvent({ type: 'link_added', entity: id, actor: actor(), channel: CHANNEL, data: { target, relation: need('relation') }, reason: need('reason') })]);
  },

  'suggest-priority-review'() {
    const id = positional[0] ?? die('pm suggest-priority-review <OPP> --reason …');
    write([newEvent({ type: 'priority_review_suggested', entity: id, actor: actor(), channel: CHANNEL, data: {}, reason: need('reason') })]);
  },

  'attempt-failed'() {
    const id = positional[0] ?? die('pm attempt-failed <TASK>');
    write([newEvent({ type: 'attempt_failed', entity: id, actor: actor(), channel: CHANNEL, data: {}, reason: need('reason') })]);
  },

  note() {
    const id = positional[0] ?? die('pm note <ID> --text …');
    write([newEvent({ type: 'note', entity: id, actor: actor(), channel: CHANNEL, data: { text: need('text') }, reason: flags.reason ?? null })]);
  },

  async owner() {
    // Interactive only. An agent's shell is not a TTY, and the PreToolUse guard
    // refuses `pm owner` outright; see agent-os/THREAT_MODEL.md for the limits.
    if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT)
      die('pm owner runs only in the owner\'s own interactive terminal (not from an agent session). Use the dashboard, or run it yourself.', 4);
    const [sub, id, decision] = positional;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const yes = await rl.question(`Record as the project OWNER: ${sub} ${id ?? ''} ${decision ?? ''}. Type "owner" to confirm: `);
    rl.close();
    if (yes.trim() !== 'owner') die('not confirmed');
    ensureOwnerKey(); // the owner's own terminal is one of the two places the key may be created
    const events = ownerEvents(sub, id, decision, flags, 'owner-cli');
    write(events);
  },

  'migrate-v1'() {
    const existing = readEvents();
    if (existing.some((e) => e.type === 'v1_imported')) die('V1 already imported — the log is append-only; nothing to do');
    const map = enums().legacy_mappings.task_status;
    const events = [];
    const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    for (const [id, file] of [...recordFiles()].sort(([a], [b]) => a.localeCompare(b))) {
      const { meta, ok } = parse(readFileSync(join(PM, file), 'utf8'));
      if (!ok) die(`${file}: no front matter`);
      if (meta.id !== id) die(`${file}: id ${meta.id} does not match file name`);
      const fields = { ...meta };
      delete fields.id;
      if (id.startsWith('TASK-') && map[fields.status]) fields.status = map[fields.status];
      events.push(newEvent({ type: 'v1_imported', entity: id, actor: 'system', channel: 'migration', data: { fields, v1_file: file }, reason: 'CR-0003 M5: V1 record imported unchanged into canonical state', ts }));
    }
    if (flags['dry-run']) return console.log(`${events.length} records would be imported`);
    try {
      commit(events, null, { migration: true });
    } catch (e) {
      die(e.message, 2);
    }
    console.log(`imported ${events.length} V1 records`);
    sync();
  },
};

// The flags each command reads. Anything else is refused before the command
// runs: a mistyped or imagined flag (`--dry-run` on a write) used to be
// ignored silently, so the caller believed one thing and the log got another.
const WRITE = ['by', 'reason'];
const FLAGS = {
  help: [],
  show: [],
  list: ['status'],
  attention: [],
  route: ['paths', 'level', 'type', 'user-facing', 'visual', 'json'],
  similar: [],
  metrics: [],
  check: [],
  sync: [],
  create: [...WRITE, 'json', 'field', 'id', 'relation'],
  set: [...WRITE, 'json', 'field'],
  transition: [...WRITE, 'stage', 'progress'],
  review: [...WRITE, 'type', 'result', 'independent', 'executor', 'findings', 'evidence'],
  'review-invalidate': WRITE,
  evidence: [...WRITE, 'type', 'stance', 'quality', 'claim', 'source', 'date', 'strength'],
  link: [...WRITE, 'relation'],
  'suggest-priority-review': WRITE,
  'attempt-failed': WRITE,
  note: [...WRITE, 'text'],
  owner: ['reason', 'questions', 'invalidated_if', 'revisit_when', 'suggested_priority', 'target_milestone', 'merged_into', 'authority_level', 'preferences'],
  'migrate-v1': ['dry-run'],
};

const run = commands[cmd] ?? (cmd ? () => die(`unknown command "${cmd}" — pm help`) : commands.help);
// Fail closed: a command added without a FLAGS entry is refused, not unchecked.
if (commands[cmd] && !FLAGS[cmd]) die(`pm ${cmd} has no entry in FLAGS (agent-os/tools/pm.mjs); add the flags it reads before using it`);
if (FLAGS[cmd]) {
  const unknown = Object.keys(flags).filter((k) => !FLAGS[cmd].includes(k));
  if (unknown.length)
    die(`unknown flag(s) for ${cmd}: ${unknown.map((k) => '--' + k).join(', ')} — nothing was written. ${cmd} accepts ${FLAGS[cmd].map((k) => '--' + k).join(', ') || 'no flags'}${cmd === 'route' ? ' (did you mean --paths?)' : ''}.`);
}
await run();
