import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AOS, PM } from './paths.mjs';

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
const memo = new Map();
const once = (k, f) => (memo.has(k) ? memo.get(k) : (memo.set(k, f()), memo.get(k)));

export const permissions = () => once('perm', () => load(join(PM, 'PERMISSIONS.json')));
export const config = () => once('config', () => load(join(PM, 'PROJECT_CONFIG.json')));
export const governor = () => once('gov', () => load(join(AOS, 'policies', 'governor.json')));
export const decisionRights = () => once('dr', () => load(join(AOS, 'policies', 'decision-rights.json')));
export const routing = () => once('route', () => load(join(AOS, 'policies', 'routing.json')));
export const people = () => ({ ...permissions().managers, ...permissions().roles });

// The project owner is not a catalog role; owner-only events carry actor "owner".
export const OWNER = 'owner';
export const OWNER_CHANNELS = new Set(['dashboard', 'owner-cli']);
