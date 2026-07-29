# Contributing

Open Clip is a Bun and TypeScript package. Prefer small, tested changes that
keep the CLI, SDK, MCP, and server behavior aligned over the same storage layer.

## Development

```bash
bun install
bun run check
bunx --bun npm pack --dry-run
```

`bun run check` runs the TypeScript check, tests, contract conformance, package
build, and static macOS source check. The separate GitHub Actions macOS job
compiles the Swift package.

Use temporary state for tests and smokes:

```bash
clip_state_dir="$(mktemp -d)"
HASNA_CLIP_HOME="$clip_state_dir" bun run src/cli/index.ts status --json
```

## Boundaries

- Keep the package local and self-hosted only.
- Do not add private package dependencies or command stubs for hosted services.
- Mutations from the macOS app must go through the `clip` CLI.
- Keep CLI, SDK, MCP, HTTP, and documentation behavior aligned over the same
  local storage layer.
