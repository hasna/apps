# Contributing

This repo is the public `@hasna/*` apps monorepo. Add one member app per
directory under `apps/`, named for the package it publishes:
`apps/<name>` maps to `@hasna/<name>`.

Each member app ships four surfaces: a CLI bin, an MCP server bin, a
`-serve` server bin, and an importable `./sdk` module. Keep domain logic in
the member app and route interfaces through that shared implementation.

All changes land PR-first from a task worktree. Never push directly to `main`.

Before opening or updating a PR, run the relevant gates:

```bash
bun run check
bunx turbo run build --affected
bunx turbo run test --affected
```

`bun run check` covers names, secrets, manifests, and the publish guard. The
Turbo commands cover affected build and test work.

This repo and every member package are licensed under Apache-2.0.
