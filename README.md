# hasna/apps

Hasna's **public** OSS apps monorepo. Member packages under `apps/` publish
public `@hasna/*` npm packages — per-app CLIs and SDKs. This repo is fully
public. Hasna's private scope (`@hasna-internal/*`, `hasna-internal` org) is
never described or referenced beyond this prohibition; see the publish guard.

## What lives where

- **Public apps** (this repo): every project that publishes a public
  `@hasna/<name>` package and is not a fork or archived artifact.
- **Forks / archived**: standalone `hasna/<name>` repos, unchanged.

## Layout

```
apps/                  member packages (one dir per @hasna/<name>, four-surface target standard)
contracts/             contract manifests / schemas (tier-0, founder-owned; schema lane deferred)
tooling/ci/            CI gate scripts (secret scan, name conformance, publish guard)
.claude/               agent identities (fixer, publisher, reviewer) + repo laws
.github/workflows/     CI: ci.yml (gates, test-suites, build-test, verify-generated, publish-guard) + release.yml, deploy-projects.yml, deploy-skills.yml, deploy-todos.yml, recordings-macos.yml, blacksmith-testbox.yml
```

## Member status

Member packages live under `apps/` — one directory per public `@hasna/<name>`
package with the four surfaces (CLI, MCP server bin, `-serve` server bin,
`./sdk` import) as a target standard — not every member ships all four today
(25 of 75).

Retired umbrella: the `@hasna/cli` package (bin `hasna`, deprecated on npm)
is retired and has no source in this repo — do not deploy or advertise it
here. The supported surface is the per-app CLIs, and the name-conformance
gate refuses any README claim of a unified CLI that no member package ships.

The LIVE member count is what
the census gate prints —
`bun tooling/ci/check-names.ts` — and this README deliberately carries no
member-count snapshot beyond the four-surface ratio above, because a snapshot
rots while the gate's output does not.
The initial `main` commit was the owner-approved bootstrap; everything after
is PR-first. The remaining public-estate repos are tracked by the import wave
(todos `28ac4516`) and land PR-first; per-member gaps against the four-surface
standard are tracked by the manifest lane (todos `41208cbe`) and the SDK lane
(todos `c7ce8b75`).

## License / Security / Contributing

- License: [Apache-2.0](LICENSE)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security: [SECURITY.md](SECURITY.md)

## Developer commands

```bash
bun install
bunx turbo run build --affected     # or: test / lint
bun run check                        # names + secrets + manifests + publish-guard
```

See `AGENTS.md` for the repo laws and `.claude/rules/` for the details.
