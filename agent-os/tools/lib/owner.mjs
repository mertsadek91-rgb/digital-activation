// Owner actions. Shared by the interactive owner CLI and the dashboard server;
// never reachable from an agent's `pm` command (see writeGuards + THREAT_MODEL).
import { ownerKey, sign } from './owner-key.mjs';
import { materialize, newEvent, nextId, readEvents } from './state.mjs';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Build the owner's events, each signed with the owner key. Without the key
 * (anyone who is not the owner, on a machine where the owner never ran the
 * dashboard in owner mode) the events are unsigned, and writeGuards refuses them.
 */
export function ownerEvents(sub, id, decision, f, channel) {
  const key = ownerKey();
  const events = buildOwnerEvents(sub, id, decision, f, channel);
  return key ? events.map((e) => sign(e, key)) : events;
}

function buildOwnerEvents(sub, id, decision, f, channel) {
  const s = materialize(readEvents());
  const reason = f.reason ?? null;
  if (sub === 'rank') return [newEvent({ type: 'ranking_set', entity: 'ROADMAP', actor: 'owner', channel, data: { order: String(id).split(',').filter(Boolean) }, reason })];
  if (sub === 'accept-risk') return [newEvent({ type: 'risk_accepted', entity: id, actor: 'owner', channel, data: { reason }, reason })];
  if (sub === 'portfolio') return [newEvent({ type: 'portfolio_preferences_set', entity: 'PORTFOLIO', actor: 'owner', channel, data: { preferences: f.preferences ?? {} }, reason })];
  if (sub !== 'decide') throw new Error(`unknown owner action ${sub}`);
  const opp = s.entities.get(id);
  if (!opp) throw new Error(`${id}: not found`);
  const events = [];
  const data = { decision, reason, questions: f.questions ?? null, invalidated_if: f.invalidated_if ?? null };
  if (f.revisit_when) data.revisit_when = f.revisit_when;
  if (f.suggested_priority) data.suggested_priority = f.suggested_priority;
  if (f.target_milestone) data.target_milestone = f.target_milestone;
  if (decision === 'MERGE') data.merged_into = f.merged_into ?? null;
  if (decision === 'APPROVE' || decision === 'APPROVE_AND_PRIORITIZE') {
    // Approval hands the opportunity to the existing change workflow: a CR that
    // inherits the shaped context and points back at the opportunity.
    const cr = opp.related_change_request ?? nextId(s, 'CR');
    if (!opp.related_change_request)
      events.push(newEvent({
        type: 'entity_created', entity: cr, actor: 'owner', channel,
        data: { fields: {
          title: opp.title, status: 'APPROVED', authority_level: f.authority_level ?? 3, risk: { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', VERY_HIGH: 'CRITICAL' }[opp.risk] ?? 'MEDIUM',
          responsible_manager: 'pm-01', departments: ['Product', 'Product Evolution'], consensus_required: false, tasks: [],
          source_opportunity: opp.id, created_at: today(), updated_at: today(),
        } },
        reason: `approved from ${opp.id}`,
      }));
    data.related_change_request = cr;
  }
  events.push(newEvent({ type: 'opportunity_decided', entity: id, actor: 'owner', channel, data, reason }));
  return events;
}

