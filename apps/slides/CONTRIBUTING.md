# Contributing

`@hasna/slides` uses [Bun](https://bun.sh).

```bash
bun install
bun run typecheck   # tsc --noEmit
bun test            # SDK core unit tests
bun run build:lib   # build the library (SDK + React viewer + d.ts)

cd dashboard && bun install && bun run dev   # run the studio
```

## Guidelines

- Keep the core SDK (`src/`, excluding `src/react/`) **headless** — no React,
  no DOM assumptions — so it stays usable server-side.
- Put UI in the React viewer (`src/react/`) or the `dashboard/`.
- Add unit tests for new SDK behavior; `bun test` and `bun run typecheck` must
  pass before opening a PR.
- Dependencies must be MIT (or otherwise permissive, non-copyleft). No
  GPL/AGPL/LGPL.
