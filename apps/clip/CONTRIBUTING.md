# Contributing

Open Clip is a Bun and TypeScript package. Prefer small, tested changes that
keep the CLI, SDK, MCP, and server behavior aligned over the same storage layer.

## Development

```bash
bun install
bun run build
bun run typecheck
bun test
```

Use temporary state for tests and smokes:

```bash
HOME="$(mktemp -d)" HASNA_CLIP_DB_PATH="$HOME/clip.db" bun run src/cli/index.ts status --json
```

## Boundaries

- Keep the package local and self-hosted only.
- Do not add private package dependencies or command stubs for hosted services.
- Mutations from the macOS app must go through the `clip` CLI.
