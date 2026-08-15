# hasna/apps — public OSS apps monorepo

This repo is the **producer** of public `@hasna/*` packages. Every member
package under `apps/` is a public npm package. This is the inverse of the
private platform repo, which only *consumes* `@hasna/*` — the gates here are
re-derived for a producer tree, never copied from a consumer tree.

## The three-way split (what lives where)

| surface | repo | publishes |
|---|---|---|
| public OSS apps & packages | **this repo** (`hasna/apps`) | `@hasna/*` (public, npm) |
| private scope — NEVER referenced beyond this line | `hasna-internal/platform` (private) | `@hasna-internal/*` (restricted) |
| forks and archived projects | standalone `hasna/<name>` repos | unchanged, kept separate |

Membership of a project in THIS monorepo is decided by role, not by popularity:
a project that publishes a public `@hasna/*` package and is not a fork or an
archived artifact belongs here. Member census: 75 members are imported under
`apps/` (measured by the standard-adherence suite census); the remaining
public-estate imports are tracked by the import wave (todos `28ac4516`).

## Repo laws (binding)

1. **One-way dependency direction.** Member packages depend on published
   `@hasna/*` registry packages and on other members; nothing here may depend on
   `@hasna-internal/*` or on private infrastructure. Internal-infra strings
   (`*.hasna.xyz`, ARNs, AWS account ids) must never reach a published tarball —
   the CI publish-guard blocks them.
2. **PR-first.** Every change lands via a branch + pull request into `main` from
   a task worktree. The single initial bootstrap commit to `main` was the
   owner-approved exception and is already done.
3. **No secrets in this tree.** Never commit, print, or paste a credential
   value in any encoding. Values live in the secrets vault; the staged scan runs
   before every commit and push, and the CI gates job scans added lines with a
   two-sided self-test.
4. **Every member package = `@hasna/<name>` with four surfaces:** a CLI
   (`<name>` bin), an MCP server bin, a `-serve` server bin, and an `./sdk`
   importable module. Name must match the directory (`apps/<name>` ↔
   `@hasna/<name>`), kebab-case, enforced by the CI name-conformance gate.
5. **Publish guard.** Publishing is per-package `npm publish` from the package
   directory with the vault token `hasna/npm/live/publish-token` via
   `secrets exec` + a temp npmrc referencing `NODE_AUTH_TOKEN`. Never `bun
   publish` (no workspace filter; `workspace:*` tarball leak). Announce intent
   on `git-publishing` before publishing, confirm in-thread after. See
   `.claude/rules/publish.md`.
6. **`Agent:` trailer.** Agent-made commits end the message with
   `Agent: <registered-name>`. Never `Co-Authored-By`. Never override git
   identity.

## Verification

```bash
bun install                 # bun 1.3.14 (packageManager pin)
bunx turbo run build --affected
bun run check               # names + secrets + manifests + publish-guard
```

## Tooling

- `bun` workspaces (`apps/*`), `turbo` for build/test/lint (strict env lists),
  `changesets` with independent per-package versions and public access.
- CI: one workflow, four jobs — `gates` (secrets scan with self-test,
  name-conformance gate, contract-manifest placeholder), `test-suites`
  (versioning + standard-adherence, hard gate), `build-test` (`turbo --affected`
  with `TURBO_SCM_BASE`), `publish-guard` (npm pack --dry-run per member).
- Agent identities: `.claude/agents/{fixer,publisher,reviewer}.md`, laws in
  `.claude/rules/`.
