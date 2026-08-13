# hasna/apps

Hasna's **public** OSS apps monorepo. Member packages under `apps/` publish
public `@hasna/*` npm packages — per-app CLIs, the unified `hasna` CLI, and
SDKs. This is the producer counterpart to `hasna-internal/platform` (private,
consumes `@hasna/*`).

## What lives where

- **Public apps** (this repo): every project that publishes a public
  `@hasna/<name>` package and is not a fork or archived artifact.
- **Private apps**: `hasna-internal/platform` (private org) — internal control
  plane, internal apps, agent infrastructure; publishes `@hasna-internal/*`.
- **Forks / archived**: standalone `hasna/<name>` repos, unchanged.

## Layout

```
apps/                  member packages (one dir per @hasna/<name>, four surfaces each)
contracts/             contract manifests / schemas (tier-0, founder-owned; schema lane deferred)
tooling/ci/            CI gate scripts (secret scan, name conformance, publish guard)
.claude/               agent identities (fixer, publisher, reviewer) + repo laws
.github/workflows/     one CI workflow: gates, build-test, publish-guard
```

## Bootstrap status (2026-08-13)

Phase-0 skeleton: workspaces, turbo, changesets (independent versions, public
access), CI gates, agent rules. The member repos are **not imported yet** —
that is the next lane's work; this tree intentionally holds no member packages.
The initial `main` commit is the owner-approved bootstrap; everything after is
PR-first.

## Developer commands

```bash
bun install
bunx turbo run build --affected     # or: test / lint
bun run check                        # names + secrets + manifests + publish-guard
```

See `AGENTS.md` for the repo laws and `.claude/rules/` for the details.
