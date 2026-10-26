import {
  type AgentItemResult,
  type AgentLogCode,
  type AgentLogEntry,
  type AgentPlan,
  agentLogEntrySchema,
  agentPlanSchema,
} from '@da/contracts';

import { OpenCodeError } from '../supplier/ai/opencode.js';

/**
 * The product agent's pure rules (CR-0007), kept apart from the services so
 * a test pins them without a database or a model.
 */

/** Ticks of the worker. Short: the cooldown, not the tick, paces a batch. */
export const TICK_MS = 10_000;
/** A RUNNING item whose heartbeat is older than this has lost its worker. */
export const STALE_MS = 15 * 60 * 1000;
/** After a rate limit or an overloaded provider, the whole batch waits this long. */
export const BACKOFF_MS = 5 * 60 * 1000;
/** Tries per item, rate-limit retries and lost workers included. */
export const MAX_ATTEMPTS = 3;
/** Log lines kept per item; the oldest go first. */
export const MAX_LOG = 60;

/** An item that should not run, with the reason shown in its log. */
export class SkipItemError extends Error {
  constructor(
    readonly code: AgentLogCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Whether an error is the provider asking us to slow down, or a failure that
 * is likely to pass (an overloaded model, a timeout) — retried after a
 * backoff rather than failing the product. The services wrap OpenCode's
 * errors in a BadRequest that keeps only the message, so the message is
 * read too, in both panel languages.
 */
export function isTransient(error: unknown): boolean {
  if (error instanceof OpenCodeError && error.status !== null) {
    return error.status === 429 || error.status >= 500;
  }
  const message = error instanceof Error ? error.message : '';
  return /OpenCode (429|5\d\d)\b|OpenCode did not answer|did not finish its answer|لم يُكمل النموذج|rate.?limit|too many requests|overloaded/i.test(
    message,
  );
}

export function appendLog(
  log: unknown,
  code: AgentLogCode,
  level: AgentLogEntry['level'],
  detail = '',
  now = new Date(),
): AgentLogEntry[] {
  const current = readLog(log);
  current.push({ at: now.toISOString(), code, level, detail: detail.slice(0, 2000) });
  return current.slice(-MAX_LOG);
}

export function readLog(log: unknown): AgentLogEntry[] {
  if (!Array.isArray(log)) return [];
  return log.flatMap((entry) => {
    const parsed = agentLogEntrySchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

export function emptyResult(): AgentItemResult {
  return {
    productSlug: null,
    created: false,
    category: null,
    copyLocales: [],
    card: null,
    published: null,
    blockers: [],
  };
}

/**
 * The model's plan, checked. Section ids it names that do not exist are
 * dropped; a "keep" with nothing to keep, or an "assign" left with no valid
 * id, becomes a create when creating is allowed and a keep otherwise.
 */
export function checkPlan(
  raw: unknown,
  known: ReadonlySet<string>,
  current: readonly string[],
  allowCreate: boolean,
): { plan: AgentPlan } | { error: string } {
  const parsed = agentPlanSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: parsed.error.issues
        .slice(0, 6)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    };
  }
  const plan = parsed.data;
  const ids = [...new Set(plan.category.categoryIds.filter((id) => known.has(id)))].slice(0, 3);
  let action = plan.category.action;
  if (action === 'create' && (!allowCreate || !plan.category.create)) {
    action = ids.length > 0 ? 'assign' : 'keep';
  }
  if (action === 'assign' && ids.length === 0) action = 'keep';
  if (action === 'keep' && current.length === 0 && allowCreate && plan.category.create) {
    action = 'create';
  }
  const create = plan.category.create
    ? {
        ...plan.category.create,
        parentId:
          plan.category.create.parentId && known.has(plan.category.create.parentId)
            ? plan.category.create.parentId
            : null,
      }
    : null;
  return { plan: { ...plan, category: { ...plan.category, action, categoryIds: ids, create } } };
}

/** The text of a page's body, as the copy prompt counts it: is there anything to improve. */
export function hasBody(body: unknown): boolean {
  return Array.isArray(body) && body.length > 0;
}

/**
 * A model-written product name as plain text: no markup characters, no
 * control characters, one space between words. The name is rendered as text
 * everywhere, but it is a public field the model wrote, so it is held to what
 * a person would type (REV-0196).
 */
export function plainName(name: string): string {
  return (
    name
      // Markup, control characters, and the invisible marks that reorder text.
      .replace(/[<>\p{Cc}\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
  );
}
