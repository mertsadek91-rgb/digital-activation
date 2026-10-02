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

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(process.env.CLAUDE_PROJECT_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const { matchesCI, expandBraces } = await import(pathToFileURL(join(ROOT, 'agent-os', 'tools', 'lib', 'glob.mjs')).href);
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
  // Resolve `..` first, so `node_modules/../.cache` is still the legacy `.cache`.
  const segs = posix.normalize(String(p).replace(/\\/g, '/')).split('/').filter(Boolean).map(normName).map(lc);
  const prot = policy.protected_segments.segments.map(lc);
  const notUnder = (policy.protected_segments.not_directly_under ?? []).map(lc);
  // A tool cache inside a dependency folder (`node_modules/.cache`) is build output, not the legacy `.cache/`.
  return segs.some((s, i) => prot.includes(s) && !(i > 0 && notUnder.includes(segs[i - 1])));
}
/** MSYS / WSL / Cygwin drive spellings (`/d/…`, `/mnt/d/…`, `/cygdrive/d/…`) of a Windows path. */
const WIN_ROOT = /^[A-Za-z]:\//.test(String(ROOT).replace(/\\/g, '/'));
function driveFix(p) {
  const s = String(p).replace(/\\/g, '/');
  if (!WIN_ROOT) return s;
  const m = /^\/(?:mnt\/|cygdrive\/)?([A-Za-z])(\/.*|$)/.exec(s);
  return m && !/^\/(tmp|usr|etc|var|bin|dev|opt|home|proc)(\/|$)/i.test(s) ? `${m[1].toUpperCase()}:${m[2] || '/'}` : s;
}
/** `$PWD/x`, `${PWD}/x`, `$(pwd)/x`, `%CD%\x` are the working directory, i.e. relative. */
const stripPwd = (p) => String(p).replace(/^["']?(\$\{?PWD\}?|\$\(pwd\)|%CD%|\(Get-Location\)|\$pwd\.Path)["']?[\\/]/i, '');
/** A target the guard cannot resolve statically: variables, substitutions, globs of variables. */
const nonLiteral = (p) => /[$`%]|\(|\)/.test(String(p));
/** Scratch locations a recursive delete outside the repository may touch. */
function isTempPath(p) {
  const s = lc(String(p).replace(/\\/g, '/'));
  const tmp = lc(tmpdir().replace(/\\/g, '/'));
  return /^\/(var\/)?tmp\//.test(s) || s.startsWith(tmp + '/') || /\/appdata\/local\/temp\//.test(s) || /^[a-z]:\/(windows\/)?te?mp\//.test(s);
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

// ------------------------------------------------------------------ globs
//
// TASK-0080 round 2 (REV-0115): a shell or a Windows program expands globs, so
// `gc ..\*env`, `cat .[[:alpha:]]nv`, `cp x agent-os/sta*/` reach files whose
// names never appear in the command. Globs are compiled the way a shell would
// match them (braces, `*`, `?`, `[...]` with `!`/`^` and POSIX classes) and
// tested against the names that matter. Matching is dotglob-style (a leading
// `*` matches `.env`), because Windows programs and PowerShell match dotfiles.

const hasGlob = (s) => /[*?[{]/.test(String(s));
const POSIX_CLASS = { alpha: 'a-zA-Z', alnum: 'a-zA-Z0-9', digit: '0-9', lower: 'a-z', upper: 'A-Z', space: '\\s', blank: ' \\t', xdigit: '0-9a-fA-F', word: '\\w', punct: '!-\\/:-@\\[-`{-~', graph: '!-~', print: ' -~', cntrl: '\\x00-\\x1f' };
/** One path segment's glob → RegExps (one per brace alternative), case-insensitive. */
function segRx(glob) {
  return expandBraces(String(glob)).map((g) => {
    let re = '';
    for (let i = 0; i < g.length; i++) {
      const c = g[i];
      if (c === '*') re += '.*';
      else if (c === '?') re += '.';
      else if (c === '[') {
        let j = i + 1;
        const neg = g[j] === '!' || g[j] === '^';
        if (neg) j++;
        let body = '';
        let closed = false;
        for (let first = true; j < g.length; j++, first = false) {
          if (g[j] === ']' && !first) {
            closed = true;
            break;
          }
          const m = /^\[:(\w+):\]/.exec(g.slice(j));
          if (m) {
            body += POSIX_CLASS[m[1].toLowerCase()] ?? '\\s\\S';
            j += m[0].length - 1;
          } else body += /[\\\]^[]/.test(g[j]) ? '\\' + g[j] : g[j];
        }
        if (!closed) re += '\\[';
        else {
          re += `[${neg ? '^' : ''}${body}]`;
          i = j;
        }
      } else re += c.replace(/[.+^$(){}|\\\]]/g, '\\$&');
    }
    try {
      return new RegExp('^' + re + '$', 'i');
    } catch {
      return /^.*$/; // an unparseable class could match anything
    }
  });
}
const SECRET_SAMPLES = ['.env', '.env.local', '.env.production', '.env.staging', '.env.development', '.env.test', 'owner.key'];
/** A glob (one name) that could expand to a secret file name. `.env.example` alone is fine. */
const globHitsSecret = (name) => hasGlob(name) && segRx(name).some((rx) => SECRET_SAMPLES.some((n) => rx.test(n)));
/** Paths a write must never reach, used to test globbed targets that do not exist yet. */
const PROTECTED_SAMPLES = ['agent-os/state/events.jsonl', 'agent-os/policies/guard.json', '.claude/settings.json', '.claude/settings.local.json', '.claude/hooks/guard.mjs', 'project-management/TASK_INDEX.json', 'project-management/dashboard/data.js', 'Old Website/x', '.cache/x'];
/** Directories a recursive copy/sync must not land on or above. */
const TREE_PROTECTED = ['agent-os/state', 'agent-os/policies', '.claude/hooks', '.claude/settings.json', '.claude/settings.local.json', 'project-management/TASK_INDEX.json', 'project-management/dashboard', 'project-management/history', 'packages/db/prisma/migrations', 'Old Website', '.cache'];

/** Expand a globbed absolute path against the disk (what the shell does), plus protected samples it could match. */
function expandGlobPath(absPath) {
  const segs = String(absPath).replace(/\\/g, '/').split('/');
  let bases = [segs[0] === '' ? '/' : segs[0] + '/'];
  for (const seg of segs.slice(1)) {
    if (!seg) continue;
    if (!hasGlob(seg)) {
      bases = bases.map((b) => posix.join(b, seg));
      continue;
    }
    const rxs = segRx(seg);
    const next = [];
    for (const b of bases) {
      let names = [];
      try {
        names = readdirSync(b);
      } catch {
        /* missing directory: nothing to expand */
      }
      for (const n of names) if (seg === '**' || rxs.some((rx) => rx.test(n))) next.push(posix.join(b, n));
      if (seg === '**') next.push(b);
    }
    bases = next.length ? next.slice(0, 500) : bases.map((b) => posix.join(b, seg));
  }
  const out = new Set(bases);
  // Not on disk (CI, a new file): test the repo-relative glob against the protected samples, segment by segment.
  const rel = relative(ROOT, resolve(absPath)).split('\\').join('/');
  if (!rel.startsWith('..') && !isAbsolute(rel)) {
    const g = rel.split('/').filter(Boolean);
    for (const sample of PROTECTED_SAMPLES) {
      const s = sample.split('/');
      for (let k = 1; k <= s.length; k++)
        if (g.length === k && g.every((gs, i) => segRx(gs).some((rx) => rx.test(s[i])))) out.add(posix.join(String(ROOT).replace(/\\/g, '/'), ...s.slice(0, k)));
    }
  }
  return [...out];
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
    // Wrappers that run the rest of the line as the command: `( … )`, `{ … }`, sudo, exec, env, VAR=x.
    const s = seg.trim().replace(/^(?:[({!]\s*|(?:sudo|exec|nohup|time|command|builtin|env)\s+|[A-Za-z_]\w*=\S*\s+)+/, '');
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
    // `Old\ Website` is one argument, not two.
    const toks = (s.match(/"[^"]+"|'[^']+'|(?:\\ |\S)+/g) ?? []).map((t) => unquote(t).replace(/\\ /g, ' '));
    const name = (toks[0] ?? '').replace(/^.*[\\/]/, '');
    const args = toks.slice(1).filter((t) => !t.startsWith('-'));
    if (/^(cd|pushd|Set-Location|sl|chdir)$/i.test(name) && args[0]) {
      const target = driveFix(stripPwd(args[0]));
      // An absolute cd replaces the working directory (REV-0005 M4: `D:` must not become `D`).
      cwd = isAbsolute(target) || /^[A-Za-z]:\//.test(target) ? target : join(cwd, target).split('\\').join('/');
      continue;
    }
    const verb = name.replace(/\.exe$/i, '');
    if (verb === 'perl' && toks.some((t) => /^-[a-zA-Z]*i/.test(t))) out.push(...args.slice(1).map((path) => ({ path, op: 'write', cwd })));
    const add = (paths, op) => out.push(...paths.filter(Boolean).map((path) => ({ path, op, cwd })));
    // A destination may be a directory: the copy lands at dest/<source name> (REV-0115 H1: `cp x.jsonl agent-os/state/`).
    const addDest = (dest, sources, tree) => {
      if (!dest) return;
      add([dest, ...sources.map((s) => posix.join(dest.replace(/\\/g, '/'), basename(s.replace(/\\/g, '/')) || '_')), posix.join(dest.replace(/\\/g, '/'), '_')], 'write');
      if (tree) add([dest], 'tree');
    };
    if (verb === 'tee') add(args, 'write');
    if (['cp', 'install', 'ln', 'mv', 'scp'].includes(verb)) {
      // GNU options: `-t DIR`, `-tDIR`, `-rt DIR`, `--target-directory[=]DIR`; `--` ends options.
      let tdir = null;
      let tree = false;
      const pos = [];
      for (let i = 1; i < toks.length; i++) {
        const t = toks[i];
        if (t === '--') {
          pos.push(...toks.slice(i + 1));
          break;
        }
        let m;
        if (t === '--target-directory') tdir = toks[++i];
        else if ((m = /^--target-directory=(.*)$/.exec(t))) tdir = m[1];
        else if (/^--(recursive|archive)$/.test(t)) tree = true;
        else if ((m = /^-([A-Za-z]+)$/.exec(t))) {
          if (/[rRa]/.test(m[1].split('t')[0])) tree = true;
          const ti = m[1].indexOf('t');
          if (ti >= 0) tdir = ti === m[1].length - 1 ? toks[++i] : m[1].slice(ti + 1);
        } else if (!t.startsWith('-')) pos.push(t);
      }
      const dest = tdir ?? pos.at(-1);
      const sources = tdir ? pos : pos.slice(0, -1);
      if (verb === 'mv') add(sources, 'delete');
      if (dest && (tdir || pos.length > 1)) addDest(dest, sources, tree && verb !== 'mv');
    }
    if (verb === 'rsync') {
      const pos = args;
      const dest = pos.at(-1);
      if (pos.length > 1) addDest(dest, pos.slice(0, -1), true);
      // `--delete*` removes whatever the source lacks; `--remove-source-files` deletes the sources.
      if (toks.some((t) => /^--del(ete(-\w+)?)?$/.test(t))) add([dest], 'delete');
      if (toks.some((t) => /^--remove-(source|sent)-files$/.test(t))) add(pos.slice(0, -1), 'delete');
    }
    if (/^(robocopy|xcopy)$/i.test(verb)) {
      // Switches are `/MIR`, `/E`, `/XF:x`; MSYS spells them `//MIR`. `/d/x` is a path.
      const isSwitch = (t) => /^\/+[A-Za-z]+(:\S*)?$/.test(t) && !/^\/[A-Za-z]\//.test(t);
      const pos = toks.slice(1).filter((t) => !isSwitch(t) && !t.startsWith('-'));
      const flags = toks.filter(isSwitch).map((t) => t.toUpperCase().replace(/^\/+/, '/'));
      if (pos[1]) addDest(pos[1], [], true);
      if (flags.some((f) => f === '/MIR' || f === '/PURGE')) add([pos[1]], 'delete');
      if (flags.some((f) => f === '/MOV' || f === '/MOVE')) add([pos[0]], 'delete');
    }
    if (['rm', 'rmdir', 'unlink', 'shred'].includes(verb) && !CMD_SWITCH_STYLE(toks)) add(args, 'delete');
    if (['truncate', 'touch'].includes(verb)) add(args, 'write');
    if (verb === 'sed' && toks.some((t) => /^-[a-zA-Z]*i/.test(t) || /^--in-place(=|$)/.test(t))) add(args.slice(1), 'write');
    if (verb === 'dd') add(toks.filter((t) => t.startsWith('of=')).map((t) => t.slice(3)), 'write');
    if (verb === 'find') {
      // Start points are the operands before the first expression token; none means `.` (REV-0115: bare `find -delete`).
      const firstExpr = toks.findIndex((t, i) => i > 0 && /^(-|\(|!|\\\()/.test(t) && !/^-[HLP]$/.test(t));
      const roots = toks.slice(1, firstExpr < 0 ? undefined : firstExpr).filter((t) => !/^-[HLP]$/.test(t));
      const execs = toks.flatMap((t, i) => (/^-(exec|execdir|ok|okdir)$/.test(t) ? [(toks[i + 1] ?? '').replace(/^.*[\\/]/, '')] : []));
      if (toks.includes('-delete') || execs.some((e) => !FIND_READONLY_EXEC.test(e))) add(roots.length ? roots : ['.'], 'delete');
    }
    // git checkout/restore overwrite paths: `-- paths`, or `<ref> <paths>` (REV-0005: `checkout stash@{0} project-management`).
    const gi = verb === 'git' ? toks.findIndex((t, i) => i > 0 && /^(checkout|restore)$/.test(t)) : -1;
    if (gi > 0) {
      const dd = toks.indexOf('--');
      // Treated as deletion: a checkout can replace or remove everything under the path.
      add(dd >= 0 ? toks.slice(dd + 1) : toks.slice(gi + 1).filter((t) => !t.startsWith('-')), 'delete');
    }
    if (PS_DELETE.test(verb) && CMD_SWITCH_STYLE(toks)) {
      // cmd.exe `rd /s /q x`, `del /s /q *.jsonl`: switches are not paths; `del /s` reaches every subdirectory.
      const paths = toks.slice(1).filter((t) => !/^\/[A-Za-z?](:\S*)?$/.test(t));
      add(paths, 'delete');
      if (/^(del|erase)$/i.test(verb) && toks.some((t) => /^\/s$/i.test(t))) add(paths.map((p) => dirname(p.replace(/\\/g, '/'))), 'delete');
    } else if (PS_DELETE.test(verb) || PS_WRITE.test(verb)) {
      const { path, dest, newName, childName, recurse } = psArgs(toks);
      if (PS_DELETE.test(verb)) add(path, 'delete');
      else if (/^(Copy-Item|cpi|copy|cp|Move-Item|mi|move|mv)$/i.test(verb)) {
        if (/^(Move-Item|mi|move|mv)$/i.test(verb)) add(path, 'delete');
        for (const d of dest) addDest(d, path, recurse || /^(Move-Item|mi|move|mv)$/i.test(verb));
      } else if (/^(Rename-Item|rni|ren)$/i.test(verb)) {
        add(path, 'delete');
        for (const p of path) for (const n of newName) add([posix.join(dirname(p.replace(/\\/g, '/')), n)], 'write');
      } else {
        add(path, 'write');
        for (const p of path) for (const n of childName) add([posix.join(p.replace(/\\/g, '/'), n)], 'write');
      }
    }
  }
  return out;
}

/** cmd.exe-style switches (`/s`, `/q`) on rd/del/rmdir: the verb is cmd's, not PowerShell's or POSIX's. */
const CMD_SWITCH_STYLE = (toks) => /^(rd|rmdir|del|erase)(\.exe)?$/i.test((toks[0] ?? '').replace(/^.*[\\/]/, '')) && toks.slice(1).some((t) => /^\/[A-Za-z?](:\S*)?$/.test(t));
/** `find -exec <cmd>` commands that only read. Anything else is treated as deleting the start points. */
const FIND_READONLY_EXEC = /^(grep|egrep|fgrep|rg|ls|wc|stat|file|echo|printf|sha1sum|sha256sum|sha512sum|md5sum|du|basename|dirname|test|\[|realpath|readlink)$/;
/** PowerShell parameters that take a value (so the next token is not a positional path). */
const PS_VALUE_PARAM = /^(path|literalpath|lp|pspath|filepath|destination|dest\w*|filter|include|exclude|value|encoding|inputobject|width|itemtype|type|name|newname|stream|delimiter|credential|tosession|fromsession|target)$/i;

/** PowerShell cmdlet arguments: named (`-Destination x`, `-Destination:x`) and positional (Path, then Destination/Value). */
function psArgs(toks) {
  const named = {};
  const pos = [];
  const split = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i];
    const m = /^-([A-Za-z]\w*)(?::(.+))?$/.exec(t);
    if (m) {
      const key = m[1].toLowerCase();
      const val = m[2] !== undefined ? m[2] : PS_VALUE_PARAM.test(key) ? toks[++i] : undefined;
      if (val !== undefined) (named[key] ??= []).push(...split(val));
      else (named[key] ??= []).push(true);
      continue;
    }
    pos.push(...split(t));
  }
  const pick = (test) => Object.entries(named).filter(([k]) => test(k)).flatMap(([, v]) => v.filter((x) => x !== true));
  const path = pick((k) => /^(p(a(th?)?)?|pspath|l(i\w*|p)|f(ile\w*|p))$/.test(k));
  const dest = pick((k) => /^dest/.test(k));
  return {
    path: path.length ? path : pos.slice(0, 1),
    dest: dest.length ? dest : pos.slice(path.length ? 0 : 1, path.length ? 1 : 2),
    newName: pick((k) => /^newn/.test(k)).concat(path.length ? pos.slice(0, 1) : pos.slice(1, 2)),
    childName: pick((k) => k === 'name'),
    recurse: Object.keys(named).some((k) => 'recurse'.startsWith(k) && k.length >= 1 && k[0] === 'r'),
  };
}

// A secret file mentioned anywhere in a command, with light de-obfuscation
// (quotes and glob brackets stripped: .e""nv, .en[v]).
function mentionsSecret(cmd) {
  // Backslashes are path separators on Windows (`gc .\.env`, `D:\…\.env`), not noise (REV-0005 H2);
  // in bash they are escapes (`cat .e\nv` reads .env), so both readings are checked.
  if (cmd.includes('\\')) {
    const hit = mentionsSecretIn(cmd.replace(/\\(?=[A-Za-z.])/g, ''));
    if (hit) return hit;
  }
  return mentionsSecretIn(cmd);
}
function mentionsSecretIn(cmd) {
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

/** Content readers: a bare `*` handed to them in PowerShell or cmd includes `.env`. */
const READ_VERB = /^(gc|Get-Content|cat|type|sls|Select-String|findstr|find|more|Format-Hex|fhx|Import-Csv|ipcsv|Import-Clixml|Copy-Item|cpi|cp|copy|xcopy|robocopy|Compress-Archive|tar|zip|7z|base64|certutil|Get-FileHash|grep|rg|head|tail|less|sort|strings|od|xxd|hexdump)$/i;
/** Commands that only list names. */
const LIST_VERB = /^(ls|dir|gci|Get-ChildItem|tree|echo|printf|Write-Output|Write-Host|stat|du)$/i;

/**
 * REV-0115 H2: a glob argument that could expand to a secret file name is a read of it, whatever
 * the first character (`*env`, `?env`, `.[a-z]nv`, `.[[:alpha:]]nv`, `.{e,x}nv`). Matching is
 * dotglob-style except a bare `*` in bash (no dotglob), which never matches a dotfile.
 */
function globSecret(cmd, ps) {
  const dotglob = ps || /\bdotglob\b|\bGLOBIGNORE\b|\b(cmd|pwsh|powershell)(\.exe)?\b/i.test(cmd);
  for (const seg of String(cmd).split(/\n|;|&&|\|\||\||&/)) {
    const toks = seg.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    const verb = (toks[0] ?? '').replace(/["']/g, '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '');
    if (LIST_VERB.test(verb)) continue;
    for (const tok of toks.slice(1)) {
      for (const part of tok.replace(/["'`]/g, '').split(/[=<>()]+/)) {
        const name = part.split(/[\\/]/).pop() ?? '';
        if (!hasGlob(name)) continue;
        const names = [name];
        if (name.includes(':') && !name.includes('[')) names.push(name.split(':').pop());
        for (const n of names) {
          // A bare `*`: bash leaves dotfiles out; PowerShell and cmd content readers take them in.
          if (/^\*+$/.test(n) && !(dotglob && READ_VERB.test(verb))) continue;
          if (globHitsSecret(n)) return part;
        }
      }
    }
  }
  return null;
}

// Guardrail files wherever they live: this repo, the main checkout, the user's ~/.claude (REV-0005).
const isGuardrailFile = (p) => /(^|[\\/])\.claude[\\/](settings(\.local)?\.json|hooks([\\/]|$))/i.test(String(p));

// ---------------------------------------------------------- inline scripts
//
// TASK-0082 / REV-0005: an inline program (`node -e`, `python -c`, `perl -e`,
// `ruby -e`, a heredoc into an interpreter, PowerShell .NET IO) can build its
// target at runtime, so literal-path extraction alone is not enough. Deny by
// default for the shapes that matter, accepting false positives:
//   - an inline program that names the event log and can write;
//   - an inline program that deletes anything it does not name literally.
// A script FILE (`node x.mjs`) is not inspected: THREAT_MODEL.md limit 1.

/** The canonical event log, however the path is spelled or assembled. */
const STATE_MENTION = /events\.jsonl|agent-os[\\/]+state\b|['"`]agent-os['"`]\s*,\s*['"`]state['"`]/i;
const GUARD_MENTION = /\.claude['"`]?\s*[\\/,+]+\s*['"`]?(settings|hooks)\b|agent-os['"`]?\s*[\\/,+]+\s*['"`]?policies\b|Old Website/i;
const INLINE =/\b(?:node|nodejs|deno|bun|python[23]?|py|perl|ruby|php)(?:\.exe)?\b[^;&|\n]*?(?:\s-[A-Za-z]*[ecpE]\b|\s--eval\b|\s--print\b|\seval\b|\s-\s|<<)|\[(?:System\.)?IO\.(?:File|Directory|FileInfo|DirectoryInfo|StreamWriter)\]|New-Object\s+(?:System\.)?IO\./i;
const SCRIPT_WRITE = /\b(?:write\w*|append\w*|createWriteStream|truncate\w*|rename\w*|copy\w*|cp(?:Sync)?|rm\w*|unlink\w*|move\w*|os\.replace|Set-Content|Add-Content|Out-File|syswrite|print\s*\(?\s*\w+\s*,|open\s*\(|fopen|file_put_contents|IO\.write|File\.write)\b|(?<![=\-<>])>>?(?![=>])/i;
const SCRIPT_DELETE_CALL = /(?:\b(?:rmSync|rmdirSync|unlinkSync|rimraf(?:\.sync)?|rmtree|remove_tree|rm_rf|rm_r|removedirs|os\.(?:remove|unlink|rmdir)|Deno\.remove(?:Sync)?|(?:fs|fsp|promises)\.(?:rm|rmdir|unlink)|unlink|rmdir)|::Delete|\.Delete)\s*\(\s*(?!["'][^"'$`{}]*["']\s*[,)])/i;

/** Delete primitives and child-process launchers in an inline program (REV-0115 H3). */
const SCRIPT_DEL_OR_SPAWN = /\b(rmtree|remove_tree|rm_rf|rm_r|rm_f|rmSync|rmdirSync|unlinkSync|rimraf|removedirs|unlink|rmdir|remove|rm|Delete|FileUtils|system|exec\w*|spawn\w*|popen\w*|subprocess|child_process|check_call|check_output|call|run|Process\.Start|Start-Process|qx)\b|%x[({[]/i;
/** A string literal that reads as a shell command, not a path. */
const LOOKS_LIKE_COMMAND = /^\s*(rm|rmdir|del|erase|rd|mv|move|cp|copy|find|git|Remove-Item|ri|robocopy|xcopy|rsync|sh|bash|zsh|cmd|powershell|pwsh|xargs|unlink|shred|truncate|sed|perl|node|python3?)(\.exe)?\s/i;

/** String literals of every quote type, including those nested inside another quote type. */
function stringLiterals(c) {
  const out = [];
  for (const q of ['"', "'", '`']) for (const m of c.matchAll(new RegExp(`${q}((?:\\\\.|[^${q}\\\\])*)${q}`, 'g'))) out.push(m[1]);
  return out;
}

/**
 * An inline program that deletes or launches a process: every string literal it holds is checked as
 * a delete target and as a shell command, and every literal list (`['rm','-rf','x']`) as an argv.
 * Deny by default: a literal that names a protected root fails, even when it is used for something else.
 */
function scriptLiterals(c, depth, ps) {
  if (!SCRIPT_DEL_OR_SPAWN.test(c)) return null;
  const lits = stringLiterals(c);
  for (const m of c.matchAll(/\[([^[\]]*)\]/g)) {
    const argv = stringLiterals(m[1]);
    if (argv.length > 1) lits.push(argv.join(' '));
  }
  for (const raw of lits) {
    const lit = raw.trim();
    if (!lit) continue;
    if (depth < 3 && /\s/.test(lit)) {
      const inner = checkBash(lit, depth + 1, ps);
      if (inner && inner.decision === 'deny') return { ...inner, why: `${inner.why} (inside an inline program)` };
    }
    if (lit.startsWith('-') || LOOKS_LIKE_COMMAND.test(lit) || /[(){};=\n"'`]/.test(lit)) continue;
    const hit = checkTarget({ path: lit, op: 'delete', cwd: '' }, c);
    if (hit && hit.decision === 'deny')
      return { decision: 'deny', rule: hit.rule, why: `An inline program that deletes or runs commands names ${lit}: ${hit.why}` };
  }
  return null;
}

function scriptShape(c, depth = 0, ps = false) {
  if (!INLINE.test(c)) return null;
  const lit = scriptLiterals(c, depth, ps);
  if (lit) return lit;
  if (STATE_MENTION.test(c) && SCRIPT_WRITE.test(c))
    return { decision: 'deny', rule: 'canonical-state', why: 'An inline program that names the event log and can write to it. Canonical state changes only through `node agent-os/tools/pm.mjs`; read it with `pnpm pm show` or `cat`.' };
  if (GUARD_MENTION.test(c) && SCRIPT_WRITE.test(c))
    return { decision: 'deny', rule: 'guard-tamper', why: 'An inline program that names the guardrails (Claude settings, hooks, agent-os/policies) or the legacy backup and can write. Use the Edit tool so the owner confirms.' };
  if (SCRIPT_DELETE_CALL.test(c))
    return { decision: 'deny', rule: 'destructive-delete', why: 'An inline program deletes a path it computes at runtime, which cannot be checked against the protected roots. Delete a literal path with rm instead.' };
  return null;
}

// ------------------------------------------------------------------ git
//
// REV-0115 H3: options are parsed, not pattern-matched, so `git clean -fdx -e -n` (where `-n` is the
// value of `-e`) is not a dry run. Commands that destroy uncommitted work (the 2026-09-30 incident)
// are refused: `reset --hard`, `stash -u/-a`, `stash clear`, `checkout -f`, `switch -f`, index rewrites.

/** Flags seen in a git argument list: short letters and long names, skipping option values. */
function gitFlags(args, shortValue = '', longValue = []) {
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const t = args[i];
    if (t === '--') break;
    if (t.startsWith('--')) {
      const [long, val] = t.split('=');
      if (longValue.includes(long) && val === undefined) i++;
      seen.add(long);
      continue;
    }
    if (!/^-[A-Za-z0-9]+$/.test(t)) continue;
    for (let j = 1; j < t.length; j++) {
      seen.add(t[j]);
      if (shortValue.includes(t[j])) {
        if (j === t.length - 1) i++; // `-e pattern`; otherwise `-epattern`
        break;
      }
    }
  }
  return seen;
}

function gitCheck(c) {
  const G = policy.git_destructive;
  const deny = (k) => ({ decision: 'deny', rule: G[k].rule, why: G[k].why });
  for (const seg of String(c).split(/\n|;|&&|\|\||\||&/)) {
    const toks = (seg.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(unquote);
    let i = toks.findIndex((t) => /^git(\.exe)?$/i.test(t.replace(/^.*[\\/]/, '')));
    if (i < 0) continue;
    for (i++; i < toks.length && toks[i].startsWith('-'); i++)
      if (/^(-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix|--config-env)$/.test(toks[i])) i++;
    const sub = toks[i];
    const rest = toks.slice(i + 1);
    if (sub === 'clean') {
      const f = gitFlags(rest, 'e', ['--exclude']);
      if (!f.has('n') && !f.has('--dry-run')) return deny('clean');
    }
    if (sub === 'reset' && gitFlags(rest).has('--hard')) return deny('reset_hard');
    if (sub === 'stash') {
      if (rest[0] === 'clear') return deny('stash_clear');
      const f = gitFlags(rest, 'm', ['--message', '--pathspec-from-file']);
      if (f.has('u') || f.has('a') || f.has('--include-untracked') || f.has('--all')) return deny('stash_untracked');
    }
    if (sub === 'checkout') {
      const f = gitFlags(rest, 'bB', ['--orphan', '--conflict', '--pathspec-from-file']);
      if (f.has('f') || f.has('--force') || f.has('--overwrite-ignore')) return deny('checkout_force');
    }
    if (sub === 'switch') {
      const f = gitFlags(rest, 'cC', ['--create', '--force-create', '--orphan', '--conflict']);
      if (f.has('f') || f.has('--force') || f.has('--discard-changes')) return deny('checkout_force');
    }
    if (sub === 'update-index' && (rest.includes('--cacheinfo') || rest.includes('--index-info'))) return deny('index');
    if (sub === 'checkout-index' && (gitFlags(rest).has('f') || rest.includes('--force'))) return deny('index');
    if (sub === 'read-tree' && (gitFlags(rest).has('u') || rest.includes('--reset'))) return deny('index');
  }
  return null;
}

// ------------------------------------------------------------------ targets

/** One write/delete/tree target, already resolved through `cd`; a deny verdict or null. */
function checkTarget(raw, c) {
  const t = { ...raw, path: driveFix(stripPwd(raw.path)).replace(/^~(?=\/|$)/, homedir().replace(/\\/g, '/')), cwd: driveFix(raw.cwd) };
  // A computed target cannot be checked, so it is refused where it could matter (deny by default, REV-0005).
  if (nonLiteral(t.path)) {
    if (t.op === 'delete')
      return { decision: 'deny', rule: 'destructive-delete', why: `Deleting a computed path (${t.path}) cannot be checked against the protected roots; name the path literally.` };
    if (STATE_MENTION.test(c) || isGuardrailFile(t.path) || t.op === 'tree')
      return { decision: 'deny', rule: 'canonical-state', why: `A computed write target (${t.path}) in a command that names the canonical state or the guardrails, or a recursive copy to one; change state only through \`node agent-os/tools/pm.mjs\`.` };
    return null;
  }
  if (t.op === 'tree') {
    // A recursive copy or sync writes everything below its destination (REV-0115 H1: `cp -r foo/agent-os .`).
    const p = relPath(t.path, t.cwd);
    if (p === null) {
      // Outside: a `.claude` directory itself, or an ancestor of ~/.claude or of this checkout (the main checkout's .claude and .env).
      const clean = t.path.replace(/\\/g, '/');
      const abs = lc((isAbsolute(clean) || /^[A-Za-z]:\//.test(clean) ? resolve(clean) : resolve(ROOT, t.cwd, clean)).replace(/\\/g, '/')).replace(/\/+$/, '');
      const under = (x) => lc(resolve(x).replace(/\\/g, '/')).startsWith(abs + '/');
      if (/(^|\/)\.claude(\/|$)/.test(abs) || under(join(homedir(), '.claude')) || under(ROOT))
        return { decision: 'deny', rule: 'guard-tamper', why: `A recursive copy into ${t.path} can overwrite Claude Code settings, hooks or the checkout.` };
      return null;
    }
    const lp = lc(p);
    const hit = TREE_PROTECTED.find((P) => lp === '' || lc(P) === lp || lc(P).startsWith(lp + '/'));
    if (hit)
      return { decision: 'deny', rule: /^(\.claude|agent-os\/policies)/i.test(hit) ? 'guard-tamper' : 'canonical-state', why: `A recursive copy or sync into ${p || 'the repository root'} can overwrite ${hit}. Copy individual files to a path below it instead.` };
    return null;
  }
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
  if (p === null) {
    // Outside the repository only scratch space may be deleted: a sibling worktree, the main checkout
    // (.env, Old Website/, .cache/) or ~/.agent-os is never build output (REV-0005 H3; relPath is null there).
    if (t.op === 'delete') {
      const clean = t.path.replace(/\\/g, '/');
      const abs = isAbsolute(clean) || /^[A-Za-z]:\//.test(clean) ? resolve(clean) : resolve(ROOT, t.cwd, clean);
      if (!isTempPath(clean) && !isTempPath(abs))
        return { decision: 'deny', rule: 'destructive-delete', why: `Deleting ${t.path} outside the repository (only the temp directory is scratch space).` };
    }
    return null;
  }
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
  return null;
}

/** A target as written, plus what its glob expands to on disk or could match among the protected paths. */
function targetVariants(raw) {
  if (!hasGlob(raw.path) || nonLiteral(raw.path)) return [raw];
  const clean = driveFix(stripPwd(raw.path)).replace(/^~(?=\/|$)/, homedir().replace(/\\/g, '/'));
  const abs = isAbsolute(clean) || /^[A-Za-z]:\//.test(clean) ? clean : resolve(ROOT, driveFix(raw.cwd), clean);
  return [raw, ...expandGlobPath(abs).map((path) => ({ ...raw, path, cwd: '' }))];
}

function checkBash(cmd, depth = 0, ps = false) {
  const c = String(cmd ?? '');
  if (depth < 3) {
    // A command string handed to another shell is checked as a command (REV-0005: bash -c "rm -rf agent-os").
    for (const m of c.matchAll(/\b(bash|sh|zsh|dash|ksh|pwsh|powershell|cmd)(?:\.exe)?\b[^;&|]*?\s(?:-c|-Command|\/c|\/k)\s+("[^"]*"|'[^']*')/gi)) {
      const inner = checkBash(m[2].slice(1, -1), depth + 1, /^(pwsh|powershell|cmd)$/i.test(m[1]));
      if (inner) return inner;
    }
    // Unquoted: cmd /c and powershell -Command run the rest of the line (REV-0115 H3: `cmd /c rd /s /q agent-os`).
    for (const m of c.matchAll(/\b(?:cmd|pwsh|powershell)(?:\.exe)?\b[^\n]*?\s(?:\/[ckCK]|-c|-Command)\s+(?!["'])([^\n]+)/gi)) {
      const inner = checkBash(m[1], depth + 1, true);
      if (inner) return inner;
    }
    for (const m of c.matchAll(/\b(?:Invoke-Expression|iex)\s+(?:-Command\s+)?("[^"]*"|'[^']*')/gi)) {
      const inner = checkBash(m[1].slice(1, -1), depth + 1, true);
      if (inner) return inner;
    }
  }
  if (/\b(pwsh|powershell)(\.exe)?\b[^\n]*\s-(e|ec|en|enc|enco\w*)\s/i.test(c))
    return { decision: 'deny', rule: 'encoded-command', why: 'An encoded PowerShell command cannot be inspected. Pass the command as text.' };
  for (const r of policy.bash_deny) {
    if (!new RegExp(r.pattern, r.flags ?? '').test(c)) continue;
    if (r.unless && new RegExp(r.unless).test(c)) continue;
    return { decision: 'deny', rule: r.rule, why: r.why };
  }
  const git = gitCheck(c);
  if (git) return git;
  // Command substitutions run too: `echo $(rm -rf agent-os)`, `` `rm -rf agent-os` ``.
  if (depth < 3)
    for (const m of c.matchAll(/\$\(([^()]+)\)|`([^`]+)`/g)) {
      const inner = checkBash(m[1] ?? m[2], depth + 1, ps);
      if (inner && inner.decision === 'deny') return inner;
    }
  const secret = mentionsSecret(c) ?? globSecret(c, ps);
  if (secret) return { decision: 'deny', rule: 'secret-file', why: `${policy.secret_files.why} (command references ${secret})` };
  const script = scriptShape(c, depth, ps);
  if (script) return script;
  for (const raw of writeTargets(c))
    for (const v of targetVariants(raw)) {
      const hit = checkTarget(v, c);
      if (hit) return hit;
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
    // REV-0115 H2: a Grep glob or a globbed read path that could match a secret name (`*env`, `.{e,x}nv`).
    // The Glob tool only lists names, so its pattern is not a read.
    for (const p of [input.glob, input.path, input.file_path].filter((x) => typeof x === 'string'))
      if (globHitsSecret(p.split(/[\\/]/).pop()))
        return { decision: 'deny', rule: 'secret-read', why: `${policy.secret_files.why} (the glob ${p} can match a secret file)` };
    return null;
  }
  if (tool === 'Bash' || tool === 'PowerShell') return checkBash(input.command, 0, tool === 'PowerShell');
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
