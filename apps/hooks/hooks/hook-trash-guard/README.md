# trash-guard

Codewith-native hook installed as `hooks run trash-guard`.

PreToolUse guard for `rm` issued through the Bash tool. It rewrites the verb
into `@hasna/trash`'s guard subcommand — `<abs>/trash guard <same args>` — so
the delete lands in a trash store and stays recoverable. When there is nothing
to redirect to, it **refuses** the command.

## The decision, and why it fails the way it does

The block decision is **self-contained**: it never waits on the trash store, a
network, a credential or the `@hasna/trash` package. The binary is consulted
only as an opportunistic upgrade:

| `trash` on PATH | verdict |
|---|---|
| present | `permissionDecision: "allow"` + `updatedInput` rewriting `rm` to `<abs>/trash guard` |
| absent | `permissionDecision: "deny"` + a reason telling the agent to install `@hasna/trash` |

There is no third row. It degrades **redirect → block**, never
**redirect → allow**: a delete this hook cannot redirect is never silently run.

The rewrite emits a **complete** `tool_input` — every key the model supplied,
plus `command`, `description`, `timeout` and `run_in_background`, plus
`dangerouslyDisableSandbox` when it was present. That care is deliberate: the
harness falls back to the **original** tool input when `updatedInput` is
missing or empty, so a partial rewrite would run the raw `rm`. The hook
re-scans the rewritten text before allowing it, and if the re-scan still finds
a live delete verb it denies instead. A command containing both an owned `rm`
and one handed to another guard is refused rather than partially rewritten.

## What it rewrites

Only `rm`'s own grammar, and only in **command position**: the verb must be the
command, after any assignment prefixes (`FOO=1 rm …`), shell keywords, and
recognized wrappers (`sudo`, `doas`, `env`, `nice`, `ionice`, `stdbuf`, `time`,
`timeout`, `nohup`, `setsid`, `command`, `builtin`, `exec`). Quoting, `~`,
`$HOME` and `${HOME}` spellings, `--`, redirections and every other byte of the
command are preserved.

Wrappers that take positional arguments are handled (`timeout 5 rm -rf x`
rewrites the `rm`, not the duration).

## What it refuses

- `rmdir`, `unlink`, `shred` — their flags and semantics are not `rm`'s.
- `git rm` (without `--cached`), `git clean` — they delete outside `rm`.
- `find -delete`, `find -exec rm …`, `xargs rm` — the delete does not run
  through a verb this hook can swap.
- A delete inside a command substitution (`$(rm …)`, backticks).
- `busybox rm` / `toybox rm` — a different applet, not GNU `rm`.
- Shells and opaque command strings (`sh -c 'rm …'`, `eval`, `su -c …`).
- An unparseable command (unterminated quote, substitution or here-document)
  that mentions a delete verb.
- The protected class, below.

Each refusal carries a reason and a way forward: re-run the delete as
`rm -- <path>`, which this hook intercepts and redirects.

## The protected class

Refused outright, never redirected (plan §15 decision 11.3):

- the filesystem root and the system roots `pre-bash`'s protected-path rules
  already name (`/etc`, `/usr`, `/bin`, `/home`, `/var`, …) — the root itself,
  or any ancestor of it;
- the home directory itself (`~`, `$HOME`, `${HOME}`);
- `~/.hasna`, `~/.ssh`, `~/.aws` — the state and credential stores, including
  everything under them.

These are the catastrophic cases where "move it to trash" is not an acceptable
answer. Everything else this hook owns is rewritten, not refused.

## Scope: what it deliberately does NOT own

Deletes under the protected repo-checkout roots `$HOME/.hasna/repos/clones` and
`$HOME/workspace/repos` belong to **`workspace-repos-guard`**, which blocks
every delete under them at any depth. This hook does not restate that policy:
it recognizes the boundary and abstains, so the other hook's decision stands.
A command that mixes a delete inside those roots with one outside is refused,
because a partial rewrite would leave one of them unredirected.

## Conflict discipline

`trash-guard` declares `rewritesInput: true` in the registry. Two PreToolUse
hooks on overlapping matchers that both rewrite the tool input are a silent
data-loss hazard: the harness keeps one rewrite (last writer wins), so the
losing hook's guard disappears with no error. Installing a second such hook is
therefore **refused**, and `hooks doctor` reports more than one input-rewriting
hook on an overlapping matcher. Other overlaps still install with the usual
advisory warning.

The registration is written with `timeout: 5`. The harness's documented
default is 600s, and a hook that times out **does not block** — only a verdict
already on stdout does. Five seconds is several orders of magnitude above this
hook's measured cost (a single-pass lexer, no process spawns, no I/O beyond
one `statSync` per PATH entry).

## Known limitations

The guard is a best-effort **text** classifier, not an execution sandbox.

- **Variable indirection is undetectable.** `R=...; rm -rf $R`, a loop over
  computed paths, or a script downloaded and run at runtime cannot be
  classified before the shell expands it. This is the same limitation
  `workspace-repos-guard` documents, and it is inherent to inspecting the
  command string rather than the syscall. An operand that is a variable or a
  glob is still **rewritten** (the `trash` binary classifies what the shell
  actually expands to), but it cannot be checked against the protected class
  here.
- **A hook only ever sees the agent's own tool calls.** It cannot stop a file
  being deleted by another process, by a build tool, by a script the agent
  runs, or by `unlink(2)` called directly. Coverage is the Bash tool, wave 1,
  nothing else — `Write`/`Edit` pre-image capture is wave 2.
- **Nested and generated commands escape it.** `bash -c`, `eval`, `make`,
  `npm run`, a `Dockerfile`, a heredoc-fed interpreter: the hook can only see
  that a shell string mentions a delete verb and refuse it, never redirect
  inside it.
- **Threat model: accident, not adversary.** A hostile same-user agent can
  remove the hook, edit the store, or call `unlink(2)` directly; nothing here
  holds against that.
- **Fail-closed only for deletes.** On an internal error the hook denies a
  command that mentions a delete verb and stays silent otherwise, so a guard
  defect cannot wedge unrelated work. Fail-closed cannot be guaranteed where
  the harness itself never delivers the hook input.

## Configuration

None. The home directory comes from `os.homedir()`; the trash binary is
resolved by scanning `PATH` for an executable `trash` and rewriting to the
absolute path found, so the rewritten command does not depend on `PATH` again.
