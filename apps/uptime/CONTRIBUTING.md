# Contributing

Open Uptime is a Bun and TypeScript project.

## Local Setup

```bash
bun install
bun run build
bun run typecheck
bun test
```

Use `HASNA_UPTIME_HOME` or `HASNA_UPTIME_DB` when testing against disposable
state.

## Pull Requests

- Keep changes scoped and covered by tests.
- Do not commit secrets, local databases, `.hasna`, `.codewith`, `.takumi`, or
  logs.
- Preserve the public CLI, MCP, and SDK surfaces unless the change is explicitly
  a breaking release.
- Run `bun run build`, `bun run typecheck`, and `bun test` before submitting.
