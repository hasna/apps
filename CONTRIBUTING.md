# Contributing

This repo is the public `@hasna/*` apps monorepo. Add one member app per
directory under `apps/`, named for the package it publishes:
`apps/<name>` maps to `@hasna/<name>`.

Each member app is expected to ship four surfaces: a CLI bin, an MCP server
bin, a `-serve` server bin, and an importable `./sdk` module. Not every
member has reached that standard yet — per-member gaps are tracked by the
manifest lane (todos `41208cbe`) and the SDK lane (todos `c7ce8b75`). Keep
domain logic in the member app and route interfaces through that shared
implementation.

All changes land PR-first from a task worktree. Never push directly to `main`.

Before opening or updating a PR, run the relevant gates:

```bash
bun run check
bunx turbo run build --affected
bunx turbo run test --affected
```

`bun run check` covers names, secrets, manifests, and the publish guard. The
contract-manifest gate (`tooling/ci/check-manifests.ts`) is a real validator
that runs the canonical manifest validator against every publishable member
and refuses (exit 1); it is wired into the `ci.yml` `gates` job. The Turbo
commands cover affected build and test work.

This repository is licensed under Apache-2.0. Member packages carry their own
licenses: some are Apache-2.0 and some are intentionally different (for
example `apps/notes` and `apps/ui` are MIT). The standard census
(`tooling/ci/tests/standard/census.ts`) records the exceptions; follow each
package's own `LICENSE` and `license` field.
