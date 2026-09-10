# CLAUDE.md — hasna/apps

This is the PUBLIC producer monorepo for `@hasna/*` packages. Read
`AGENTS.md` (repo laws) and `.claude/rules/` before working here. The laws in
short:

- **PR-first, worktree-only.** Mutate files in a task worktree at
  `$HOME/.hasna/repos/worktrees/apps/<name>`, never the shared checkout, never
  `main` directly (the one bootstrap commit to main is already done).
- **No secrets in the tree.** Scan the staged diff before every commit and
  push (`secrets scan staged`). A tagged release (`npm/<app>/v<semver>`) goes
  through the OIDC lane (`.github/workflows/release-npm.yml`, environment
  `npm-release`) and consumes NO token; the vault fallback — for members whose
  manifest does not declare this repo — is `secrets exec
  hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- npm publish
  --userconfig "$NPMRC"` (temp npmrc holding the placeholder text).
- **Public names only.** Every member is `@hasna/<name>`, four surfaces
  (CLI + MCP bin + `-serve` + `./sdk`). No `@hasna-internal/*`, no internal
  infra strings (`*.hasna.xyz`, ARNs, account ids) in published artifacts.
- **Commits** end with `Agent: <registered-name>`. Never `Co-Authored-By`.

Verify with `bun run check` before opening a PR.
