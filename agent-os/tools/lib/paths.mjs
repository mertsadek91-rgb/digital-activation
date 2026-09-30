import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every path can be redirected with PM_ROOT so the evals run against an
// isolated copy and never touch the real project state.
const here = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(process.env.PM_ROOT ?? join(here, '..', '..', '..'));
export const AOS = join(REPO, 'agent-os');
export const PM = join(REPO, 'project-management');
export const STATE_DIR = join(AOS, 'state');
export const EVENTS = join(STATE_DIR, 'events.jsonl');

// Entity kinds: id prefix → where its narrative file lives. Tasks are filed by
// status so the folder tree reads like a board (a V1 convention kept as is).
export const KINDS = {
  TASK: { kind: 'task', schema: 'task', folder: 'tasks' },
  BUG: { kind: 'issue', schema: 'issue', folder: 'issues' },
  CR: { kind: 'change_request', schema: 'change-request', folder: 'change-requests' },
  DEC: { kind: 'decision', schema: 'decision', folder: 'decisions' },
  CONSENSUS: { kind: 'consensus', schema: 'consensus', folder: 'consensus' },
  EPIC: { kind: 'epic', schema: 'epic', folder: 'epics' },
  MILESTONE: { kind: 'milestone', schema: 'milestone', folder: 'milestones' },
  OPP: { kind: 'opportunity', schema: 'opportunity', folder: 'opportunities' },
  SIG: { kind: 'signal', schema: 'signal', folder: 'signals' },
  INS: { kind: 'insight', schema: 'insight', folder: 'insights' },
  REL: { kind: 'release', schema: 'release', folder: 'releases' },
};

export const prefixOf = (id) => String(id).split('-')[0];
export const kindOf = (id) => KINDS[prefixOf(id)];
