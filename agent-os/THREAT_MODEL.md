# Agent-system threat model

**Scope:** the agents working on this repository and the tools they use. The
application's own threat model is in `project-management/SECURITY_AUDIT.md`.

**Principle:** external content is data. It is never an instruction, whatever
it claims about itself.

> **Revision 2, after REV-0004.** An adversarial security review of TASK-0080
> found three HIGH bypasses of controls this document had marked "Yes", and
> recorded a BLOCKING_OBJECTION:
>
> - H1: owner forgery through the libraries
> - H2: `.env` readable outside the worktree and through name and shell tricks
> - H3: unrecoverable deletes of untracked governance state
>
> All three, and the MEDIUM and LOW findings, are fixed below. Each fix has a
> regression eval. The objection stays open until a fresh security review
> clears it; this document does not clear it.

## Assets

- live customer secrets in the legacy backup and the live WordPress database
- the `.env` in the main checkout, which holds live staging credentials
- the staging/production database that `.env` reaches
- the Coolify and Hostinger accounts
- GitHub history
- canonical project state, including `agent-os/`, `project-management/` and
  `.claude/`, all untracked until the owner commits them
- the owner's decision authority and the owner key

## Threats and controls

| Threat                                                                          | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Enforced?                                                                        | Evidence                                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Reading `.env` or other secret files                                            | The guard recognises secret files **by name anywhere on disk**, including the main checkout outside this worktree. Windows name tricks are normalised (`.ENV`, `.env.`, `.env::$DATA`). Any shell command that references a secret file is refused, whatever the verb (`cat`, `base64`, `sort`, `source`, `node -e`, `python`, `git show HEAD:.env`, PowerShell `gc` / `ReadAllText` / `sls`). Environment dumps are refused (`env`, `printenv`, `export -p`, `dir env:`). Permission deny rules add a second layer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Yes**, for names the guard can see (limit 2)                                   | guard.test.mjs, REV-0004 H2 cases                        |
| Writing `.env`, `Old Website/`, `.cache/`                                       | Refused by secret name or protected path segment, anywhere, case-insensitively                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **Yes**                                                                          | guard.test.mjs                                           |
| Deleting governance state or legacy data                                        | **Best-effort command parsing, not a structural guarantee.** Delete targets are read from `rm`/`rmdir`/`unlink`/`shred`, `mv` sources, `find` start points (`.` when none are given) for `-delete` and any `-exec` that is not read-only, `Remove-Item` and cmd `rd`/`del` (`del /s` reaches every subdirectory), `robocopy /MIR /PURGE /MOVE`, `rsync --delete*`, `git checkout/restore` paths, `cmd /c` and `powershell -Command` with or without quotes, and inline programs (in a program that deletes or starts a process, every string literal is checked as a target and as a command). Globs are expanded against the disk and against the protected paths. Refused on the protected roots (`agent-os`, `project-management`, `.claude`, `.git`, `Old Website`, `.cache`, applied migrations), inside them and on their ancestors; outside the repository only the temp directory may be deleted. `git clean` options are parsed, so only a real `-n`/`--dry-run` is a dry run. `reset --hard`, `stash -u/-a`, `stash clear`, `checkout -f` and `switch -f` are refused. A shape the parser does not model is not seen. | **Partly**: the shapes the parser models (limits 0b, 1, 8, 9)                    | guard.test.mjs: REV-0004 H3, REV-0005, REV-0113 cases    |
| Bypassing canonical state (editing the log, projections or record front matter) | Write-deny on the state and projections, and a front-matter check on Edit/Write. Shell write targets are parsed best-effort: redirects, `tee`, `cp`/`mv`/`install`/`ln` (including `-t`/`--target-directory` and directory destinations), recursive copies onto the state or an ancestor of it, `rsync`/`robocopy`/`xcopy`, `sed -i`/`--in-place`, `perl -i`, `dd`, PowerShell cmdlets with named or positional `-Path`/`-Destination`, `git checkout --`, and `git update-index --cacheinfo`, `checkout-index -f` and `read-tree -u`. Targets are resolved through `cd`, backslashes, heredocs and globs, case-insensitively. A writer the parser does not model passes the guard. **Detection** is `pm check` replay in CI, which refuses a hand-edited or forged log; an owner-proof forgery is detected only on a machine that holds the owner key (limit 0c).                                                                                                                                                                                                                                                              | **Partly**: prevention is best-effort (limits 0b, 1, 8); detection by `pm check` | guard.test.mjs, consistency.test.mjs                     |
| Rewriting history                                                               | The guard refuses force/mirror/`+ref` push, filter-repo and reset to origin. `pm check` enforces the log is append-only. `commit()` refuses a second V1 import.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Yes**                                                                          | state.test.mjs                                           |
| Destructive database commands                                                   | The guard refuses `migrate reset`, `db push --accept-data-loss`, DROP, TRUNCATE and unscoped DELETE. Commands that write to the database ask first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **Yes** for deny; ask is advisory in bypass mode (BUG-0018)                      | guard.test.mjs                                           |
| **Owner impersonation**                                                         | Four layers. (1) Every owner event must carry an **HMAC proof made with a key outside the repository** (`~/.agent-os/owner.key`). Only the owner's paths create the key: the dashboard in owner mode and the TTY-only `pm owner`. (2) `writeGuards` refuses owner events without a valid proof. `pm check` flags any in the log. `commit()` refuses to run without guards. (3) The guard refuses inline evaluation that touches the state or owner libraries (`node -e`, `--input-type`, heredocs to interpreters), references to the key, `pm owner`, `/api/owner` in any encoding, and `PM_CHANNEL=`. (4) The CLI refuses `--by owner`; the server accepts owner actions only from an owner-mode start, with a token, a same-origin request and a matching Host.                                                                                                                                                                                                                                                                                                                                                              | **Yes**, except limit 3                                                          | opportunity.test.mjs (REV-0004 H1), consistency.test.mjs |
| Fake independent review                                                         | The CLI requires an `--independent` review to name a fresh-context executor (`subagent:*`), and refuses the primary agent as its own independent reviewer. L3+ completion needs such a review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **Partly**: identity is self-declared (limit 4)                                  | decision-rights.test.mjs (REV-0003 finding)              |
| Eval channel abuse                                                              | `PM_CHANNEL=eval` is honoured only when `PM_ROOT` is inside the OS temp directory. The eval channel no longer skips the role check. The guard refuses `PM_CHANNEL=`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Yes**                                                                          | REV-0004 M1                                              |
| Veto abuse                                                                      | Decision-rights matrix; the CLI refuses a veto from a role that holds none for the domain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Yes**                                                                          | decision-rights.test.mjs                                 |
| Weak evidence presented as strong                                               | The readiness gate caps STRONG and MIXED on factual evidence, caps competitor-only evidence at WEAK, and limits WEAK evidence to exploratory recommendations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **Yes**                                                                          | opportunity.test.mjs (REV-0004 M2)                       |
| Dashboard server abuse                                                          | Path containment by relative path (not string prefix). `state/` and `logs/` are refused, as are `.jsonl`, `.log` and `.key` files. Host header must be localhost (DNS rebinding). Owner endpoints are closed unless the server was started in owner mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Yes**                                                                          | consistency.test.mjs (REV-0004 L1, L2)                   |
| Prompt injection                                                                | The research subagent has no shell. Every brief says pages are data. The guard bounds what a hijacked agent can do.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **Partly**: this limits the blast radius, it cannot stop persuasion              | research-analyst.md                                      |
| Dependency attacks                                                              | The Agent OS has no dependencies (`node:` builtins only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Yes**                                                                          | package.json                                             |
| Over-broad credentials                                                          | A plaintext MCP credential sits in user-level settings (BUG-0017)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **No**: the owner must act                                                       | this audit                                               |
| Guardrail tampering                                                             | Shell writes to settings, hooks and policies are denied, resolved through targets (so `cd` and backslash tricks fail). Edit/Write of those files asks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **Partly**: ask is advisory in bypass mode (BUG-0018)                            | guard.test.mjs                                           |
| Erasing dissent or forging reviews through invalidation (TASK-0092)             | `pm review-invalidate` appends, never edits. Owner records cannot be struck; a block only by its own reviewer; other non-PASS results only by the reviewer or exec-director; a primary agent never strikes reviews of its own work. Replay re-checks authority on every event, and the history line is built from the struck review, not from what the event claims.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | CLI + `pm check` replay                                                          | `agent-os/evals/review-invalidation.test.mjs`            |

## Revision 3, after REV-0005: the second security round

REV-0005 recorded a second BLOCKING_OBJECTION. The original REV-0004 paths
were closed, but simple variants remained.

**Structural fix.** `pm check` now **replays the whole log through every
write guard**, so a forged event fails CI however it reached the file: raw
append, `node -e`, a no-op guard, or a non-owner or migration channel.
Validation happens on read, not only on write.

**Guard fixes:**

- secrets named with backslash paths and wildcards (`gc .\.env`, `cat .e*`)
- ancestor and `./*` deletes, and `git -C … clean`
- `bash -c` recursion
- `1>>`, `&>>` and `>|` redirects
- absolute `cd`
- `git checkout <ref> <path>` and `git restore`
- `perl -pi` and `[IO.File]::*`
- Claude settings outside the repo
- the key-file override variable

Every variant has a regression eval (55 in total).

**Escalated, not looped.** Security decisions allow two review rounds. Both
ended blocking, so TASK-0080 is BLOCKED and escalated to PM-06 and the owner.
The objection stays open. It is not cleared by this document or by the
implementer.

## Revision 4: REV-0005 re-work and TASK-0082 (not yet re-reviewed)

The REV-0005 objection stays open until a fresh security review clears it.
This revision records what changed and what is still out of reach.

**H1, `pm check` side.** Replay now checks an owner proof on **every**
owner-class event, on any channel: owner-only event types, any event by the
owner actor, and any CR carrying `source_opportunity` (the approval
artifact). A CR with `source_opportunity` from anyone but the owner on an
owner channel is refused. `v1_imported` is valid only as the log's prefix.
Before this change, a later unguarded `v1_imported` could create an APPROVED
opportunity with no proof.

**H1, guard side.** The guard handles these shapes:

- Redirects (`1>`, `1>>`, `&>`, `&>>`, `>|`) are resolved, including through
  `$PWD/…`, `( … )`, `{ … }`, `$( … )` and backticks.
- A computed write target (`$F`, `$(…)`) is refused when the command names the
  event log or the guardrails.
- An **inline program** that names the event log and can write is refused.
  This covers `node -e`, `python -c`, `perl -e`, `ruby -e`, heredocs into an
  interpreter, and PowerShell `[IO.File]`/`StreamWriter`. It applies even
  when the path is assembled (`join('agent-os','state',…)`) or passed as
  `argv`.

**H3.** These deletes are refused:

- Any delete outside the repository except under the temp directory. This
  covers sibling worktrees, the main checkout and `~/.agent-os`.
- MSYS spellings (`/d/…`).
- Any delete whose target is computed (`rm -rf "$DIR"`, `rmSync(process.cwd())`,
  `[IO.Directory]::Delete($p)`).
- Pipeline deletes (`xargs rm`, `… | Remove-Item`, `% { Remove-Item }`).
- `` `rm …` `` and `$(rm …)` substitutions.

`git clean -nfd` counts as a dry run. `node_modules/.cache` is build output,
not the legacy `.cache/`, and `..` is resolved before that rule applies.

**Deny by default, false positives accepted.** A read-only inline script
that names `events.jsonl` and also contains a write-like token (including a
bare `>` comparison) is refused. Use `pnpm pm show` or `cat` instead. A
recursive delete of a variable path is refused even when it is harmless.

## Revision 5: REV-0113, TASK-0080 round 2 (re-reviewed in REV-0115)

REV-0113 (security re-test, BLOCKING_OBJECTION) listed inputs the guard still
allowed. The objection stays open until a fresh security review clears it.
Each input below has a regression eval in `guard.test.mjs`.

- **H3, deletes.** `cmd /c rd /s /q …` without quotes; `del /s`;
  `robocopy /MIR`, `/PURGE` and `/MOVE`; `rsync --delete*` and
  `--remove-source-files`; child-process deletes in inline programs
  (`subprocess.run([...])`, `os.system`, `__import__('shutil').rmtree`,
  `execSync`, `spawnSync`, perl `rmtree`/`system`, ruby `FileUtils.rm_rf`);
  `find -delete` and `find -exec` with no start point; `git clean` with `-n`
  only as the value of `-e`/`--exclude` or after `--`.
- **H3, uncommitted work.** `git reset --hard`, `git stash -u/-a`,
  `git stash clear`, `git checkout -f`, `git checkout -- .`, `git switch -f`
  and `--discard-changes` are refused. `git stash push -m`, `stash list`,
  `checkout <branch>`, `switch`, `merge`, `revert`, `commit` and `fetch`
  stay allowed; `push` still asks.
- **H2, globs.** Any argument whose last segment is a glob that could expand to
  a secret name is refused, whatever its first character: `*env`, `?env`,
  `*nv`, `.[a-z]nv`, `.[[:alpha:]]nv`, `.{e,x}nv`, `.e[!x]v`. The same
  applies to the Grep tool's `glob` and `path`. A bare `*` counts only for
  content readers under PowerShell, cmd or bash `dotglob`, because plain bash
  never expands `*` to a dotfile. `.env.example` is allowed. Bash escapes
  (`.e\nv`) are read both ways.
- **H1, writes.** `cp -t DIR`, `--target-directory`, a directory destination
  (`cp x agent-os/state/`), recursive copies onto an ancestor of the state,
  `Copy-Item`/`Move-Item` destinations (positional, `-Destination`,
  `-Destination:`), `Set-Content -Value x <path>`, `New-Item -Name`,
  `sed --in-place`, globbed targets (`agent-os/stat[e]/…`, `agent-os/sta*/…`)
  and `git update-index --cacheinfo`.
- **Also closed on the way:** `powershell -EncodedCommand` (refused, it cannot
  be inspected) and `iex '…'`, which is checked as a command.

**What did not change.** The guard is still a command parser. It denies the
shapes it models and accepts some false positives to do so. It is not a
sandbox, and the limits below are what it cannot see.

## Revision 6: REV-0115, residual risk accepted by the owner

The re-test of round 2 (REV-0115, BLOCKING_OBJECTION) confirmed every
REV-0113 input is denied and found new bypasses in all three classes. They come
from wrappers and parser shapes the guard reads as data:

- PowerShell path arrays (`x, ......`), `.Delete($true)`, script blocks
  and `try {}`, and abbreviated `-comm`
- `eval`, `bash -lc`, `echo … | bash`, and `env`/`nice`/`timeout`
  prefixes
- the `cmd` caret escape (`r^d`) and `wsl`
- `git worktree remove --force .`
- `.env` loaded by Node itself (`process.loadEnvFile`, `-r dotenv/config`)
- `ac -Va/-Pa` and `Tee-Object`
- writes into a sibling worktree's log

**What this means.** A deny-list parser cannot be made complete. After five
review rounds the governor's limit escalated the item to the owner. The owner
accepted the residual risk on 2026-10-02, recorded as `risk_accepted` on
TASK-0080. Two consequences follow:

- The guard is a **best-effort tripwire** against accidents and casual
  misuse, not a security boundary against a determined agent.
- Real containment is TASK-0098: an OS-level sandbox or an allowlisted shell.

**Until TASK-0098 lands:**

- `pm check` replay is the backstop for state forgery, on a machine holding
  the owner key.
- Commits and the remote are the backstop for destroyed work.
- The main checkout's `.env` stays outside every worktree.

## Remaining limits (recorded, not hidden)

0. **Pattern rules scan the whole command, quoted text included.** A note or
   commit message that contains `git … clean` or `.env` is refused. That is
   a false positive, not a bypass; reword the text.
   0b. **Computed targets are refused by shape, not followed.** Revision 4
   refuses pipeline deletes, computed delete targets and inline programs that
   name the log. It still cannot see through names that never appear in the
   command text:
   - 8.3 short names (`AGENT-~1`)
   - names decoded at runtime (base64, `chr()` concatenation, `'events' + '.jsonl'`)
   - a computed write target in a command that never names the log or the
     guardrails
   - `find … -exec` over a computed root
   - writes by tools the guard does not model (`git apply`, `git am`, `tar -x`,
     `unzip`, an editor)
   - process launchers whose arguments are data (`Start-Process -ArgumentList`,
     `saps`, `xargs` over a file of commands)
   - links and junctions (`ln -s`, `mklink /J`, `New-Item -ItemType Junction`)
     that give a protected directory a second name

   For state, `pm check` replay catches the effect. For deletions of untracked
   files nothing can restore them, which is why committing the governance
   state matters (limit 6).
   0c. **`pm check` detects a forged owner event only on a machine that holds
   the owner key.** CI cannot verify owner proofs, because the key is on the owner's machine.
   CI checks that a proof is present; the owner's machine checks that it is
   valid. A random "proof" therefore passes CI, and fails `pm check` wherever
   the key exists.

1. **A standalone script file that writes or reads is not inspected (TASK-0082
   explicit limit).** Running `node scratch/x.mjs`, `python x.py`,
   `pwsh -File x.ps1`, or a package script executes code the guard never sees. Detection
   there cannot be complete: the guard would have to read and understand an
   arbitrary program. Inline one-liners are inspected by shape (revision 4):
   `node -e`, `python -c`, `perl -e`/`-pi`, `ruby -e`, `deno`, `bun`, heredocs
   into an interpreter, and PowerShell `[IO.File]`.
   - For state, projections and front matter, `pm check` catches the effect in
     CI.
   - Secrets are protected by keeping them out of reach of external scripts.
2. **Obfuscated names defeat any name-based check.** Examples: a path assembled at
   runtime, variables (`F=…; cat $F`), or base64-decoded names. The guard
   catches the common forms, and CI catches their effect on state.
3. **The owner key is a file.**
   - A script that reads it (limit 1) could sign.
   - Before the owner first runs owner mode, no key exists, so a script could
     create one first.
   - Owner decisions should therefore be reviewed from the dashboard's decision
     history, which records `channel` and time.
   - A stronger boundary needs OS-level separation: a separate user account, or
     an OS keychain.
4. **Subagent identity is self-declared** (`--by`, `--executor`). Independence is
   enforced structurally: tool lists, a fresh-context executor is required, and
   no self-review. It is not cryptographic.
5. **`ask` does not stop an agent in bypassPermissions mode** (BUG-0018). Every
   protection that matters is a deny.
6. **Governance state is untracked.** Until the owner commits `agent-os/`,
   `project-management/` and `.claude/`, a deletion the guard misses cannot be
   recovered. Committing them is the owner's call.
7. **The `.env` database is live staging.** The guard refuses destructive
   commands against it. Ordinary application-script writes are only ask-gated.

8. **The guard parses commands; it does not contain them.** Coverage of
   writes and deletes is the list of shapes in rows "Deleting governance
   state" and "Bypassing canonical state", nothing more. Recording a new shape
   needs a code change and an eval. For the event log, `pm check` replay is
   the backstop; for deleted untracked files there is none (limit 6).
9. **Recursive reads are not name-checked.** `grep -r . ../../..`,
   `find … -exec grep`, `Select-String -Recurse`, or a recursive copy of a
   tree that holds `.env` read it without naming it. The Grep tool on a
   directory relies on ripgrep skipping hidden and git-ignored files.
10. **Deny-by-default false positives.** A glob in quoted text (a `--reason`
    containing `*env`), an inline program that deletes or starts a process
    and also holds a literal such as `'.'`, and `find -exec` with a command
    outside the read-only list are refused even when harmless. Reword, or name
    the path literally.
