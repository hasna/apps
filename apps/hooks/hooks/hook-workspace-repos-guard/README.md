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

## Configuration

Allowed orgs default to `hasna,hasnaxyz,hasna-internal,hasna-products` and
are overridable with the `WORKSPACE_REPOS_GUARD_ORGS` env var
(comma-separated). The home directory is resolved with `os.homedir()` —
never hardcoded.

## Failure mode

Fail-open: on any parse or evaluation error the hook responds `continue` so a
guard defect can never wedge the agent.

## License

Apache-2.0
