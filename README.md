# hasna/apps

Hasna's **public** OSS apps monorepo. Member packages under `apps/` publish
public `@hasna/*` npm packages — per-app CLIs, the unified `hasna` CLI, and
SDKs. This repo is fully public. Hasna's private scope (`@hasna-internal/*`,
`hasna-internal` org) is never described or referenced beyond this prohibition;
see the publish guard.

## What lives where

- **Public apps** (this repo): every project that publishes a public
  `@hasna/<name>` package and is not a fork or archived artifact.
- **Forks / archived**: standalone `hasna/<name>` repos, unchanged.

## Layout

```
apps/                  member packages (one dir per @hasna/<name>, four surfaces each)
contracts/             contract manifests / schemas (tier-0, founder-owned; schema lane deferred)
tooling/ci/            CI gate scripts (secret scan, name conformance, publish guard)
.claude/               agent identities (fixer, publisher, reviewer) + repo laws
.github/workflows/     one CI workflow: gates, test-suites, build-test, verify-generated, publish-guard
```

## Member status (2026-08-15)

77 member packages are imported under `apps/` (measured by the
standard-adherence census, 2026-08-15), each a public `@hasna/<name>`
package with the four surfaces (CLI, MCP server bin, `-serve` server bin,
`./sdk` import). The initial `main` commit was the owner-approved bootstrap;
everything after is PR-first. The remaining public-estate repos are tracked by
the import wave (todos `28ac4516`) and land PR-first; per-member gaps against
the four-surface standard are tracked by the manifest lane (todos `41208cbe`)
and the SDK lane (todos `c7ce8b75`).

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
