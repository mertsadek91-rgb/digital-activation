// Owner proof. Every owner-only event carries data.owner_proof: an HMAC over
// the event made with a key that lives OUTSIDE the repository
// (~/.agent-os/owner.key, or AGENT_OS_OWNER_KEY_FILE). The key is created only
// by the owner's own interactive paths (dashboard in owner mode, `pm owner`).
//
// This closes REV-0004 H1: importing lib/owner.mjs and calling commit() no
// longer yields an accepted owner decision, because the forger has no key.
// The guard also refuses reading the key file and calling the state libraries
// from a shell. Residual risk (a script file that reads the key) is recorded in
// agent-os/THREAT_MODEL.md.
import crypto from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const keyFile = () => process.env.AGENT_OS_OWNER_KEY_FILE ?? join(homedir(), '.agent-os', 'owner.key');

export function ownerKey() {
  const f = keyFile();
  return existsSync(f) ? readFileSync(f, 'utf8').trim() : null;
}

/** Owner paths only: create the key on first use. */
export function ensureOwnerKey() {
  const existing = ownerKey();
  if (existing) return existing;
  const f = keyFile();
  mkdirSync(dirname(f), { recursive: true });
  const k = crypto.randomBytes(32).toString('hex');
  writeFileSync(f, k + '\n', { mode: 0o600 });
  try {
    chmodSync(f, 0o600);
  } catch {
    /* best effort on Windows */
  }
  return k;
}

const payload = (ev) => {
  const { owner_proof: _p, ...data } = ev.data ?? {};
  return JSON.stringify([ev.id, ev.ts, ev.type, ev.actor, ev.channel, ev.entity, data]);
};

export function sign(ev, key) {
  ev.data = { ...(ev.data ?? {}), owner_proof: crypto.createHmac('sha256', key).update(payload(ev)).digest('hex') };
  return ev;
}

/** 'valid' | 'missing' | 'invalid' | 'unverifiable' (no key on this machine, e.g. CI). */
export function verify(ev, key = ownerKey()) {
  const proof = ev.data?.owner_proof;
  if (!proof) return 'missing';
  if (!key) return 'unverifiable';
  const want = crypto.createHmac('sha256', key).update(payload(ev)).digest('hex');
  return proof.length === want.length && crypto.timingSafeEqual(Buffer.from(proof), Buffer.from(want)) ? 'valid' : 'invalid';
}
