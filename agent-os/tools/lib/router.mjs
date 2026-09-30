// Dynamic agent router. Existing role ≠ active agent: the router picks the
// smallest team the work needs and says why each member is there.
//
//   route({ paths, level, type, userFacing, visual }) →
//     { level, domains, decision_class, workflow, team:[{role, executor, reason, required}], trimmed, fan_out_limit }

import { matchesAny } from './glob.mjs';
import { decisionRights, governor, people, routing } from './policy.mjs';

export function route({ paths = [], level = null, type = null, userFacing = false, visual = false } = {}) {
  const R = routing();
  const P = people();
  const team = [];
  // Implementers run where they are mapped (usually the main session). A role
  // routed as a reviewer always runs in a fresh context — never `main`.
  const exec = (role, as) => {
    const e = R.executors[role] ?? R.executors.default;
    return as === 'reviewer' && e === 'main' ? R.reviewer_executor_default : e;
  };
  const add = (role, reason, required = true, as = 'reviewer') => {
    if (!role || team.some((m) => m.role === role)) return;
    team.push({ role, title: P[role]?.title ?? role, as, executor: exec(role, as), reason, required });
  };

  // Research / audit / shaping are read-only kinds of work with fixed small teams.
  const override = type && R.type_overrides[type];
  if (override) {
    const lv = Math.min(level ?? 1, override.max_level);
    for (const role of override.team) add(role, `${type}: core role`, true, 'contributor');
    if (userFacing) for (const role of override.add_if_user_facing ?? []) add(role, 'user-facing: design shapes the experience before approval');
    if (visual) for (const role of override.add_if_visual ?? []) add(role, 'changes visual expression: art direction reviews coherence and brand');
    return finish({ level: lv, type, domains: [], decision_class: type === 'opportunity_shaping' ? 'opportunity_approval' : null, workflow: R.level_requirements[lv].workflow, team });
  }

  // routing.json lists domains from most to least specific; each path belongs
  // to the first domain that matches it (proxy.ts → storefront-routing, not storefront).
  const specific = [];
  for (const p of paths) {
    const d = R.domains.find((x) => matchesAny(p, x.paths));
    if (d && !specific.includes(d)) specific.push(d);
  }
  const lead = specific.reduce((best, d) => (!best || d.min_level > best.min_level ? d : best), null);
  const lv = Math.max(level ?? 0, ...specific.map((d) => d.min_level), 1);
  const req = R.level_requirements[String(lv)];

  if (lead) add(lead.primary, `owns ${lead.id} (${lead.paths[0]}${lead.paths.length > 1 ? ', …' : ''})`, true, 'implementer');
  else add('backend-engineer', 'no domain matched these paths; default implementer — confirm the owner', true, 'implementer');

  const tags = new Set(specific.flatMap((d) => d.tags));
  if (userFacing) tags.add('user_facing');
  if (visual) tags.add('visual');

  if (lv >= 2 && tags.has('user_facing')) add(R.tag_specialists.user_facing.role, R.tag_specialists.user_facing.reason, lv >= 2);
  if (req.independent_review) add(R.independent_reviewer_role, `level ${lv}: the implementer may not be the only evaluator of its own work`);
  for (const [tag, spec] of Object.entries(R.tag_specialists)) {
    if (tag === 'user_facing') continue;
    if (tags.has(tag) && lv >= spec.from_level) add(spec.role, spec.reason);
  }
  if (req.second_manager)
    for (const d of specific) for (const r of d.reviewers) if (r.startsWith('pm-') || r === 'exec-director') add(r, `level ${lv}: cross-domain review for ${d.id}`);
  let decision_class = lead?.decision_class ?? null;
  if (req.consensus && decision_class) {
    const cls = decisionRights().classes[decision_class];
    for (const r of cls.required_reviewers) add(r, `level 5 ${decision_class}: required reviewer in the decision-rights matrix`);
  }
  return finish({ level: lv, domains: specific.map((d) => d.id), decision_class, workflow: req.workflow, team });
}

function finish(result) {
  const gv = governor();
  const limit = (result.type && gv.max_fan_out_by_type?.[result.type]) ?? gv.max_fan_out_by_level[String(result.level)];
  const trimmed = [];
  while (result.team.length > limit) {
    const i = result.team.findLastIndex((m) => !m.required);
    if (i < 0) break;
    trimmed.push(result.team.splice(i, 1)[0]);
  }
  return { ...result, fan_out_limit: limit, over_limit: result.team.length > limit, trimmed };
}
