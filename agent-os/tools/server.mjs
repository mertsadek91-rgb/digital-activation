#!/usr/bin/env node
// Dashboard server. `pnpm pm:dashboard` → http://127.0.0.1:4600/
//
//   GET  /api/state        live projection of canonical state (computed per request — never stale)
//   GET  /api/session      whether owner actions are available in this server
//   POST /api/owner/*      owner decisions: decision, ranking, portfolio, accept-risk
//
// Owner actions are enabled only when the server was started from an
// interactive terminal outside an agent session. It then prints a one-time
// owner link; requests must carry that token and a same-origin header. A server
// started by an agent (preview pane, background shell) is read-only. Limits of
// this protection are written down in agent-os/THREAT_MODEL.md.

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';

import { ensureOwnerKey } from './lib/owner-key.mjs';
import { ownerEvents } from './lib/owner.mjs';
import { PM, REPO } from './lib/paths.mjs';
import { bodiesOf, project } from './lib/project.mjs';
import { writeGuards } from './lib/rules.mjs';
import { commit } from './lib/state.mjs';

const port = Number(process.env.PM_DASHBOARD_PORT ?? process.argv[2] ?? 4600);
const inAgent = !!(process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT);
const ownerMode = Boolean(process.stdin.isTTY && process.stdout.isTTY && !inAgent && process.env.PM_DASHBOARD_READONLY !== '1');
const token = ownerMode ? crypto.randomBytes(24).toString('base64url') : null;
if (ownerMode) ensureOwnerKey(); // owner mode is one of the two places the owner key may be created
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };

function send(res, code, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const c of req) {
    raw += c;
    if (raw.length > 64_000) throw new Error('body too large');
  }
  return JSON.parse(raw || '{}');
}

function ownerAllowed(req) {
  if (!ownerMode) return 'This dashboard was not started by the owner in an interactive terminal; it is read-only.';
  const origin = req.headers.origin;
  if (origin && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) return 'cross-origin request refused';
  const given = String(req.headers['x-owner-token'] ?? '');
  if (given.length !== token.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token))) return 'owner token missing or wrong — open the owner link printed in the terminal that started the dashboard';
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return 'JSON only';
  return null;
}

function syncProjections() {
  execFileSync(process.execPath, [join(REPO, 'agent-os', 'tools', 'pm.mjs'), 'sync'], { cwd: REPO, stdio: 'ignore' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  // DNS-rebinding defence (REV-0004 L2): answer only requests addressed to this machine.
  const host = String(req.headers.host ?? '');
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) return send(res, 421, { error: 'misdirected request' });
  try {
    if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, { ...project({ check: true, now: new Date() }).data, live: true, owner_mode: ownerMode });
    if (req.method === 'GET' && url.pathname === '/api/session') return send(res, 200, { owner_mode: ownerMode });
    if (req.method === 'POST' && url.pathname.startsWith('/api/owner/')) {
      const refusal = ownerAllowed(req);
      if (refusal) return send(res, 403, { error: refusal });
      const body = await readBody(req);
      const action = url.pathname.slice('/api/owner/'.length);
      const map = { decision: ['decide', body.id, body.decision], ranking: ['rank', (body.order ?? []).join(','), null], portfolio: ['portfolio', null, null], 'accept-risk': ['accept-risk', body.id, null] };
      if (!map[action]) return send(res, 404, { error: 'unknown owner action' });
      const [sub, id, decision] = map[action];
      if (sub === 'decide' && !body.reason) return send(res, 400, { error: 'a reason is required for every owner decision' });
      const events = ownerEvents(sub, id, decision, { ...body, preferences: body.preferences }, 'dashboard');
      const bodies = bodiesOf();
      try {
        commit(events, (b, a, evs) => writeGuards(b, a, evs, { bodies }));
      } catch (e) {
        return send(res, 422, { error: e.message, refusals: e.refusals ?? [] });
      }
      syncProjections();
      return send(res, 200, { ok: true, events: events.map((e) => ({ id: e.id, type: e.type, entity: e.entity })) });
    }
    if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });
    // Static: the dashboard, plus the human-readable docs it links to.
    // The dashboard's asset paths are relative, so it must be served from /dashboard/.
    if (url.pathname === '/' || url.pathname === '/dashboard' || url.pathname === '/dashboard/')
      return send(res, 302, '', 'text/plain', { location: '/dashboard/index.html' });
    const p = decodeURIComponent(url.pathname);
    const full = resolve(normalize(join(PM, p)));
    // Containment by relative path, not string prefix (REV-0004 L1: a sibling
    // "project-management-evil" directory passed a startsWith check).
    const inside = relative(resolve(PM), full);
    if (!inside || inside.startsWith('..') || isAbsolute(inside) || !existsSync(full) || statSync(full).isDirectory()) return send(res, 404, 'not found', 'text/plain');
    if (/\.(log|jsonl|key)$/i.test(full) || /(^|[\\/])(state|logs)([\\/]|$)/i.test(inside)) return send(res, 404, 'not found', 'text/plain');
    return send(res, 200, readFileSync(full), TYPES[extname(full)] ?? 'application/octet-stream');
  } catch (e) {
    return send(res, 500, { error: e.message });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Agent OS dashboard: http://127.0.0.1:${port}/`);
  if (ownerMode) console.log(`Owner link (this terminal only — do not share): http://127.0.0.1:${port}/dashboard/index.html#owner=${token}`);
  else console.log('Read-only: owner actions are disabled (not an interactive owner terminal).');
});
