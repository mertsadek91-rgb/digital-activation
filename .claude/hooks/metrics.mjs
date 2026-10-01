#!/usr/bin/env node
// PostToolUse: one line per tool call, for the cost & complexity governor
// (`node agent-os/tools/pm.mjs metrics`). Records the tool name and session —
// never tool input or output, so nothing sensitive lands here. Gitignored.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.env.CLAUDE_PROJECT_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
try {
  const p = JSON.parse(raw || '{}');
  const dir = join(ROOT, '.claude', 'metrics');
  mkdirSync(dir, { recursive: true });
  const failed = p.tool_response && typeof p.tool_response === 'object' && (p.tool_response.is_error || p.tool_response.error) ? true : false;
  appendFileSync(join(dir, 'tool-calls.jsonl'), JSON.stringify({ ts: new Date().toISOString(), session: p.session_id ?? null, tool: p.tool_name ?? null, failed }) + '\n');
} catch {
  /* never block */
}
