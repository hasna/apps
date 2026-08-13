# CLAUDE.md — hasna/apps

This is the PUBLIC producer monorepo for `@hasna/*` packages. Read
`AGENTS.md` (repo laws) and `.claude/rules/` before working here. The laws in
short:

- **PR-first, worktree-only.** Mutate files in a task worktree at
  `$HOME/.hasna/repos/worktrees/apps/<name>`, never the shared checkout, never
  `main` directly (the one bootstrap commit to main is already done).
- **No secrets in the tree.** Scan the staged diff before every commit and
  push (`secrets scan staged`). Values live in the vault; consume with
  `secrets exec hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- npm publish
  --userconfig "$NPMRC"` (temp npmrc holding the placeholder text).
- **Public names only.** Every member is `@hasna/<name>`, four surfaces
  (CLI + MCP bin + `-serve` + `./sdk`). No `@hasna-internal/*`, no internal
  infra strings (`*.hasna.xyz`, ARNs, account ids) in published artifacts.
- **Commits** end with `Agent: <registered-name>`. Never `Co-Authored-By`.

Verify with `bun run check` before opening a PR.
