#!/usr/bin/env node
// PreToolUse guard. Policy: agent-os/policies/guard.json. Tests:
// agent-os/evals/guard.test.mjs. Runs in every permission mode, including
// bypassPermissions, so `deny` rules hold even when prompts are off.
//
// Hardened after the REV-0004 adversarial review:
//   - secrets are recognised by FILE NAME anywhere on disk (the main checkout's
//     .env lives outside this worktree), with Windows name tricks normalised
//     (.ENV, `.env.`, `.env::$DATA`);
//   - shell commands that mention a secret file at all are refused (reading via
//     base64/sort/node/python/source is still reading);
//   - deletions are checked against protected roots, the roots themselves and
//     their ancestors (rm -rf ./agent-os/state/, Remove-Item, find -delete);
//   - shell write targets are resolved through `cd`, backslashes and heredocs
//     fed to interpreters, and matched case-insensitively.
// Known limits (script files that write, obfuscated names) are in
// agent-os/THREAT_MODEL.md.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.CLAUDE_PROJECT_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const { matchesCI } = await import(pathToFileURL(join(ROOT, 'agent-os', 'tools', 'lib', 'glob.mjs')).href);
const policy = JSON.parse(readFileSync(join(ROOT, 'agent-os', 'policies', 'guard.json'), 'utf8'));

const SECRET_NAME = policy.secret_files.names.map((r) => new RegExp(r, 'i'));
const SECRET_EXCEPT = policy.secret_files.except.map((r) => new RegExp(r, 'i'));
const SECRET_EXT = policy.secret_files.extensions.map((r) => new RegExp(r, 'i'));
const lc = (s) => s.toLowerCase();

// ------------------------------------------------------------------ paths

/** Normalise Windows name tricks: trailing dots/spaces and NTFS streams. */
function normName(name) {
  return name.replace(/:+\$?[A-Za-z]*$/, '').replace(/[. ]+$/, '');
}
function segmentsOf(p) {
  return String(p).replace(/\\/g, '/').split('/').filter(Boolean).map(normName);
}
function isSecretFile(p) {
  const segs = segmentsOf(p);
  const name = segs.at(-1) ?? '';
  if (SECRET_EXCEPT.some((r) => r.test(name))) return false;
  if (SECRET_NAME.some((r) => r.test(name))) return true;
  const under = policy.secret_files.extensions_only_under.map(lc);
  return SECRET_EXT.some((r) => r.test(name)) && segs.some((s) => under.includes(lc(s)));
}
function inProtectedSegment(p) {
  const segs = segmentsOf(p).map(lc);
  return policy.protected_segments.segments.map(lc).some((s) => segs.includes(s));
}
/** Repo-relative POSIX path, or null when the path is outside the project. */
function relPath(p, cwd = '') {
  if (!p) return null;
  const clean = String(p).replace(/\\/g, '/');
  const drive = /^[A-Za-z]:\//.test(clean);
  // A drive-letter path can never be inside a POSIX checkout (CI runs on
  // Linux); without this, relative() would read `C:/Users/…` as a subfolder.
  if (drive && !/^[A-Za-z]:\//.test(String(ROOT).replace(/\\/g, '/'))) return null;
  const abs = isAbsolute(clean) || drive ? clean : resolve(ROOT, cwd, clean);
  const r = relative(ROOT, abs).split('\\').join('/');
  if (r.startsWith('..') || isAbsolute(r)) return null;
  return segmentsOf(r).join('/');
}
function firstMatch(list, path) {
  return list.find((r) => matchesCI(path, r.glob) && (r.when !== 'exists' || existsSync(join(ROOT, path))));
}
/** Deleting a protected root, anything inside it, or anything that contains it. */
function deletesProtected(rel) {
  if (rel === '' || rel === '.') return 'the whole repository';
  const p = lc(rel);
  for (const root of policy.delete_protected_roots.map(lc)) if (p === root || p.startsWith(root + '/') || root.startsWith(p + '/')) return root;
  return null;
}

// ------------------------------------------------------------------ shell

const unquote = (t) => t.replace(/^["']|["']$/g, '').replace(/["']/g, '');
const INTERPRETER = /^(bash|sh|zsh|dash|ksh|pwsh|powershell|node|python3?|deno|bun|ruby|perl)$/i;
const PS_DELETE = /^(Remove-Item|ri|del|erase|rd|rmdir)$/i;
const PS_WRITE = /^(Set-Content|sc|Add-Content|ac|Out-File|New-Item|ni|Move-Item|mi|move|Copy-Item|cpi|copy|Rename-Item|rni|ren|Clear-Content|clc)$/i;

/** Expand heredocs: bodies fed to an interpreter are commands; others are data. */
function expandHeredocs(cmd) {
  return cmd.replace(/^([^\n]*?)<<-?\s*(['"]?)(\w+)\2([^\n]*)\n([\s\S]*?)\n\s*\3\s*(?=\n|$)/gm, (m, before, _q, _tag, after, body) => {
    const exe = (before.trim().split(/\s+/).pop() ?? '').replace(/^.*[\\/]/, '');
    const head = `${before}${after}`;
    return INTERPRETER.test(exe) ? `${head}\n${body}` : head;
  });
}

/** Every {path, op} a shell command writes or deletes (best effort). */
export function writeTargets(cmd) {
  const out = [];
  let cwd = '';
  // `>|` (clobber) is a redirect, not a pipe; normalise before splitting on `|`.
  const text = expandHeredocs(String(cmd)).replace(/>\|/g, '>');
  for (const seg of text.split(/\n|;|&&|\|\||\|/)) {
    const s = seg.trim();
    if (!s) continue;
    // Redirections: >, >>, >|, 1>, 1>>, &>, &>> (2> to /dev/null resolves outside the repo and is harmless).
    for (const m of s.matchAll(/(?:^|[^<>])(?:\d|&)?>>?\|?\s*("[^"]+"|'[^']+'|[^\s;&|<>]+)/g)) out.push({ path: unquote(m[1]), op: 'write', cwd });
    // PowerShell .NET file APIs: [IO.File]::WriteAllText('path', …), AppendAllText, Delete, …
    for (const m of s.matchAll(/\[(?:System\.)?IO\.(?:File|Directory)\]::(\w+)\(\s*["']([^"']+)["']/gi))
      out.push({ path: m[2], op: /delete/i.test(m[1]) ? 'delete' : 'write', cwd });
    // Node.js fs & fs/promises APIs in inline scripts: fs.writeFileSync('path', …), fs.appendFileSync, fs.rmSync, …
    for (const m of s.matchAll(/\b(writeFile|appendFile|truncate|rm|unlink|rmdir|createWriteStream)(?:Sync)?\(\s*["'`]([^"'`]+)["'`]/gi))
      out.push({ path: m[2], op: /rm|unlink/i.test(m[1]) ? 'delete' : 'write', cwd });
    // Python file writes/deletes: open('path', 'w'|'a'), os.remove, shutil.rmtree, Path('path').write_text, …
    for (const m of s.matchAll(/\bopen\(\s*["'`]([^"'`]+)["'`]\s*,\s*["'`]([wa]\+?b?)["'`]/gi))
      out.push({ path: m[1], op: 'write', cwd });
    for (const m of s.matchAll(/\b(?:os\.(?:remove|unlink|rmdir)|shutil\.rmtree)\(\s*["'`]([^"'`]+)["'`]/gi))
      out.push({ path: m[1], op: 'delete', cwd });
    for (const m of s.matchAll(/\bPath\(\s*["'`]([^"'`]+)["'`]\s*\)\.(write_text|write_bytes|unlink)/gi))
      out.push({ path: m[1], op: /unlink/i.test(m[2]) ? 'delete' : 'write', cwd });
    // Deno & Bun file APIs: Deno.writeTextFile('path', …), Bun.write('path', …), Deno.remove(…)
    for (const m of s.matchAll(/\b(?:Deno\.(?:writeTextFile|writeFile|remove)(?:Sync)?|Bun\.write)\(\s*["'`]([^"'`]+)["'`]/gi))
      out.push({ path: m[1], op: /remove/i.test(m[0]) ? 'delete' : 'write', cwd });
    const toks = (s.match(/"[^"]+"|'[^']+'|[^\s]+/g) ?? []).map(unquote);
    const name = (toks[0] ?? '').replace(/^.*[\\/]/, '');
    const args = toks.slice(1).filter((t) => !t.startsWith('-'));
    if (/^(cd|pushd|Set-Location|sl|chdir)$/i.test(name) && args[0]) {
      const target = args[0].replace(/\\/g, '/');
      // An absolute cd replaces the working directory (REV-0005 M4: `D:` must not become `D`).
      cwd = isAbsolute(target) || /^[A-Za-z]:\//.test(target) ? target : join(cwd, target).split('\\').join('/');
      continue;
    }
    if (name === 'perl' && toks.some((t) => /^-[a-zA-Z]*i/.test(t))) out.push(...args.slice(1).map((path) => ({ path, op: 'write', cwd })));
    const add = (paths, op) => out.push(...paths.filter(Boolean).map((path) => ({ path, op, cwd })));
    if (name === 'tee') add(args, 'write');
    if (['cp', 'install', 'ln', 'rsync', 'scp'].includes(name)) add(args.slice(-1), 'write');
    if (name === 'mv') {
      add(args.slice(0, -1), 'delete');
      add(args.slice(-1), 'write');
    }
    if (['rm', 'rmdir', 'unlink', 'shred'].includes(name)) add(args, 'delete');
    if (['truncate', 'touch'].includes(name)) add(args, 'write');
    if (name === 'sed' && toks.some((t) => /^-[a-zA-Z]*i/.test(t))) add(args.slice(1), 'write');
    if (name === 'dd') add(toks.filter((t) => t.startsWith('of=')).map((t) => t.slice(3)), 'write');
    if (name === 'find' && toks.some((t) => t === '-delete' || t === '-exec' || t === '-execdir')) add(args.slice(0, 1), 'delete');
    // git checkout/restore overwrite paths: `-- paths`, or `<ref> <paths>` (REV-0005: `checkout stash@{0} project-management`).
    const gi = name === 'git' ? toks.findIndex((t, i) => i > 0 && /^(checkout|restore)$/.test(t)) : -1;
    if (gi > 0) {
      const dd = toks.indexOf('--');
      // Treated as deletion: a checkout can replace or remove everything under the path.
      add(dd >= 0 ? toks.slice(dd + 1) : toks.slice(gi + 1).filter((t) => !t.startsWith('-')), 'delete');
    }
    if (PS_DELETE.test(name) || PS_WRITE.test(name)) {
      const pi = toks.findIndex((t) => /^-(Path|LiteralPath|FilePath|Destination)$/i.test(t));
      add(pi >= 0 ? [toks[pi + 1]] : args.slice(0, 1), PS_DELETE.test(name) || /^(Move-Item|mi|move)$/i.test(name) ? 'delete' : 'write');
    }
  }
  return out;
}

// A secret file mentioned anywhere in a command, with light de-obfuscation
// (quotes and glob brackets stripped: .e""nv, .en[v]).
function mentionsSecret(cmd) {
  // Backslashes are path separators on Windows (`gc .\.env`, `D:\…\.env`), not noise (REV-0005 H2).
  const flat = cmd.replace(/\\/g, '/').replace(/["'`]/g, '').replace(/\[([^\]]{1,3})\]/g, '$1');
  // ':' too — `git show HEAD:.env` and `D:/…/.env` name the file after a colon.
  // Brackets and braces too: `[".env.example"]` in JSON is `.env.example`, not a new secret name.
  for (const raw of flat.split(/[\s;&|<>()=,:[\]{}]+/)) {
    const tok = raw.replace(/^[:@]+/, '');
    if (!tok) continue;
    if (isSecretFile(tok)) return tok;
    // A wildcard that could expand to a secret name (`cat .e*`, `.en?`) is a read of it.
    const name = tok.split('/').pop();
    if (/[*?]/.test(name) && name.startsWith('.')) {
      const rx = new RegExp('^' + name.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
      if (['.env', '.env.local', '.env.production'].some((n) => rx.test(n))) return tok;
    }
  }
  return null;
}

// Guardrail files wherever they live: this repo, the main checkout, the user's ~/.claude (REV-0005).
const isGuardrailFile = (p) => /(^|[\\/])\.claude[\\/](settings(\.local)?\.json|hooks([\\/]|$))/i.test(String(p));

function checkBash(cmd, depth = 0) {
  const c = String(cmd ?? '');
  // A command string handed to another shell is checked as a command (REV-0005: bash -c "rm -rf agent-os").
  if (depth < 3)
    for (const m of c.matchAll(/\b(?:bash|sh|zsh|dash|ksh|pwsh|powershell|cmd)(?:\.exe)?\b[^;&|]*?\s(?:-c|-Command|\/c|\/k)\s+("[^"]*"|'[^']*')/gi)) {
      const inner = checkBash(m[1].slice(1, -1), depth + 1);
      if (inner) return inner;
    }
  for (const r of policy.bash_deny) {
    if (!new RegExp(r.pattern, r.flags ?? '').test(c)) continue;
    if (r.unless && new RegExp(r.unless).test(c)) continue;
    return { decision: 'deny', rule: r.rule, why: r.why };
  }
  const secret = mentionsSecret(c);
  if (secret) return { decision: 'deny', rule: 'secret-file', why: `${policy.secret_files.why} (command references ${secret})` };
  for (const t of writeTargets(c)) {
    if (isSecretFile(t.path) || inProtectedSegment(t.path))
      return { decision: 'deny', rule: isSecretFile(t.path) ? 'secret-file' : 'legacy-backup', why: `${isSecretFile(t.path) ? policy.secret_files.why : policy.protected_segments.why} (shell ${t.op} of ${t.path})` };
    if (isGuardrailFile(t.path) || isGuardrailFile(join(t.cwd, t.path)))
      return { decision: 'deny', rule: 'guard-tamper', why: `${policy.shell_write_deny[0].why} (shell ${t.op} of ${t.path})` };
    // Deleting a filesystem root, the home directory or a bare wildcard is never scoped enough.
    if (t.op === 'delete' && /^(\/\*?|~[\\/]?\*?|\*|[A-Za-z]:[\\/]?\*?|\/[a-z]\/?)$/i.test(t.path.trim()))
      return { decision: 'deny', rule: 'destructive-delete', why: `Deleting ${t.path} is unscoped.` };
    if (t.op === 'delete') {
      // Resolve through cd; a wildcard deletes its directory's contents (`rm -rf ./*`).
      const clean = t.path.replace(/\\/g, '/');
      const abs = isAbsolute(clean) || /^[A-Za-z]:\//.test(clean) ? resolve(clean) : resolve(ROOT, t.cwd, clean);
      const target = /[*?]/.test(basename(abs)) ? dirname(abs) : abs;
      const R = resolve(ROOT);
      // The repository itself, or anything that contains it (the main checkout, every worktree, the drive).
      if (lc(R) === lc(target) || lc(R).startsWith(lc(target) + (target.endsWith('\\') || target.endsWith('/') ? '' : '\\')) || lc(R).startsWith(lc(target) + '/'))
        return { decision: 'deny', rule: 'destructive-delete', why: `Deleting ${t.path} removes the repository or a directory containing it (the main checkout holds .env, Old Website/ and .cache/).` };
    }
    const p = relPath(t.path, t.cwd);
    if (p === null) continue;
    if (t.op === 'delete' && /[*?]/.test(p.split('/').pop() ?? '')) {
      const root = deletesProtected(p.split('/').slice(0, -1).join('/'));
      if (root) return { decision: 'deny', rule: 'destructive-delete', why: `Wildcard delete in ${root}.` };
    }
    if (t.op === 'delete') {
      const root = deletesProtected(p);
      if (root) return { decision: 'deny', rule: 'destructive-delete', why: `Deleting ${p} removes protected ${root} (untracked governance state or legacy data cannot be restored). Delete specific build output instead.` };
    }
    const hit = firstMatch(policy.write_deny, p) ?? firstMatch(policy.shell_write_deny, p);
    if (hit) return { decision: 'deny', rule: hit.rule, why: `${hit.why} (shell ${t.op} of ${p})` };
  }
  for (const r of policy.bash_ask) if (new RegExp(r.pattern, r.flags ?? '').test(c)) return { decision: 'ask', rule: r.rule, why: r.why };
  return null;
}

// ------------------------------------------------------------------ files

function frontMatterEnd(text) {
  const t = text.replace(/\r\n/g, '\n');
  if (!t.startsWith('---\n')) return -1;
  const end = t.indexOf('\n---', 4);
  return end < 0 ? -1 : end + 4;
}

function recordFrontMatterEdit(tool, input, path) {
  if (!policy.record_front_matter.globs.some((g) => matchesCI(path, g))) return null;
  const full = join(ROOT, path);
  if (!existsSync(full)) return null; // new record file: the projection writes its front matter
  const text = readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
  const end = frontMatterEnd(text);
  if (end < 0) return null;
  if (tool === 'Edit' || tool === 'MultiEdit') {
    for (const e of tool === 'MultiEdit' ? (input.edits ?? []) : [input]) {
      const at = text.indexOf(String(e.old_string ?? '').replace(/\r\n/g, '\n'));
      if (at >= 0 && at < end) return policy.record_front_matter.why;
    }
    return null;
  }
  const next = String(input.content ?? '').replace(/\r\n/g, '\n');
  const nextEnd = frontMatterEnd(next);
  const strip = (s) => s.split('\n').filter((l) => !l.startsWith('#')).join('\n').trim();
  return nextEnd < 0 || strip(next.slice(0, nextEnd)) !== strip(text.slice(0, end)) ? policy.record_front_matter.why : null;
}

export function decide(payload) {
  const tool = payload.tool_name;
  const input = payload.tool_input ?? {};
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    const raw = input.file_path ?? input.notebook_path;
    if (!raw) return null;
    if (isSecretFile(raw)) return { decision: 'deny', rule: 'secret-file', why: policy.secret_files.why };
    if (inProtectedSegment(raw)) return { decision: 'deny', rule: 'legacy-backup', why: policy.protected_segments.why };
    const path = relPath(raw);
    // Guardrail config outside this repo (main checkout, ~/.claude): an agent here has no business there.
    if (!path && isGuardrailFile(raw)) return { decision: 'deny', rule: 'guard-tamper', why: 'Claude Code settings or hooks outside this repository are the owner’s configuration.' };
    if (!path) return null;
    const deny = firstMatch(policy.write_deny, path);
    if (deny) return { decision: 'deny', rule: deny.rule, why: deny.why };
    const fm = recordFrontMatterEdit(tool, input, path);
    if (fm) return { decision: 'deny', rule: 'record-front-matter', why: fm };
    const ask = firstMatch(policy.write_ask, path);
    return ask ? { decision: 'ask', rule: ask.rule, why: ask.why } : null;
  }
  if (['Read', 'Grep', 'Glob', 'NotebookRead'].includes(tool)) {
    for (const p of [input.file_path, input.path, input.notebook_path, input.glob, input.pattern && tool === 'Glob' ? input.pattern : null])
      if (p && (isSecretFile(p) || (/\.sql(\.gz)?$/i.test(p) && inProtectedSegment(p)))) return { decision: 'deny', rule: 'secret-read', why: policy.secret_files.why };
    return null;
  }
  if (tool === 'Bash' || tool === 'PowerShell') return checkBash(input.command);
  return null;
}

function log(payload, d) {
  try {
    const dir = join(ROOT, '.claude', 'metrics');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'guard.jsonl'), JSON.stringify({ ts: new Date().toISOString(), session: payload.session_id ?? null, tool: payload.tool_name, decision: d.decision, rule: d.rule }) + '\n');
  } catch {
    /* metrics never block work */
  }
}

// Run as a hook (not when imported by the evals).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let payload = {};
  try {
    payload = JSON.parse(raw || '{}');
    const d = decide(payload);
    if (d) {
      log(payload, d);
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d.decision, permissionDecisionReason: `[agent-os guard: ${d.rule}] ${d.why}` } }));
    }
  } catch (e) {
    // Fail closed for anything that can write; fail open for reads.
    if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'].includes(payload.tool_name))
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `[agent-os guard] could not evaluate this call (${e.message}); refused.` } }));
  }
}
