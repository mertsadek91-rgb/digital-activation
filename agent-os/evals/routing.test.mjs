// Routing evals, built from real project work: does the router pick the
// smallest relevant team, explain each member, and keep reviewers independent?
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { route } from '../tools/lib/router.mjs';

const roles = (r) => r.team.map((m) => m.role);
const EXEC = new Set(['exec-director']);

test('minor isolated UI fix (TASK-0062): implementer plus visual verification, no management', () => {
  const r = route({ paths: ['apps/admin/src/app/layout.tsx'] });
  assert.equal(r.level, 2);
  assert.ok(r.team.length <= 3, roles(r).join());
  assert.deepEqual(roles(r), ['frontend-engineer', 'responsive-design-specialist']);
  assert.ok(!roles(r).some((x) => EXEC.has(x) || x.startsWith('pm-')));
});

test('shared design-system change: design system owner, art direction, independent review, visual QA', () => {
  const r = route({ paths: ['packages/ui/src/tokens.css'] });
  assert.equal(r.level, 3);
  for (const x of ['design-system-architect', 'art-director', 'qa-lead', 'responsive-design-specialist']) assert.ok(roles(r).includes(x), x);
  assert.ok(r.team.length <= r.fan_out_limit);
});

test('auth change (TASK-0013): auth owner, security review, QA and a second manager', () => {
  const r = route({ paths: ['apps/api/src/auth/auth.service.ts'] });
  assert.equal(r.level, 4);
  assert.equal(r.decision_class, 'auth');
  for (const x of ['auth-rbac-specialist', 'security-engineer', 'qa-lead', 'pm-06']) assert.ok(roles(r).includes(x), x);
});

test('auth redesign at L5 adds the decision-rights reviewers', () => {
  const r = route({ paths: ['apps/api/src/auth/auth.service.ts'], level: 5 });
  assert.ok(roles(r).includes('backend-architect'));
  assert.ok(r.team.length <= r.fan_out_limit);
});

test('database change routes the database architect; SEO route change routes technical SEO', () => {
  assert.ok(roles(route({ paths: ['packages/db/prisma/schema/40-orders.prisma'] })).includes('database-architect'));
  const seo = route({ paths: ['apps/storefront/src/proxy.ts'], level: 4 });
  assert.equal(seo.decision_class, 'seo_routes');
  assert.ok(roles(seo).includes('technical-seo-specialist'));
});

test('the ownership floor raises the level: sweeps touching checkout are L4 (TASK-0010)', () => {
  assert.equal(route({ paths: ['apps/api/src/checkout/expiry-sweep.service.ts'], level: 3 }).level, 4);
});

test('reviewers never run as the implementer (main); implementers may', () => {
  for (const paths of [['apps/api/src/auth/auth.service.ts'], ['packages/ui/src/tokens.css'], ['apps/storefront/src/proxy.ts']]) {
    const r = route({ paths, level: 5 });
    for (const m of r.team) if (m.as === 'reviewer') assert.notEqual(m.executor, 'main', `${m.role} reviews as main`);
  }
});

test('every routed member has a reason', () => {
  const r = route({ paths: ['apps/api/src/vault/vault.service.ts', 'apps/storefront/src/app/[locale]/page.tsx'] });
  for (const m of r.team) assert.ok(m.reason && m.reason.length > 10, m.role);
});

test('opportunity shaping: engineering always, design when user-facing, art direction when visual', () => {
  const plain = route({ type: 'opportunity_shaping' });
  assert.deepEqual(roles(plain), ['product-opportunity-lead', 'embedded-product-engineer']);
  const visual = route({ type: 'opportunity_shaping', userFacing: true, visual: true });
  assert.ok(roles(visual).includes('product-ui-designer'));
  assert.ok(roles(visual).includes('art-director'));
  assert.equal(visual.over_limit, false);
});

test('research is a single read-only analyst, not a team', () => {
  const r = route({ type: 'research' });
  assert.deepEqual(roles(r), ['competitor-intelligence-analyst']);
  assert.equal(r.team[0].executor, 'subagent:research-analyst');
});
