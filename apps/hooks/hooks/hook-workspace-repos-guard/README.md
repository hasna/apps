# workspace-repos-guard

Codewith-native hook installed as `hooks run workspace-repos-guard`.

PreToolUse guard for the canonical workspace structure (knowledge
`k_mssu9jdq_dgnnu2`): `$HOME/workspace` contains ONLY `repos/` + `scratch/` +
`AGENTS.md`, and `repos/` contains ONLY GitHub-org folders. Checkouts at
`$HOME/workspace/repos/<org>/<repo>/` are read/context only.

## What it blocks

- Any write to `$HOME/workspace/repos` itself (file tools and Bash).
- Any write that would create a top-level entry directly under `repos/`
  (depth 1 — a stray folder or file at the org level).
- Any write whose second path segment is not an allowed GitHub org.
- Any delete (`rm`, `rmdir`, `git clean`, `git rm`, `unlink`, `shred`,
  `trash`, ...) anywhere under `$HOME/workspace/repos`, at any depth,
  including deep inside org checkouts.

## What it allows

- Reads, always.
- Writes deeper inside an allowed org folder
  (`repos/<org>/<repo>/...`). Structure only: it deliberately does NOT
  duplicate the `worktree-guard` hook, which owns edits-in-shared-checkouts
  semantics.

Home spellings (`~`, `$HOME`, `${HOME}`, quoted or not, including split-quote
forms like `"$HOME"/workspace/repos`, which Bash treats identically to the
unquoted spelling) are expanded before classification; `apply_patch` tools
are inspected through their `Add File` / `Update File` / `Delete File`
markers; Bash relative operands are resolved against the command's cwd when
it sits under `repos/`; parenthesized command groups
(`(cd ... && rm -rf ...)`) are unwrapped.

## Configuration

Allowed orgs default to `hasna,hasnaxyz,hasna-products` and are overridable
with the `WORKSPACE_REPOS_GUARD_ORGS` env var (comma-separated). Private
workspace orgs must be added per-install via that var; they are never part
of the public default. The home directory is resolved with `os.homedir()` —
never hardcoded.

## Failure mode

Fail-open: on any parse or evaluation error the hook responds `continue` so a
guard defect can never wedge the agent.

## Known limitation

The guard is a best-effort **structural** guard, not an execution sandbox.
Variable indirection cannot be caught by pre-expansion inspection: a command
that builds its target dynamically (`R=...; rm -rf $R`, loops over computed
paths, scripts downloaded and executed at runtime) is undetectable at hook
time. The hook inspects literal spellings of the protected path (`~/...`,
`$HOME/...`, `${HOME}/...`, split-quote forms such as `"$HOME"/...`, the
resolved absolute home) and relative operands resolved from the command's
cwd, so anything the shell would expand or indirect through a variable is
outside its reach. Because it also fails open, it must never be relied on as
the only protection layer.

## License

Apache-2.0
