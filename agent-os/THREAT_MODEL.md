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

| Threat                                                                          | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Enforced?                                                           | Evidence                                                 |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------- |
| Reading `.env` or other secret files                                            | The guard recognises secret files **by name anywhere on disk**, including the main checkout outside this worktree. Windows name tricks are normalised (`.ENV`, `.env.`, `.env::$DATA`). Any shell command that references a secret file is refused, whatever the verb (`cat`, `base64`, `sort`, `source`, `node -e`, `python`, `git show HEAD:.env`, PowerShell `gc` / `ReadAllText` / `sls`). Environment dumps are refused (`env`, `printenv`, `export -p`, `dir env:`). Permission deny rules add a second layer.                                                                                                                                                                                                                                               | **Yes**, for names the guard can see (limit 2)                      | guard.test.mjs, REV-0004 H2 cases                        |
| Writing `.env`, `Old Website/`, `.cache/`                                       | Refused by secret name or protected path segment, anywhere, case-insensitively                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Yes**                                                             | guard.test.mjs                                           |
| Deleting governance state or legacy data                                        | Structural delete check: `rm`, `rmdir`, `mv` sources, `find -delete/-exec`, `Remove-Item`/`ri`/`del`, and `git checkout/restore` targets. Refused on the protected roots (`agent-os`, `project-management`, `.claude`, `.git`, `Old Website`, `.cache`, applied migrations), on anything inside them, and **on their ancestors**. Deleting `/`, `~` or `*` is refused. `git clean` is refused except as `-n`.                                                                                                                                                                                                                                                                                                                                                      | **Yes**                                                             | guard.test.mjs, REV-0004 H3 cases                        |
| Bypassing canonical state (editing the log, projections or record front matter) | Write-deny on the state and projections. Front-matter check on Edit/Write. Shell write targets resolved through `cd`, backslashes, heredocs fed to interpreters, `git checkout --`, `cp`/`mv`/`tee`/`sed -i`/`dd`/PowerShell cmdlets, all case-insensitive. `pm check` in CI catches drift.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **Yes**, except limit 1                                             | guard.test.mjs, consistency.test.mjs                     |
| Rewriting history                                                               | The guard refuses force/mirror/`+ref` push, filter-repo and reset to origin. `pm check` enforces the log is append-only. `commit()` refuses a second V1 import.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **Yes**                                                             | state.test.mjs                                           |
| Destructive database commands                                                   | The guard refuses `migrate reset`, `db push --accept-data-loss`, DROP, TRUNCATE and unscoped DELETE. Commands that write to the database ask first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **Yes** for deny; ask is advisory in bypass mode (BUG-0018)         | guard.test.mjs                                           |
| **Owner impersonation**                                                         | Four layers. (1) Every owner event must carry an **HMAC proof made with a key outside the repository** (`~/.agent-os/owner.key`). Only the owner's paths create the key: the dashboard in owner mode and the TTY-only `pm owner`. (2) `writeGuards` refuses owner events without a valid proof. `pm check` flags any in the log. `commit()` refuses to run without guards. (3) The guard refuses inline evaluation that touches the state or owner libraries (`node -e`, `--input-type`, heredocs to interpreters), references to the key, `pm owner`, `/api/owner` in any encoding, and `PM_CHANNEL=`. (4) The CLI refuses `--by owner`; the server accepts owner actions only from an owner-mode start, with a token, a same-origin request and a matching Host. | **Yes**, except limit 3                                             | opportunity.test.mjs (REV-0004 H1), consistency.test.mjs |
| Fake independent review                                                         | The CLI requires an `--independent` review to name a fresh-context executor (`subagent:*`), and refuses the primary agent as its own independent reviewer. L3+ completion needs such a review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Partly**: identity is self-declared (limit 4)                     | decision-rights.test.mjs (REV-0003 finding)              |
| Eval channel abuse                                                              | `PM_CHANNEL=eval` is honoured only when `PM_ROOT` is inside the OS temp directory. The eval channel no longer skips the role check. The guard refuses `PM_CHANNEL=`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **Yes**                                                             | REV-0004 M1                                              |
| Veto abuse                                                                      | Decision-rights matrix; the CLI refuses a veto from a role that holds none for the domain                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **Yes**                                                             | decision-rights.test.mjs                                 |
| Weak evidence presented as strong                                               | The readiness gate caps STRONG and MIXED on factual evidence, caps competitor-only evidence at WEAK, and limits WEAK evidence to exploratory recommendations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | **Yes**                                                             | opportunity.test.mjs (REV-0004 M2)                       |
| Dashboard server abuse                                                          | Path containment by relative path (not string prefix). `state/` and `logs/` are refused, as are `.jsonl`, `.log` and `.key` files. Host header must be localhost (DNS rebinding). Owner endpoints are closed unless the server was started in owner mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **Yes**                                                             | consistency.test.mjs (REV-0004 L1, L2)                   |
| Prompt injection                                                                | The research subagent has no shell. Every brief says pages are data. The guard bounds what a hijacked agent can do.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **Partly**: this limits the blast radius, it cannot stop persuasion | research-analyst.md                                      |
| Dependency attacks                                                              | The Agent OS has no dependencies (`node:` builtins only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **Yes**                                                             | package.json                                             |
| Over-broad credentials                                                          | A plaintext MCP credential sits in user-level settings (BUG-0017)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | **No**: the owner must act                                          | this audit                                               |
| Guardrail tampering                                                             | Shell writes to settings, hooks and policies are denied, resolved through targets (so `cd` and backslash tricks fail). Edit/Write of those files asks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **Partly**: ask is advisory in bypass mode (BUG-0018)               | guard.test.mjs                                           |
| Erasing dissent or forging reviews through invalidation (TASK-0092)             | `pm review-invalidate` appends, never edits. Owner records cannot be struck; a block only by its own reviewer; other non-PASS results only by the reviewer or exec-director; a primary agent never strikes reviews of its own work. Replay re-checks authority on every event, and the history line is built from the struck review, not from what the event claims.                                                                                                                                                                                                                                                                                                                                                                                               | CLI + `pm check` replay                                             | `agent-os/evals/review-invalidation.test.mjs`            |

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
   - writes by tools the guard does not model (`git apply`, `tar -x`, `unzip`,
     an editor)

   For state, `pm check` replay catches the effect. For deletions of untracked
   files nothing can restore them, which is why committing the governance
   state matters (limit 6).
   0c. **CI cannot verify owner proofs,** because the key is on the owner's machine.
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
